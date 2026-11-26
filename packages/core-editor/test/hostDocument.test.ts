import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { applyExtensions, loadHostDocument, reloadDocumentFromHost } from '../src/hostDocument';
import { listThemeExtensions, setThemeExtension, themeExtensionLabel } from '../src/chrome/themeExtensions';

// resetEditor rebuilds the whole editor (covered by core tests); here it only needs the text.
jest.mock('../src/core', () => {
  const actual = jest.requireActual<typeof import('../src/core')>('../src/core');
  return {
    ...actual,
    resetEditor: async (text: string) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('./utils/editor') as typeof import('./utils/editor')).setText(text);
      return true;
    },
  };
});

type Hooks = {
  __prepareScriptContexts__?: (scripts: { path: string; capability: string }[]) => void;
  __runScriptWithContext__?: (key: string, execute: (...args: unknown[]) => void) => void;
  __extensionLog__?: string[];
  __TAURI_INTERNALS__?: unknown;
};

describe('host document loading', () => {
  beforeEach(() => {
    editor.setUp('placeholder');
    document.head.querySelectorAll('style[data-markedit-user-style]').forEach(element => element.remove());
    const hooks = window as unknown as Hooks;
    hooks.__extensionLog__ = [];
    hooks.__prepareScriptContexts__ = jest.fn();
    hooks.__runScriptWithContext__ = (_key, execute) => execute({ name: 'MarkEdit' }, undefined);
    delete hooks.__TAURI_INTERNALS__;
  });

  test('loads the document text from the host reply', async () => {
    await loadHostDocument({ text: '# Opened file\n\n한글', restoreText: null, extensions: { styles: [], scripts: [] } });
    expect(window.editor.state.doc.toString()).toBe('# Opened file\n\n한글');
  });

  test('applies recovered unsaved text as an edit on top of the file', async () => {
    await loadHostDocument({ text: 'saved', restoreText: 'saved + edits' });
    expect(window.editor.state.doc.toString()).toBe('saved + edits');
  });

  test('a broken extension does not stop the others or the document', async () => {
    const scripts = [
      { path: '/a.js', capability: 'a.js', source: 'window.__extensionLog__.push("a:" + MarkEdit.name);' },
      { path: '/broken.js', capability: 'broken.js', source: 'import x from "y"; }}}' },
      { path: '/throws.js', capability: 'throws.js', source: 'throw new Error("boom");' },
      { path: '/b.js', capability: 'b.js', source: 'window.__extensionLog__.push("b");' },
    ];
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    await loadHostDocument({ text: 'document', extensions: { styles: [{ name: 'theme.css', css: '.x{}' }], scripts } });

    expect((window as unknown as Hooks).__extensionLog__).toEqual(['a:MarkEdit', 'b']);
    expect((window as unknown as Hooks).__prepareScriptContexts__).toHaveBeenCalledWith(scripts.map(({ path, capability }) => ({ path, capability })));
    expect(document.head.querySelector('style[data-markedit-user-style="theme.css"]')?.textContent).toBe('.x{}');
    expect(window.editor.state.doc.toString()).toBe('document');
    expect(errors).toHaveBeenCalledTimes(2);
    errors.mockRestore();
  });

  test('re-applying extensions replaces the previous stylesheets', () => {
    applyExtensions({ styles: [{ name: 'a.css', css: 'a' }], scripts: [] });
    applyExtensions({ styles: [{ name: 'b.css', css: 'b' }], scripts: [] });
    expect(document.head.querySelectorAll('style[data-markedit-user-style]').length).toBe(1);
  });

  test('ignores replies without a document (older hosts)', async () => {
    await loadHostDocument(null);
    await loadHostDocument(undefined);
    expect(window.editor.state.doc.toString()).toBe('placeholder');
  });

  test('File > Open pulls the new document from the host', async () => {
    (window as unknown as Hooks).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => (cmd === 'document_content' ? { text: 'from disk' } : undefined) };
    await reloadDocumentFromHost();
    expect(window.editor.state.doc.toString()).toBe('from disk');
  });


  // A stand-in for the `markedit-theming` library the theme extensions bundle: each script
  // writes its theme into customThemes; assigning config.theme re-applies (recorded here).
  function themeScript(capability: string, light?: string, dark?: string) {
    const writes = [light === undefined ? '' : `t.customThemes.light = ${JSON.stringify(light)};`, dark === undefined ? '' : `t.customThemes.dark = ${JSON.stringify(dark)};`].join(' ');
    const source = `
      var w = window;
      if (typeof w.__markeditTheming__ !== 'object') {
        w.__markeditTheming__ = { customThemes: {}, applied: [] };
        var name = w.config.theme;
        Object.defineProperty(w.config, 'theme', {
          configurable: true,
          get: function() { return name; },
          set: function(value) { name = value; w.__markeditTheming__.applied.push(JSON.stringify(w.__markeditTheming__.customThemes)); },
        });
      }
      var t = w.__markeditTheming__;
      ${writes}`;
    return { path: `/ext/${capability}`, capability, source };
  }

  type Theming = { customThemes: Record<string, unknown>; applied: string[] };
  const theming = () => (window as unknown as { __markeditTheming__: Theming }).__markeditTheming__;

  describe('theme extensions follow the theme chosen in Settings', () => {
    beforeEach(() => {
      delete (window as unknown as { __markeditTheming__?: unknown }).__markeditTheming__;
      window.config = { theme: 'github-light' } as typeof window.config;
    });

    const scripts = () => [
      themeScript('markedit-theme-vscode.js', 'vscode-light', 'vscode-dark'),
      themeScript('markedit-theme-one-dark.js', undefined, 'one-dark'),
    ];

    test('with a built-in theme selected, no extension colors apply', () => {
      applyExtensions({ styles: [], scripts: scripts() });

      expect(theming().customThemes).toEqual({});
      expect(theming().applied.at(-1)).toBe('{}');
      expect(listThemeExtensions()).toEqual([
        { capability: 'markedit-theme-vscode.js', label: 'VS Code', light: true, dark: true },
        { capability: 'markedit-theme-one-dark.js', label: 'One Dark', light: false, dark: true },
      ]);
    });

    test('only the selected theme extension applies, and it can be switched', () => {
      (window.config as { themeExtension?: string }).themeExtension = 'markedit-theme-vscode.js';
      applyExtensions({ styles: [], scripts: scripts() });
      expect(theming().customThemes).toEqual({ light: 'vscode-light', dark: 'vscode-dark' });

      setThemeExtension('markedit-theme-one-dark.js');
      expect(theming().customThemes).toEqual({ dark: 'one-dark' });
      expect(theming().applied.at(-1)).toBe(JSON.stringify({ dark: 'one-dark' }));

      setThemeExtension('');
      expect(theming().customThemes).toEqual({});
    });

    test('a disabled theme extension stops applying when extensions reload', () => {
      (window.config as { themeExtension?: string }).themeExtension = 'markedit-theme-one-dark.js';
      applyExtensions({ styles: [], scripts: scripts() });
      expect(theming().customThemes).toEqual({ dark: 'one-dark' });

      applyExtensions({ styles: [], scripts: [] });
      expect(theming().customThemes).toEqual({});
      expect(listThemeExtensions()).toEqual([]);
    });

    test('labels theme extensions by their file name', () => {
      expect(themeExtensionLabel('markedit-theme-rose-pine.js')).toBe('Rose Pine');
      expect(themeExtensionLabel('markedit-theme-nushu.js')).toBe('Nushu');
    });
  });
});
