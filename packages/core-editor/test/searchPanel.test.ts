import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { initChromeUI } from '../src/chrome';
import { initSidebar, openFolder } from '../src/chrome/sidebar';
import { renderSearch } from '../src/chrome/searchPanel';

describe('Search Panel', () => {
  let mockInvoke: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    const editorDiv = document.createElement('div');
    editorDiv.id = 'editor';
    document.body.appendChild(editorDiv);
    editor.setUp('# Guide\n\nHello');

    mockInvoke = jest.fn(async (cmd, args) => {
      if (cmd === 'list_folder_tree') {
        return { name: 'P', path: args?.folder, is_dir: true, children: [] };
      }
      if (cmd === 'search_in_folder') {
        return {
          files: [
            { path: '/P/a.md', matches: [{ line_number: 2, line_text: 'hello world', start: 0, end: 5 }] },
          ],
          total_matches: 1,
          files_searched: 1,
        };
      }
      if (cmd === 'open_document') return undefined;
      return undefined;
    });

    (window as unknown as { __TAURI_INTERNALS__?: { invoke?: typeof mockInvoke } }).__TAURI_INTERNALS__ = { invoke: mockInvoke };

    window.webModules = {
      core: { getEditorText: jest.fn(() => window.editor.state.doc.toString()), restoreFocus: jest.fn() },
      selection: { gotoLine: jest.fn(), getText: jest.fn(() => '') },
    } as unknown as typeof window.webModules;

    initChromeUI();
    initSidebar();
    await openFolder('/P');
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('renders search results after typing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSearch(container);
    const input = container.querySelector('input.markedit-search-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    // wait for async
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.textContent).toContain('a.md');
    expect(container.textContent).toContain('result');
  });
});

describe('Search Panel replace', () => {
  let mockInvoke: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(async () => {
    document.body.innerHTML = '';
    const editorDiv = document.createElement('div');
    editorDiv.id = 'editor';
    document.body.appendChild(editorDiv);
    editor.setUp('# Guide\n\nHello');

    mockInvoke = jest.fn(async (cmd) => {
      if (cmd === 'list_folder_tree') return { name: 'P', path: '/P', is_dir: true, children: [] };
      if (cmd === 'search_in_folder') return { files: [], total_matches: 0, files_searched: 1 };
      if (cmd === 'replace_in_files') return 3;
      if (cmd === 'open_document') return undefined;
      return undefined;
    });

    (window as unknown as { __TAURI_INTERNALS__?: { invoke?: typeof mockInvoke } }).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    window.webModules = { core: { getEditorText: jest.fn(() => ''), restoreFocus: jest.fn() }, selection: { gotoLine: jest.fn(), getText: jest.fn(() => '') } } as unknown as typeof window.webModules;

    const { initChromeUI } = await import('../src/chrome');
    const { initSidebar, openFolder } = await import('../src/chrome/sidebar');
    initChromeUI();
    initSidebar();
    await openFolder('/P');
  });

  afterEach(() => { jest.clearAllMocks(); });

  test('replace all reports count', async () => {
    const { renderSearch } = await import('../src/chrome/searchPanel');
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSearch(container);
    const inputs = container.querySelectorAll('input.markedit-search-input') as NodeListOf<HTMLInputElement>;
    inputs[0].value = 'foo';
    inputs[1].value = 'bar';
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Replace All') as HTMLButtonElement;
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockInvoke).toHaveBeenCalledWith('replace_in_files', expect.anything());
  });
});
