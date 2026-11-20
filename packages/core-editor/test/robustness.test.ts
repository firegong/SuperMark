import { describe, expect, test } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { classHighlighter } from '@lezer/highlight';
import { commonmarkEngine, extendedEngine, gfmEngine, micromarkEngine, superMarkdownEngine } from '../src/modules/markdown-renderer/parsers';
import type { MarkdownRendererEngine } from '../src/modules/markdown-renderer';
import { highlightCode } from '../src/modules/markdown-renderer/plugins/codeHighlightPlugin';
import { highlightWithParser } from '../src/modules/markdown-renderer/plugins/syntaxHighlight';
import { streamModes } from '../src/codeLanguages';
import { normalizeUserSettings } from '../src/chrome/settingsModal';
import { buildPreviewThemeCss, normalizePreviewThemeStyles } from '../src/chrome/previewThemeStyles';

/**
 * Robustness: malformed, pathological and hostile input must never throw, hang, or produce HTML
 * that runs script. Samples live in docs/05-testing/samples/malformed (open them in the app too).
 */

const engines: MarkdownRendererEngine[] = [extendedEngine, gfmEngine, commonmarkEngine, superMarkdownEngine, micromarkEngine];
const samplesDir = join(__dirname, '../../../docs/05-testing/samples/malformed');
const samples = readdirSync(samplesDir)
  .filter(name => name.endsWith('.md') && name !== 'README.md')
  .map(name => ({ name, text: readFileSync(join(samplesDir, name), 'utf8') }));

/** Small deterministic PRNG, so a failure can be reproduced. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomText(seed: number, length: number, alphabet: string[]): string {
  const next = random(seed);
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += alphabet[Math.floor(next() * alphabet.length)];
  }
  return text;
}

const markdownAlphabet = [
  '*', '_', '`', '~', '#', '>', '-', '+', '|', '[', ']', '(', ')', '{', '}', '<', '>', '!', '$', '^', ':',
  '=', '\\', '"', "'", '@', '%', '&', ' ', ' ', ' ', '\n', '\n', '\t', 'a', 'b', '한', '1', '.', '/',
  '```', ':::', '$$', '[[', ']]', '{{', '}}', '<div>', '</div>', '<!--', '-->', '[^1]', '[x]', '[!note]',
];

/** Pathological inputs: deep nesting, huge runs of one marker, very long lines. */
const pathological: Record<string, string> = {
  deepQuotes: '> '.repeat(3000) + 'deep',
  deepLists: Array.from({ length: 400 }, (_, level) => `${'  '.repeat(level)}- item ${level}`).join('\n'),
  deepFencedDivs: ':::\n'.repeat(1500) + 'x\n' + ':::\n'.repeat(1500),
  openBrackets: '['.repeat(30000),
  linkChain: '[a]('.repeat(5000),
  stars: '*'.repeat(30000),
  alternatingEmphasis: '*a_'.repeat(10000),
  backticks: '`'.repeat(20000),
  dollars: '$'.repeat(20000),
  braces: '{{'.repeat(10000),
  pipes: '|'.repeat(20000) + '\n' + '|---'.repeat(3000) + '|',
  angles: '<'.repeat(20000),
  backslashes: '\\'.repeat(20000),
  longLine: 'word '.repeat(200000),
  manyLines: 'line\n'.repeat(50000),
  manyTables: '| a | b |\n|---|---|\n| 1 | 2 |\n\n'.repeat(2000),
  unclosedHtml: '<div>'.repeat(5000),
  manyFootnotes: Array.from({ length: 3000 }, (_, index) => `[^${index}] [^${index}]: note ${index}`).join('\n'),
  loneSurrogates: '\ud800a\udfffb\ud83d'.repeat(2000),
  controlCharacters: Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join('x').repeat(500),
  mixedLineEndings: 'a\rb\r\nc\nd\r'.repeat(5000),
};

/** Unsafe things that must never appear in rendered HTML. */
function expectSafe(html: string, label: string): void {
  const container = document.createElement('div');
  container.innerHTML = html;
  const problems: string[] = [];
  for (const element of Array.from(container.querySelectorAll('*'))) {
    const tag = element.tagName.toLowerCase();
    if (['script', 'iframe', 'object', 'embed', 'style', 'form', 'base', 'meta', 'link'].includes(tag)) {
      problems.push(`<${tag}>`);
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      // Strip whitespace and control characters, as browsers do before reading the scheme.
      const value = Array.from(attribute.value).filter(char => char.charCodeAt(0) > 0x20).join('').toLowerCase();
      if (name.startsWith('on')) {
        problems.push(`${tag}[${name}]`);
      }
      if (['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'].includes(name)
        && (value.startsWith('javascript:') || value.startsWith('vbscript:') || value.startsWith('data:text/html'))) {
        problems.push(`${tag}[${name}=${value.slice(0, 30)}]`);
      }
      if (name === 'style' && /url\s*\(\s*['"]?\s*javascript:|expression\s*\(/i.test(attribute.value)) {
        problems.push(`${tag}[style]`);
      }
    }
  }
  expect(`${label}: ${problems.join(', ')}`).toBe(`${label}: `);
}

function renderTimed(engine: MarkdownRendererEngine, text: string, label: string, budgetMs: number): string {
  const start = Date.now();
  let html = '';
  expect(() => {
    html = engine.render(text);
  }).not.toThrow();
  const elapsed = Date.now() - start;
  expect(`${label}: ${elapsed <= budgetMs ? 'fast' : `${elapsed}ms`}`).toBe(`${label}: fast`);
  return html;
}

describe('Renderer robustness', () => {
  test.each(samples.map(sample => [sample.name, sample.text]))('malformed sample %s renders safely with every renderer', (name, text) => {
    for (const engine of engines) {
      const html = renderTimed(engine, text, `${engine.id} ${name}`, 2000);
      expect(typeof html).toBe('string');
      expectSafe(html, `${engine.id} ${name}`);
    }
  });

  test('hostile HTML is neutralized', () => {
    const hostile = samples.find(sample => sample.name.includes('hostile'))?.text ?? '';
    for (const engine of engines) {
      const container = document.createElement('div');
      container.innerHTML = engine.render(hostile);
      document.body.appendChild(container);
      expect((window as { __pwned?: number }).__pwned).toBeUndefined();
      container.remove();
    }
  });

  test.each(Object.entries(pathological))('pathological input "%s" renders in time with every renderer', (name, text) => {
    for (const engine of engines) {
      expectSafe(renderTimed(engine, text, `${engine.id} ${name}`, 4000), `${engine.id} ${name}`);
    }
  });

  test('random Markdown punctuation never throws or hangs', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const text = randomText(seed, 3000, markdownAlphabet);
      for (const engine of engines) {
        expectSafe(renderTimed(engine, text, `${engine.id} seed ${seed}`, 1500), `${engine.id} seed ${seed}`);
      }
    }
  });

  test('random code units (including invalid UTF-16) never throw', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const next = random(seed * 7919);
      const text = Array.from({ length: 4000 }, () => String.fromCharCode(Math.floor(next() * 0x10000))).join('');
      for (const engine of engines) {
        renderTimed(engine, text, `${engine.id} code units ${seed}`, 1500);
      }
    }
  });
});

describe('Highlighter robustness', () => {
  const garbage = [
    '',
    '"unterminated string',
    "'''\n\"\"\"\n/* never closed",
    '<<<<<<<<<<<< >>>>>>>> {{{{{{ ]]]]]]',
    randomText(42, 5000, [...markdownAlphabet, ';', ',', '0x', '1e9', '#', '//', '--', '(*', '*)', '\\\n']),
    '𐀀\ud800 lone',
  ];

  test('every bundled language handles garbage and long input', () => {
    const names = Object.keys(streamModes);
    for (const name of names) {
      for (const code of [...garbage, 'x = 1;\n'.repeat(5000)]) {
        const start = Date.now();
        let html: string | undefined;
        expect(() => {
          html = highlightWithParser(code, name, classHighlighter);
        }).not.toThrow();
        expect(`${name}: ${Date.now() - start <= 2000 ? 'fast' : 'slow'}`).toBe(`${name}: fast`);
        // Escaped: no raw markup from the code survives.
        expect(html ?? '').not.toMatch(/<(?!span|\/span)/);
      }
    }
  });

  test('the generic tokenizer handles unknown languages and garbage', () => {
    for (const code of garbage) {
      expect(() => highlightCode(code, 'not-a-language')).not.toThrow();
      expect(highlightCode(code, 'not-a-language')).not.toMatch(/<(?!span|\/span)/);
    }
  });
});

describe('Settings robustness', () => {
  test('settings from a damaged file normalize to safe values', () => {
    const damaged: unknown[] = [
      null, undefined, 42, 'text', [], [1, 2],
      { fontSize: 'huge', theme: 12, lineHeight: null, tabKeyBehavior: 'x', appearance: 'purple', previewThemeStyles: 'nope' },
      { 'editor.fontSize': Number.NaN, 'editor.lightTheme': {}, diagramRendering: 'everywhere' },
      JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}'),
    ];
    for (const raw of damaged) {
      expect(() => normalizeUserSettings(raw as Record<string, unknown>)).not.toThrow();
      const settings = normalizeUserSettings(raw as Record<string, unknown>);
      expect(['system', 'light', 'dark']).toContain(settings.appearance);
      expect(['auto', 'local', 'server']).toContain(settings.diagramRendering);
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  test('preview styles from a damaged file cannot inject CSS', () => {
    const styles = normalizePreviewThemeStyles({
      'github-light': {
        h1: { fontFamily: 'x; } body { display: none } .a {', color: 'red; background: url(javascript:alert(1))', fontSize: '12px; }' },
        body: { fontWeight: 'bold', color: '#12345g' },
        notAnElement: { color: '#ffffff' },
      },
      '': { h1: { color: '#ffffff' } },
      __proto__: { h1: { color: '#000000' } },
    });
    const css = buildPreviewThemeCss(styles['github-light']);
    // One rule, no extra declarations: no `;` or `:` survive inside the font name.
    expect(css).not.toContain('display:');
    expect(css.match(/;/g)?.length).toBe(css.match(/:/g)?.length);
    expect(css).not.toContain('javascript:');
    expect(css).not.toContain('notAnElement');
    expect(css.split('{').length).toBe(css.split('}').length);
    expect(Object.keys(styles)).toEqual(['github-light']);
  });
});
