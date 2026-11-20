import { escapeHtml } from '../../utils';
import { blockAttributes, codeBlockHtml as sharedCodeBlockHtml, tableOpenTag, taskCheckboxHtml } from '../../previewMarkup';
import { sanitizeHtml } from './html';
import { hasDiagramPlugin, renderDiagramWithPlugin } from '../../plugins/registry';
import { diagramBlockHtml } from '../../plugins/builtin';
import { parseInline } from './inline';
import {
  extractChunkOptions,
  optionFlag,
  parseAttributes,
  parseCodeInfo,
  safeClassNames,
  sanitizeSize,
} from './attributes';
import type { MarkdownBlockPlugin } from '../../types';
import {
  group,
  labelKind,
  placeholderEnd,
  placeholderStart,
  registerLabel,
  slugifyUnicode,
  uniqueId,
  type CrossRefKind,
  type SourceLine,
  type SuperContext,
} from './context';

type BlockResult = { html: string; consumed: number } | null;

const htmlBlockTags = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'ul', 'center', 'caption', 'colgroup', 'col', 'kbd', 'img', 'br', 'picture', 'video', 'audio', 'svg',
]);

const calloutIcons: Record<string, string> = {
  note: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a.75.75 0 010-1.5.75.75 0 010 1.5zm0-3c.41 0 .75-.34.75-.75V4.5a.75.75 0 00-1.5 0v3.75c0 .41.34.75.75.75z',
  tip: 'M9.5 1a4.5 4.5 0 00-4.3 5.9L1.5 11h3v3h7v-3h3l-3.7-4.1A4.5 4.5 0 009.5 1z',
  warning: 'M8.88 1.4a1 1 0 00-1.76 0l-7 13A1 1 0 001 15.5h14a1 1 0 00.88-1.6l-7-13.5zM8 12a1 1 0 110-2 1 1 0 010 2zm0-3V6h1v3H8z',
};

/** Callout aliases (§17.2) → the base style used for colouring. */
const calloutStyles: Record<string, string> = {
  note: 'note', info: 'note', todo: 'note', abstract: 'note', summary: 'note', tldr: 'note',
  tip: 'tip', hint: 'tip', success: 'tip', check: 'tip', done: 'tip', example: 'tip',
  important: 'important', question: 'important', help: 'important', faq: 'important', quote: 'important', cite: 'important',
  warning: 'warning', attention: 'warning',
  caution: 'caution', danger: 'caution', error: 'caution', failure: 'caution', fail: 'caution', missing: 'caution', bug: 'caution',
};

const diagramLanguages = new Set(['mermaid', 'plantuml', 'puml', 'graphviz', 'dot', 'd2', 'ditaa']);

// The preview markup contract (data-line, checkboxes, code blocks, tables), shared by all parsers.
export { blockAttributes };

export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function leadingSpaces(text: string): number {
  return /^ */.exec(text)?.[0].length ?? 0;
}

function stripSpaces(text: string, count: number): string {
  return text.slice(Math.min(count, leadingSpaces(text)));
}

// ---------------------------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------------------------

const fenceOpenPattern = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const atxPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const hrPattern = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const blockquotePattern = /^ {0,3}> ?(.*)$/;
const fencedDivPattern = /^ {0,3}(:{3,})[ \t]*(.*?)[ \t]*$/;
const tocPattern = /^\[TOC(?:\s+depth\s*=\s*(\d))?\]\s*$/i;
const includePattern = /^@include[ \t]+(.+?)[ \t]*$/;
const definitionPattern = /^ {0,3}:[ \t]+(.*)$/;
const listItemPattern = /^( {0,3})([-*+]|\d{1,9}[.)]|\(@[\w-]*\))(?:([ \t]+)(.*))?$/;

export function isFenceOpen(text: string): { indent: number; fence: string; info: string } | null {
  const match = fenceOpenPattern.exec(text);
  if (match === null || (match[2].startsWith('`') && match[3].includes('`'))) {
    return null;
  }
  return { indent: match[1].length, fence: match[2], info: match[3].trim() };
}

function isFenceClose(text: string, fence: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
  return match !== null && match[1][0] === fence[0] && match[1].length >= fence.length;
}

interface ListMarker {
  indent: number;
  marker: string;
  kind: 'bullet' | 'ordered' | 'example';
  contentOffset: number;
  content: string;
  start: number;
  exampleLabel: string;
}

function parseListMarker(text: string): ListMarker | null {
  const match = listItemPattern.exec(text);
  if (match === null) {
    return null;
  }

  const [, indent, marker] = match;
  const spacing = group(match, 3);
  const content = group(match, 4);
  const spaces = spacing?.length ?? 0;
  if (spacing === undefined && content === undefined && text.length > indent.length + marker.length) {
    return null;
  }

  const kind = marker.startsWith('(@') ? 'example' : /^\d/.test(marker) ? 'ordered' : 'bullet';
  const padding = spaces >= 1 && spaces <= 4 ? spaces : 1;
  return {
    indent: indent.length,
    marker,
    kind,
    contentOffset: indent.length + marker.length + padding,
    content: spaces > 4 ? `${' '.repeat(spaces - 1)}${content ?? ''}` : content ?? '',
    start: kind === 'ordered' ? parseInt(marker, 10) : 1,
    exampleLabel: kind === 'example' ? marker.slice(2, -1) : '',
  };
}

function sameListType(a: ListMarker, b: ListMarker): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'bullet') {
    return a.marker === b.marker;
  }
  if (a.kind === 'ordered') {
    return a.marker.slice(-1) === b.marker.slice(-1);
  }
  return true;
}

function isHtmlBlockStart(text: string): boolean {
  if (/^ {0,3}<!--/.test(text)) {
    return true;
  }

  const match = /^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/.exec(text);
  if (match === null) {
    return false;
  }

  if (htmlBlockTags.has(match[1].toLowerCase())) {
    return true;
  }

  // CommonMark type 7: a complete open/close tag alone on the line.
  return /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*)?\s*\/?>\s*$/.test(text);
}

/** Splits a pipe-table row, honouring `\|` and code spans. Returns null for non-rows. */
export function splitTableRow(text: string): string[] | null {
  let trimmed = text.trim();
  if (!trimmed.includes('|')) {
    return null;
  }

  const cells: string[] = [];
  let current = '';
  let sawPipe = false;
  let inCode = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }
    if (char === '\\' && index + 1 < trimmed.length) {
      current += char + trimmed[index + 1];
      index += 1;
      continue;
    }
    if (char === '`') {
      let run = 0;
      while (trimmed[index + run] === '`') {
        run += 1;
      }
      inCode = inCode === run ? 0 : inCode === 0 ? run : inCode;
      current += '`'.repeat(run);
      index += run - 1;
      continue;
    }
    if (char === '|' && inCode === 0) {
      sawPipe = true;
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);

  if (!sawPipe) {
    return null;
  }

  trimmed = text.trim();
  if (trimmed.startsWith('|')) {
    cells.shift();
  }
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) {
    cells.pop();
  }

  return cells.map(cell => cell.trim());
}

function isTableSeparator(cells: string[] | null): boolean {
  return cells !== null && cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
}

function startsPipeTable(lines: SourceLine[], index: number): boolean {
  if (splitTableRow(lines[index].text) === null) {
    return false;
  }
  for (let next = index + 1; next < lines.length; next += 1) {
    const cells = splitTableRow(lines[next].text);
    if (cells === null) {
      return false;
    }
    if (isTableSeparator(cells)) {
      return true;
    }
  }
  return false;
}

/** Whether `text` begins a block that can interrupt a paragraph. */
function interruptsParagraph(lines: SourceLine[], index: number): boolean {
  const text = lines[index].text;
  if (lines[index].isDefinition === true || atxPattern.test(text) || hrPattern.test(text) || isFenceOpen(text) !== null) {
    return true;
  }
  if (blockquotePattern.test(text) || /^ {0,3}\$\$/.test(text) || /^ {0,3}:{3,}/.test(text) || isHtmlBlockStart(text)) {
    return true;
  }
  if (tocPattern.test(text) || includePattern.test(text) || /^ {0,3}<!--\s*(pb|pagebreak)\s*-->/.test(text)) {
    return true;
  }

  const marker = parseListMarker(text);
  if (marker !== null && marker.content.trim().length > 0 && (marker.kind !== 'ordered' || marker.start === 1)) {
    return true;
  }

  return /^\+(?:[-=:]+\+)+\s*$/.test(text.trim()) || startsPipeTable(lines, index);
}

// ---------------------------------------------------------------------------------------------
// Captions & labels
// ---------------------------------------------------------------------------------------------

function captionPrefix(context: SuperContext, kind: CrossRefKind, number: number): string {
  switch (kind) {
    case 'sec':
    case 'heading':
      return '';
    case 'fig': return context.crossRefLabels.fig(number);
    case 'tbl': return context.crossRefLabels.tbl(number);
    case 'eq': return context.crossRefLabels.eq(number);
    case 'lst': return context.crossRefLabels.lst(number);
  }
}

/** Registers a label and returns `{ id, prefix }` for captions; duplicate labels are flagged. */
function defineLabel(context: SuperContext, label: string | undefined, fallback: CrossRefKind): { id: string | null; prefix: string; error: string } {
  if (label === undefined || label.length === 0) {
    return { id: null, prefix: '', error: '' };
  }

  const kind = labelKind(label, fallback);
  const number = registerLabel(context, label, kind, label);
  if (number === null) {
    return { id: null, prefix: '', error: `<span class="msm-error" title="Duplicate label">[#${escapeHtml(label)}]</span>` };
  }

  context.usedIds.set(label, (context.usedIds.get(label) ?? 0) + 1);
  return { id: label, prefix: captionPrefix(context, kind, number), error: '' };
}

function captionText(prefix: string, caption: string | undefined, context: SuperContext): string {
  const body = caption === undefined || caption.length === 0 ? '' : parseInline(caption, context);
  if (prefix.length > 0 && body.length > 0) {
    return `<span class="msm-caption-label">${escapeHtml(prefix)}:</span> ${body}`;
  }
  return prefix.length > 0 ? `<span class="msm-caption-label">${escapeHtml(prefix)}</span>` : body;
}

// ---------------------------------------------------------------------------------------------
// Code, chunks and diagrams (§4, §13–15)
// ---------------------------------------------------------------------------------------------

function codeBlockHtml(code: string, lang: string, context: SuperContext): string {
  const highlighted = context.options.enableCodeHighlight !== false && lang.length > 0
    ? context.highlightCode(code, lang)
    : escapeHtml(code);
  return sharedCodeBlockHtml(highlighted, lang);
}

function notice(message: string): string {
  return `<div class="msm-notice">${escapeHtml(message)}</div>`;
}

function isDiagramLanguage(lang: string): boolean {
  return diagramLanguages.has(lang) || hasDiagramPlugin(lang);
}

/** A host-provided `diagramRenderer` wins; otherwise the registered diagram plugin renders. */
function renderDiagram(lang: string, code: string, options: Map<string, string>, context: SuperContext): string | null {
  const custom = context.options.diagramRenderer?.(lang, code, options) ?? null;
  if (custom !== null) {
    return custom;
  }
  if (context.options.enableMermaid === false) {
    return null;
  }
  return renderDiagramWithPlugin(lang, code, options);
}

function renderCodeBlock(info: string, rawLines: string[], line: number, context: SuperContext): string {
  const codeInfo = parseCodeInfo(info);

  if (codeInfo.rawFormat !== null) {
    const raw = rawLines.join('\n');
    if (codeInfo.rawFormat === 'html') {
      return `<div ${blockAttributes(line, 'msm-raw')}>${sanitizeHtml(raw)}</div>`;
    }
    if (isDiagramLanguage(codeInfo.rawFormat)) {
      // §14.1: {=mermaid} / {=plantuml} are shown as text only.
      return `<div ${blockAttributes(line)}>${codeBlockHtml(raw, codeInfo.rawFormat, context)}</div>`;
    }
    // Raw blocks for other output formats (latex, docx, …) are not part of the HTML preview.
    return '';
  }

  const { options, body } = codeInfo.braced ? extractChunkOptions(rawLines) : { options: new Map<string, string>(), body: rawLines };
  const code = body.join('\n');
  const lang = codeInfo.lang.toLowerCase();
  const caption = codeInfo.attributes.values.get('caption');
  const label = codeInfo.attributes.values.get('label') ?? codeInfo.attributes.id ?? undefined;

  // Diagrams (§14)
  if (isDiagramLanguage(lang)) {
    const isRenderChunk = codeInfo.braced && codeInfo.render && context.execute;
    const echo = isRenderChunk ? optionFlag(options, 'echo', false) : false;
    const output = isRenderChunk ? optionFlag(options, 'output', true) : true;
    const width = sanitizeSize(options.get('width'));
    const labelInfo = defineLabel(context, label, 'fig');

    let html = labelInfo.error;
    if (echo || !output) {
      html += codeBlockHtml(code, lang, context);
    }

    if (output) {
      const diagram = renderDiagram(lang, code, options, context);
      if (diagram === null) {
        if (!echo) {
          html += codeBlockHtml(code, lang, context);
        }
        if (isRenderChunk) {
          html += notice(`No renderer is available for "${lang}" in the preview.`);
        }
      } else {
        const style = width === null ? '' : ` style="width: ${width};"`;
        const body = isRenderChunk ? `<div class="msm-diagram">${diagram}</div>` : diagramBlockHtml(lang, code, diagram);
        const captionHtml = labelInfo.prefix.length > 0 || caption !== undefined
          ? `<figcaption class="msm-caption">${captionText(labelInfo.prefix, caption, context)}</figcaption>`
          : '';
        const idAttr = labelInfo.id === null ? '' : ` id="${escapeHtml(labelInfo.id)}"`;
        html += `<figure class="msm-figure"${idAttr}${style}>${body}${captionHtml}</figure>`;
      }
    }

    return `<div ${blockAttributes(line)}>${html}</div>`;
  }

  const labelInfo = defineLabel(context, label, 'lst');
  const idAttr = labelInfo.id === null ? '' : ` id="${escapeHtml(labelInfo.id)}"`;
  const captionHtml = labelInfo.prefix.length > 0 || caption !== undefined
    ? `<div class="msm-caption msm-code-caption">${captionText(labelInfo.prefix, caption, context)}</div>`
    : '';

  // Executable chunk (§13). Without `execute: true` it is shown as static code (§13.4).
  if (codeInfo.braced && codeInfo.run && context.execute) {
    const echo = optionFlag(options, 'echo', true);
    const output = optionFlag(options, 'output', true);
    let html = labelInfo.error + captionHtml;
    if (echo) {
      html += codeBlockHtml(code, lang, context);
    }
    if (output) {
      const result = context.options.codeRunner?.(lang, code, options) ?? null;
      html += result === null
        ? notice(`Running "${lang}" chunks is not available in the preview.`)
        : `<pre class="msm-output"><code>${escapeHtml(result)}</code></pre>`;
    }
    return `<div ${blockAttributes(line, 'msm-chunk')}${idAttr}>${html}</div>`;
  }

  return `<div ${blockAttributes(line)}${idAttr}>${labelInfo.error}${captionHtml}${codeBlockHtml(code, lang, context)}</div>`;
}

function renderFencedCode(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  const open = isFenceOpen(lines[index].text);
  if (open === null) {
    return null;
  }

  const content: string[] = [];
  let cursor = index + 1;
  while (cursor < lines.length && !isFenceClose(lines[cursor].text, open.fence)) {
    content.push(stripSpaces(lines[cursor].text, open.indent));
    cursor += 1;
  }

  const consumed = Math.min(cursor + 1, lines.length) - index;
  return { html: renderCodeBlock(open.info, content, lines[index].line, context), consumed };
}

function renderIndentedCode(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (leadingSpaces(lines[index].text) < 4) {
    return null;
  }

  let cursor = index;
  let end = index;
  while (cursor < lines.length && (isBlank(lines[cursor].text) || leadingSpaces(lines[cursor].text) >= 4)) {
    if (!isBlank(lines[cursor].text)) {
      end = cursor;
    }
    cursor += 1;
  }

  const code = lines.slice(index, end + 1).map(line => stripSpaces(line.text, 4)).join('\n');
  return { html: `<div ${blockAttributes(lines[index].line)}>${codeBlockHtml(code, '', context)}</div>`, consumed: end + 1 - index };
}

// ---------------------------------------------------------------------------------------------
// Math (§8, §20)
// ---------------------------------------------------------------------------------------------

function renderMathBlock(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (context.options.enableMath === false) {
    return null;
  }

  const open = /^ {0,3}\$\$(.*)$/.exec(lines[index].text);
  if (open === null) {
    return null;
  }

  const closePattern = /^(.*?)\$\$[ \t]*(?:\[#([^\]\s]+)\])?[ \t]*$/;
  const content: string[] = [];
  let label: string | undefined;
  let consumed: number;

  const sameLine = closePattern.exec(open[1]);
  if (sameLine !== null) {
    content.push(sameLine[1]);
    label = sameLine[2];
    consumed = 1;
  } else {
    if (open[1].trim().length > 0) {
      content.push(open[1]);
    }
    let cursor = index + 1;
    while (cursor < lines.length) {
      const close = closePattern.exec(lines[cursor].text);
      if (close !== null) {
        content.push(close[1]);
        label = close[2];
        break;
      }
      content.push(lines[cursor].text);
      cursor += 1;
    }
    consumed = Math.min(cursor + 1, lines.length) - index;
  }

  const math = context.renderMath(content.join('\n').trim(), true);
  if (label === undefined) {
    return { html: `<div ${blockAttributes(lines[index].line)}>${math}</div>`, consumed };
  }

  const kind = labelKind(label, 'eq');
  const number = registerLabel(context, label, kind, label);
  if (number === null) {
    return { html: `<div ${blockAttributes(lines[index].line)}>${math}<span class="msm-error" title="Duplicate label">[#${escapeHtml(label)}]</span></div>`, consumed };
  }

  context.usedIds.set(label, (context.usedIds.get(label) ?? 0) + 1);
  const numberText = kind === 'eq' ? `(${number})` : escapeHtml(captionPrefix(context, kind, number));
  return {
    html: `<div ${blockAttributes(lines[index].line, 'msm-equation')} id="${escapeHtml(label)}">${math}<span class="msm-equation-number">${numberText}</span></div>`,
    consumed,
  };
}

// ---------------------------------------------------------------------------------------------
// Fenced divs, tabs, conditional blocks (§16, §24, §26)
// ---------------------------------------------------------------------------------------------

interface FencedDiv {
  attributes: ReturnType<typeof parseAttributes>;
  body: SourceLine[];
  consumed: number;
}

function collectFencedDiv(lines: SourceLine[], index: number): FencedDiv | null {
  const open = fencedDivPattern.exec(lines[index].text);
  if (open === null) {
    return null;
  }

  const colons = open[1].length;
  let attributeSource = open[2].replace(/[ \t]*:+$/, '').trim();
  if (attributeSource.startsWith('{') && attributeSource.endsWith('}')) {
    attributeSource = attributeSource.slice(1, -1);
  } else if (attributeSource.length > 0) {
    // Pandoc shorthand: `::: warning` → class "warning"
    attributeSource = attributeSource.split(/\s+/).map(word => `.${word}`).join(' ');
  }

  let depth = 0;
  let fence: string | null = null;
  const body: SourceLine[] = [];
  let cursor = index + 1;

  for (; cursor < lines.length; cursor += 1) {
    const text = lines[cursor].text;

    if (fence !== null) {
      if (isFenceClose(text, fence)) {
        fence = null;
      }
      body.push(lines[cursor]);
      continue;
    }

    const codeFence = isFenceOpen(text);
    if (codeFence !== null) {
      fence = codeFence.fence;
      body.push(lines[cursor]);
      continue;
    }

    const divLine = fencedDivPattern.exec(text);
    if (divLine !== null) {
      const isBare = divLine[2].replace(/:+$/, '').trim().length === 0;
      if (!isBare) {
        depth += 1;
      } else if (depth > 0) {
        depth -= 1;
      } else if (divLine[1].length >= colons) {
        break;
      } else {
        // A shorter bare fence inside an unattributed block opens a nested div.
        depth += 1;
      }
    }

    body.push(lines[cursor]);
  }

  return {
    attributes: parseAttributes(attributeSource),
    body,
    consumed: Math.min(cursor + 1, lines.length) - index,
  };
}

function renderTabset(div: FencedDiv, line: number, context: SuperContext): string {
  const tabs: { title: string; html: string }[] = [];
  let cursor = 0;
  while (cursor < div.body.length) {
    if (isBlank(div.body[cursor].text)) {
      cursor += 1;
      continue;
    }

    const child = collectFencedDiv(div.body, cursor);
    if (child === null) {
      cursor += 1;
      continue;
    }

    const title = child.attributes.values.get('title') ?? `Tab ${tabs.length + 1}`;
    tabs.push({ title, html: renderBlocks(child.body, context) });
    cursor += child.consumed;
  }

  const buttons = tabs.map((tab, i) => `<button type="button" class="msm-tab-button${i === 0 ? ' is-active' : ''}" data-tab="${i}" role="tab">${parseInline(tab.title, context)}</button>`).join('');
  const panels = tabs.map((tab, i) => `<div class="msm-tab-panel${i === 0 ? ' is-active' : ''}" data-tab="${i}" role="tabpanel"><div class="msm-tab-print-title">${parseInline(tab.title, context)}</div>${tab.html}</div>`).join('');
  return `<div ${blockAttributes(line, 'msm-tabset')}><div class="msm-tab-list" role="tablist">${buttons}</div>${panels}</div>`;
}

function renderFencedDiv(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  const div = collectFencedDiv(lines, index);
  if (div === null) {
    return null;
  }

  const { attributes } = div;
  const line = lines[index].line;
  const outputFormat = context.options.outputFormat ?? 'html';
  const onlyClass = attributes.classes.find(cls => cls.startsWith('only-'));
  if (onlyClass !== undefined && onlyClass !== `only-${outputFormat}`) {
    return { html: '', consumed: div.consumed };
  }

  if (attributes.classes.includes('tabset')) {
    return { html: renderTabset(div, line, context), consumed: div.consumed };
  }

  const classes = safeClassNames(attributes.classes);
  const idAttr = attributes.id === null ? '' : ` id="${escapeHtml(attributes.id)}"`;
  const title = attributes.values.get('title');
  const titleHtml = title === undefined ? '' : `<div class="msm-div-title">${parseInline(title, context)}</div>`;
  const extraClass = ['msm-div', ...classes].join(' ');
  return {
    html: `<div ${blockAttributes(line, extraClass)}${idAttr}>${titleHtml}${renderBlocks(div.body, context)}</div>`,
    consumed: div.consumed,
  };
}

// ---------------------------------------------------------------------------------------------
// Tables (§7, §12, §18)
// ---------------------------------------------------------------------------------------------

type CellKind = 'text' | '^' | '<' | '>';

function cellKind(cell: string): CellKind {
  return cell === '^' || cell === '<' || cell === '>' ? cell : 'text';
}

function renderCellContent(cell: string, context: SuperContext): string {
  const checkbox = /^\[([ xX/-])\]$/.exec(cell);
  if (checkbox !== null) {
    const state = checkboxState(checkbox[1]);
    return `<span class="msm-checkbox is-${state}" role="img" aria-label="${state}"></span>`;
  }
  return parseInline(cell, context);
}

export function checkboxState(char: string): 'todo' | 'done' | 'doing' | 'cancelled' {
  switch (char) {
    case 'x':
    case 'X':
      return 'done';
    case '/':
      return 'doing';
    case '-':
      return 'cancelled';
    default:
      return 'todo';
  }
}

/**
 * Renders a header or body section with §12 merge markers. Markers resolve to the nearest text
 * cell in their direction; each merged region is emitted once with rowspan/colspan. A region
 * that is not rectangular, or a marker pointing outside the section, is shown literally.
 */
function renderTableSection(rows: string[][], tag: 'th' | 'td', aligns: string[], context: SuperContext, rowLines: number[] = []): string {
  const height = rows.length;
  const width = aligns.length;
  const owner: ([number, number] | null)[][] = rows.map(() => new Array<[number, number] | null>(width).fill(null));

  const resolve = (r: number, c: number, guard: number): [number, number] | null => {
    if (r < 0 || c < 0 || r >= height || c >= width || guard > height * width) {
      return null;
    }
    const kind = cellKind(rows[r][c] ?? '');
    switch (kind) {
      case 'text': return [r, c];
      case '^': return resolve(r - 1, c, guard + 1);
      case '<': return resolve(r, c - 1, guard + 1);
      case '>': return resolve(r, c + 1, guard + 1);
    }
  };

  const regions = new Map<string, { minR: number; maxR: number; minC: number; maxC: number; count: number }>();
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const target = resolve(r, c, 0);
      owner[r][c] = target;
      if (target === null) {
        continue;
      }
      const key = `${target[0]},${target[1]}`;
      const region = regions.get(key) ?? { minR: r, maxR: r, minC: c, maxC: c, count: 0 };
      region.minR = Math.min(region.minR, r);
      region.maxR = Math.max(region.maxR, r);
      region.minC = Math.min(region.minC, c);
      region.maxC = Math.max(region.maxC, c);
      region.count += 1;
      regions.set(key, region);
    }
  }

  // Non-rectangular regions fall back to literal markers.
  for (const [key, region] of regions) {
    const area = (region.maxR - region.minR + 1) * (region.maxC - region.minC + 1);
    if (area !== region.count) {
      for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
          const target = owner[r][c];
          if (target !== null && `${target[0]},${target[1]}` === key && cellKind(rows[r][c] ?? '') !== 'text') {
            owner[r][c] = null;
          }
        }
      }
      region.minR = region.maxR = Number(key.split(',')[0]);
      region.minC = region.maxC = Number(key.split(',')[1]);
    }
  }

  let html = '';
  for (let r = 0; r < height; r += 1) {
    // Source line of each row: a finer anchor for preview scroll sync.
    const rowLine = rowLines.at(r);
    html += rowLine === undefined ? '<tr>' : `<tr data-line="${rowLine}">`;
    for (let c = 0; c < width; c += 1) {
      const cell = rows[r][c] ?? '';
      const target = owner[r][c];
      const align = aligns[c];
      const style = align === 'left' ? '' : ` style="text-align: ${align}"`;

      if (target === null) {
        // Marker that could not be resolved (e.g. `^` in the first body row): show it as text.
        const literal = cellKind(cell) === 'text' ? renderCellContent(cell, context) : `<span class="msm-error" title="Merge marker has no target">${escapeHtml(cell)}</span>`;
        html += `<${tag}${style}>${literal}</${tag}>`;
        continue;
      }

      const region = regions.get(`${target[0]},${target[1]}`);
      if (region?.minR !== r || region.minC !== c) {
        continue;
      }

      const rowspan = region.maxR - region.minR + 1;
      const colspan = region.maxC - region.minC + 1;
      const spanAttrs = `${rowspan > 1 ? ` rowspan="${rowspan}"` : ''}${colspan > 1 ? ` colspan="${colspan}"` : ''}`;
      html += `<${tag}${spanAttrs}${style}>${renderCellContent(rows[target[0]][target[1]] ?? '', context)}</${tag}>`;
    }
    html += '</tr>';
  }

  return html;
}

function parseTableCaption(text: string | undefined): { caption: string; label: string | undefined } | null {
  if (text === undefined) {
    return null;
  }
  const match = /^ {0,3}\[Table:\s*(.*?)\]\s*(?:\[#([^\]\s]+)\])?\s*$/i.exec(text);
  return match === null ? null : { caption: match[1], label: match[2] };
}

function wrapTable(sections: string, line: number, captionLine: string | undefined, context: SuperContext): { html: string; captionUsed: boolean } {
  const caption = parseTableCaption(captionLine);
  let captionHtml = '';
  let idAttr = '';
  let error = '';
  if (caption !== null) {
    const labelInfo = defineLabel(context, caption.label, 'tbl');
    error = labelInfo.error;
    idAttr = labelInfo.id === null ? '' : ` id="${escapeHtml(labelInfo.id)}"`;
    captionHtml = `<caption class="msm-caption">${captionText(labelInfo.prefix, caption.caption, context)}</caption>`;
  }

  return {
    html: `<div ${blockAttributes(line)}${idAttr}>${error}${tableOpenTag()}${captionHtml}${sections}</table></div>`,
    captionUsed: caption !== null,
  };
}

function renderPipeTable(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (context.options.enableTables === false || !startsPipeTable(lines, index)) {
    return null;
  }

  const header: string[][] = [];
  const headerLines: number[] = [];
  const bodyLines: number[] = [];
  let cursor = index;
  let separator: string[] = [];
  while (cursor < lines.length) {
    const cells = splitTableRow(lines[cursor].text) ?? [];
    cursor += 1;
    if (isTableSeparator(cells)) {
      separator = cells;
      break;
    }
    header.push(cells);
    headerLines.push(lines[cursor - 1].line);
  }

  const aligns = separator.map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : 'left';
  });
  const width = aligns.length;
  const normalize = (cells: string[]) => Array.from({ length: width }, (_, i) => cells[i] ?? '');

  const body: string[][] = [];
  while (cursor < lines.length && !isBlank(lines[cursor].text)) {
    const cells = splitTableRow(lines[cursor].text);
    if (cells === null) {
      break;
    }
    body.push(normalize(cells));
    bodyLines.push(lines[cursor].line);
    cursor += 1;
  }

  const sections = `<thead>${renderTableSection(header.map(normalize), 'th', aligns, context, headerLines)}</thead>`
    + (body.length > 0 ? `<tbody>${renderTableSection(body, 'td', aligns, context, bodyLines)}</tbody>` : '');
  const wrapped = wrapTable(sections, lines[index].line, lines[cursor]?.text, context);
  return { html: wrapped.html, consumed: cursor - index + (wrapped.captionUsed ? 1 : 0) };
}

/** Display width of a character: East Asian wide/fullwidth characters take two columns. */
function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff) || (code >= 0x20000 && code <= 0x3fffd)
    ? 2
    : 1;
}

/** Slices `text` between display columns `[start, end)`, so grid tables line up with CJK text. */
function sliceByWidth(text: string, start: number, end: number): string {
  let column = 0;
  let result = '';
  for (const char of text) {
    const width = charWidth(char);
    if (column >= start && column + width <= end) {
      result += char;
    }
    column += width;
    if (column >= end) {
      break;
    }
  }
  return result;
}

function renderGridTable(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  const first = lines[index].text.trim();
  if (context.options.enableTables === false || !/^\+(?:[-=:]+\+)+$/.test(first)) {
    return null;
  }

  const offset = lines[index].text.indexOf('+');
  const boundaries: number[] = [];
  for (let i = 0; i < first.length; i += 1) {
    if (first[i] === '+') {
      boundaries.push(i);
    }
  }
  const columns = boundaries.length - 1;

  const alignSource = (lines.slice(index).find(line => /^\s*\+(?:[=:]+\+)+\s*$/.test(line.text))?.text ?? first).trim();
  const aligns = Array.from({ length: columns }, (_, c) => {
    const segment = alignSource.slice(boundaries[c] + 1, boundaries[c + 1]);
    const left = segment.startsWith(':');
    const right = segment.endsWith(':');
    return left && right ? 'center' : right ? 'right' : 'left';
  });

  const headerRows: string[][][] = [];
  const bodyRows: string[][][] = [];
  let current: string[][] = Array.from({ length: columns }, () => []);
  let rows: string[][][] = [];
  let hasContent = false;
  let cursor = index + 1;

  for (; cursor < lines.length; cursor += 1) {
    const text = sliceByWidth(lines[cursor].text, offset, Number.MAX_SAFE_INTEGER);
    if (/^\+(?:[-=:]+\+)+\s*$/.test(text)) {
      if (hasContent) {
        rows.push(current);
      }
      current = Array.from({ length: columns }, () => []);
      hasContent = false;
      if (text.includes('=')) {
        headerRows.push(...rows);
        rows = [];
      }
      continue;
    }
    if (!text.startsWith('|')) {
      break;
    }
    for (let c = 0; c < columns; c += 1) {
      current[c].push(sliceByWidth(text, boundaries[c] + 1, boundaries[c + 1]).replace(/\s+$/, ''));
    }
    hasContent = true;
  }
  bodyRows.push(...rows);

  const renderCell = (cellLines: string[], line: number) => {
    const indent = Math.min(...cellLines.filter(l => !isBlank(l)).map(leadingSpaces), 99);
    const dedented = cellLines.map(l => l.slice(Math.min(indent, leadingSpaces(l))));
    while (dedented.length > 0 && isBlank(dedented[dedented.length - 1])) {
      dedented.pop();
    }
    if (!dedented.some(isBlank) && dedented.length <= 1) {
      return renderCellContent((dedented[0] ?? '').trim(), context);
    }
    return renderBlocks(dedented.map(text => ({ text, line })), context);
  };

  const line = lines[index].line;
  const renderRows = (source: string[][][], tag: 'th' | 'td') => source.map(row => `<tr>${row.map((cell, c) => {
    const align = aligns[c];
    const style = align === 'left' ? '' : ` style="text-align: ${align}"`;
    return `<${tag}${style}>${renderCell(cell, line)}</${tag}>`;
  }).join('')}</tr>`).join('');

  const sections = (headerRows.length > 0 ? `<thead>${renderRows(headerRows, 'th')}</thead>` : '') + `<tbody>${renderRows(bodyRows, 'td')}</tbody>`;
  const wrapped = wrapTable(sections, line, lines[cursor]?.text, context);
  return { html: wrapped.html.replace('markedit-preview-table', 'markedit-preview-table msm-grid-table'), consumed: cursor - index + (wrapped.captionUsed ? 1 : 0) };
}

// ---------------------------------------------------------------------------------------------
// Blockquotes & callouts (§5, §17)
// ---------------------------------------------------------------------------------------------

function renderBlockquote(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (!blockquotePattern.test(lines[index].text)) {
    return null;
  }

  const content: SourceLine[] = [];
  let cursor = index;
  let lastWasText = false;
  while (cursor < lines.length) {
    const { text, line } = lines[cursor];
    const quote = blockquotePattern.exec(text);
    if (quote !== null) {
      content.push({ text: quote[1], line });
      lastWasText = !isBlank(quote[1]) && isFenceOpen(quote[1]) === null;
    } else if (lastWasText && !isBlank(text) && !interruptsParagraph(lines, cursor)) {
      // Lazy continuation line.
      content.push({ text, line });
    } else {
      break;
    }
    cursor += 1;
  }

  const consumed = cursor - index;
  const line = lines[index].line;
  const callout = /^\[!([\w-]+)\]([+-])?(?:[ \t]+(.*?))?[ \t]*$/.exec(content[0].text);

  if (callout === null || context.options.enableCallouts === false) {
    return { html: `<div ${blockAttributes(line)}><blockquote class="markedit-preview-blockquote">${renderBlocks(content, context)}</blockquote></div>`, consumed };
  }

  const type = callout[1].toLowerCase();
  const style = calloutStyles[type] ?? 'note';
  const fold = group(callout, 2);
  const titleSource = group(callout, 3) ?? type.charAt(0).toUpperCase() + type.slice(1);
  const iconPath = calloutIcons[style] ?? calloutIcons.note;
  const icon = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  const inner = renderBlocks(content.slice(1), context);
  const classes = `markedit-preview-alert msm-callout is-${style} msm-callout-${escapeHtml(type)}`;

  if (fold === undefined) {
    return {
      html: `<div ${blockAttributes(line)}><div class="${classes}" data-callout="${escapeHtml(type)}"><div class="markedit-preview-alert-title">${icon}${parseInline(titleSource, context)}</div><div class="markedit-preview-alert-content">${inner}</div></div></div>`,
      consumed,
    };
  }

  return {
    html: `<div ${blockAttributes(line)}><details class="${classes}" data-callout="${escapeHtml(type)}"${fold === '+' ? ' open' : ''}><summary class="markedit-preview-alert-title">${icon}${parseInline(titleSource, context)}</summary><div class="markedit-preview-alert-content">${inner}</div></details></div>`,
    consumed,
  };
}

// ---------------------------------------------------------------------------------------------
// Lists (§3, §30) and definition lists
// ---------------------------------------------------------------------------------------------

function renderList(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  const first = parseListMarker(lines[index].text);
  if (first === null) {
    return null;
  }

  const items: { marker: ListMarker; lines: SourceLine[]; line: number }[] = [];
  let cursor = index;
  let loose = false;

  while (cursor < lines.length) {
    const marker = parseListMarker(lines[cursor].text);
    if (marker === null || !sameListType(marker, first) || hrPattern.test(lines[cursor].text)) {
      break;
    }

    const itemLines: SourceLine[] = [{ text: marker.content, line: lines[cursor].line }];
    const itemLine = lines[cursor].line;
    cursor += 1;
    let lastBlank = false;
    let lastWasText = marker.content.trim().length > 0;

    while (cursor < lines.length) {
      const { text, line } = lines[cursor];
      if (isBlank(text)) {
        itemLines.push({ text: '', line });
        lastBlank = true;
        cursor += 1;
        continue;
      }

      if (leadingSpaces(text) >= marker.contentOffset) {
        itemLines.push({ text: text.slice(marker.contentOffset), line });
        lastBlank = false;
        lastWasText = true;
        cursor += 1;
        continue;
      }

      if (lastBlank || !lastWasText || parseListMarker(text) !== null || interruptsParagraph(lines, cursor)) {
        break;
      }

      // Lazy paragraph continuation.
      itemLines.push({ text: text.trimStart(), line });
      cursor += 1;
    }

    let trailingBlanks = 0;
    while (itemLines.length > 1 && isBlank(itemLines[itemLines.length - 1].text)) {
      itemLines.pop();
      trailingBlanks += 1;
    }

    if (itemLines.some((line, i) => i > 0 && isBlank(line.text))) {
      loose = true;
    }

    items.push({ marker, lines: itemLines, line: itemLine });

    const next = cursor < lines.length ? parseListMarker(lines[cursor].text) : null;
    if (trailingBlanks > 0 && next !== null && sameListType(next, first)) {
      loose = true;
    }
  }

  // Trailing blank lines belong to the document, not the list.
  while (cursor > index && isBlank(lines[cursor - 1].text) && cursor - 1 > index) {
    cursor -= 1;
  }

  const ordered = first.kind !== 'bullet';
  let start = first.start;
  if (first.kind === 'example') {
    start = context.counters.example + 1;
  }

  let html = '';
  let hasTasks = false;
  for (const item of items) {
    let firstLine = item.lines[0].text;
    let checkbox = '';
    let itemClass = '';
    const task = /^\[([ xX/-])\](?:[ \t]+|$)/.exec(firstLine);
    if (task !== null && context.options.enableTaskLists !== false) {
      const state = checkboxState(task[1]);
      hasTasks = true;
      itemClass = `markedit-preview-task-item msm-task-${state}`;
      checkbox = taskCheckboxHtml(item.line, state === 'done', `msm-task-checkbox is-${state}`, ` data-state="${escapeHtml(task[1])}"`);
      firstLine = firstLine.slice(task[0].length);
    }

    if (item.marker.kind === 'example') {
      context.counters.example += 1;
      if (item.marker.exampleLabel.length > 0) {
        context.exampleLabels.set(item.marker.exampleLabel, context.counters.example);
      }
    }

    const content = renderBlocks([{ ...item.lines[0], text: firstLine }, ...item.lines.slice(1)], context, !loose);
    const spacing = checkbox.length > 0 ? '' : ' ';
    html += `<li ${blockAttributes(item.line, itemClass)}>${checkbox}${spacing}${content}</li>`;
  }

  const tag = ordered ? 'ol' : 'ul';
  const listClass = `markedit-preview-list${hasTasks ? ' markedit-preview-task-list' : ''}${first.kind === 'example' ? ' msm-example-list' : ''}`;
  const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
  return { html: `<${tag} class="${listClass}"${startAttr}>${html}</${tag}>`, consumed: cursor - index };
}

function nextNonBlank(lines: SourceLine[], index: number, maxSkip: number): number {
  let cursor = index;
  let skipped = 0;
  while (cursor < lines.length && isBlank(lines[cursor].text)) {
    cursor += 1;
    skipped += 1;
    if (skipped > maxSkip) {
      return -1;
    }
  }
  return cursor < lines.length ? cursor : -1;
}

function startsDefinitionList(lines: SourceLine[], index: number): boolean {
  if (isBlank(lines[index].text) || definitionPattern.test(lines[index].text)) {
    return false;
  }
  const next = nextNonBlank(lines, index + 1, 1);
  return next !== -1 && definitionPattern.test(lines[next].text);
}

function renderDefinitionList(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (!startsDefinitionList(lines, index)) {
    return null;
  }

  let html = '';
  let cursor = index;

  while (cursor < lines.length && startsDefinitionList(lines, cursor)) {
    html += `<dt ${blockAttributes(lines[cursor].line)}>${parseInline(lines[cursor].text.trim(), context)}</dt>`;
    cursor = nextNonBlank(lines, cursor + 1, 1);

    while (cursor !== -1 && cursor < lines.length) {
      const definition = definitionPattern.exec(lines[cursor].text);
      if (definition === null) {
        break;
      }

      const body: SourceLine[] = [{ text: definition[1], line: lines[cursor].line }];
      cursor += 1;
      let lastBlank = false;
      while (cursor < lines.length) {
        const { text, line } = lines[cursor];
        if (isBlank(text)) {
          body.push({ text: '', line });
          lastBlank = true;
          cursor += 1;
          continue;
        }
        if (leadingSpaces(text) >= 2) {
          body.push({ text: stripSpaces(text, 4), line });
          lastBlank = false;
          cursor += 1;
          continue;
        }
        if (lastBlank || definitionPattern.test(text) || startsDefinitionList(lines, cursor) || interruptsParagraph(lines, cursor)) {
          break;
        }
        body.push({ text: text.trim(), line });
        cursor += 1;
      }

      while (body.length > 1 && isBlank(body[body.length - 1].text)) {
        body.pop();
      }
      html += `<dd>${renderBlocks(body, context, !body.some(line => isBlank(line.text)))}</dd>`;

      // Skip blank lines between definitions of the same term.
      const peek = nextNonBlank(lines, cursor, 1);
      if (peek !== -1 && definitionPattern.test(lines[peek].text)) {
        cursor = peek;
      }
    }

    if (cursor === -1) {
      cursor = lines.length;
      break;
    }

    const peek = nextNonBlank(lines, cursor, 1);
    if (peek === -1 || !startsDefinitionList(lines, peek)) {
      break;
    }
    cursor = peek;
  }

  return { html: `<dl class="msm-definition-list">${html}</dl>`, consumed: cursor - index };
}

// ---------------------------------------------------------------------------------------------
// HTML, comments, page breaks (§9, §22)
// ---------------------------------------------------------------------------------------------

function renderHtmlBlock(lines: SourceLine[], index: number): BlockResult {
  const text = lines[index].text;
  if (!isHtmlBlockStart(text)) {
    return null;
  }

  if (/^ {0,3}<!--/.test(text)) {
    let cursor = index;
    while (cursor < lines.length && !lines[cursor].text.includes('-->')) {
      cursor += 1;
    }
    const end = Math.min(cursor, lines.length - 1);
    const comment = lines.slice(index, end + 1).map(line => line.text).join('\n').trim();
    const consumed = end + 1 - index;
    if (/^<!--\s*(pb|pagebreak)\s*-->$/.test(comment)) {
      return { html: `<div ${blockAttributes(lines[index].line, 'msm-pagebreak')} aria-hidden="true"></div>`, consumed };
    }

    // Text after the comment on its closing line is still rendered as HTML.
    const after = lines[end].text.slice(lines[end].text.indexOf('-->') + 3);
    return { html: isBlank(after) ? '' : sanitizeHtml(after), consumed };
  }

  let cursor = index;
  while (cursor < lines.length && !isBlank(lines[cursor].text)) {
    cursor += 1;
  }

  return { html: sanitizeHtml(lines.slice(index, cursor).map(line => line.text).join('\n')), consumed: cursor - index };
}

function renderCommentBlock(lines: SourceLine[], index: number): BlockResult {
  const trimmed = lines[index].text.trim();
  if (!trimmed.startsWith('%%')) {
    return null;
  }

  const restOfLine = trimmed.slice(2);
  const close = restOfLine.indexOf('%%');
  if (close !== -1) {
    // Single-line `%%comment%%`; text after it is an inline comment in a paragraph.
    return close + 2 === restOfLine.length ? { html: '', consumed: 1 } : null;
  }

  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor].text.includes('%%')) {
      return { html: '', consumed: cursor + 1 - index };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------------------------
// Headings, paragraphs
// ---------------------------------------------------------------------------------------------

function renderHeading(level: number, source: string, line: number, context: SuperContext): string {
  let content = source;
  let explicitId: string | null = null;
  const idMatch = /\s*\[#([^\]\s]+)\]\s*$/.exec(content);
  if (idMatch !== null) {
    explicitId = idMatch[1];
    content = content.slice(0, idMatch.index);
  }

  const inline = parseInline(content.trim(), context);
  let id: string;
  let error = '';
  const headingIndex = context.headings.length;

  if (explicitId !== null) {
    id = explicitId;
    const kind = labelKind(explicitId, 'heading') === 'sec' ? 'sec' : 'heading';
    if (registerLabel(context, explicitId, kind, explicitId, headingIndex) === null) {
      error = `<span class="msm-error" title="Duplicate label">[#${escapeHtml(explicitId)}]</span>`;
    }
    context.usedIds.set(explicitId, (context.usedIds.get(explicitId) ?? 0) + 1);
  } else {
    id = uniqueId(context, slugifyUnicode(content));
  }

  context.headings.push({ level, id, html: inline, label: explicitId });
  const safeId = escapeHtml(id);
  return `<div ${blockAttributes(line)}><h${level} id="${safeId}" class="markedit-preview-heading"><a class="markedit-preview-anchor" href="#${safeId}" aria-hidden="true">#</a>${inline}${error}</h${level}></div>`;
}

function renderParagraph(lines: SourceLine[], index: number, context: SuperContext, tight: boolean): { html: string; consumed: number } {
  const content: SourceLine[] = [];
  let cursor = index;

  while (cursor < lines.length) {
    const { text } = lines[cursor];
    if (isBlank(text) || lines[cursor].isDefinition === true) {
      break;
    }

    if (content.length > 0) {
      const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(text);
      if (setext !== null) {
        const level = setext[1].startsWith('=') ? 1 : 2;
        const source = content.map(line => line.text.trim()).join('\n');
        return { html: renderHeading(level, source, lines[index].line, context), consumed: cursor + 1 - index };
      }

      if (interruptsParagraph(lines, cursor) || definitionPattern.test(text)) {
        break;
      }
    }

    content.push(lines[cursor]);
    cursor += 1;
  }

  // Always consume at least one line so the block loop can never stall.
  if (content.length === 0) {
    content.push(lines[index]);
    cursor = index + 1;
  }

  let text = content.map(line => line.text.replace(/^[ \t]+/, '')).join('\n').replace(/\s+$/, '');

  // §10 block reference: ` ^id` at the very end of the paragraph.
  let idAttr = '';
  const blockRef = /\s\^([A-Za-z0-9-]+)$/.exec(text);
  if (blockRef !== null) {
    text = text.slice(0, blockRef.index);
    idAttr = ` id="${escapeHtml(blockRef[1])}"`;
  }

  const inline = parseInline(text, context);
  if (inline.trim().length === 0) {
    return { html: '', consumed: cursor - index };
  }

  if (tight && idAttr.length === 0) {
    return { html: inline, consumed: cursor - index };
  }

  return { html: `<p ${blockAttributes(lines[index].line)}${idAttr}>${inline}</p>`, consumed: cursor - index };
}

function tryBlockPlugins(lines: SourceLine[], index: number, context: SuperContext): BlockResult {
  if (context.blockPlugins.length === 0) {
    return null;
  }

  const converted = lines.slice(index).map(line => ({ raw: line.text, text: line.text.trim(), indent: leadingSpaces(line.text), lineNumber: line.line }));
  const legacyContext = {
    options: { ...context.options, blockPlugins: context.blockPlugins, inlinePlugins: [] },
    parseInline: (text: string) => parseInline(text, context),
    renderBlocks: (blockLines: { raw: string; lineNumber: number }[]) => renderBlocks(blockLines.map(line => ({ text: line.raw, line: line.lineNumber })), context),
    renderMath: context.renderMath,
    renderMermaid: context.renderMermaid,
    highlightCode: context.highlightCode,
  };

  for (const plugin of context.blockPlugins) {
    const result = plugin.tryRender(converted, legacyContext as unknown as Parameters<MarkdownBlockPlugin['tryRender']>[1]);
    if (result !== null && result.consumed > 0) {
      return result;
    }
  }

  return null;
}

/** Renders a sequence of source lines. `tight` drops `<p>` wrappers (tight list items). */
/**
 * Nesting limit for blocks inside blocks (quotes, lists, fenced divs, callouts): each level
 * recurses, so thousands of `>` would overflow the stack. Deeper content is shown as plain text.
 */
const maxNestingDepth = 64;
let nestingDepth = 0;

export function renderBlocks(lines: SourceLine[], context: SuperContext, tight = false): string {
  if (nestingDepth >= maxNestingDepth) {
    return `<p>${escapeHtml(lines.map(line => line.text).join('\n'))}</p>`;
  }
  nestingDepth += 1;
  try {
    return renderBlocksAtDepth(lines, context, tight);
  } finally {
    nestingDepth -= 1;
  }
}

function renderBlocksAtDepth(lines: SourceLine[], context: SuperContext, tight: boolean): string {
  let html = '';
  let index = 0;

  while (index < lines.length) {
    const { text, line } = lines[index];

    if (isBlank(text) || lines[index].isDefinition === true) {
      index += 1;
      continue;
    }

    const toc = tocPattern.exec(text);
    if (toc !== null) {
      html += `<div ${blockAttributes(line, 'msm-toc')}>${placeholderStart}T:${group(toc, 1) ?? '3'}${placeholderEnd}</div>`;
      index += 1;
      continue;
    }

    const include = includePattern.exec(text);
    if (include !== null) {
      // Unresolved include (resolved ones were expanded during pre-processing).
      html += `<div ${blockAttributes(line, 'msm-include')}>${notice(`@include ${include[1]}: ${lines[index].includeError ?? 'not resolved'}`)}</div>`;
      index += 1;
      continue;
    }

    const heading = atxPattern.exec(text);
    if (heading !== null) {
      const content = (group(heading, 2) ?? '').replace(/(^|[ \t]+)#+[ \t]*$/, '');
      html += renderHeading(heading[1].length, content, line, context);
      index += 1;
      continue;
    }

    const block = renderCommentBlock(lines, index)
      ?? renderFencedCode(lines, index, context)
      ?? renderMathBlock(lines, index, context)
      ?? renderFencedDiv(lines, index, context)
      ?? renderHtmlBlock(lines, index)
      ?? (hrPattern.test(text) ? { html: `<hr ${blockAttributes(line)}>`, consumed: 1 } : null)
      ?? renderGridTable(lines, index, context)
      ?? renderPipeTable(lines, index, context)
      ?? renderBlockquote(lines, index, context)
      ?? renderList(lines, index, context)
      ?? renderIndentedCode(lines, index, context)
      ?? tryBlockPlugins(lines, index, context)
      ?? renderDefinitionList(lines, index, context)
      ?? renderParagraph(lines, index, context, tight);

    html += block.html;
    index += Math.max(1, block.consumed);
  }

  return html;
}
