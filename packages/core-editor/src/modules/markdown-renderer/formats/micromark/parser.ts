import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { renderMdast, type MdastRenderHooks } from '../../core/mdastRenderer';
import { highlightCode } from '../../plugins/codeHighlightPlugin';
import { renderDiagramWithPlugin, renderMathWithPlugin } from '../../plugins/registry';
import { diagramBlockHtml } from '../../plugins/builtin';
import { escapeHtml } from '../../utils';
import type { MarkdownRendererEngine } from '../../types';

/**
 * micromark (https://github.com/micromark/micromark): a spec-compliant CommonMark parser with the
 * GFM extensions (tables, task lists, strikethrough, autolinks, footnotes) and math (`$…$`,
 * `$$…$$`). It parses into an mdast tree with source positions, which core/mdastRenderer.ts turns
 * into preview HTML (so scroll sync and checkboxes work), with diagrams, math and code
 * highlighting from the shared plugins.
 *
 * To update or replace this parser, change only this folder and keep the id `micromark`.
 */

const hooks: MdastRenderHooks = {
  highlightCode,
  renderMath: (latex, displayMode) => renderMathWithPlugin(latex, displayMode),
  renderDiagram: (lang, code) => {
    const rendered = renderDiagramWithPlugin(lang, code);
    return rendered === null ? null : diagramBlockHtml(lang.toLowerCase(), code, rendered);
  },
};

/**
 * Guards against inputs micromark parses slowly, so the preview never freezes. Line numbers stay
 * the same (only characters within lines change); fenced code is untouched.
 *
 * - Emphasis is resolved in time quadratic in the number of `*`/`_` markers of a paragraph
 *   (12,000 markers took over a second): in the rare paragraph with more than this many, the
 *   markers are escaped and it renders as plain text.
 * - Very deep nesting (hundreds of indented list levels) takes seconds to parse: indentation is
 *   capped at the depth beyond which the renderer shows plain text anyway.
 */
const maxEmphasisMarkersPerParagraph = 3000;
const maxIndentColumns = 128;

export function tamePathologicalInput(markdown: string): string {
  const lines = markdown.split('\n');
  let paragraph: number[] = [];
  let markers = 0;
  let fence: string | null = null;

  const flush = () => {
    if (markers > maxEmphasisMarkersPerParagraph) {
      for (const index of paragraph) {
        lines[index] = lines[index].replace(/[*_]/g, '\\$&');
      }
    }
    paragraph = [];
    markers = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      // Inside fenced code: nothing to escape until the closing fence.
      if (fenceMatch !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch !== null) {
      flush();
      fence = fenceMatch[1];
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
    if (indent.length > maxIndentColumns) {
      lines[index] = ' '.repeat(maxIndentColumns) + line.slice(indent.length);
    }
    paragraph.push(index);
    for (const char of line) {
      if (char === '*' || char === '_') {
        markers += 1;
      }
    }
  }
  flush();
  return lines.join('\n');
}

export const micromarkEngine: MarkdownRendererEngine = {
  id: 'micromark',
  name: 'micromark (CommonMark + GFM)',
  standard: 'micromark',
  render(markdown: string): string {
    try {
      const tree = fromMarkdown(tamePathologicalInput(markdown), {
        extensions: [gfm(), math()],
        mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
      });
      return renderMdast(tree, hooks);
    } catch (error) {
      console.error('[MarkEdit] micromark failed to parse the document:', error);
      return `<pre>${escapeHtml(markdown)}</pre>`;
    }
  },
  renderMath: (latex, displayMode) => renderMathWithPlugin(latex, displayMode),
};
