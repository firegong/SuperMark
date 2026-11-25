import type { MarkdownRendererEngine, MarkdownRenderOptions } from '../../types';
import { highlightCode } from '../../plugins/codeHighlightPlugin';
import { renderDiagramWithPlugin, renderMathWithPlugin } from '../../plugins/registry';
import { diagramBlockHtml } from '../../plugins/builtin';
import { escapeHtml } from '../../utils';
import { BlockRenderer } from './blocks';
import type { Abbreviation, GmarkdownContext, GmarkdownHooks, GmarkdownOptions } from './context';
import { expandImports, extractAbbreviations, extractHeader, toLines, type DocumentHeader } from './preprocess';

/**
 * gmarkdown Markdown: the dialect of the gmarkdown Markdown → Confluence tool, as documented in
 * docs/reference/GMARKDOWN-SYNTAX.md (based on gmarkdown's own parser, `mdparser`).
 *
 * The preview follows gmarkdown's output, with three intentional differences:
 * - math and abbreviation definitions inside fenced code are left alone (gmarkdown changes them);
 * - `[[page]]` links to `page.md`, so the link opens the document in the app (gmarkdown: page.html);
 * - front matter and metadata comments, which gmarkdown removes, are shown in a header panel.
 *
 * The format module (engine + preview) is index.ts.
 */

const hooks: GmarkdownHooks = {
  highlightCode,
  renderMath: (latex, displayMode) => renderMathWithPlugin(latex, displayMode),
  renderDiagram: (lang, code) => {
    // PlantUML and Graphviz (§9.1); Mermaid stays a code block, as in gmarkdown.
    const pluginLang = lang.toLowerCase() === 'puml' ? 'plantuml' : lang.toLowerCase();
    const rendered = renderDiagramWithPlugin(pluginLang, code);
    return rendered === null ? null : diagramBlockHtml(pluginLang, code, rendered);
  },
};

function abbreviationPattern(abbreviations: Abbreviation[]): RegExp | null {
  if (abbreviations.length === 0) {
    return null;
  }
  const alternatives = abbreviations
    .map(entry => escapeHtml(entry.abbr).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
}

function headerHtml(header: DocumentHeader): string {
  if (header.frontMatter === null && header.metadata.length === 0) {
    return '';
  }
  const rows = header.metadata.map(entry => `<tr><th>${escapeHtml(entry.key)}</th><td>${escapeHtml(entry.value)}</td></tr>`).join('');
  const table = rows === '' ? '' : `<table>${rows}</table>`;
  const frontMatter = header.frontMatter === null
    ? ''
    : `<details><summary>Front Matter</summary><pre>${escapeHtml(header.frontMatter)}</pre></details>`;
  return `<div class="markedit-preview-frontmatter gmarkdown-header">${frontMatter}${table}</div>`;
}

function renderGmarkdown(markdown: string, options?: GmarkdownOptions): string {
  const { header, body } = extractHeader(toLines(markdown));
  const imported = expandImports(body, options ?? {});
  const { abbreviations, body: lines } = extractAbbreviations(imported);

  const context: GmarkdownContext = {
    hooks,
    abbreviations,
    abbreviationPattern: abbreviationPattern(abbreviations),
    footnoteDefinitions: new Map(),
    footnoteOrder: [],
    headingIds: new Map(),
    headingTexts: new Map(),
    depth: 0,
  };
  const blocks = new BlockRenderer(context);
  blocks.collectReferences(lines);
  const content = blocks.render(lines);
  return headerHtml(header) + content + blocks.footnotes();
}

export const gmarkdownEngine: MarkdownRendererEngine = {
  id: 'gmarkdown',
  name: 'gMarkdown set',
  standard: 'gmarkdown',
  render(markdown: string, options?: MarkdownRenderOptions): string {
    return renderGmarkdown(markdown, options as GmarkdownOptions | undefined);
  },
  renderMath: (latex, displayMode) => renderMathWithPlugin(latex, displayMode),
};

export type { GmarkdownOptions } from './context';
