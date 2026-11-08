import { describe, expect, test, beforeEach, jest } from '@jest/globals';
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
