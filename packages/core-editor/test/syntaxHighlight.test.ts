import { describe, expect, test, afterEach } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter, tags } from '@lezer/highlight';
import { codeParser, highlightWithParser } from '../src/modules/markdown-renderer/plugins/syntaxHighlight';
import { highlightCode } from '../src/modules/markdown-renderer/plugins/codeHighlightPlugin';

type EditorHolder = { editor?: { state: EditorState } };

describe('Preview syntax highlighting', () => {
  afterEach(() => {
    delete (window as EditorHolder).editor;
  });

  test('knows common languages by name and alias', () => {
    for (const name of ['js', 'TypeScript', 'tsx', 'json', 'python', 'py', 'c++', 'csharp', 'java', 'kotlin', 'go', 'rust',
      'ruby', 'swift', 'bash', 'powershell', 'sql', 'postgres', 'css', 'scss', 'html', 'xml', 'yaml', 'toml', 'ini',
      'dockerfile', 'diff', 'lua', 'r', 'haskell', 'latex', 'markdown', 'python {.class}']) {
      expect(`${name}: ${codeParser(name) === undefined ? 'missing' : 'ok'}`).toBe(`${name}: ok`);
    }
    expect(codeParser('no-such-language')).toBeUndefined();
    expect(codeParser('')).toBeUndefined();
    expect(codeParser('constructor')).toBeUndefined();
  });

  test('each language is tokenized by its own rules', () => {
    const python = highlightWithParser('def greet(name):\n    # say hi\n    return f"hi {name}"', 'python', classHighlighter) ?? '';
    expect(python).toContain('<span class="tok-keyword">def</span>');
    expect(python).toContain('<span class="tok-comment"># say hi</span>');
    expect(python).toContain('\n');

    // `#` is not a comment in JavaScript, `--` is one in SQL.
    const sql = highlightWithParser('SELECT id FROM users -- all\nWHERE id = 1;', 'sql', classHighlighter) ?? '';
    expect(sql).toContain('<span class="tok-keyword">SELECT</span>');
    expect(sql).toContain('<span class="tok-comment">-- all</span>');
    expect(sql).toContain('<span class="tok-number">1</span>');

    const rust = highlightWithParser('fn main() { let x: u32 = 5; }', 'rs', classHighlighter) ?? '';
    expect(rust).toContain('<span class="tok-keyword">fn</span>');

    // Code is escaped.
    expect(highlightWithParser('<b>&</b>', 'html', classHighlighter)).not.toContain('<b>');
  });

  test('uses the editor theme\'s highlight classes', () => {
    const style = HighlightStyle.define([{ tag: tags.keyword, color: '#ff00ff' }]);
    (window as EditorHolder).editor = { state: EditorState.create({ extensions: [syntaxHighlighting(style)] }) };

    const html = highlightCode('const x = 1', 'javascript');
    const keywordClass = /<span class="([^"]+)">const<\/span>/.exec(html)?.[1];
    expect(keywordClass).toBeDefined();
    expect(keywordClass).not.toContain('tok-');
    expect(style.style([tags.keyword])).toBe(keywordClass);

    // Unknown languages use the generic tokenizer, in the same theme classes.
    expect(highlightCode('return 1', 'some-language')).toContain(`<span class="${keywordClass ?? ''}">return</span>`);
    expect(highlightCode('graph TD', 'mermaid')).toBe('graph TD');
  });
});
