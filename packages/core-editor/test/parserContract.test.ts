import { describe, expect, test } from '@jest/globals';
import { builtInParsers } from '../src/modules/markdown-renderer/parsers';
import { previewClasses } from '../src/modules/markdown-renderer/previewMarkup';
import type { MarkdownRendererEngine } from '../src/modules/markdown-renderer';

/**
 * The preview markup contract (src/modules/markdown-renderer/previewMarkup.ts), checked for every
 * built-in parser. A new or replaced parser that breaks it would still render, but scroll sync,
 * double-click to source, task checkboxes or code copy buttons would stop working.
 */

const source = [
  '# Heading', //       0
  '', //                1
  'A paragraph.', //    2
  '', //                3
  '- [ ] open task', // 4
  '- [x] done task', // 5
  '', //                6
  '| a | b |', //       7
  '|---|---|', //       8
  '| 1 | 2 |', //       9
  '', //               10
  '```js', //          11
  'const x = 1;', //   12
  '```', //            13
  '', //               14
  '> A quote.', //     15
].join('\n');

function render(parser: MarkdownRendererEngine): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = parser.render(source);
  return container;
}

function lineOf(container: HTMLElement, selector: string): number | null {
  const element = container.querySelector(selector);
  const block = element?.closest<HTMLElement>(`.${previewClasses.block}`) ?? null;
  return block === null ? null : Number(block.dataset.line);
}

describe.each(builtInParsers.map(parser => [parser.id, parser] as const))('Preview markup contract: %s', (_id, parser) => {
  const container = render(parser);

  test('blocks carry their source line (scroll sync, double-click to source)', () => {
    expect(lineOf(container, 'h1')).toBe(0);
    expect(lineOf(container, 'p')).toBe(2);
    expect(lineOf(container, 'blockquote')).toBe(15);
    for (const block of Array.from(container.querySelectorAll<HTMLElement>(`.${previewClasses.block}`))) {
      expect(block.dataset.line).toMatch(/^\d+$/);
    }
  });

  test('code blocks have the shared wrapper with language label and Copy button', () => {
    const block = container.querySelector<HTMLElement>(`.${previewClasses.codeBlock}`);
    expect(block).not.toBeNull();
    expect(block?.dataset.language).toBe('js');
    expect(block?.querySelector(`.${previewClasses.codeCopy}`)).not.toBeNull();
    expect(block?.querySelector('pre code')?.textContent).toContain('const x = 1;');
    expect(lineOf(container, `.${previewClasses.codeBlock}`)).toBe(11);
  });

  test('task checkboxes, when the parser has task lists, point at their source lines', () => {
    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    if (checkboxes.length === 0) {
      // CommonMark has no task lists.
      expect(parser.id).toBe('commonmark');
      return;
    }
    expect(checkboxes.every(checkbox => checkbox.classList.contains(previewClasses.taskCheckbox))).toBe(true);
    expect(checkboxes.map(checkbox => [checkbox.dataset.line, checkbox.checked])).toEqual([['4', false], ['5', true]]);
  });

  test('tables, when the parser has tables, use the preview table class', () => {
    const tables = Array.from(container.querySelectorAll('table'));
    if (tables.length === 0) {
      expect(parser.id).toBe('commonmark');
      return;
    }
    expect(tables.every(table => table.classList.contains(previewClasses.table))).toBe(true);
    expect(lineOf(container, 'table')).toBe(7);
  });
});
