import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { initChromeUI } from '../src/chrome';
import { initSidebar, openFolder } from '../src/chrome/sidebar';
import { renderGit } from '../src/chrome/gitPanel';

describe('Git Panel', () => {
  let mockInvoke: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    const editorDiv = document.createElement('div');
    editorDiv.id = 'editor';
    document.body.appendChild(editorDiv);
    editor.setUp('# Guide');

    mockInvoke = jest.fn(async (cmd) => {
      if (cmd === 'list_folder_tree') return { name: 'P', path: '/P', is_dir: true, children: [] };
      if (cmd === 'git_is_repo') return true;
      if (cmd === 'git_status') return { branch: 'main', upstream: null, ahead: 0, behind: 0, changes: [{ path: 'a.md', index_status: '.', worktree_status: 'M', untracked: false }], is_repo: true };
      if (cmd === 'open_document') return undefined;
      return undefined;
    });

    (window as unknown as { __TAURI_INTERNALS__?: { invoke?: typeof mockInvoke } }).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    window.webModules = { core: { getEditorText: jest.fn(() => ''), restoreFocus: jest.fn() }, selection: { gotoLine: jest.fn(), getText: jest.fn(() => '') } } as unknown as typeof window.webModules;

    initChromeUI();
    initSidebar();
    await openFolder('/P');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders branch and changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderGit(container);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.textContent).toContain('main');
    expect(container.textContent).toContain('a.md');
    expect(container.textContent).toContain('Changes');
  });
});
