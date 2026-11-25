import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import { EditorView } from '@codemirror/view';
import type { ExtensionUpdateBehavior, ExtensionsManagerState } from '../src/chrome/extensionsModal';
import type { UserSettings } from '../src/chrome/settingsModal';
import { setMarkdownPreviewMode, syncScroll } from '../src/chrome/markdownPreview';
import { createLivePreviewExtension, livePreviewExtension } from '../src/chrome/liveEditorPreview';
import { beginExtensionScript, endExtensionScript, resetThemeContributions } from '../src/chrome/themeExtensions';
import {
  renderMarkdownToHtml,
  setMarkdownSyntaxStandard,
  getMarkdownSyntaxStandard,
  registerMarkdownRenderer,
  setActiveMarkdownRenderer,
  getActiveMarkdownRenderer,
  renderMarkdown,
  type MarkdownRendererEngine,
} from '../src/modules/markdown-renderer';
import * as editor from './utils/editor';
import { initChromeUI } from '../src/chrome';

describe('Chrome UI', () => {
  let mockedWebModules: {
    search: {
      setState: jest.Mock;
      updateQuery: jest.Mock;
      findNext: jest.Mock;
      findPrevious: jest.Mock;
      replaceNext: jest.Mock;
      replaceAll: jest.Mock;
      getCounterInfo: jest.Mock;
    };
    toc: {
      getTableOfContents: jest.Mock;
      gotoHeader: jest.Mock;
    };
    core: {
      getEditorText: jest.Mock;
      restoreFocus: jest.Mock;
    };
    selection: {
      getText: jest.Mock;
      gotoLine: jest.Mock;
    };
    api: {
      getMenuItemState: jest.Mock;
      handleContextMenuAction: jest.Mock;
    };
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.\n\n## Section\n\nMore text.');

    mockedWebModules = {
      search: {
        setState: jest.fn(),
        updateQuery: jest.fn(),
        findNext: jest.fn(),
        findPrevious: jest.fn(),
        replaceNext: jest.fn(),
        replaceAll: jest.fn(),
        getCounterInfo: jest.fn(() => ({ currentIndex: 0, numberOfItems: 0 })),
      },
      toc: {
        getTableOfContents: jest.fn(() => [
          { title: 'Hello', level: 1, from: 0, to: 7, selected: true, lineNumber: 1 },
          { title: 'Section', level: 2, from: 10, to: 19, selected: false, lineNumber: 4 },
        ]),
        gotoHeader: jest.fn(),
      },
      core: {
        getEditorText: jest.fn(() => window.editor.state.doc.toString()),
        restoreFocus: jest.fn(),
      },
      selection: {
        getText: jest.fn(() => ''),
        gotoLine: jest.fn(),
      },
      api: {
        getMenuItemState: jest.fn(() => ({})),
        handleContextMenuAction: jest.fn(),
      },
    };

    window.webModules = mockedWebModules as unknown as typeof window.webModules;
    initChromeUI();
  });

  test('initChromeUI creates root and exposes controller', () => {
    expect(document.getElementById('markedit-chrome-root')).not.toBeNull();
    expect(window.chromeUI).toBeDefined();
  });

  test('openFindBar renders find bar and enables search state', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);

    expect(document.querySelector('.markedit-chrome-findbar')).not.toBeNull();
    expect(mockedWebModules.search.setState).toHaveBeenCalledWith({ enabled: true });
  });

  test('openFindBar with replace shows replace controls', () => {
    (window.chromeUI as ChromeUI).openFindBar(true);

    const replaceRow = document.querySelector('.markedit-chrome-replace-row');
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.classList.contains('markedit-chrome-hidden')).toBe(false);
  });

  test('toggleToc renders headings and supports filtering', () => {
    (window.chromeUI as ChromeUI).toggleToc();

    const items = document.querySelectorAll('.markedit-chrome-toc .markedit-chrome-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Hello');
    expect(items[1].textContent).toBe('Section');

    const filter = document.querySelector('.markedit-chrome-toc input') as HTMLInputElement;
    filter.value = 'sect';
    filter.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelectorAll('.markedit-chrome-toc .markedit-chrome-list-item').length).toBe(1);
  });

  test('toggleStatistics computes document statistics', () => {
    (window.chromeUI as ChromeUI).toggleStatistics();

    const body = document.querySelector('.markedit-chrome-statistics .markedit-chrome-popover-body');
    expect(body?.textContent).toContain('Characters');
    expect(body?.textContent).toContain('Words');
    expect(body?.textContent).toContain('Document');
  });

  test('openGotoLine prompts and jumps on Enter', () => {
    (window.chromeUI as ChromeUI).openGotoLine();

    const input = document.querySelector('.markedit-chrome-goto input') as HTMLInputElement;
    expect(input).not.toBeNull();

    input.value = '2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(mockedWebModules.selection.gotoLine).toHaveBeenCalledWith({ lineNumber: 2 });
  });

  test('closeAll removes active panel', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);
    (window.chromeUI as ChromeUI).closeAll();

    expect(document.querySelector('.markedit-chrome-findbar')).toBeNull();
  });

  test('Escape closes overlays and restores focus', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.markedit-chrome-findbar')).toBeNull();
    expect(mockedWebModules.core.restoreFocus).toHaveBeenCalled();
  });

  test('showTextBox renders modal and resolves with value on OK', async () => {
    const promise = (window.chromeUI as ChromeUI).showTextBox({ title: 'Rename', defaultValue: 'old', placeholder: 'Name' });

    const input = document.querySelector('.markedit-chrome-modal-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('old');
    expect(input.placeholder).toBe('Name');
    expect(document.querySelector('.markedit-chrome-modal-title')?.textContent).toBe('Rename');

    input.value = 'new';
    (document.querySelector('.markedit-chrome-action-button') as HTMLButtonElement | null)?.click();

    await expect(promise).resolves.toBe('new');
    expect(document.querySelector('.markedit-chrome-modal-backdrop')).toBeNull();
  });

  test('showTextBox resolves with value on Enter', async () => {
    const promise = (window.chromeUI as ChromeUI).showTextBox({ defaultValue: 'initial' });

    const input = document.querySelector('.markedit-chrome-modal-input') as HTMLInputElement;
    input.value = 'submitted';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await expect(promise).resolves.toBe('submitted');
  });

  test('showTextBox resolves with undefined on Cancel', async () => {
    const promise = (window.chromeUI as ChromeUI).showTextBox({ title: 'Discard' });

    const buttons = document.querySelectorAll('.markedit-chrome-modal-footer .markedit-chrome-button');
    const cancelButton = Array.from(buttons).find(button => button.textContent === 'Cancel') as HTMLButtonElement;
    cancelButton.click();

    await expect(promise).resolves.toBeUndefined();
  });

  test('showTextBox resolves with undefined on Escape', async () => {
    const promise = (window.chromeUI as ChromeUI).showTextBox({});

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(promise).resolves.toBeUndefined();
    expect(mockedWebModules.core.restoreFocus).toHaveBeenCalled();
  });

  test('showContextMenu renders items and separators', () => {
    (window.chromeUI as ChromeUI).showContextMenu({
      location: { x: 100, y: 200 },
      items: [
        { separator: true },
        { separator: false, title: 'Cut', actionID: 'cut' },
        { separator: false, title: 'Copy', actionID: 'copy', modifiers: ['Ctrl'], key: 'C' },
        { separator: false, title: 'Paste', actionID: 'paste' },
      ],
    });

    const menu = document.querySelector('.markedit-chrome-context-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');

    const items = document.querySelectorAll('.markedit-chrome-context-item');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain('Cut');
    expect(items[1].textContent).toContain('Copy');
    expect(items[1].textContent).toContain('Ctrl+C');
    expect(items[2].textContent).toContain('Paste');

    expect(document.querySelectorAll('.markedit-chrome-context-separator').length).toBe(1);
  });

  test('showContextMenu invokes handleContextMenuAction when clicking an item', () => {
    (window.chromeUI as ChromeUI).showContextMenu({
      location: { x: 0, y: 0 },
      items: [
        { separator: false, title: 'Delete', actionID: 'delete' },
      ],
    });

    const item = document.querySelector('.markedit-chrome-context-item') as HTMLElement;
    item.click();

    expect(mockedWebModules.api.handleContextMenuAction).toHaveBeenCalledWith({ id: 'delete' });
    expect(document.querySelector('.markedit-chrome-context-backdrop')).toBeNull();
  });

  test('showContextMenu renders disabled and checked states', () => {
    mockedWebModules.api.getMenuItemState.mockImplementation(args => {
      const { id } = args as { id: string };
      if (id === 'bold') {
        return { isSelected: true };
      }
      if (id === 'italic') {
        return { isEnabled: false };
      }
      return {};
    });

    (window.chromeUI as ChromeUI).showContextMenu({
      location: { x: 0, y: 0 },
      items: [
        { separator: false, title: 'Bold', actionID: 'bold', stateGetterID: 'bold' },
        { separator: false, title: 'Italic', actionID: 'italic', stateGetterID: 'italic' },
      ],
    });

    const items = document.querySelectorAll('.markedit-chrome-context-item');
    expect(items[0].textContent).toContain('✓ Bold');
    expect(items[1].classList.contains('markedit-chrome-disabled')).toBe(true);
  });

  test('showContextMenu renders nested submenus', () => {
    (window.chromeUI as ChromeUI).showContextMenu({
      location: { x: 0, y: 0 },
      items: [
        {
          separator: false,
          title: 'Share',
          children: [
            { separator: false, title: 'Email', actionID: 'email' },
          ],
        },
      ],
    });

    const submenu = document.querySelector('.markedit-chrome-submenu');
    expect(submenu).not.toBeNull();
    expect(submenu?.textContent).toContain('Email');
  });
});

describe('Extensions Manager', () => {
  let invokeMock: jest.Mock<(_cmd: string, args?: Record<string, unknown>) => Promise<ExtensionsManagerState>>;

  const sampleState: ExtensionsManagerState = {
    catalog: [
      {
        id: 'markedit-preview',
        name: 'MarkEdit Preview',
        description: 'Live preview panel for Markdown.',
        author: 'MarkEdit-app',
        homepage: 'https://github.com/MarkEdit-app/markedit-preview',
        category: 'extension',
        featured: true,
        latest: { version: '1.2.0', url: 'https://example.com/preview.zip', sha256: 'abc', notes: 'Bug fixes' },
      },
      {
        id: 'markedit-theme-catppuccin',
        name: 'Catppuccin Theme',
        description: 'A soothing pastel theme.',
        author: 'Catppuccin',
        homepage: 'https://github.com/Catppuccin/markedit-theme-catppuccin',
        category: 'theme',
        colorScheme: 'both',
        colorPatterns: [
          '#eff1f5,#4c4f69,#1e66f5,#d20f39,#40a02b,#9ca0b0',
          '#1e1e2e,#cdd6f4,#89b4fa,#f38ba8,#a6e3a1,#6c7086',
        ],
        featured: false,
        latest: { version: '2.0.0', url: 'https://example.com/catppuccin.zip', sha256: 'def' },
      },
    ],
    installed: [
      {
        id: 'markedit-preview',
        version: '1.1.0',
        file: 'markedit-preview.zip',
        enabled: true,
      },
    ],
    updates: [
      {
        id: 'markedit-preview',
        installedVersion: '1.1.0',
        latestVersion: '1.2.0',
      },
    ],
    updateBehavior: 'quiet',
    appVersion: '1.0.0',
  };

  const refreshedState: ExtensionsManagerState = {
    catalog: sampleState.catalog,
    installed: [],
    updates: [],
    updateBehavior: 'notify',
    appVersion: '1.0.0',
  };

  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  async function openAndRender(tab: 'discover' | 'installed' | 'updates'): Promise<void> {
    (window.chromeUI as ChromeUI).openExtensionsManager(tab);
    await tick();
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.');

    invokeMock = jest.fn(async (_cmd: string, args?: Record<string, unknown>): Promise<ExtensionsManagerState> => {
      if (args !== undefined && 'behavior' in args) {
        return { ...sampleState, updateBehavior: args.behavior as ExtensionUpdateBehavior };
      }

      return sampleState;
    });

    window.__TAURI_INTERNALS__ = { invoke: invokeMock } as unknown as typeof window.__TAURI_INTERNALS__;
    window.webModules = {
      core: { restoreFocus: jest.fn() },
    } as unknown as typeof window.webModules;
    initChromeUI();
  });

  test('openExtensionsManager renders Discover cards and fetches state', async () => {
    await openAndRender('discover');

    expect(document.querySelector('.markedit-chrome-extensions-backdrop')).not.toBeNull();
    expect(document.querySelector('.markedit-chrome-extensions-title')?.textContent).toBe('Extensions');
    expect(invokeMock).toHaveBeenCalledWith('extensions_get_state', { forceRefresh: false });

    const cards = document.querySelectorAll('.markedit-chrome-extensions-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Catppuccin Theme');

    const icons = document.querySelectorAll('.markedit-ext-icon');
    expect(icons.length).toBe(1);

    expect(document.querySelector('.markedit-ext-theme-preview')).not.toBeNull();
    expect(document.querySelectorAll('.markedit-ext-theme-pane').length).toBe(2);
  });

  test('built-in extensions are listed in Installed with a toggle and no Uninstall', async () => {
    invokeMock.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => ({
      ...sampleState,
      builtins: [{
        id: 'supermarkdown',
        name: 'SuperMarkdown',
        description: 'Markdown parser',
        version: '0.1.0',
        enabled: args?.id === 'supermarkdown' ? Boolean(args.enabled) : true,
      }],
    }));
    await openAndRender('installed');

    const row = document.querySelector('[data-builtin-id="supermarkdown"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('SuperMarkdown');
    expect(row.textContent).toContain('Built-in');
    expect(row.querySelector('[data-action="uninstall"]')).toBeNull();
    // Built-in first, then the installed extension.
    const rows = document.querySelectorAll('.markedit-chrome-extensions-row');
    expect(rows[0]).toBe(row);
    expect(rows.length).toBe(2);

    const toggle = row.querySelector('[data-action="toggle-enabled"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    expect(invokeMock).toHaveBeenCalledWith('extensions_set_enabled', { id: 'supermarkdown', enabled: false });
    const updated = document.querySelector('[data-builtin-id="supermarkdown"] [data-action="toggle-enabled"]') as HTMLInputElement;
    expect(updated.checked).toBe(false);
  });

  test('search filters Discover cards', async () => {
    await openAndRender('discover');

    const search = document.querySelector('.markedit-chrome-extensions-search') as HTMLInputElement;
    search.value = 'catppuccin';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const cards = document.querySelectorAll('.markedit-chrome-extensions-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Catppuccin Theme');
  });

  test('category pills filter Discover cards', async () => {
    await openAndRender('discover');

    const pills = document.querySelectorAll('.markedit-chrome-extensions-pill');
    const themesPill = Array.from(pills).find(pill => pill.textContent === 'Themes') as HTMLButtonElement;
    themesPill.click();

    const cards = document.querySelectorAll('.markedit-chrome-extensions-card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Catppuccin Theme');
  });

  test('clicking Install invokes extensions_install', async () => {
    await openAndRender('discover');

    const installButton = document.querySelector('[data-action="install"][data-extension-id="markedit-theme-catppuccin"]') as HTMLButtonElement;
    expect(installButton).not.toBeNull();
    installButton.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_install', { id: 'markedit-theme-catppuccin' });
  });

  test('Installed tab lists extensions and supports toggle/uninstall', async () => {
    await openAndRender('installed');

    const rows = document.querySelectorAll('.markedit-chrome-extensions-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('MarkEdit Preview');

    const toggle = document.querySelector('[data-action="toggle-enabled"][data-extension-id="markedit-preview"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_set_enabled', { id: 'markedit-preview', enabled: false });

    await tick();

    const uninstallButton = document.querySelector('[data-action="uninstall"][data-extension-id="markedit-preview"]') as HTMLButtonElement;
    uninstallButton.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_uninstall', { id: 'markedit-preview' });
  });

  test('Updates tab lists pending updates and Update All invokes extensions_update', async () => {
    await openAndRender('updates');

    const rows = document.querySelectorAll('.markedit-chrome-extensions-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('1.1.0');
    expect(rows[0].textContent).toContain('1.2.0');

    const updateAllButton = document.querySelector('[data-action="update-all"]') as HTMLButtonElement;
    expect(updateAllButton).not.toBeNull();
    expect(updateAllButton.textContent).toBe('Update All (1)');
    updateAllButton.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_update', {});
  });

  test('changing update behavior invokes extensions_set_update_behavior', async () => {
    await openAndRender('discover');

    const select = document.querySelector('[data-action="update-behavior"]') as HTMLSelectElement;
    select.value = 'automatic';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(invokeMock).toHaveBeenCalledWith('extensions_set_update_behavior', { behavior: 'automatic' });
  });

  test('refresh button invokes extensions_get_state with forceRefresh', async () => {
    await openAndRender('discover');

    const refreshButton = Array.from(document.querySelectorAll('.markedit-chrome-extensions-header-actions .markedit-chrome-button'))
      .find(button => button.textContent === '↻') as HTMLButtonElement;
    refreshButton.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_get_state', { forceRefresh: true });
  });

  test('Install from URL expands input and invokes extensions_install_url', async () => {
    await openAndRender('discover');

    const urlButton = Array.from(document.querySelectorAll('.markedit-chrome-extensions-header-actions .markedit-chrome-button'))
      .find(button => button.textContent === 'Install from URL...') as HTMLButtonElement;
    urlButton.click();

    const urlInput = document.querySelector('.markedit-chrome-extensions-url-input') as HTMLInputElement;
    expect(urlInput).not.toBeNull();

    urlInput.value = 'https://example.com/custom.zip';
    urlInput.dispatchEvent(new Event('input', { bubbles: true }));
    urlInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(invokeMock).toHaveBeenCalledWith('extensions_install_url', { url: 'https://example.com/custom.zip' });
  });

  test('Open Folder invokes extensions_open_folder', async () => {
    await openAndRender('discover');

    const folderButton = Array.from(document.querySelectorAll('.markedit-chrome-extensions-header-actions .markedit-chrome-button'))
      .find(button => button.textContent === 'Open Folder') as HTMLButtonElement;
    folderButton.click();

    expect(invokeMock).toHaveBeenCalledWith('extensions_open_folder', {});
  });

  test('Ctrl+Shift+X is left to Format > Strikethrough', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', ctrlKey: true, shiftKey: true, bubbles: true }));

    expect(document.querySelector('.markedit-chrome-extensions-backdrop')).toBeNull();
  });

  test('Escape closes Extensions Manager and restores focus', async () => {
    await openAndRender('discover');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.markedit-chrome-extensions-backdrop')).toBeNull();
    expect((window.webModules.core as { restoreFocus: jest.Mock }).restoreFocus).toHaveBeenCalled();
  });

  test('gracefully falls back to empty state when Tauri internals are unavailable', async () => {
    window.__TAURI_INTERNALS__ = undefined;
    (window.chromeUI as ChromeUI).openExtensionsManager('discover');

    await tick();

    expect(document.querySelector('.markedit-chrome-extensions-empty')?.textContent).toBe('No extensions found.');
  });

  test('displays error banner when IPC call rejects', async () => {
    let installCalls = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>): Promise<ExtensionsManagerState> => {
      if (cmd === 'extensions_install' && args !== undefined && 'id' in args && args.id === 'markedit-theme-catppuccin') {
        installCalls += 1;
        if (installCalls === 1) {
          throw new Error('Network unavailable');
        }
      }

      return sampleState;
    });

    await openAndRender('discover');

    const installButton = document.querySelector('[data-action="install"][data-extension-id="markedit-theme-catppuccin"]') as HTMLButtonElement;
    installButton.click();

    await tick();

    const errorBanner = document.querySelector('.markedit-chrome-extensions-error') as HTMLElement;
    expect(errorBanner).not.toBeNull();
    expect(errorBanner.textContent).toContain('Network unavailable');
  });

  test('Update All button is hidden when no updates are available', async () => {
    invokeMock.mockResolvedValue(refreshedState);
    await openAndRender('updates');

    const updateAllButton = document.querySelector('[data-action="update-all"]') as HTMLButtonElement;
    expect(updateAllButton.classList.contains('markedit-chrome-hidden')).toBe(true);
  });
});

describe('Settings Modal', () => {
  let settingsInvokeMock: jest.Mock<(_cmd: string, _args?: Record<string, unknown>) => Promise<UserSettings>>;
  let configSetters: Record<string, jest.Mock>;

  const sampleSettings: UserSettings = {
    theme: 'github-light',
    themeExtension: '',
    fontFamily: 'ui-monospace',
    fontSize: 16,
    showLineNumbers: true,
    showActiveLineIndicator: true,
    invisiblesBehavior: 'selection',
    typewriterMode: false,
    focusMode: false,
    livePreview: false,
    lineWrapping: true,
    lineHeight: 1.5,
    tabKeyBehavior: 2,
    indentUnit: '    ',
    suggestWhileTyping: true,
    autoCharacterPairs: true,
    smartQuotesEnabled: true,
    insertFinalNewline: true,
    trimTrailingWhitespace: false,
    appearance: 'system',
    newFilenameExtension: 'md',
    defaultTextEncoding: 'UTF-8',
    defaultLineBreak: '\n',
    startupBehavior: 'newDocument',
    checkForUpdates: true,
    reduceTransparency: false,
    markdownRenderer: 'extended',
    diagramServer: 'https://kroki.io',
    diagramRendering: 'auto',
    plantumlCommand: 'plantuml',
    d2Command: 'd2',
    previewThemeStyles: {},
  };

  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });
  const themeButton = () => document.querySelector('.markedit-theme-picker-button') as HTMLButtonElement;
  const themeOptions = () => Array.from(document.querySelectorAll<HTMLElement>('.markedit-theme-picker-option'));
  const selectTheme = (value: string) => {
    themeButton().click();
    const option = themeOptions().find(element => element.dataset.value === value);
    expect(option).toBeDefined();
    option?.click();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.');

    settingsInvokeMock = jest.fn(async (cmd: string, _args?: Record<string, unknown>): Promise<UserSettings> => {
      if (cmd === 'extensions_get_state') {
        return {
          catalog: [],
          installed: [],
          updates: [],
          updateBehavior: 'quiet',
          appVersion: '1.0.0',
        } as unknown as UserSettings;
      }

      return sampleSettings;
    });
    window.__TAURI_INTERNALS__ = { invoke: settingsInvokeMock } as unknown as typeof window.__TAURI_INTERNALS__;

    configSetters = {
      setTheme: jest.fn(),
      setFontSize: jest.fn(),
      setShowLineNumbers: jest.fn(),
      setShowActiveLineIndicator: jest.fn(),
      setInvisiblesBehavior: jest.fn(),
      setTypewriterMode: jest.fn(),
      setFocusMode: jest.fn(),
      setLineWrapping: jest.fn(),
      setLineHeight: jest.fn(),
      setTabKeyBehavior: jest.fn(),
      setIndentUnit: jest.fn(),
      setSuggestWhileTyping: jest.fn(),
      setSmartQuotesEnabled: jest.fn(),
      setAutoCharacterPairs: jest.fn(),
      setDefaultLineBreak: jest.fn(),
    };

    window.webModules = {
      core: { restoreFocus: jest.fn() },
      config: configSetters,
    } as unknown as typeof window.webModules;

    initChromeUI();
  });

  test('openSettings renders tabs and theme drop-down', async () => {
    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    expect(document.querySelector('.markedit-chrome-settings-backdrop')).not.toBeNull();
    expect(document.querySelector('.markedit-chrome-settings-title')?.textContent).toBe('Settings');

    const tabs = document.querySelectorAll('.markedit-chrome-settings-tab');
    expect(tabs.length).toBe(5);
    expect(Array.from(tabs).map(tab => tab.textContent)).toEqual(['General', 'Editor', 'Assistant', 'Preview', 'Window']);

    // A drop-down whose button and options show each theme's colors.
    expect(themeButton().dataset.value).toBe(sampleSettings.theme);
    expect(themeButton().querySelector('.markedit-theme-swatch')).not.toBeNull();
    expect(themeOptions().length).toBe(16);
    expect(themeOptions().every(option => option.querySelector('.markedit-theme-swatch') !== null)).toBe(true);
    expect(themeOptions().find(option => option.getAttribute('aria-selected') === 'true')?.dataset.value).toBe(sampleSettings.theme);

    expect(document.querySelector('.markedit-settings-more-themes')).not.toBeNull();
  });

  test('theme drop-down works with the keyboard, and Escape closes only the list', async () => {
    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    themeButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(themeButton().getAttribute('aria-expanded')).toBe('true');
    const list = document.querySelector('.markedit-theme-picker-list') as HTMLElement;
    expect(list.getAttribute('aria-activedescendant')).toBe(themeOptions()[0].id);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(themeButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.markedit-chrome-settings-backdrop')).not.toBeNull();

    themeButton().click();
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { theme: 'github-dark' } });
  });

  test('selecting a theme invokes settings_update and config.setTheme', async () => {
    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    selectTheme('github-dark');

    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { theme: 'github-dark' } });
    expect(configSetters.setTheme).toHaveBeenCalledWith({ name: 'github-dark' });
  });

  test('installed theme extensions are offered as themes and saved as the theme extension', async () => {
    // A theme extension recorded while extension scripts ran (see themeExtensions.ts).
    const theming = window as unknown as { __markeditTheming__?: { customThemes: Record<string, unknown> } };
    theming.__markeditTheming__ = { customThemes: {} };
    resetThemeContributions();
    beginExtensionScript();
    theming.__markeditTheming__.customThemes.dark = 'one-dark';
    endExtensionScript('markedit-theme-one-dark.js');

    // The host keeps what was saved.
    let saved: UserSettings = { ...sampleSettings };
    settingsInvokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'settings_update') {
        saved = { ...saved, ...(args?.patch as Partial<UserSettings>) };
      }
      return saved;
    });

    try {
      (window.chromeUI as ChromeUI).openSettings('editor');
      await tick();

      const option = themeOptions()
        .find(element => element.closest('[role="group"]')?.textContent.startsWith('Extensions') === true && element.textContent.includes('One Dark'));
      expect(option).toBeDefined();
      selectTheme(option?.dataset.value ?? '');
      await tick();
      expect(themeButton().dataset.value).toBe('extension:markedit-theme-one-dark.js');

      expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { themeExtension: 'markedit-theme-one-dark.js' } });
      expect(theming.__markeditTheming__.customThemes).toEqual({ dark: 'one-dark' });

      // Back to a built-in theme: the extension's colors are removed.
      selectTheme('github-light');
      await tick();
      expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { themeExtension: '' } });
      expect(theming.__markeditTheming__.customThemes).toEqual({});
    } finally {
      resetThemeContributions();
      delete theming.__markeditTheming__;
    }
  });

  test('toggle switch invokes settings_update and config setter', async () => {
    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    const toggle = document.querySelector('.markedit-settings-toggle input') as HTMLInputElement;
    expect(toggle).not.toBeNull();
    toggle.click();

    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { showLineNumbers: false } });
    expect(configSetters.setShowLineNumbers).toHaveBeenCalledWith({ enabled: false });
  });

  test('Assistant tab renders its controls', async () => {
    (window.chromeUI as ChromeUI).openSettings('assistant');
    await tick();

    const toggles = document.querySelectorAll('.markedit-settings-toggle');
    expect(toggles.length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).toContain('Insert Final Newline');
    expect(document.body.textContent).toContain('Smart Quotes');
  });

  test('General tab renders controls and Reset to Defaults invokes settings_reset', async () => {
    (window.chromeUI as ChromeUI).openSettings('general');
    await tick();

    expect(document.body.textContent).toContain('Appearance');
    expect(document.body.textContent).toContain('Default Line Endings');

    const resetButton = Array.from(document.querySelectorAll('.markedit-chrome-button'))
      .find(button => button.textContent === 'Reset to Defaults') as HTMLButtonElement;
    expect(resetButton).not.toBeNull();
    resetButton.click();

    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_reset', undefined);
  });

  test('Window tab renders Reduce Transparency toggle', async () => {
    (window.chromeUI as ChromeUI).openSettings('window');
    await tick();

    expect(document.body.textContent).toContain('Reduce Transparency');
  });

  test('Preview tab saves per-theme preview styles and applies them to the preview', async () => {
    (window.config as { theme?: string }).theme = 'github-light';
    // The host keeps what was saved.
    let saved: UserSettings = { ...sampleSettings };
    settingsInvokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'settings_update') {
        saved = { ...saved, ...(args?.patch as Partial<UserSettings>) };
      }
      return saved;
    });
    (window.chromeUI as ChromeUI).openSettings('preview');
    await tick();

    const themeSelect = document.querySelector('.markedit-chrome-settings-body select') as HTMLSelectElement;
    expect(themeSelect.value).toBe('github-light');

    const size = document.querySelector('input[data-element="h1"][data-property="fontSize"]') as HTMLInputElement;
    size.value = '32';
    size.dispatchEvent(new Event('change'));
    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', {
      patch: { previewThemeStyles: { 'github-light': { h1: { fontSize: 32 } } } },
    });
    expect(document.getElementById('markedit-preview-theme-styles')?.textContent)
      .toContain('.markedit-preview-body h1 { font-size: 32px; }');

    const color = document.querySelector('input[data-element="body"][data-property="color"]') as HTMLInputElement;
    color.value = '#336699';
    color.dispatchEvent(new Event('change'));
    await tick();
    expect(document.getElementById('markedit-preview-theme-styles')?.textContent)
      .toContain('.markedit-preview-body { color: #336699; }');

    // Styles of another theme are kept apart and not applied to this one.
    const otherTheme = document.querySelector('.markedit-chrome-settings-body select') as HTMLSelectElement;
    otherTheme.value = 'dracula';
    otherTheme.dispatchEvent(new Event('change'));
    await tick();
    expect((document.querySelector('input[data-element="h1"][data-property="fontSize"]') as HTMLInputElement).value).toBe('');
    expect(document.getElementById('markedit-preview-theme-styles')?.textContent).toContain('font-size: 32px');

    window.chromeUI?.setPreviewThemeStyles({});
  });

  test('preview styles follow the theme in use', () => {
    const config = window.config as { theme?: string; themeExtension?: string };
    config.theme = 'github-light';
    config.themeExtension = '';
    window.chromeUI?.setPreviewThemeStyles({
      'github-light': { h2: { color: '#112233', fontWeight: 700 } },
      dracula: { h2: { fontFamily: 'Georgia; } body { display: none', fontSize: 500 } },
      bogus: 'not an object',
    });
    const css = () => document.getElementById('markedit-preview-theme-styles')?.textContent ?? '';
    expect(css()).toContain('h2 { font-weight: 700; color: #112233; }');

    config.theme = 'dracula';
    window.dispatchEvent(new Event('editor-colors-changed'));
    // Values are sanitized: nothing escapes the declaration, sizes are clamped.
    expect(css()).toContain('h2 { font-family: Georgia  body  display none; font-size: 96px; }');
    expect(css()).not.toContain('}  body {');

    config.theme = 'cobalt';
    window.dispatchEvent(new Event('editor-colors-changed'));
    expect(document.getElementById('markedit-preview-theme-styles')).toBeNull();

    window.chromeUI?.setPreviewThemeStyles({});
    config.theme = 'github-light';
  });

  test('Get More Themes opens Extensions Manager', async () => {
    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    const moreButton = document.querySelector('.markedit-settings-more-themes') as HTMLButtonElement;
    moreButton.click();

    expect(document.querySelector('.markedit-chrome-extensions-backdrop')).not.toBeNull();
  });

  test('normalizes dotted settings keys from backend and updates font size via stepper buttons', async () => {
    settingsInvokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'settings_get_state') {
        return {
          'editor.lightTheme': 'dracula',
          'editor.fontFamily': 'Consolas, monospace',
          'editor.fontSize': 20,
          'editor.showLineNumbers': false,
          'assistant.autoCharacterPairs': true,
        } as unknown as UserSettings;
      }

      if (cmd === 'settings_update') {
        const patch = (args?.patch ?? {}) as Record<string, unknown>;
        return {
          'editor.lightTheme': 'dracula',
          'editor.fontFamily': 'Consolas, monospace',
          'editor.fontSize': patch.fontSize ?? 20,
          'editor.showLineNumbers': patch.showLineNumbers ?? false,
          'assistant.autoCharacterPairs': patch.autoCharacterPairs ?? true,
        } as unknown as UserSettings;
      }

      return sampleSettings;
    });

    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    const numberInput = document.querySelector('.markedit-settings-number') as HTMLInputElement;
    expect(numberInput).not.toBeNull();
    expect(numberInput.value).toBe('20');

    const plusBtn = Array.from(document.querySelectorAll('.markedit-settings-stepper-btn'))
      .find(btn => btn.textContent === '+') as HTMLButtonElement;
    expect(plusBtn).toBeDefined();
    plusBtn.click();
    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { fontSize: 21 } });
    expect(configSetters.setFontSize).toHaveBeenCalledWith({ fontSize: 21 });
    expect((document.querySelector('.markedit-settings-number') as HTMLInputElement).value).toBe('21');
  });

  test('Assistant tab autoCharacterPairs toggle calls config.setAutoCharacterPairs', async () => {
    (window.chromeUI as ChromeUI).openSettings('assistant');
    await tick();

    const toggles = document.querySelectorAll('.markedit-settings-toggle input');
    // Order on Assistant tab: insertFinalNewline (0), trimTrailingWhitespace (1), suggestWhileTyping (2), autoCharacterPairs (3), smartQuotesEnabled (4)
    expect(toggles.length).toBe(5);
    (toggles[3] as HTMLInputElement).click();
    await tick();

    expect(settingsInvokeMock).toHaveBeenCalledWith('settings_update', { patch: { autoCharacterPairs: false } });
    expect(configSetters.setAutoCharacterPairs).toHaveBeenCalledWith({ enabled: false });
  });
});

describe('Version History Modal', () => {
  let versionsInvokeMock: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;
  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.');

    versionsInvokeMock = jest.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === 'versions_list') {
        return { filePath: '/docs/note.md', versions: ['v3', 'v2', 'v1'] };
      }

      if (cmd === 'versions_get_content' && args !== undefined && 'version' in args) {
        return `Content of ${args.version}`;
      }

      if (cmd === 'versions_restore') {
        return true;
      }

      if (cmd === 'versions_delete_all') {
        return true;
      }

      return undefined;
    });

    window.__TAURI_INTERNALS__ = { invoke: versionsInvokeMock } as unknown as typeof window.__TAURI_INTERNALS__;
    window.webModules = {
      core: { restoreFocus: jest.fn() },
    } as unknown as typeof window.webModules;

    initChromeUI();
  });

  test('openVersionHistory lists versions and previews first', async () => {
    (window.chromeUI as ChromeUI).openVersionHistory();
    await tick();

    expect(document.querySelector('.markedit-chrome-versions-backdrop')).not.toBeNull();
    expect(document.querySelector('.markedit-chrome-versions-title')?.textContent).toBe('Version History');
    expect(versionsInvokeMock).toHaveBeenCalledWith('versions_list', undefined);

    const items = document.querySelectorAll('.markedit-chrome-versions-item');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('v3');
    expect(items[0].classList.contains('is-selected')).toBe(true);

    expect(versionsInvokeMock).toHaveBeenCalledWith('versions_get_content', { version: 'v3' });

    const preview = document.querySelector('.markedit-chrome-versions-preview-content') as HTMLTextAreaElement;
    expect(preview.value).toBe('Content of v3');
  });

  test('selecting a version loads its content', async () => {
    (window.chromeUI as ChromeUI).openVersionHistory();
    await tick();

    const items = document.querySelectorAll('.markedit-chrome-versions-item') as NodeListOf<HTMLButtonElement>;
    items[2].click();

    await tick();

    expect(versionsInvokeMock).toHaveBeenCalledWith('versions_get_content', { version: 'v1' });

    const preview = document.querySelector('.markedit-chrome-versions-preview-content') as HTMLTextAreaElement;
    expect(preview.value).toBe('Content of v1');
  });

  test('restore selected version invokes versions_restore and closes modal', async () => {
    (window.chromeUI as ChromeUI).openVersionHistory();
    await tick();

    const restoreButton = document.querySelector('[data-action="restore-version"]') as HTMLButtonElement;
    restoreButton.click();

    await tick();

    expect(versionsInvokeMock).toHaveBeenCalledWith('versions_restore', { version: 'v3' });
    expect(document.querySelector('.markedit-chrome-versions-backdrop')).toBeNull();
  });

  test('delete all versions invokes versions_delete_all', async () => {
    (window.chromeUI as ChromeUI).openVersionHistory();
    await tick();

    const deleteButton = document.querySelector('[data-action="delete-all-versions"]') as HTMLButtonElement;
    deleteButton.click();

    await tick();

    expect(versionsInvokeMock).toHaveBeenCalledWith('versions_delete_all', undefined);
    expect(document.querySelectorAll('.markedit-chrome-versions-item').length).toBe(0);
  });
});

describe('Markdown Preview', () => {
  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  beforeEach(() => {
    document.body.className = '';
    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('editor');
  });

  test('renderMarkdownToHtml simple', () => {
    const html = renderMarkdownToHtml('# Heading\n\nHello world.');
    expect(html).toContain('<h1');
  });

  test('renderMarkdownToHtml handles headings, tables, tasks, code, alerts, frontmatter', () => {
    const html = renderMarkdownToHtml('---\nfront: value\n---\n\n# Heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task a\n- [x] task b\n\n> [!WARNING]\n> Watch out\n\n```js\nconst x = 1;\n```\n\n---');

    expect(html).toContain('<h1');
    expect(html).toContain('<table');
    expect(html).toContain('markedit-preview-task-checkbox');
    expect(html).toContain('markedit-preview-code-block');
    expect(html).toContain('is-warning');
    expect(html).toContain('markedit-preview-frontmatter');
  });

  test('renderMarkdownToHtml table only', () => {
    const html = renderMarkdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table');
  });

  test('renderMarkdownToHtml task list only', () => {
    const html = renderMarkdownToHtml('- [ ] task a\n- [x] task b');
    expect(html).toContain('markedit-preview-task-checkbox');
  });

  test('renderMarkdownToHtml alert only', () => {
    const html = renderMarkdownToHtml('> [!WARNING]\n> Watch out');
    expect(html).toContain('is-warning');
  });

  test('renderMarkdownToHtml code only', () => {
    const html = renderMarkdownToHtml('```js\nconst x = 1;\n```');
    expect(html).toContain('markedit-preview-code-block');
  });

  test('renderMarkdownToHtml frontmatter only', () => {
    const html = renderMarkdownToHtml('---\nfront: value\n---');
    expect(html).toContain('markedit-preview-frontmatter');
  });

  test('toggleMarkdownPreview switches to split and back', async () => {
    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('editor');

    (window.chromeUI as ChromeUI).toggleMarkdownPreview('split');
    await tick();

    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('split');
    expect(document.body.classList.contains('markedit-mode-split')).toBe(true);
    expect(document.querySelector('.markedit-markdown-preview-pane')).not.toBeNull();
    expect(document.querySelector('.markedit-preview-body')?.textContent).toContain('Hello');

    (window.chromeUI as ChromeUI).toggleMarkdownPreview('split');
    await tick();

    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('editor');
    expect(document.body.classList.contains('markedit-mode-split')).toBe(false);
  });

  test('setMarkdownPreviewMode switches between modes', async () => {
    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('preview');
    await tick();

    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('preview');
    expect(document.body.classList.contains('markedit-mode-preview')).toBe(true);

    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('editor');
    await tick();

    expect(document.body.classList.contains('markedit-mode-preview')).toBe(false);
  });

  test('the preview pane has no view buttons; modes are set from the native View menu', async () => {
    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('split');
    await tick();

    expect(document.querySelector('.markedit-markdown-preview-pane')).not.toBeNull();
    expect(document.querySelector('.markedit-preview-toolbar')).toBeNull();
    expect(document.querySelector('[data-mode]')).toBeNull();
    expect(document.querySelector('.markedit-preview-standard-select')).toBeNull();

    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('preview');
    await tick();
    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('preview');
  });

  test('Escape returns from Markdown view to the editor', async () => {
    (window.chromeUI as ChromeUI).setMarkdownPreviewMode('preview');
    await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick();

    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('editor');
  });

  test('Ctrl+Shift+P toggles split preview', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));

    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('split');
  });

  test('Ctrl+Shift+V toggles Markdown view; AltGr-like Ctrl+Alt+P does nothing', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, altKey: true, bubbles: true }));
    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('editor');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect((window.chromeUI as ChromeUI).getMarkdownPreviewMode()).toBe('preview');
  });
});

describe('Markdown Preview Rendering', () => {
  test('renderMarkdownToHtml renders inline math as MathML', () => {
    const html = renderMarkdownToHtml('The equation $E = mc^2$ is famous.');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain('<span class="markedit-math-inline">');
    expect(html).toContain('<mi>E</mi>');
    expect(html).toContain('<mn>2</mn>');
  });

  test('renderMarkdownToHtml renders display math as MathML', () => {
    const html = renderMarkdownToHtml('$$\\frac{a}{b}$$');
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain(' display="block"');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('<mi>a</mi>');
    expect(html).toContain('<mi>b</mi>');
  });

  test('renderMarkdownToHtml renders mermaid code block as SVG', () => {
    const html = renderMarkdownToHtml('```mermaid\ngraph TD\nA[Start] --> B[End]\n```');
    expect(html).toContain('<svg class="markedit-mermaid-svg"');
    expect(html).toContain('Start');
    expect(html).toContain('End');
    expect(html).toContain('markedit-preview-mermaid');
  });

  test('renderMarkdownToHtml renders task list inline without paragraph wrapping', () => {
    const html = renderMarkdownToHtml('- [ ] task a\n- [x] task b');
    expect(html).toContain('<ul class="markedit-preview-list markedit-preview-task-list">');
    expect(html).toContain('markedit-preview-task-item');
    expect(html).toContain('<input type="checkbox" class="markedit-preview-task-checkbox"');
    expect(html).not.toContain('<p ');
  });
});

describe('Markdown Syntax Standard Switching', () => {
  afterEach(() => {
    setMarkdownSyntaxStandard('extended');
  });

  test('commonmark only renders CommonMark elements', () => {
    setMarkdownSyntaxStandard('commonmark');
    const html = renderMarkdown('# Heading\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n~~strike~~\n\n$E=mc^2$\n\n```mermaid\ngraph TD\nA --> B\n```\n\n> [!NOTE]\n> note');

    expect(html).toContain('<h1');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('markedit-preview-task-checkbox');
    expect(html).not.toContain('<del>');
    expect(html).not.toContain('<math');
    expect(html).not.toContain('markedit-mermaid-svg');
    expect(html).not.toContain('markedit-preview-alert');
  });

  test('gfm renders tables, task lists, and strikethrough', () => {
    setMarkdownSyntaxStandard('gfm');
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] task\n\n~~strike~~\n\n$E=mc^2$');

    expect(html).toContain('<table');
    expect(html).toContain('markedit-preview-task-checkbox');
    expect(html).toContain('<del>');
    expect(html).not.toContain('<math');
  });

  test('extended renders math, mermaid, callouts, and frontmatter', () => {
    setMarkdownSyntaxStandard('extended');
    const html = renderMarkdown('---\ntitle: doc\n---\n\n$E=mc^2$\n\n```mermaid\ngraph TD\nA[Start] --> B[End]\n```\n\n> [!NOTE]\n> note');

    expect(html).toContain('markedit-preview-frontmatter');
    expect(html).toContain('<math');
    expect(html).toContain('markedit-mermaid-svg');
    expect(html).toContain('markedit-preview-alert');
  });

  test('registering and activating a custom renderer swaps output', () => {
    setMarkdownSyntaxStandard('extended');

    const customEngine: MarkdownRendererEngine = {
      id: 'custom-test',
      name: 'Custom Test Renderer',
      standard: 'custom',
      render: () => '<div class="custom-renderer-output">CUSTOM</div>',
    };

    registerMarkdownRenderer(customEngine);
    setActiveMarkdownRenderer('custom-test');

    expect(getActiveMarkdownRenderer().id).toBe('custom-test');
    expect(renderMarkdown('# Hello')).toBe('<div class="custom-renderer-output">CUSTOM</div>');
    expect(getMarkdownSyntaxStandard()).toBe('custom');

    setActiveMarkdownRenderer('extended');
    expect(renderMarkdown('# Hello')).toContain('<h1');
  });
});

describe('Native View menu state', () => {
  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.');

    window.webModules = {
      core: { restoreFocus: jest.fn(), getEditorText: jest.fn(() => window.editor.state.doc.toString()) },
      search: { setState: jest.fn(), updateQuery: jest.fn(), findNext: jest.fn(), findPrevious: jest.fn(), replaceNext: jest.fn(), replaceAll: jest.fn(), getCounterInfo: jest.fn(() => ({ currentIndex: 0, numberOfItems: 0 })) },
      toc: { getTableOfContents: jest.fn(() => []), gotoHeader: jest.fn() },
      selection: { getText: jest.fn(() => ''), gotoLine: jest.fn() },
      api: { getMenuItemState: jest.fn(() => ({})), handleContextMenuAction: jest.fn() },
    } as unknown as typeof window.webModules;

    initChromeUI();
    setMarkdownPreviewMode('editor');
  });

  afterEach(() => {
    setMarkdownPreviewMode('editor');
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  const viewStates = (invoke: jest.Mock<Invoke>) => invoke.mock.calls
    .filter(([cmd]) => cmd === 'view_state_changed')
    .map(([, args]) => args);

  test('no floating mode switcher is added to the page', () => {
    expect(document.getElementById('markedit-mode-switcher')).toBeNull();
  });

  test('mode, parser and scroll sync changes are reported to the View menu', async () => {
    const invoke = jest.fn<Invoke>(async () => undefined);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };

    setMarkdownPreviewMode('split');
    await tick();
    expect(viewStates(invoke).at(-1)).toEqual({ mode: 'split', renderer: getActiveMarkdownRenderer().id, syncScroll: true, livePreview: false });

    (window.chromeUI as ChromeUI).togglePreviewSyncScroll();
    expect(viewStates(invoke).at(-1)).toMatchObject({ mode: 'split', syncScroll: false });
    (window.chromeUI as ChromeUI).togglePreviewSyncScroll();

    (window.chromeUI as ChromeUI).setMarkdownRenderer('super');
    expect(viewStates(invoke).at(-1)).toMatchObject({ renderer: 'super' });
    (window.chromeUI as ChromeUI).setMarkdownRenderer('extended');

    // The menu is shared by all windows: a focused window reports its own state.
    const before = viewStates(invoke).length;
    window.dispatchEvent(new Event('focus'));
    expect(viewStates(invoke).length).toBe(before + 1);
  });

  test('live preview in the editor is off by default and toggled from the View menu', async () => {
    const invoke = jest.fn<Invoke>(async () => undefined);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
    // An editor with the app's live preview slot (the saved setting is off).
    document.body.innerHTML = '';
    editor.setUp('Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |', livePreviewExtension());
    const view = window.editor;
    view.dispatch({ selection: { anchor: 0 } });

    // Off: the table is plain source.
    expect(view.dom.querySelector('.cm-live-table')).toBeNull();

    (window.chromeUI as ChromeUI).toggleEditorLivePreview();
    await tick();
    expect(view.dom.querySelector('.cm-live-table')).not.toBeNull();
    expect(viewStates(invoke).at(-1)).toMatchObject({ livePreview: true });
    expect(invoke).toHaveBeenCalledWith('settings_update', { patch: { livePreview: true } });

    (window.chromeUI as ChromeUI).toggleEditorLivePreview();
    await tick();
    expect(view.dom.querySelector('.cm-live-table')).toBeNull();
    expect(viewStates(invoke).at(-1)).toMatchObject({ livePreview: false });
  });

  test('Copy Preview HTML copies the rendered document in any mode', async () => {
    const writeText = jest.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    (window.chromeUI as ChromeUI).copyPreviewHtml();
    await tick();
    expect(writeText.mock.calls[0][0]).toContain('<h1');
  });
});

describe('Split View Sync Scroll', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Heading\n\n- item 1\n- item 2\n\nMore text.');

    window.webModules = {
      core: { restoreFocus: jest.fn(), getEditorText: jest.fn(() => window.editor.state.doc.toString()) },
    } as unknown as typeof window.webModules;

    initChromeUI();
    setMarkdownPreviewMode('split');
  });

  afterEach(() => {
    setMarkdownPreviewMode('editor');
  });

  // jsdom has no layout: give the preview blocks positions and both panes scroll metrics.
  function setupPreviewBody(): HTMLElement {
    const body = document.querySelector('.markedit-preview-body') as HTMLElement;
    body.innerHTML = `
      <div class="markedit-preview-block" data-line="0"><h1>Heading</h1></div>
      <ul class="markedit-preview-list">
        <li class="markedit-preview-block" data-line="2">item 1</li>
        <li class="markedit-preview-block" data-line="3">item 2</li>
      </ul>
      <div class="markedit-preview-block" data-line="5"><p>More text.</p></div>
    `;

    const tops: Record<string, number> = { 0: 0, 2: 200, 3: 300, 5: 600 };
    body.querySelectorAll<HTMLElement>('[data-line]').forEach(element => {
      element.getBoundingClientRect = () => ({ top: tops[element.dataset.line ?? ''] - body.scrollTop, width: 100, height: 20 }) as DOMRect;
    });
    body.getBoundingClientRect = () => ({ top: 0, width: 100, height: 200 }) as DOMRect;
    mockScroller(body, 1000, 200);
    return body;
  }

  function mockScroller(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
    let top = 0;
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(value, scrollHeight - clientHeight)); },
    });
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
  }

  // Editor lines are 100px tall; the 6-line document is 600px in a 100px viewport.
  function setupEditorScroller(): HTMLElement {
    const view = window.editor;
    const scroller = view.scrollDOM;
    mockScroller(scroller, 600, 100);
    const blockOf = (index: number) => {
      const doc = view.state.doc;
      const line = doc.line(Math.max(0, Math.min(index, doc.lines - 1)) + 1);
      return { from: line.from, to: line.to, top: (line.number - 1) * 100, height: 100 };
    };
    Object.defineProperty(view, 'documentTop', { configurable: true, get: () => -scroller.scrollTop });
    view.lineBlockAtHeight = ((height: number) => blockOf(Math.floor(height / 100))) as unknown as typeof view.lineBlockAtHeight;
    view.lineBlockAt = ((pos: number) => blockOf(view.state.doc.lineAt(pos).number - 1)) as unknown as typeof view.lineBlockAt;
    return scroller;
  }

  test('editor scrolling moves the preview to the interpolated position', () => {
    const body = setupPreviewBody();
    const scroller = setupEditorScroller();

    // Reference offset 300 of 600 → line 3 → preview offset 300 → scrollTop 300 × 800 / 1000.
    scroller.scrollTop = 250;
    scroller.dispatchEvent(new Event('scroll'));
    expect(body.scrollTop).toBeCloseTo(240);

    // Line 4.2 lies between line 3 (300) and line 5 (600): preview offset 480.
    scroller.scrollTop = 350;
    syncScroll();
    expect(body.scrollTop).toBeCloseTo(384);

    scroller.scrollTop = 0;
    syncScroll();
    expect(body.scrollTop).toBe(0);

    scroller.scrollTop = 500;
    syncScroll();
    expect(body.scrollTop).toBe(800);
  });

  test('preview scrolling moves the editor', () => {
    const body = setupPreviewBody();
    const scroller = setupEditorScroller();

    body.dispatchEvent(new Event('wheel', { bubbles: true }));
    body.scrollTop = 240; // reference offset 300 → line 3 → editor offset 300
    body.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBeCloseTo(250);

    // The editor's own scroll event (caused by the sync) does not move the preview back.
    scroller.dispatchEvent(new Event('scroll'));
    expect(body.scrollTop).toBe(240);
  });

  // CodeMirror measures in animation frames and would reset the mocked editor scroll position.
  const useFakeTimers = () => jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });

  test('editing pauses sync until there has been no edit for a second', () => {
    useFakeTimers();
    try {
      const body = setupPreviewBody();
      const scroller = setupEditorScroller();
      // The user works in the editor, so the editor leads when sync resumes.
      window.editor.contentDOM.dispatchEvent(new Event('keydown', { bubbles: true }));

      window.editor.dispatch({ changes: { from: 0, insert: 'x' } });
      scroller.scrollTop = 250;
      scroller.dispatchEvent(new Event('scroll'));
      expect(body.scrollTop).toBe(0);

      // Another edit 600 ms later restarts the quiet period.
      jest.advanceTimersByTime(600);
      window.editor.dispatch({ changes: { from: 0, insert: 'y' } });
      scroller.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(600);
      expect(body.scrollTop).toBe(0);

      // A second without edits: sync resumes and re-aligns the preview.
      jest.advanceTimersByTime(500);
      expect(body.scrollTop).toBeCloseTo(240);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a selection pauses sync until it has been cleared for a second', () => {
    useFakeTimers();
    try {
      const body = setupPreviewBody();
      const scroller = setupEditorScroller();
      // The user works in the editor, so the editor leads when sync resumes.
      window.editor.contentDOM.dispatchEvent(new Event('keydown', { bubbles: true }));

      window.editor.dispatch({ selection: { anchor: 0, head: 5 } });
      scroller.scrollTop = 250;
      scroller.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(3000);
      expect(body.scrollTop).toBe(0);

      window.editor.dispatch({ selection: { anchor: 0 } });
      document.dispatchEvent(new Event('selectionchange'));
      jest.advanceTimersByTime(800);
      expect(body.scrollTop).toBe(0);

      jest.advanceTimersByTime(400);
      expect(body.scrollTop).toBeCloseTo(240);
    } finally {
      jest.useRealTimers();
    }
  });

  test('preview scroll caused by the sync or by re-rendering does not move the editor', () => {
    const body = setupPreviewBody();
    const scroller = setupEditorScroller();

    window.editor.contentDOM.dispatchEvent(new Event('wheel', { bubbles: true }));
    scroller.scrollTop = 250;
    scroller.dispatchEvent(new Event('scroll'));
    body.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBe(250);

    body.scrollTop = 10;
    body.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBe(250);
  });
});

describe('Settings Modal Window Controls', () => {
  const tick = () => new Promise(resolve => { setTimeout(resolve, 0); });

  const minimalSettings: UserSettings = {
    theme: 'github-light',
    themeExtension: '',
    fontFamily: 'ui-monospace',
    fontSize: 16,
    showLineNumbers: true,
    showActiveLineIndicator: true,
    invisiblesBehavior: 'selection',
    typewriterMode: false,
    focusMode: false,
    livePreview: false,
    lineWrapping: true,
    lineHeight: 1.5,
    tabKeyBehavior: 2,
    indentUnit: '    ',
    suggestWhileTyping: true,
    autoCharacterPairs: true,
    smartQuotesEnabled: true,
    insertFinalNewline: true,
    trimTrailingWhitespace: false,
    appearance: 'system',
    newFilenameExtension: 'md',
    defaultTextEncoding: 'UTF-8',
    defaultLineBreak: '\n',
    startupBehavior: 'newDocument',
    checkForUpdates: true,
    reduceTransparency: false,
    markdownRenderer: 'extended',
    diagramServer: 'https://kroki.io',
    diagramRendering: 'auto',
    plantumlCommand: 'plantuml',
    d2Command: 'd2',
    previewThemeStyles: {},
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.');

    window.__TAURI_INTERNALS__ = {
      invoke: jest.fn(async () => minimalSettings),
    } as unknown as typeof window.__TAURI_INTERNALS__;

    window.webModules = {
      core: { restoreFocus: jest.fn() },
    } as unknown as typeof window.webModules;

    initChromeUI();
  });

  afterEach(() => {
    delete document.documentElement.dataset.windowControls;
  });

  test('macOS traffic lights render on the left and close the modal', async () => {
    document.documentElement.dataset.windowControls = 'macos';

    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    const controls = document.querySelector('.markedit-window-controls.is-macos');
    expect(controls).not.toBeNull();

    const closeButton = controls?.querySelector('.markedit-traffic-light.is-close.markedit-chrome-close-button');
    expect(closeButton).not.toBeNull();
    expect(controls?.firstChild === closeButton).toBe(true);

    (closeButton as HTMLButtonElement).click();
    await tick();

    expect(document.querySelector('.markedit-chrome-settings-backdrop')).toBeNull();
  });

  test('Windows caption close button renders on the right and closes the modal', async () => {
    document.documentElement.dataset.windowControls = 'windows';

    (window.chromeUI as ChromeUI).openSettings('editor');
    await tick();

    const controls = document.querySelector('.markedit-window-controls.is-windows');
    expect(controls).not.toBeNull();

    const closeButton = controls?.querySelector('.markedit-win-caption-close.markedit-chrome-close-button');
    expect(closeButton).not.toBeNull();

    const titleRow = document.querySelector('.markedit-chrome-settings-title-row');
    expect(titleRow?.lastChild === controls).toBe(true);

    (closeButton as HTMLButtonElement).click();
    await tick();

    expect(document.querySelector('.markedit-chrome-settings-backdrop')).toBeNull();
  });
});

describe('Live Editor Preview Extension', () => {
  test('renders checkboxes, math, mermaid, and tables in editor mode', () => {
    const doc = [
      '- [ ] task a',
      '',
      '$E=mc^2$',
      '',
      '```mermaid',
      'graph TD',
      'A[Start] --> B[End]',
      '```',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');

    const view = new EditorView({
      doc,
      parent: document.body,
      extensions: [
        EditorView.editable.of(true),
        createLivePreviewExtension(),
      ],
    });

    view.dispatch({ selection: { anchor: doc.length } });
    view.requestMeasure();

    expect(view.dom.querySelector('.cm-live-checkbox')).not.toBeNull();
    expect(view.dom.querySelector('.cm-live-math')).not.toBeNull();
    expect(view.dom.querySelector('.cm-live-mermaid')).not.toBeNull();
    expect(view.dom.querySelector('.cm-live-table')).not.toBeNull();

    view.destroy();
  });
});
