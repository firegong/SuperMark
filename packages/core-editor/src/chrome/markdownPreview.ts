import { createButton, createElement } from './utils';

export type MarkdownPreviewMode = 'editor' | 'split' | 'preview';

const previewState: {
  mode: MarkdownPreviewMode;
  pane: HTMLElement | null;
  toolbar: HTMLElement | null;
  body: HTMLElement | null;
  syncScroll: boolean;
  splitRatio: number;
  isDragging: boolean;
  updateTimeout: ReturnType<typeof setTimeout> | null;
  lastContent: string;
} = {
  mode: 'editor',
  pane: null,
  toolbar: null,
  body: null,
  syncScroll: true,
  splitRatio: 0.5,
  isDragging: false,
  updateTimeout: null,
  lastContent: '',
};

let editorContainer: HTMLElement | null = null;
let mutationObserver: MutationObserver | null = null;

const alertTitles: Record<string, { label: string; icon: string }> = {
  note: { label: 'Note', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a.75.75 0 010-1.5.75.75 0 010 1.5zm0-3c.41 0 .75-.34.75-.75V4.5a.75.75 0 00-1.5 0v3.75c0 .41.34.75.75.75z' },
  tip: { label: 'Tip', icon: 'M9.5 1a4.5 4.5 0 00-4.3 5.9L1.5 11h3v3h7v-3h3l-3.7-4.1A4.5 4.5 0 009.5 1z' },
  important: { label: 'Important', icon: 'M8 1L1 14h14L8 1zm0 3.5L11 7l1.5 1.5 1.5-1.5L14 2.5l-1.5 1.5-.5-.5-1.5 1.5 1.5 1.5zM7.5 8v3h1V8h-1z' },
  warning: { label: 'Warning', icon: 'M8.88 1.4a1 1 0 00-1.76 0l-7 13A1 1 0 001 15.5h14a1 1 0 00.88-1.6l-7-13.5zM8 12a1 1 0 110-2 1 1 0 010 2zm0-3V6h1v3H8z' },
  caution: { label: 'Caution', icon: 'M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 01.75.75v4a.75.75 0 01-1.5 0v-4A.75.75 0 018 4.5zm0 7a.75.75 0 110-1.5.75.75 0 010 1.5z' },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isUnsafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches?.length ?? 0;
}

function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function parseLinkDestination(text: string): { href: string; title: string; rest: string } | null {
  const match = /^\s*<([^>]*)>|^\s*([^\s)]*)/.exec(text);
  if (match === null) {
    return null;
  }

  const raw = match[1] || match[2] || '';
  let rest = text.slice(match[0].length);
  let title = '';

  const titleMatch = /^\s+("[^"]*"|'[^']*'|\([^)]*\))/.exec(rest);
  if (titleMatch !== null) {
    title = titleMatch[1].slice(1, -1);
    rest = rest.slice(titleMatch[0].length);
  }

  return { href: raw, title, rest };
}

function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Footnote references [^1]
  result = result.replace(/\[\^([^\]]+)\]/g, '<sup class="markedit-preview-footnote-ref"><a href="#fn-$1" id="fnref-$1">$1</a></sup>');

  // Images ![alt](src "title")
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full: string, alt: string, dest: string) => {
    const parsed = parseLinkDestination(dest);
    if (parsed === null || isUnsafeUrl(parsed.href)) {
      return full;
    }
    const titleAttr = parsed.title.length > 0 ? ` title="${escapeHtml(parsed.title)}"` : '';
    return `<img src="${escapeHtml(parsed.href)}" alt="${escapeHtml(alt)}"${titleAttr} class="markedit-preview-image">`;
  });

  // Links [label](href "title")
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full: string, label: string, dest: string) => {
    const parsed = parseLinkDestination(dest);
    if (parsed === null || isUnsafeUrl(parsed.href)) {
      return full;
    }
    const titleAttr = parsed.title.length > 0 ? ` title="${escapeHtml(parsed.title)}"` : '';
    return `<a href="${escapeHtml(parsed.href)}"${titleAttr}>${parseInline(label)}</a>`;
  });

  // Autolinks <url>
  result = result.replace(/<([a-z][a-z0-9+.-]*:[^\s<>]+)>/gi, (full: string, url: string) => {
    if (isUnsafeUrl(url)) {
      return escapeHtml(url);
    }
    return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  });

  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code class="markedit-preview-code">$1</code>');

  // Display math $$...$$
  result = result.replace(/\$\$([^$]+)\$\$/g, '<div class="markedit-preview-math-block">$1</div>');

  // Inline math $...$
  result = result.replace(/\$([^\s$][^$]*?)\$/g, '<span class="markedit-preview-math-inline">$1</span>');

  // Bold + italic ***text***
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

  // Bold **text** __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic *text* _text_
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Strikethrough ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Highlight ==text==
  result = result.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  return result;
}

interface Line {
  raw: string;
  text: string;
  indent: number;
  lineNumber: number;
}

function classifyLine(raw: string): Line {
  const indent = raw.match(/^(\s*)/)?.[1].length ?? 0;
  return { raw, text: raw.trim(), indent, lineNumber: 0 };
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
  const match = /^(```|~~~)([^\s]*)/.exec(line);
  if (match === null) {
    return null;
  }

  return { fence: match[1], lang: match[2].trim() };
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

function blockAttributes(lineNumber: number): string {
  return `class="markedit-preview-block" data-line="${lineNumber}"`;
}

function renderAlert(lines: Line[]): { html: string; consumed: number } | null {
  if (lines.length === 0) {
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

  const contentLines: string[] = [];
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
    contentLines.push(bq.content);
    consumed += 1;
  }

  const inner = renderBlocks(contentLines.map(classifyLine));
  const iconSvg = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="${alertTitles[type].icon}"/></svg>`;
  const html = `<div ${blockAttributes(startLine)}><div class="markedit-preview-alert is-${type}"><div class="markedit-preview-alert-title">${iconSvg}${escapeHtml(title)}</div><div class="markedit-preview-alert-content">${inner}</div></div></div>`;

  return { html, consumed };
}

function renderFencedCode(lines: Line[]): { html: string; consumed: number } | null {
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
    if (line.startsWith(start.fence)) {
      consumed += 1;
      break;
    }

    content.push(line);
    consumed += 1;
  }

  const code = escapeHtml(content.join('\n'));
  const langAttr = start.lang.length > 0 ? ` data-language="${escapeHtml(start.lang)}"` : '';
  const langLabel = start.lang.length > 0 ? `<span class="markedit-preview-code-lang">${escapeHtml(start.lang)}</span>` : '';
  const html = `<div ${blockAttributes(startLine)}><div class="markedit-preview-code-block"${langAttr}>${langLabel}<button type="button" class="markedit-preview-code-copy">Copy</button><pre><code>${code}</code></pre></div></div>`;

  return { html, consumed };
}

function renderTable(lines: Line[]): { html: string; consumed: number } | null {
  if (lines.length < 2) {
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
    return `<${tag} style="text-align: ${align}">${parseInline(cell)}</${tag}>`;
  }).join('');

  let html = `<div ${blockAttributes(startLine)}><table class="markedit-preview-table"><thead><tr>${renderCells(header.cells, 'th')}</tr></thead><tbody>`;

  let consumed = 2;
  while (consumed < lines.length) {
    const row = isTableRow(lines[consumed].raw);
    if (row === null || row.isSeparator) {
      break;
    }

    html += `<tr>${renderCells(row.cells, 'td')}</tr>`;
    consumed += 1;
  }

  html += '</tbody></table></div>';
  return { html, consumed };
}

function renderList(lines: Line[]): { html: string; consumed: number } | null {
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

  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag} class="markedit-preview-list">`;

  for (const item of items) {
    const checkbox = item.task !== null
      ? `<input type="checkbox" class="markedit-preview-task-checkbox" data-line="${item.lineNumber}"${item.task ? ' checked' : ''}> `
      : '';
    const subList = item.subLines.length > 0 ? renderBlocks(item.subLines) : '';
    const contentHtml = renderBlocks(item.content.split('\n').map(classifyLine));
    html += `<li ${blockAttributes(item.lineNumber)}>${checkbox}${contentHtml}${subList}</li>`;
  }

  html += `</${tag}>`;
  return { html, consumed };
}

function renderBlockquote(lines: Line[]): { html: string; consumed: number } | null {
  if (lines.length === 0) {
    return null;
  }

  const first = isBlockquote(lines[0].raw);
  if (first === null) {
    return null;
  }

  const startLine = lines[0].lineNumber;
  const content: string[] = [];
  let consumed = 0;

  while (consumed < lines.length) {
    const bq = isBlockquote(lines[consumed].raw);
    if (bq === null) {
      break;
    }

    content.push(bq.content);
    consumed += 1;
  }

  const inner = renderBlocks(content.map(classifyLine));
  const html = `<div ${blockAttributes(startLine)}><blockquote class="markedit-preview-blockquote">${inner}</blockquote></div>`;
  return { html, consumed };
}

function renderParagraph(lines: Line[]): { html: string; consumed: number } {
  const startLine = lines[0].lineNumber;
  const content: string[] = [];
  let consumed = 0;

  while (consumed < lines.length) {
    const line = lines[consumed];
    if (line.raw.trim().length === 0 || isHeading(line.raw) !== null || isHorizontalRule(line.raw) || isFencedCodeStart(line.raw) !== null || isListItem(line.raw) !== null || isBlockquote(line.raw) !== null || isTableRow(line.raw) !== null) {
      break;
    }

    content.push(line.raw);
    consumed += 1;
  }

  const text = content.join(' ').replace(/\s+/g, ' ').trim();
  const html = text.length > 0 ? `<p ${blockAttributes(startLine)}>${parseInline(text)}</p>` : '';
  return { html, consumed };
}

function renderBlocks(lines: Line[]): string {
  const withLineNumbers = lines.map((line, index) => ({ ...line, lineNumber: index }));
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
      html += `<div ${blockAttributes(line.lineNumber)}><h${heading.level} id="${id}" class="markedit-preview-heading"><a class="markedit-preview-anchor" href="#${id}" aria-hidden="true">#</a>${parseInline(heading.content)}</h${heading.level}></div>`;
      index += 1;
      continue;
    }

    const fenced = renderFencedCode(withLineNumbers.slice(index));
    if (fenced !== null) {
      html += fenced.html;
      index += fenced.consumed;
      continue;
    }

    const table = renderTable(withLineNumbers.slice(index));
    if (table !== null) {
      html += table.html;
      index += table.consumed;
      continue;
    }

    const alert = renderAlert(withLineNumbers.slice(index));
    if (alert !== null) {
      html += alert.html;
      index += alert.consumed;
      continue;
    }

    const list = renderList(withLineNumbers.slice(index));
    if (list !== null) {
      html += list.html;
      index += list.consumed;
      continue;
    }

    const blockquote = renderBlockquote(withLineNumbers.slice(index));
    if (blockquote !== null) {
      html += blockquote.html;
      index += blockquote.consumed;
      continue;
    }

    const paragraph = renderParagraph(withLineNumbers.slice(index));
    html += paragraph.html;
    index += paragraph.consumed;
  }

  return html;
}

export function renderMarkdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n').map(classifyLine);
  const { frontMatter, remaining } = parseYamlFrontMatter(rawLines);

  let html = '';
  if (frontMatter !== null) {
    html += renderYamlFrontMatter(frontMatter);
  }

  html += renderBlocks(remaining);
  return html;
}

function getEditorView(): typeof window.editor | undefined {
  return window.editor as typeof window.editor | undefined;
}

function getEditorText(): string {
  const core = window.webModules.core as unknown as { getEditorText?: () => string } | undefined;
  if (core?.getEditorText !== undefined) {
    return core.getEditorText();
  }

  return getEditorView()?.state.doc.toString() ?? '';
}

function getEditorLineStart(line: number): number {
  const doc = getEditorView()?.state.doc;
  if (doc === undefined) {
    return 0;
  }

  const lineObj = doc.line(Math.min(line + 1, doc.lines));
  return lineObj.from;
}

function getEditorLineRange(line: number): { from: number; to: number } {
  const doc = getEditorView()?.state.doc;
  if (doc === undefined) {
    return { from: 0, to: 0 };
  }

  const lineObj = doc.line(Math.min(line + 1, doc.lines));
  return { from: lineObj.from, to: lineObj.to };
}

function updateSummary(): void {
  if (previewState.toolbar === null) {
    return;
  }

  const text = getEditorText();
  const words = countWords(text);
  const badge = previewState.toolbar.querySelector('.markedit-preview-summary') as HTMLElement | null;
  if (badge !== null) {
    badge.textContent = `${words} words · ${readingTime(words)}`;
  }
}

function updateContent(immediate = false): void {
  const body = previewState.body;
  if (body === null || previewState.mode === 'editor') {
    return;
  }

  const render = () => {
    const text = getEditorText();
    if (text === previewState.lastContent) {
      return;
    }

    previewState.lastContent = text;
    body.innerHTML = renderMarkdownToHtml(text);
    attachPreviewInteractions();
    updateSummary();
  };

  if (immediate) {
    if (previewState.updateTimeout !== null) {
      clearTimeout(previewState.updateTimeout);
      previewState.updateTimeout = null;
    }

    render();
    return;
  }

  if (previewState.updateTimeout !== null) {
    clearTimeout(previewState.updateTimeout);
  }

  previewState.updateTimeout = setTimeout(render, 50);
}

function attachPreviewInteractions(): void {
  if (previewState.body === null) {
    return;
  }

  // Task list checkboxes
  previewState.body.querySelectorAll<HTMLInputElement>('.markedit-preview-task-checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', event => {
      event.preventDefault();
      const lineAttr = checkbox.dataset.line;
      if (lineAttr === undefined) {
        return;
      }

      const line = parseInt(lineAttr, 10);
      const checked = checkbox.checked;
      const { from, to } = getEditorLineRange(line);
      const lineText = getEditorView()?.state.doc.sliceString(from, to) ?? '';
      const updated = checked
        ? lineText.replace(/\[x\]/i, '[ ]')
        : lineText.replace(/\[ \]/, '[x]');

      getEditorView()?.dispatch({ changes: { from, to, insert: updated } });
    });
  });

  // Double-click blocks to jump to source line
  previewState.body.querySelectorAll<HTMLElement>('.markedit-preview-block').forEach(block => {
    block.addEventListener('dblclick', () => {
      const lineAttr = block.dataset.line;
      if (lineAttr === undefined) {
        return;
      }

      const line = parseInt(lineAttr, 10);
      const pos = getEditorLineStart(line);
      getEditorView()?.dispatch({ selection: { anchor: pos } });
      getEditorView()?.focus();
    });
  });

  // Copy code blocks
  previewState.body.querySelectorAll<HTMLButtonElement>('.markedit-preview-code-copy').forEach(button => {
    button.addEventListener('click', () => {
      const code = button.parentElement?.querySelector('code')?.textContent ?? '';
      void copyToClipboard(code, button, 'Copied!');
    });
  });
}

async function copyToClipboard(text: string, button: HTMLButtonElement, feedback: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = feedback;
  setTimeout(() => { button.textContent = original; }, 1200);
}

function syncScroll(): void {
  if (!previewState.syncScroll || previewState.mode !== 'split' || previewState.body === null) {
    return;
  }

  const scroller = getEditorView()?.scrollDOM;
  if (scroller === undefined) {
    return;
  }

  const ratio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);
  const body = previewState.body;
  body.scrollTop = ratio * (body.scrollHeight - body.clientHeight || 1);
}

function createPreviewPane(): HTMLElement {
  const existingPane = previewState.pane;
  if (existingPane?.isConnected === true) {
    return existingPane;
  }

  previewState.pane = null;
  previewState.toolbar = null;
  previewState.body = null;

  const pane = createElement('div', 'markedit-markdown-preview-pane');
  document.body.appendChild(pane);

  const toolbar = createElement('div', 'markedit-preview-toolbar', pane);
  previewState.toolbar = toolbar;

  const left = createElement('div', 'markedit-preview-toolbar-left', toolbar);
  const modeGroup = createElement('div', 'markedit-preview-mode-group', left);

  const editorButton = createButton('Editor', () => setMarkdownPreviewMode('editor'), 'markedit-preview-mode-button');
  editorButton.dataset.mode = 'editor';
  modeGroup.appendChild(editorButton);

  const splitButton = createButton('Split', () => setMarkdownPreviewMode('split'), 'markedit-preview-mode-button');
  splitButton.dataset.mode = 'split';
  modeGroup.appendChild(splitButton);

  const previewButton = createButton('Preview', () => setMarkdownPreviewMode('preview'), 'markedit-preview-mode-button');
  previewButton.dataset.mode = 'preview';
  modeGroup.appendChild(previewButton);

  const summary = createElement('span', 'markedit-preview-summary', left, '0 words · 1 min read');
  summary.title = 'Document summary';

  const right = createElement('div', 'markedit-preview-toolbar-right', toolbar);

  const syncButton = createButton('Sync Scroll', () => {
    previewState.syncScroll = !previewState.syncScroll;
    syncButton.classList.toggle('is-active', previewState.syncScroll);
  }, 'markedit-preview-toolbar-button');
  syncButton.classList.add('is-active');
  syncButton.title = 'Sync editor scroll to preview';
  right.appendChild(syncButton);

  const copyButton = createButton('Copy HTML', () => {
    const html = previewState.body?.innerHTML ?? '';
    void copyToClipboard(html, copyButton, 'Copied!');
  }, 'markedit-preview-toolbar-button');
  right.appendChild(copyButton);

  const closeButton = createButton('×', () => setMarkdownPreviewMode('editor'), 'markedit-chrome-button markedit-chrome-icon-button markedit-chrome-close-button');
  right.appendChild(closeButton);

  const body = createElement('div', 'markedit-preview-body', pane);
  previewState.body = body;

  previewState.pane = pane;
  return pane;
}

function ensureResizer(): HTMLElement | null {
  const existing = document.querySelector('.markedit-preview-resizer') as HTMLElement | null;
  if (existing !== null) {
    return existing;
  }

  const editor = getEditorContainer();
  if (editor === null) {
    return null;
  }

  const resizer = createElement('div', 'markedit-preview-resizer');
  document.body.appendChild(resizer);

  resizer.addEventListener('mousedown', event => {
    previewState.isDragging = true;
    event.preventDefault();
  });

  return resizer;
}

function removeResizer(): void {
  document.querySelector('.markedit-preview-resizer')?.remove();
}

function getEditorContainer(): HTMLElement | null {
  if (editorContainer === null) {
    editorContainer = document.getElementById('editor');
  }

  return editorContainer;
}

function applyLayout(): void {
  const body = document.body;
  const editor = getEditorContainer();

  body.classList.remove('markedit-mode-split', 'markedit-mode-preview');
  removeResizer();

  if (previewState.mode === 'editor') {
    if (editor !== null) {
      editor.style.width = '';
      editor.style.display = '';
    }

    if (previewState.pane !== null) {
      previewState.pane.style.display = 'none';
    }

    return;
  }

  createPreviewPane();
  if (previewState.pane !== null) {
    previewState.pane.style.display = '';
  }

  body.classList.add(previewState.mode === 'split' ? 'markedit-mode-split' : 'markedit-mode-preview');

  if (previewState.mode === 'split') {
    ensureResizer();
    if (editor !== null) {
      editor.style.width = `${previewState.splitRatio * 100}%`;
      editor.style.display = '';
    }
  } else {
    if (editor !== null) {
      editor.style.display = 'none';
    }
  }

  // Update mode button states
  previewState.toolbar?.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.mode === previewState.mode);
  });

  updateContent(true);
}

function startLiveSync(): void {
  const editor = getEditorView();
  if (editor === undefined) {
    return;
  }

  editor.scrollDOM.addEventListener('scroll', syncScroll);

  // MutationObserver on the editor container catches content changes
  const target = editor.dom;
  if (mutationObserver === null) {
    mutationObserver = new MutationObserver(() => {
      if (previewState.mode !== 'editor') {
        updateContent();
      }
    });
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }
}

function stopLiveSync(): void {
  getEditorView()?.scrollDOM.removeEventListener('scroll', syncScroll);
  mutationObserver?.disconnect();
  mutationObserver = null;
}

function setupGlobalListeners(): void {
  window.addEventListener('mousemove', event => {
    if (!previewState.isDragging) {
      return;
    }

    const ratio = Math.max(0.25, Math.min(0.75, event.clientX / window.innerWidth));
    previewState.splitRatio = ratio;
    applyLayout();
  });

  window.addEventListener('mouseup', () => {
    previewState.isDragging = false;
  });

  window.addEventListener('editor-colors-changed', event => {
    const colors = (event as CustomEvent).detail?.colors as Record<string, string> | undefined;
    if (colors !== undefined && previewState.pane !== null) {
      applyPreviewColors(colors);
    }
  });
}

function applyPreviewColors(colors?: Record<string, string>): void {
  if (previewState.pane === null || colors === undefined) {
    return;
  }

  const pane = previewState.pane;
  pane.style.setProperty('--preview-bg', colors.background || '#ffffff');
  pane.style.setProperty('--preview-fg', colors.foreground || '#000000');
  pane.style.setProperty('--preview-accent', colors.accent || '#0066cc');
}

export function getMarkdownPreviewMode(): MarkdownPreviewMode {
  return previewState.mode;
}

export function setMarkdownPreviewMode(mode: MarkdownPreviewMode): void {
  if (previewState.mode === mode) {
    return;
  }

  const previous = previewState.mode;
  previewState.mode = mode;

  if (previous === 'editor') {
    startLiveSync();
  }

  applyLayout();

  if (mode === 'editor') {
    stopLiveSync();
    getEditorView()?.focus();
  }
}

export function toggleMarkdownPreview(preferredMode?: 'split' | 'preview'): void {
  const current = previewState.mode;

  if (current === 'editor') {
    setMarkdownPreviewMode(preferredMode ?? 'split');
    return;
  }

  if (preferredMode === undefined || current === preferredMode) {
    setMarkdownPreviewMode('editor');
    return;
  }

  setMarkdownPreviewMode(preferredMode);
}

setupGlobalListeners();
