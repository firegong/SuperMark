import { escapeHtml, isUnsafeUrl, slugify, parseLinkDestination } from '../utils';
import { renderMermaidToSvg } from '../plugins/mermaidPlugin';
import { hasDiagramPlugin, renderDiagramWithPlugin, renderMathWithPlugin } from '../plugins/registry';
import { diagramBlockHtml, registerBuiltinRendererPlugins } from '../plugins/builtin';
import { highlightCode } from '../plugins/codeHighlightPlugin';
import type { Line, MarkdownRenderOptions, MarkdownRendererEngine, MarkdownBlockPlugin, MarkdownInlinePlugin, MarkdownSyntaxStandard, RenderContext } from '../types';

registerBuiltinRendererPlugins();

function renderInlineMath(escapedLatex: string, displayMode: boolean): string {
  // parseInline runs on HTML-escaped text; give the math plugin the original LaTeX
  // (otherwise `&` column separators arrive as `&amp;` and `<` as `&lt;`).
  const latex = escapedLatex
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&');
  const math = renderMathWithPlugin(latex, displayMode);
  return displayMode ? `<div class="markedit-math-block">${math}</div>` : `<span class="markedit-math-inline">${math}</span>`;
}

const alertTitles: Record<string, { label: string; icon: string }> = {
  note: { label: 'Note', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a.75.75 0 010-1.5.75.75 0 010 1.5zm0-3c.41 0 .75-.34.75-.75V4.5a.75.75 0 00-1.5 0v3.75c0 .41.34.75.75.75z' },
  tip: { label: 'Tip', icon: 'M9.5 1a4.5 4.5 0 00-4.3 5.9L1.5 11h3v3h7v-3h3l-3.7-4.1A4.5 4.5 0 009.5 1z' },
  important: { label: 'Important', icon: 'M8 1L1 14h14L8 1zm0 3.5L11 7l1.5 1.5 1.5-1.5L14 2.5l-1.5 1.5-.5-.5-1.5 1.5 1.5 1.5zM7.5 8v3h1V8h-1z' },
  warning: { label: 'Warning', icon: 'M8.88 1.4a1 1 0 00-1.76 0l-7 13A1 1 0 001 15.5h14a1 1 0 00.88-1.6l-7-13.5zM8 12a1 1 0 110-2 1 1 0 010 2zm0-3V6h1v3H8z' },
  caution: { label: 'Caution', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 01.75.75v4a.75.75 0 01-1.5 0v-4A.75.75 0 018 4.5zm0 7a.75.75 0 110-1.5.75.75 0 010 1.5z' },
};

function classifyLine(raw: string, lineNumber = 0): Line {
  const indent = raw.match(/^(\s*)/)?.[1].length ?? 0;
  return { raw, text: raw.trim(), indent, lineNumber };
}

function parseYamlFrontMatter(lines: Line[]): { frontMatter: string | null; remaining: Line[] } {
  if (lines.length === 0 || lines[0].text !== '---') {
    return { frontMatter: null, remaining: lines };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].text === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontMatter: null, remaining: lines };
  }

  const frontMatter = lines.slice(1, endIndex).map(line => line.raw).join('\n');
  return { frontMatter, remaining: lines.slice(endIndex + 1) };
}

function renderYamlFrontMatter(yaml: string): string {
  const rows = yaml.split('\n').map(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    return { key, value };
  }).filter((row): row is { key: string; value: string } => row !== null);

  if (rows.length === 0) {
    return '';
  }

  const tableRows = rows.map(row => `<tr><th>${escapeHtml(row.key)}</th><td>${escapeHtml(row.value)}</td></tr>`).join('');
  return `<div class="markedit-preview-frontmatter"><table>${tableRows}</table></div>`;
}

function isFencedCodeStart(line: string): { fence: string; lang: string } | null {
  // Three or more backticks or tildes; a longer fence can hold shorter ones (```` around ```).
  const match = /^(`{3,}|~{3,})(.*)$/.exec(line);
  if (match === null) {
    return null;
  }

  const info = match[2].trim();
  // CommonMark: the info string of a backtick fence cannot contain a backtick.
  if (match[1].startsWith('`') && info.includes('`')) {
    return null;
  }

  return { fence: match[1], lang: info.split(/\s/)[0] };
}

/** A closing fence: the same character, at least as long as the opening one, nothing after it. */
function isFencedCodeEnd(line: string, fence: string): boolean {
  const match = /^(`{3,}|~{3,})\s*$/.exec(line);
  return match !== null && match[1][0] === fence[0] && match[1].length >= fence.length;
}

function isHorizontalRule(line: string): boolean {
  return /^([*\-_])(\s*\1){2,}\s*$/.test(line);
}

function isHeading(line: string): { level: number; content: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (match !== null) {
    return { level: match[1].length, content: match[2].trim() };
  }

  return null;
}

function isTableRow(line: string): { cells: string[]; isSeparator: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }

  const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined);
  const cells = inner.split('|').map(cell => cell.trim()).filter(cell => cell.length > 0 || inner.includes('|'));

  if (cells.length === 0) {
    return null;
  }

  const isSeparator = cells.every(cell => /^:?-+(:?)?$/.test(cell));
  return { cells, isSeparator };
}

function isListItem(line: string): { marker: string; content: string; task: null | boolean } | null {
  const match = /^(\s*)([-*+]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$/.exec(line);
  if (match === null) {
    return null;
  }

  const task = match[3] ? match[3].includes('x') : null;
  return { marker: match[2], content: match[4].trim(), task };
}

function isBlockquote(line: string): { content: string } | null {
  const match = /^>\s?(.*)$/.exec(line);
  if (match === null) {
    return null;
  }

  return { content: match[1] };
}

function blockAttributes(lineNumber: number, extraClass = ''): string {
  const className = extraClass.length > 0 ? `markedit-preview-block ${extraClass}` : 'markedit-preview-block';
  return `class="${className}" data-line="${lineNumber}"`;
}

function parseInline(text: string, context: RenderContext): string {
  let result = escapeHtml(text);

  if (context.options.enableFootnotes) {
    result = result.replace(/\[\^([^\]]+)\]/g, '<sup class="markedit-preview-footnote-ref"><a href="#fn-$1" id="fnref-$1">$1</a></sup>');
  }

  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full: string, alt: string, dest: string) => {
    const parsed = parseLinkDestination(dest);
    if (parsed === null || isUnsafeUrl(parsed.href)) {
      return full;
    }
    const titleAttr = parsed.title.length > 0 ? ` title="${escapeHtml(parsed.title)}"` : '';
    return `<img src="${escapeHtml(parsed.href)}" alt="${escapeHtml(alt)}"${titleAttr} class="markedit-preview-image">`;
  });

  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full: string, label: string, dest: string) => {
    const parsed = parseLinkDestination(dest);
    if (parsed === null || isUnsafeUrl(parsed.href)) {
      return full;
    }
    const titleAttr = parsed.title.length > 0 ? ` title="${escapeHtml(parsed.title)}"` : '';
    return `<a href="${escapeHtml(parsed.href)}"${titleAttr}>${parseInline(label, context)}</a>`;
  });

  if (context.options.enableAutolinks) {
    result = result.replace(/<([a-z][a-z0-9+.-]*:[^\s<>]+)>/gi, (full: string, url: string) => {
      if (isUnsafeUrl(url)) {
        return escapeHtml(url);
      }
      return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
    });
  }

  result = result.replace(/`([^`]+)`/g, '<code class="markedit-preview-code">$1</code>');

  if (context.options.enableMath) {
    result = result.replace(/\$\$([^$]+)\$\$/g, (_full: string, latex: string) => renderInlineMath(latex, true));
    result = result.replace(/\$([^\s$][^$]*?)\$/g, (_full: string, latex: string) => renderInlineMath(latex, false));
  }

  if (context.options.enableStrikethrough) {
    result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }

  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');
  result = result.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  return result;
}

function renderAlert(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length === 0 || !context.options.enableCallouts) {
    return null;
  }

  const first = isBlockquote(lines[0].raw);
  if (first === null) {
    return null;
  }

  const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(first.content);
  if (alertMatch === null) {
    return null;
  }

  const type = alertMatch[1].toLowerCase();
  const title = alertMatch[2].trim().length > 0 ? alertMatch[2].trim() : alertTitles[type].label;
  const startLine = lines[0].lineNumber;

  const contentLines: Line[] = [];
  let consumed = 1;
  let firstContent = true;

  while (consumed < lines.length) {
    const bq = isBlockquote(lines[consumed].raw);
    if (bq === null) {
      break;
    }

    if (firstContent && bq.content.trim().length === 0) {
      consumed += 1;
      firstContent = false;
      continue;
    }

    firstContent = false;
    contentLines.push(classifyLine(bq.content, lines[consumed].lineNumber));
    consumed += 1;
  }

  const inner = renderBlocks(contentLines, context);
  const iconSvg = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${alertTitles[type].icon}"/></svg>`;
  const html = `<div ${blockAttributes(startLine)}><div class="markedit-preview-alert is-${type}"><div class="markedit-preview-alert-title">${iconSvg}${escapeHtml(title)}</div><div class="markedit-preview-alert-content">${inner}</div></div></div>`;

  return { html, consumed };
}

function renderFencedCode(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length === 0) {
    return null;
  }

  const start = isFencedCodeStart(lines[0].raw);
  if (start === null) {
    return null;
  }

  const startLine = lines[0].lineNumber;
  let consumed = 1;
  const content: string[] = [];

  while (consumed < lines.length) {
    const line = lines[consumed].raw;
    if (isFencedCodeEnd(line, start.fence)) {
      consumed += 1;
      break;
    }

    content.push(line);
    consumed += 1;
  }

  const rawCode = content.join('\n');

  // Diagram plugins (mermaid, plantuml, d2, drawio, …), see plugins/registry.ts
  if (context.options.enableMermaid && hasDiagramPlugin(start.lang)) {
    const rendered = renderDiagramWithPlugin(start.lang, rawCode);
    if (rendered !== null) {
      return { html: `<div ${blockAttributes(startLine)}>${diagramBlockHtml(start.lang.toLowerCase(), rawCode, rendered)}</div>`, consumed };
    }
  }

  const code = context.options.enableCodeHighlight && start.lang.length > 0
    ? context.highlightCode(rawCode, start.lang)
    : escapeHtml(rawCode);
  const langAttr = start.lang.length > 0 ? ` data-language="${escapeHtml(start.lang)}"` : '';
  const langLabel = start.lang.length > 0 ? `<span class="markedit-preview-code-lang">${escapeHtml(start.lang)}</span>` : '';
  const html = `<div ${blockAttributes(startLine)}><div class="markedit-preview-code-block"${langAttr}>${langLabel}<button type="button" class="markedit-preview-code-copy">Copy</button><pre><code>${code}</code></pre></div></div>`;

  return { html, consumed };
}

function renderTable(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length < 2 || !context.options.enableTables) {
    return null;
  }

  const header = isTableRow(lines[0].raw);
  const separator = isTableRow(lines[1].raw);
  if (header === null || separator?.isSeparator !== true) {
    return null;
  }

  const startLine = lines[0].lineNumber;
  const aligns = separator.cells.map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  const renderCells = (cells: string[], tag: string) => cells.map((cell, index) => {
    const align = aligns[index] ?? 'left';
    return `<${tag} style="text-align: ${align}">${parseInline(cell, context)}</${tag}>`;
  }).join('');

  let html = `<div ${blockAttributes(startLine)}><table class="markedit-preview-table"><thead><tr>${renderCells(header.cells, 'th')}</tr></thead><tbody>`;

  let consumed = 2;
  while (consumed < lines.length) {
    const row = isTableRow(lines[consumed].raw);
    if (row === null || row.isSeparator) {
      break;
    }

    html += `<tr data-line="${lines[consumed].lineNumber}">${renderCells(row.cells, 'td')}</tr>`;
    consumed += 1;
  }

  html += '</tbody></table></div>';
  return { html, consumed };
}

function renderList(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length === 0) {
    return null;
  }

  const first = isListItem(lines[0].raw);
  if (first === null) {
    return null;
  }

  const ordered = /^\d+\./.test(first.marker);
  let consumed = 0;
  const items: { content: string; task: boolean | null; lineNumber: number; subLines: Line[] }[] = [];

  while (consumed < lines.length) {
    const item = isListItem(lines[consumed].raw);
    if (item === null) {
      break;
    }

    const currentIndent = lines[consumed].indent;
    const itemLineNumber = lines[consumed].lineNumber;
    const content: string[] = [item.content];
    const subLines: Line[] = [];
    consumed += 1;

    let sawBlank = false;
    while (consumed < lines.length) {
      const next = lines[consumed];
      if (next.raw.trim().length === 0) {
        sawBlank = true;
        content.push('');
        consumed += 1;
        continue;
      }

      const nextItem = isListItem(next.raw);
      if (nextItem !== null && next.indent <= currentIndent) {
        break;
      }

      if (next.indent > currentIndent) {
        sawBlank = false;
        subLines.push(next);
      } else if (!sawBlank) {
        content.push(next.raw.slice(currentIndent + 2).trimStart());
      } else {
        break;
      }

      sawBlank = false;
      consumed += 1;
    }

    items.push({ content: content.join('\n').trim(), task: item.task, lineNumber: itemLineNumber, subLines });
  }

  const hasTasks = items.some(item => item.task !== null);
  const listClass = hasTasks ? 'markedit-preview-list markedit-preview-task-list' : 'markedit-preview-list';
  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag} class="${listClass}">`;

  for (const item of items) {
    const taskEnabled = context.options.enableTaskLists;
    const checkbox = item.task !== null && taskEnabled
      ? `<input type="checkbox" class="markedit-preview-task-checkbox" data-line="${item.lineNumber}"${item.task ? ' checked' : ''}>`
      : '';
    const subList = item.subLines.length > 0 ? renderBlocks(item.subLines, context) : '';
    const paragraphs = item.content.split(/\n\s*\n/).filter(paragraph => paragraph.length > 0);
    const isSimpleInline = paragraphs.length === 1 && item.subLines.length === 0;
    const contentHtml = isSimpleInline ? parseInline(item.content, context) : renderBlocks(item.content.split('\n').map(raw => classifyLine(raw, item.lineNumber)), context);
    const itemClass = item.task !== null && taskEnabled ? 'markedit-preview-task-item' : '';
    const spacing = item.task !== null && taskEnabled ? '' : ' ';
    html += `<li ${blockAttributes(item.lineNumber, itemClass)}>${checkbox}${spacing}${contentHtml}${subList}</li>`;
  }

  html += `</${tag}>`;
  return { html, consumed };
}

function renderMathBlock(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length === 0 || !context.options.enableMath) {
    return null;
  }

  const first = lines[0].raw.trim();
  if (!first.startsWith('$$')) {
    return null;
  }

  const startLine = lines[0].lineNumber;
  let consumed = 1;
  const content: string[] = [];

  if (first.endsWith('$$') && first.length > 4) {
    content.push(first.slice(2, -2).trim());
  } else {
    const opener = first.slice(2).trim();
    if (opener.length > 0) {
      content.push(opener);
    }

    while (consumed < lines.length) {
      const line = lines[consumed].raw;
      const trimmed = line.trim();
      if (trimmed.endsWith('$$')) {
        const inner = trimmed.slice(0, -2).trim();
        if (inner.length > 0) {
          content.push(inner);
        }
        consumed += 1;
        break;
      }

      content.push(line);
      consumed += 1;
    }
  }

  const latex = content.join('\n').trim();
  const html = `<div ${blockAttributes(startLine)}>${context.renderMath(latex, true)}</div>`;
  return { html, consumed };
}

function renderBlockquote(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  if (lines.length === 0) {
    return null;
  }

  const first = isBlockquote(lines[0].raw);
  if (first === null) {
    return null;
  }

  const startLine = lines[0].lineNumber;
  const content: Line[] = [];
  let consumed = 0;

  while (consumed < lines.length) {
    const bq = isBlockquote(lines[consumed].raw);
    if (bq === null) {
      break;
    }

    // Keep the absolute source line so data-line (checkboxes, scroll sync) stays correct.
    content.push(classifyLine(bq.content, lines[consumed].lineNumber));
    consumed += 1;
  }

  const inner = renderBlocks(content, context);
  const html = `<div ${blockAttributes(startLine)}><blockquote class="markedit-preview-blockquote">${inner}</blockquote></div>`;
  return { html, consumed };
}

function renderParagraph(lines: Line[], context: RenderContext): { html: string; consumed: number } {
  const startLine = lines[0].lineNumber;
  const content: string[] = [];
  let consumed = 0;

  while (consumed < lines.length) {
    const line = lines[consumed];
    const tableRow = context.options.enableTables ? isTableRow(line.raw) !== null : false;
    if (line.raw.trim().length === 0 || isHeading(line.raw) !== null || isHorizontalRule(line.raw) || isFencedCodeStart(line.raw) !== null || isListItem(line.raw) !== null || isBlockquote(line.raw) !== null || tableRow) {
      break;
    }

    content.push(line.raw);
    consumed += 1;
  }

  // Lines that look like a block start but did not parse as one (e.g. `| a`) are plain text.
  if (consumed === 0 && lines.length > 0) {
    content.push(lines[0].raw);
    consumed = 1;
  }

  const text = content.join(' ').replace(/\s+/g, ' ').trim();
  const html = text.length > 0 ? `<p ${blockAttributes(startLine)}>${parseInline(text, context)}</p>` : '';
  return { html, consumed };
}

function tryCustomBlockPlugins(lines: Line[], context: RenderContext): { html: string; consumed: number } | null {
  for (const plugin of context.options.blockPlugins) {
    const result = plugin.tryRender(lines, context);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

/**
 * Nesting limit for blocks inside blocks (quotes, lists, …): each level recurses, so thousands of
 * `>` would overflow the stack. Deeper content is shown as plain text.
 */
const maxNestingDepth = 64;
let nestingDepth = 0;

function renderBlocks(lines: Line[], context: RenderContext): string {
  if (nestingDepth >= maxNestingDepth) {
    return `<p>${escapeHtml(lines.map(line => line.raw).join('\n'))}</p>`;
  }
  nestingDepth += 1;
  try {
    return renderBlocksAtDepth(lines, context);
  } finally {
    nestingDepth -= 1;
  }
}

function renderBlocksAtDepth(lines: Line[], context: RenderContext): string {
  // Line numbers are absolute (assigned once in render()); nested calls must not renumber them.
  const withLineNumbers = lines;
  let index = 0;
  let html = '';

  while (index < withLineNumbers.length) {
    const line = withLineNumbers[index];

    if (line.raw.trim().length === 0) {
      index += 1;
      continue;
    }

    if (isHorizontalRule(line.raw)) {
      html += `<hr ${blockAttributes(line.lineNumber)}>`;
      index += 1;
      continue;
    }

    const heading = isHeading(line.raw);
    if (heading !== null) {
      const id = slugify(heading.content);
      html += `<div ${blockAttributes(line.lineNumber)}><h${heading.level} id="${id}" class="markedit-preview-heading"><a class="markedit-preview-anchor" href="#${id}" aria-hidden="true">#</a>${parseInline(heading.content, context)}</h${heading.level}></div>`;
      index += 1;
      continue;
    }

    const fenced = renderFencedCode(withLineNumbers.slice(index), context);
    if (fenced !== null) {
      html += fenced.html;
      index += fenced.consumed;
      continue;
    }

    const table = renderTable(withLineNumbers.slice(index), context);
    if (table !== null) {
      html += table.html;
      index += table.consumed;
      continue;
    }

    const alert = renderAlert(withLineNumbers.slice(index), context);
    if (alert !== null) {
      html += alert.html;
      index += alert.consumed;
      continue;
    }

    const list = renderList(withLineNumbers.slice(index), context);
    if (list !== null) {
      html += list.html;
      index += list.consumed;
      continue;
    }

    const blockquote = renderBlockquote(withLineNumbers.slice(index), context);
    if (blockquote !== null) {
      html += blockquote.html;
      index += blockquote.consumed;
      continue;
    }

    const mathBlock = renderMathBlock(withLineNumbers.slice(index), context);
    if (mathBlock !== null) {
      html += mathBlock.html;
      index += mathBlock.consumed;
      continue;
    }

    const customBlock = tryCustomBlockPlugins(withLineNumbers.slice(index), context);
    if (customBlock !== null) {
      html += customBlock.html;
      index += customBlock.consumed;
      continue;
    }

    const paragraph = renderParagraph(withLineNumbers.slice(index), context);
    html += paragraph.html;
    // A line that looks like a table row but is not a table makes renderParagraph stop at once;
    // always advance so the loop cannot spin forever (e.g. typing `| a`).
    index += Math.max(1, paragraph.consumed);
  }

  return html;
}

/**
 * The syntax a parser built on this engine understands (see parsers/commonmark.ts, gfm.ts and
 * extended.ts, which each define their own).
 */
export type SyntaxFeatures = Omit<Required<MarkdownRenderOptions>, 'standard' | 'blockPlugins' | 'inlinePlugins'>;

function fillOptions(standard: MarkdownSyntaxStandard, features: SyntaxFeatures, overrides?: MarkdownRenderOptions): Required<MarkdownRenderOptions> {
  return { ...features, blockPlugins: [], inlinePlugins: [], ...overrides, standard: overrides?.standard ?? standard };
}

/**
 * The shared block/inline Markdown engine. A parser is an instance with its own id, name and
 * syntax features; a parser that needs different rules can be replaced by any other
 * MarkdownRendererEngine in its file under parsers/.
 */
export class DefaultMarkdownEngine implements MarkdownRendererEngine {
  readonly id: string;
  readonly name: string;
  readonly standard: MarkdownSyntaxStandard;
  private readonly blockPlugins: MarkdownBlockPlugin[] = [];
  private readonly inlinePlugins: MarkdownInlinePlugin[] = [];

  readonly features: SyntaxFeatures;

  constructor(id: string, name: string, standard: MarkdownSyntaxStandard, features: SyntaxFeatures) {
    this.id = id;
    this.name = name;
    this.standard = standard;
    this.features = features;
  }

  registerBlockPlugin(plugin: MarkdownBlockPlugin): void {
    this.blockPlugins.push(plugin);
  }

  registerInlinePlugin(plugin: MarkdownInlinePlugin): void {
    this.inlinePlugins.push(plugin);
  }

  render(markdown: string, options?: MarkdownRenderOptions): string {
    const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = normalized.split('\n').map((raw, index) => classifyLine(raw, index));

    const opts = fillOptions(this.standard, this.features, options);
    const context: RenderContext = {
      options: { ...opts, blockPlugins: this.blockPlugins, inlinePlugins: this.inlinePlugins },
      parseInline: text => parseInline(text, context),
      renderBlocks: lines => renderBlocks(lines, context),
      renderMath: (latex, displayMode) => this.renderMath(latex, displayMode),
      renderMermaid: code => this.renderMermaid(code),
      highlightCode: (code, lang) => this.highlightCode(code, lang),
    };

    let html = '';
    if (opts.enableFrontmatter) {
      const { frontMatter, remaining } = parseYamlFrontMatter(rawLines);
      if (frontMatter !== null) {
        html += renderYamlFrontMatter(frontMatter);
      }
      html += renderBlocks(remaining, context);
    } else {
      html += renderBlocks(rawLines, context);
    }

    return html;
  }

  renderInline(markdown: string, options?: MarkdownRenderOptions): string {
    const opts = fillOptions(this.standard, this.features, options);
    const context: RenderContext = {
      options: { ...opts, blockPlugins: this.blockPlugins, inlinePlugins: this.inlinePlugins },
      parseInline: text => parseInline(text, context),
      renderBlocks: lines => renderBlocks(lines, context),
      renderMath: (latex, displayMode) => this.renderMath(latex, displayMode),
      renderMermaid: code => this.renderMermaid(code),
      highlightCode: (code, lang) => this.highlightCode(code, lang),
    };

    let result = parseInline(markdown, context);
    for (const plugin of this.inlinePlugins) {
      const pluginResult = plugin.tryRender(result, context);
      if (pluginResult !== null) {
        result = pluginResult;
      }
    }
    return result;
  }

  renderMath(latex: string, displayMode: boolean): string {
    return renderMathWithPlugin(latex, displayMode);
  }

  renderMermaid(code: string): string {
    return renderMermaidToSvg(code);
  }

  highlightCode(code: string, lang: string): string {
    return highlightCode(code, lang);
  }
}
