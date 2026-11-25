import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { initChromeUI } from '../src/chrome';
import {
  initSidebar,
  setActiveTab,
  toggleSidebar,
  setSidebarVisible,
  isSidebarVisible,
  sidebarVisibleWidth,
  openFolder,
  refreshOutline,
  registerSidebarTab,
  type FolderNode,
} from '../src/chrome/sidebar';

describe('VS Code Style Sidebar & Layout', () => {
  let mockInvoke: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    const editorDiv = document.createElement('div');
    editorDiv.id = 'editor';
    document.body.appendChild(editorDiv);

    editor.setUp('# SuperMark Guide\n\nIntro text.\n\n## Getting Started\n\nStep 1.\n\n### Advanced Tips\n\nTips.');

    mockInvoke = jest.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(async (cmd, args) => {
      if (cmd === 'list_folder_tree') {
        const folder = args?.folder as string;
        const mockTree: FolderNode = {
          name: 'MyProject',
          path: folder,
          is_dir: true,
          children: [
            {
              name: 'docs',
              path: `${folder}/docs`,
              is_dir: true,
              children: [
                {
                  name: 'readme.md',
                  path: `${folder}/docs/readme.md`,
                  is_dir: false,
                  children: [],
                },
              ],
            },
            {
              name: 'index.md',
              path: `${folder}/index.md`,
              is_dir: false,
              children: [],
            },
          ],
        };
        return mockTree;
      }
      if (cmd === 'open_document') {
        return undefined;
      }
      return undefined;
    });

    (window as unknown as { __TAURI_INTERNALS__?: { invoke?: typeof mockInvoke } }).__TAURI_INTERNALS__ = {
      invoke: mockInvoke,
    };

    window.webModules = {
      core: {
        getEditorText: jest.fn(() => window.editor.state.doc.toString()),
        restoreFocus: jest.fn(),
      },
      search: {
        setState: jest.fn(),
      },
      toc: {
        getTableOfContents: jest.fn(() => []),
      },
      selection: {
        getText: jest.fn(() => ''),
      },
    } as unknown as typeof window.webModules;

    initChromeUI();
    initSidebar();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('creates VS Code app layout with Activity Bar, Sidebar and Main Area', () => {
    const layout = document.getElementById('markedit-app-layout');
    expect(layout).not.toBeNull();

    const activityBar = document.getElementById('markedit-activity-bar');
    expect(activityBar).not.toBeNull();

    const sidebar = document.getElementById('markedit-sidebar');
    expect(sidebar).not.toBeNull();

    const mainArea = document.getElementById('markedit-main-area');
    expect(mainArea).not.toBeNull();

    // Editor should be mounted inside mainArea
    expect(mainArea?.contains(document.getElementById('editor'))).toBe(true);
  });

  test('activity bar contains Explorer and Outline tabs, plus toggle and settings buttons', () => {
    const activityBar = document.getElementById('markedit-activity-bar');
    expect(activityBar).not.toBeNull();

    const explorerBtn = activityBar?.querySelector('[data-tab="files"]');
    expect(explorerBtn).not.toBeNull();

    const outlineBtn = activityBar?.querySelector('[data-tab="outline"]');
    expect(outlineBtn).not.toBeNull();

    const toggleBtn = activityBar?.querySelector('[title*="Toggle Side Bar"]');
    expect(toggleBtn).not.toBeNull();

    const settingsBtn = activityBar?.querySelector('[title*="Settings"]');
    expect(settingsBtn).not.toBeNull();
  });

  test('sidebar header displays active tab title and actions', () => {
    setActiveTab('files');
    const title = document.querySelector('.markedit-sidebar-title');
    expect(title?.textContent).toBe('EXPLORER');

    const actions = document.querySelectorAll('.markedit-sidebar-actions .markedit-sidebar-icon-btn');
    expect(actions.length).toBeGreaterThan(0);

    setActiveTab('outline');
    expect(title?.textContent).toBe('OUTLINE');
  });

  test('clicking active Activity Bar tab button closes sidebar (VS Code behavior)', () => {
    setSidebarVisible(true);
    setActiveTab('files');
    expect(isSidebarVisible()).toBe(true);

    const explorerBtn = document.querySelector<HTMLButtonElement>('[data-tab="files"]');
    explorerBtn?.click();

    expect(isSidebarVisible()).toBe(false);

    // Clicking again re-opens the sidebar
    explorerBtn?.click();
    expect(isSidebarVisible()).toBe(true);
  });

  test('toggleSidebar and global hook toggle sidebar visibility', () => {
    setSidebarVisible(true);
    expect(isSidebarVisible()).toBe(true);
    expect(sidebarVisibleWidth()).toBeGreaterThan(0);

    toggleSidebar();
    expect(isSidebarVisible()).toBe(false);
    expect(sidebarVisibleWidth()).toBe(0);

    const toggleHook = (window as unknown as { __markeditToggleSidebar?: () => void }).__markeditToggleSidebar;
    expect(typeof toggleHook).toBe('function');
    toggleHook?.();
    expect(isSidebarVisible()).toBe(true);
  });

  test('outline view extracts and renders headings with level badges and click navigation', () => {
    setActiveTab('outline');
    refreshOutline();

    const items = document.querySelectorAll('.markedit-outline-item');
    expect(items.length).toBe(3);

    const badges = document.querySelectorAll('.markedit-outline-badge');
    expect(badges[0].textContent).toBe('H1');
    expect(badges[1].textContent).toBe('H2');
    expect(badges[2].textContent).toBe('H3');

    const labels = document.querySelectorAll('.markedit-outline-label');
    expect(labels[0].textContent).toBe('SuperMark Guide');
    expect(labels[1].textContent).toBe('Getting Started');
    expect(labels[2].textContent).toBe('Advanced Tips');

    // Clicking heading dispatches selection
    const dispatchSpy = jest.spyOn(window.editor, 'dispatch');
    (items[1] as HTMLElement).click();
    expect(dispatchSpy).toHaveBeenCalled();
  });

  test('openFolder renders file tree and allows expanding and opening files', async () => {
    await openFolder('/workspace/supermark');

    expect(mockInvoke).toHaveBeenCalledWith('list_folder_tree', { folder: '/workspace/supermark' });

    const rootHeader = document.querySelector('.markedit-filetree-root-header');
    expect(rootHeader).not.toBeNull();
    expect(rootHeader?.textContent).toContain('MYPROJECT');

    const dirs = document.querySelectorAll('.markedit-filetree-dir');
    expect(dirs.length).toBe(1);
    expect(dirs[0].textContent).toContain('docs');

    const files = document.querySelectorAll('.markedit-filetree-file');
    expect(files.length).toBeGreaterThan(0);

    // Clicking file calls open_document
    const indexFile = Array.from(files).find(f => f.textContent.includes('index.md')) as HTMLElement;
    expect(indexFile).toBeDefined();
    indexFile.click();

    expect(mockInvoke).toHaveBeenCalledWith('open_document', { path: '/workspace/supermark/index.md' });
  });

  test('extensibility: registerSidebarTab adds new custom tab to Activity Bar', () => {
    const customRender = jest.fn();
    registerSidebarTab({
      id: 'bookmarks',
      title: 'BOOKMARKS',
      tooltip: 'Bookmarks',
      iconSvg: '<svg class="custom-icon"></svg>',
      render: customRender,
    });

    const customBtn = document.querySelector('[data-tab="bookmarks"]');
    expect(customBtn).not.toBeNull();

    setActiveTab('bookmarks');
    expect(document.querySelector('.markedit-sidebar-title')?.textContent).toBe('BOOKMARKS');
    expect(customRender).toHaveBeenCalled();
  });

  test('three view modes (Edit, Split, Preview) work seamlessly with the sidebar layout', () => {
    const chrome = window.chromeUI as ChromeUI;

    // 1. Editor mode
    chrome.setMarkdownPreviewMode('editor');
    expect(chrome.getMarkdownPreviewMode()).toBe('editor');
    const editorEl = document.getElementById('editor');
    expect(editorEl?.style.display).not.toBe('none');

    // 2. Split Preview mode
    chrome.setMarkdownPreviewMode('split');
    expect(chrome.getMarkdownPreviewMode()).toBe('split');
    expect(document.body.classList.contains('markedit-mode-split')).toBe(true);

    const mainArea = document.getElementById('markedit-main-area');
    const previewPane = mainArea?.querySelector('.markedit-markdown-preview-pane');
    expect(previewPane).not.toBeNull();

    // 3. Preview Markdown mode
    chrome.setMarkdownPreviewMode('preview');
    expect(chrome.getMarkdownPreviewMode()).toBe('preview');
    expect(document.body.classList.contains('markedit-mode-preview')).toBe(true);

    // Sidebar toggle works inside preview mode without breaking main area
    toggleSidebar();
    expect(isSidebarVisible()).toBe(false);
    expect(mainArea?.contains(previewPane as Node)).toBe(true);

    toggleSidebar();
    expect(isSidebarVisible()).toBe(true);

    // Return to editor mode
    chrome.setMarkdownPreviewMode('editor');
    expect(chrome.getMarkdownPreviewMode()).toBe('editor');
  });
});
