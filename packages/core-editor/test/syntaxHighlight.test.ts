import { describe, expect, test, afterEach } from '@jest/globals';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { classHighlighter, tags } from '@lezer/highlight';
import { codeParser, highlightWithParser } from '../src/modules/markdown-renderer/plugins/syntaxHighlight';
import { highlightCode } from '../src/modules/markdown-renderer/plugins/codeHighlightPlugin';
import { streamCodeLanguages } from '../src/codeLanguages';
import { renderMarkdownToHtml } from '../src/modules/markdown-renderer';

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
    // Fence info in attribute forms.
    expect(codeParser('{python run label=calc}')).toBeDefined();
    expect(codeParser('{.rust}')).toBeDefined();
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

  test('the editor gets the same languages for code inside fences', async () => {
    const languages = streamCodeLanguages();
    for (const name of ['python', 'py', 'rust', 'sql', 'c++', 'bash', 'yaml', 'dockerfile']) {
      const description = LanguageDescription.matchLanguageName(languages, name, true);
      expect(`${name}: ${description === null ? 'missing' : 'ok'}`).toBe(`${name}: ok`);
    }
    const python = LanguageDescription.matchLanguageName(languages, 'py', true);
    const support = await python?.load();
    expect(support?.language.name).toBe('python');
    // Shared with the preview: one language object per mode.
    expect(support?.language.parser).toBe(codeParser('python'));
  });

  test('a longer fence holds shorter ones, and the language is read without the extra backtick', () => {
    const html = renderMarkdownToHtml('````markdown\n```python\nprint(1)\n```\n````\n\nafter');
    expect(html).toContain('data-language="markdown"');
    expect(html).not.toContain('data-language="`markdown"');
    // The inner fence is code, not the end of the block.
    expect(html).toContain('python');
    expect(html.indexOf('after')).toBeGreaterThan(html.indexOf('print'));
    expect((html.match(/markedit-preview-code-block/g) ?? []).length).toBe(1);

    // A closing fence has nothing after it; ``` js does not close a block.
    const two = renderMarkdownToHtml('```js\nconst a = 1;\n```js\nconst b = 2;\n```');
    expect((two.match(/markedit-preview-code-block/g) ?? []).length).toBe(1);
  });
});
