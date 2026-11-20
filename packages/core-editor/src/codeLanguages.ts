import { LanguageDescription, LanguageSupport, StreamLanguage, StreamParser } from '@codemirror/language';
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

/**
 * Code languages for fenced code, shared by the editor (code inside fences is highlighted) and the
 * preview (plugins/syntaxHighlight.ts), so both color code the same way. Languages from the
 * MarkEdit-language-data extension, when installed, take precedence over these.
 */

/** Fence names (lowercase) → bundled mode. */
export const streamModes: Record<string, StreamParser<unknown>> = {};

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

const languages = new Map<StreamParser<unknown>, StreamLanguage<unknown>>();

/** The bundled mode for a fence name (lowercase), as a language. */
export function streamLanguage(name: string): StreamLanguage<unknown> | undefined {
  const mode = Object.prototype.hasOwnProperty.call(streamModes, name) ? streamModes[name] : undefined;
  if (mode === undefined) {
    return undefined;
  }
  let language = languages.get(mode);
  if (language === undefined) {
    language = StreamLanguage.define(mode);
    languages.set(mode, language);
  }
  return language;
}

let descriptions: LanguageDescription[] | undefined;

/** The bundled modes as language descriptions, for the editor's Markdown `codeLanguages`. */
export function streamCodeLanguages(): LanguageDescription[] {
  if (descriptions !== undefined) {
    return descriptions;
  }

  const namesByMode = new Map<StreamParser<unknown>, string[]>();
  for (const [name, mode] of Object.entries(streamModes)) {
    namesByMode.set(mode, [...(namesByMode.get(mode) ?? []), name]);
  }

  descriptions = [...namesByMode.values()].map(([name, ...alias]) => LanguageDescription.of({
    name,
    alias,
    // Created on first use: the editor loads a language when a fence names it.
    load: async () => new LanguageSupport(streamLanguage(name) as StreamLanguage<unknown>),
  }));
  return descriptions;
}
