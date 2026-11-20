import { LanguageDescription, StreamLanguage, StreamParser, highlightingFor } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import type { Parser } from '@lezer/common';
import { classHighlighter, highlightCode, Highlighter, Tag } from '@lezer/highlight';
import { c, cpp, csharp, dart, java, kotlin, objectiveC, scala } from '@codemirror/legacy-modes/mode/clike';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { commonLisp } from '@codemirror/legacy-modes/mode/commonlisp';
import { css, less, sCSS } from '@codemirror/legacy-modes/mode/css';
import { d } from '@codemirror/legacy-modes/mode/d';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { elm } from '@codemirror/legacy-modes/mode/elm';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { fortran } from '@codemirror/legacy-modes/mode/fortran';
import { go } from '@codemirror/legacy-modes/mode/go';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { fSharp, oCaml } from '@codemirror/legacy-modes/mode/mllike';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { octave } from '@codemirror/legacy-modes/mode/octave';
import { pascal } from '@codemirror/legacy-modes/mode/pascal';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { python } from '@codemirror/legacy-modes/mode/python';
import { r } from '@codemirror/legacy-modes/mode/r';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { sass } from '@codemirror/legacy-modes/mode/sass';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { mySQL, pgSQL, sqlite, standardSQL, msSQL } from '@codemirror/legacy-modes/mode/sql';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { vhdl } from '@codemirror/legacy-modes/mode/vhdl';
import { html, xml } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { escapeHtml } from '../utils';

/**
 * Syntax highlighting of fenced code in the preview, with the same parsers and colors as the
 * editor: each language is parsed (a language from the MarkEdit-language-data extension when it is
 * loaded, else a bundled mode), and tokens get the active theme's highlight classes, so code in the
 * preview looks like code in the editor for every theme, theme extensions included.
 */

/** Fence names (lowercase) → bundled mode. */
const streamModes: Record<string, StreamParser<unknown>> = {};

function register(mode: StreamParser<unknown>, ...names: string[]): void {
  for (const name of names) {
    streamModes[name] = mode;
  }
}

register(javascript, 'javascript', 'js', 'jsx', 'mjs', 'cjs', 'node');
register(typescript, 'typescript', 'ts', 'tsx', 'mts', 'cts');
register(json, 'json', 'jsonc', 'json5', 'geojson');
register(python, 'python', 'py', 'py3', 'python3', 'gyp');
register(c, 'c', 'h');
register(cpp, 'cpp', 'c++', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'arduino', 'ino');
register(csharp, 'csharp', 'cs', 'c#');
register(java, 'java');
register(kotlin, 'kotlin', 'kt', 'kts');
register(scala, 'scala', 'sc');
register(objectiveC, 'objective-c', 'objectivec', 'objc', 'm', 'mm');
register(dart, 'dart');
register(go, 'go', 'golang');
register(rust, 'rust', 'rs');
register(ruby, 'ruby', 'rb', 'gemfile', 'podfile', 'rake');
register(swift, 'swift');
register(shell, 'shell', 'sh', 'bash', 'zsh', 'ksh', 'fish', 'console', 'shellsession', 'terminal');
register(powerShell, 'powershell', 'ps1', 'psm1', 'pwsh', 'ps');
register(standardSQL, 'sql');
register(mySQL, 'mysql', 'mariadb');
register(pgSQL, 'postgresql', 'postgres', 'pgsql', 'psql');
register(sqlite, 'sqlite');
register(msSQL, 'mssql', 'tsql', 't-sql');
register(css, 'css');
register(sCSS, 'scss');
register(less, 'less');
register(sass, 'sass');
register(html, 'html', 'htm', 'xhtml', 'vue', 'svelte', 'handlebars', 'hbs');
register(xml, 'xml', 'svg', 'plist', 'xsl', 'xslt', 'xaml', 'csproj', 'rss', 'atom');
register(yaml, 'yaml', 'yml');
register(toml, 'toml');
register(properties, 'ini', 'properties', 'cfg', 'conf', 'dosini', 'editorconfig', 'gitconfig', 'env', 'dotenv');
register(dockerFile, 'dockerfile', 'docker', 'containerfile');
register(diff, 'diff', 'patch', 'udiff');
register(lua, 'lua');
register(perl, 'perl', 'pl', 'pm');
register(r, 'r', 'rscript');
register(haskell, 'haskell', 'hs');
register(nginx, 'nginx', 'nginxconf');
register(protobuf, 'protobuf', 'proto');
register(groovy, 'groovy', 'gradle', 'jenkinsfile');
register(erlang, 'erlang', 'erl');
register(elm, 'elm');
register(julia, 'julia', 'jl');
register(cmake, 'cmake');
register(vb, 'vb', 'vbnet', 'vb.net', 'visual-basic');
register(stex, 'latex', 'tex', 'stex');
register(clojure, 'clojure', 'clj', 'cljs', 'edn');
register(commonLisp, 'lisp', 'commonlisp', 'common-lisp', 'elisp', 'emacs-lisp');
register(scheme, 'scheme', 'racket', 'rkt');
register(oCaml, 'ocaml', 'ml');
register(fSharp, 'fsharp', 'fs', 'f#');
register(d, 'd');
register(fortran, 'fortran', 'f90', 'f95');
register(pascal, 'pascal', 'delphi', 'pas');
register(octave, 'octave', 'matlab');
register(tcl, 'tcl');
register(verilog, 'verilog', 'v', 'systemverilog', 'sv');
register(vhdl, 'vhdl');

const parsers = new Map<StreamParser<unknown>, Parser>();

/** Code languages from extensions (MarkEdit-language-data); set at startup, see chrome/index.ts. */
let userLanguages: () => readonly LanguageDescription[] = () => [];

export function setUserCodeLanguages(provider: () => readonly LanguageDescription[]): void {
  userLanguages = provider;
}

/** The parser for a fence's language name, or undefined when none is known. */
export function codeParser(lang: string): Parser | undefined {
  const name = lang.trim().toLowerCase().split(/[\s{]/)[0];
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

  const mode = Object.prototype.hasOwnProperty.call(streamModes, name) ? streamModes[name] : undefined;
  if (mode === undefined) {
    return undefined;
  }
  let parser = parsers.get(mode);
  if (parser === undefined) {
    parser = StreamLanguage.define(mode).parser;
    parsers.set(mode, parser);
  }
  return parser;
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
