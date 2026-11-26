import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { syncExtensionRenderers } from '../src/hostDocument';
import { createScriptContext } from '../src/scriptContext';
import {
  getActiveMarkdownRenderer,
  listMarkdownRenderers,
  setActiveMarkdownRenderer,
} from '../src/modules/markdown-renderer';
import { markdownItEngine } from '../src/modules/markdown-renderer/formats/markdownIt';
import type { MenuItem } from 'markedit-api';
import { setMarkdownPreviewMode } from '../src/chrome/markdownPreview';

type Globals = {
  MarkEditRenderHtml?: (markdown: string, styled: boolean) => Promise<string>;
  MarkEdit: { userSettings?: Record<string, unknown> };
};
const globals = globalThis as unknown as Globals;
const preview = [{ capability: 'markedit-preview.js' }];

describe('markdown-it parser from the MarkEdit Preview extension', () => {
  beforeEach(() => {
    editor.setUp('# Hello');
    window.webModules = {
      core: { getEditorText: () => window.editor.state.doc.toString(), restoreFocus: jest.fn() },
    } as unknown as typeof window.webModules;
    globals.MarkEditRenderHtml = async (markdown, styled) => (styled
      ? `<!doctype html><html><head><style>h1{color:red}</style></head><body><div class="markdown-body"><h1>${markdown}</h1></div></body></html>`
      : `<meta charset="UTF-8">\n<h1>${markdown}</h1>`);
  });

  afterEach(() => {
    delete globals.MarkEditRenderHtml;
    syncExtensionRenderers([]);
    setActiveMarkdownRenderer('super');
    if (globals.MarkEdit.userSettings !== undefined) {
      delete globals.MarkEdit.userSettings.markdownRenderer;
    }
  });

  test('is offered only while the extension is loaded and enabled', () => {
    syncExtensionRenderers(preview);
    expect(listMarkdownRenderers().map(engine => engine.id)).toContain('markdown-it');

    // Extension turned off (its script is no longer in the bootstrap).
    setActiveMarkdownRenderer('markdown-it');
    syncExtensionRenderers([]);
    expect(listMarkdownRenderers().map(engine => engine.id)).not.toContain('markdown-it');
    expect(getActiveMarkdownRenderer().id).toBe('super');

    // Script listed but its renderer is missing (older extension version).
    delete globals.MarkEditRenderHtml;
    syncExtensionRenderers(preview);
    expect(listMarkdownRenderers().map(engine => engine.id)).not.toContain('markdown-it');
  });

  test('a saved markdown-it choice is applied once the extension has loaded', () => {
    globals.MarkEdit.userSettings = { ...(globals.MarkEdit.userSettings ?? {}), markdownRenderer: 'markdown-it' };
    syncExtensionRenderers(preview);
    expect(getActiveMarkdownRenderer().id).toBe('markdown-it');
  });

  test('the preview shows the styled document in a sandboxed frame', async () => {
    syncExtensionRenderers(preview);
    setActiveMarkdownRenderer('markdown-it');
    setMarkdownPreviewMode('split');
    await new Promise(resolve => { setTimeout(resolve, 20); });

    const frame = document.querySelector('.markedit-preview-body > iframe.markedit-preview-frame') as HTMLIFrameElement | null;
    expect(frame).not.toBeNull();
    // Styles isolated, scripts never run (no allow-scripts).
    expect(frame?.getAttribute('sandbox')).toBe('allow-same-origin');
    expect(frame?.srcdoc).toContain('<style>h1{color:red}</style>');

    // Back to a built-in parser: fragments again, no frame.
    setActiveMarkdownRenderer('super');
    setMarkdownPreviewMode('editor');
    setMarkdownPreviewMode('split');
    expect(document.querySelector('.markedit-preview-body > iframe')).toBeNull();
    expect(document.querySelector('.markedit-preview-body h1')).not.toBeNull();
    setMarkdownPreviewMode('editor');
  });

  test('renders fragments and full styled documents through the extension', async () => {
    expect(await markdownItEngine.renderAsync?.('Title')).toBe('<h1>Title</h1>');
    expect(await markdownItEngine.renderDocument?.('Title')).toContain('<style>h1{color:red}</style>');
    // Synchronous callers still get HTML.
    expect(markdownItEngine.render('# Title')).toContain('<h1');
  });
});

describe('MarkEdit Preview extension menu', () => {
  test('its own view-mode items are removed; export items stay; source mode is restored on app ready', () => {
    const added: MenuItem[][] = [];
    const ready: (() => void)[] = [];
    const sourceMode = jest.fn();
    const original = { addMainMenuItem: MarkEdit.addMainMenuItem, onAppReady: MarkEdit.onAppReady };
    Object.assign(MarkEdit, {
      addMainMenuItem: (spec: MenuItem | MenuItem[]) => added.push(Array.isArray(spec) ? spec : [spec]),
      onAppReady: (listener: () => void) => ready.push(listener),
    });

    try {
      const context = createScriptContext('/scripts/markedit-preview.js', 'markedit-preview.js');
      context.MarkEdit.addMainMenuItem({
        title: 'View Mode',
        children: [
          { title: 'Change Mode', action: jest.fn(), key: 'V', modifiers: ['Command'] },
          { separator: true },
          { title: 'Markdown Source', action: sourceMode, state: () => ({ isSelected: true }) },
          { title: 'Preview (Side-by-Side)', action: jest.fn(), state: () => ({ isSelected: false }) },
          { title: 'Preview (Overlay)', action: jest.fn(), state: () => ({ isSelected: false }) },
          { title: 'Mixed (Syntax Hidden)', action: jest.fn(), state: () => ({ isSelected: false }) },
          { separator: true },
          { title: 'Copy HTML', action: jest.fn() },
          { separator: true },
          { title: 'Version 1.14.1', action: jest.fn() },
        ],
      });

      expect(added[0][0].title).toBe('MarkEdit Preview');
      expect(added[0][0].children?.map(child => child.title ?? '-')).toEqual(['Copy HTML', '-', 'Version 1.14.1']);

      ready.forEach(listener => listener());
      expect(sourceMode).toHaveBeenCalledTimes(1);

      // Other extensions are untouched.
      createScriptContext('/scripts/other.js', 'other.js').MarkEdit.addMainMenuItem({ title: 'Other', children: [{ title: 'A', state: () => ({ isSelected: false }) }] });
      expect(added[1][0].title).toBe('Other');
    } finally {
      Object.assign(MarkEdit, original);
    }
  });
});
