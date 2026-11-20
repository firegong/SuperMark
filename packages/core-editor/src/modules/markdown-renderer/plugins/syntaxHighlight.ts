import { LanguageDescription, highlightingFor } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Parser } from '@lezer/common';
import { classHighlighter, highlightCode, Highlighter, Tag } from '@lezer/highlight';
import { escapeHtml } from '../utils';
import { streamLanguage } from '../../../codeLanguages';

/**
 * Syntax highlighting of fenced code in the preview, with the same parsers and colors as the
 * editor: each language is parsed (a language from the MarkEdit-language-data extension when it is
 * loaded, else a bundled mode), and tokens get the active theme's highlight classes, so code in the
 * preview looks like code in the editor for every theme, theme extensions included.
 */

/** Code languages from extensions (MarkEdit-language-data); set at startup, see chrome/index.ts. */
let userLanguages: () => readonly LanguageDescription[] = () => [];

export function setUserCodeLanguages(provider: () => readonly LanguageDescription[]): void {
  userLanguages = provider;
}

/** The parser for a fence's language name, or undefined when none is known. */
export function codeParser(lang: string): Parser | undefined {
  // `python`, `python caption=…`, `{python run}`, `{.python}`.
  const name = lang.trim().toLowerCase().replace(/^[`{.\s]+/, '').split(/[\s{},]/)[0];
  if (name === '') {
    return undefined;
  }

  // A language loaded from the MarkEdit-language-data extension (the editor uses it too).
  const extension = LanguageDescription.matchLanguageName(userLanguages(), name, true);
  if (extension?.support !== undefined) {
    return extension.support.language.parser;
  }

  if (name === 'markdown' || name === 'md') {
    return markdownLanguage.parser;
  }

  return streamLanguage(name)?.parser;
}

/**
 * The editor's active highlighting (its theme), so the preview uses the theme's exact colors; the
 * generic `tok-*` classes (styled in index.css) when there is no editor.
 */
export function activeHighlighter(): Highlighter {
  const state = (window as { editor?: { state?: Parameters<typeof highlightingFor>[0] } }).editor?.state;
  if (state === undefined) {
    return classHighlighter;
  }
  return {
    // The editor also runs the generic class highlighter; keep only the theme's own classes.
    style: (tags: readonly Tag[]) => {
      const classes = highlightingFor(state, tags)?.split(' ').filter(name => name !== '' && !name.startsWith('tok-')) ?? [];
      return classes.length > 0 ? classes.join(' ') : null;
    },
  };
}

/** Highlighted HTML for code in a known language, or undefined when the language is not known. */
export function highlightWithParser(code: string, lang: string, highlighter = activeHighlighter()): string | undefined {
  const parser = codeParser(lang);
  if (parser === undefined) {
    return undefined;
  }

  let tree;
  try {
    tree = parser.parse(code);
  } catch (error) {
    console.error(`[MarkEdit] Failed to parse ${lang} code:`, error);
    return undefined;
  }

  let html = '';
  highlightCode(code, tree, highlighter, (text, classes) => {
    const escaped = escapeHtml(text);
    html += classes === '' ? escaped : `<span class="${escapeHtml(classes)}">${escaped}</span>`;
  }, () => {
    html += '\n';
  });
  return html;
}
