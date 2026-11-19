import { escapeHtml } from '../utils';
import { renderMathWithPlugin } from '../plugins/registry';
import { registerBuiltinRendererPlugins } from '../plugins/builtin';
import { renderMermaidToSvg } from '../plugins/mermaidPlugin';
import { highlightCode } from '../plugins/codeHighlightPlugin';
import type { MarkdownBlockPlugin, MarkdownRendererEngine, MarkdownRenderOptions } from '../types';
import { blockAttributes, isFenceOpen, isBlank, renderBlocks, leadingSpaces } from './blocks';
import { parseInline } from './inline';
import {
  defaultCrossRefLabels,
  group,
  normalizeLabel,
  placeholderEnd,
  placeholderStart,
  type SourceLine,
  type SuperContext,
  type SuperMarkdownOptions,
} from './context';

/**
 * SuperMarkdown renderer: MultiMarkdown 6 as the base, extended with Pandoc, markdown-it (GFM)
 * and Obsidian syntax, plus the SuperMarkdown additions (merged table cells, executable and
 * diagram chunks, fenced divs, tabs, includes, variables, keyboard keys, extended task states).
 */

registerBuiltinRendererPlugins();

const placeholderPattern = new RegExp(`${placeholderStart}([XTE]):([^${placeholderEnd}]*)${placeholderEnd}`, 'g');
const metadataKeyPattern = /^([A-Za-z0-9_][A-Za-z0-9 _.-]{0,40}?):(?:[ \t]+(.*))?$/;

interface Metadata {
  entries: { key: string; value: string }[];
  remaining: SourceLine[];
}

function toLines(text: string, lineOffset: number | null): SourceLine[] {
  return text
    .replace(/[]/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, index) => ({
      // Expand leading tabs to 4 spaces so indentation rules work on spaces only.
      text: raw.replace(/^[ \t]+/, ws => ws.replace(/\t/g, '    ')),
      line: lineOffset ?? index,
    }));
}

function metadataKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '');
}

/** Pandoc YAML (`---` … `---`/`...`) or MultiMarkdown `Key: Value` metadata at the top. */
function extractMetadata(lines: SourceLine[]): Metadata {
  const entries: { key: string; value: string }[] = [];

  if (lines.length > 0 && lines[0].text.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line.text));
    if (end === -1) {
      return { entries, remaining: lines };
    }

    for (const line of lines.slice(1, end)) {
      // Top-level scalar keys only; nested YAML is shown but not used for variables.
      const match = /^([\w.-][\w .-]*?):[ \t]*(.*)$/.exec(line.text);
      if (match !== null && !/^\s/.test(line.text)) {
        entries.push({ key: match[1], value: match[2].trim().replace(/^(["'])(.*)\1$/, '$2') });
      }
    }

    return { entries, remaining: lines.slice(end + 1) };
  }

  let cursor = 0;
  while (cursor < lines.length && !isBlank(lines[cursor].text)) {
    const match = metadataKeyPattern.exec(lines[cursor].text);
    if (match !== null) {
      entries.push({ key: match[1].trim(), value: (group(match, 2) ?? '').trim() });
    } else if (entries.length > 0 && /^\s+\S/.test(lines[cursor].text)) {
      const last = entries[entries.length - 1];
      last.value = `${last.value} ${lines[cursor].text.trim()}`.trim();
    } else {
      return { entries: [], remaining: lines };
    }
    cursor += 1;
  }

  if (entries.length === 0) {
    return { entries: [], remaining: lines };
  }

  return { entries, remaining: lines.slice(cursor) };
}

function joinPath(from: string | null, path: string): string {
  if (/^([A-Za-z]:[\\/]|\/)/.test(path) || from === null) {
    return path;
  }

  const base = from.replace(/[\\/][^\\/]*$/, '');
  const parts = `${base === from ? '' : `${base}/`}${path}`.split(/[\\/]+/);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..' && resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

/** Expands `@include path` lines outside code blocks (§27). */
function expandIncludes(lines: SourceLine[], fromPath: string | null, stack: string[], context: SuperContext): SourceLine[] {
  const result: SourceLine[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    if (fence !== null) {
      if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(line.text)) {
        fence = null;
      }
      result.push(line);
      continue;
    }

    const open = isFenceOpen(line.text);
    if (open !== null) {
      fence = open.fence;
      result.push(line);
      continue;
    }

    const include = /^@include[ \t]+(.+?)[ \t]*$/.exec(line.text);
    if (include === null) {
      result.push(line);
      continue;
    }

    const path = include[1].replace(/^(["'])(.*)\1$/, '$2');
    const resolver = context.options.includeResolver;
    if (resolver === undefined) {
      result.push({ ...line, includeError: 'file includes are not available in this preview' });
      continue;
    }

    const fullPath = joinPath(fromPath, path);
    if (stack.includes(fullPath)) {
      result.push({ ...line, includeError: 'circular include' });
      continue;
    }

    const content = resolver(path, fromPath);
    if (content === null) {
      result.push({ ...line, includeError: 'file not found' });
      continue;
    }

    // Included files keep the include line's number so preview sync still points somewhere sensible.
    const included = extractMetadata(toLines(content, line.line));
    for (const entry of included.entries) {
      if (!context.metadata.has(metadataKey(entry.key))) {
        context.metadata.set(metadataKey(entry.key), entry.value);
      }
    }
    result.push(...expandIncludes(included.remaining, fullPath, [...stack, fullPath], context));
  }

  return result;
}

/** Collects `[ref]: url` and `[^note]: text` definitions so later inline parsing can resolve them. */
function collectDefinitions(lines: SourceLine[], context: SuperContext): void {
  let fence: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const { text } = lines[index];
    if (fence !== null) {
      if (/^ {0,3}(`{3,}|~{3,})\s*$/.test(text) && text.trim()[0] === fence[0] && text.trim().length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const open = isFenceOpen(text);
    if (open !== null) {
      fence = open.fence;
      continue;
    }

    const footnote = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/.exec(text);
    if (footnote !== null) {
      const body: SourceLine[] = [{ text: footnote[2], line: lines[index].line }];
      lines[index].isDefinition = true;
      let cursor = index + 1;
      let lastBlank = false;
      while (cursor < lines.length) {
        const next = lines[cursor].text;
        if (isBlank(next)) {
          lastBlank = true;
        } else if (leadingSpaces(next) >= 4) {
          lastBlank = false;
        } else if (lastBlank || /^ {0,3}\[\^[^\]\s]+\]:/.test(next)) {
          break;
        }
        // §23: continuation paragraphs are indented by 4 spaces (or a tab).
        body.push({ text: leadingSpaces(next) >= 4 ? next.slice(4) : next, line: lines[cursor].line });
        lines[cursor].isDefinition = true;
        cursor += 1;
      }

      while (body.length > 1 && isBlank(body[body.length - 1].text)) {
        body.pop();
      }
      // Blank lines after a footnote belong to the document again.
      for (let i = cursor - 1; i > index && isBlank(lines[i].text); i -= 1) {
        lines[i].isDefinition = false;
      }

      if (!context.footnoteDefinitions.has(footnote[1])) {
        context.footnoteDefinitions.set(footnote[1], body);
      }
      index = cursor - 1;
      continue;
    }

    const reference = /^ {0,3}\[([^\]^#@][^\]]*)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/.exec(text);
    if (reference !== null) {
      const key = normalizeLabel(reference[1]);
      if (!context.references.has(key)) {
        const href = reference[2].startsWith('<') ? reference[2].slice(1, -1) : reference[2];
        context.references.set(key, { href, title: group(reference, 3)?.slice(1, -1) ?? '' });
      }
      lines[index].isDefinition = true;
    }
  }
}

function renderMetadata(entries: { key: string; value: string }[]): string {
  if (entries.length === 0) {
    return '';
  }
  const rows = entries.map(entry => `<tr><th>${escapeHtml(entry.key)}</th><td>${escapeHtml(entry.value)}</td></tr>`).join('');
  return `<div class="markedit-preview-frontmatter"><table>${rows}</table></div>`;
}

function renderFootnotes(context: SuperContext): string {
  if (context.footnoteOrder.length === 0) {
    return '';
  }

  let items = '';
  // Footnotes may reference further footnotes, so the order list can grow while rendering.
  for (let index = 0; index < context.footnoteOrder.length; index += 1) {
    const id = context.footnoteOrder[index];
    const body = context.footnoteDefinitions.get(id) ?? [];
    const safeId = escapeHtml(id);
    items += `<li id="fn-${safeId}" ${blockAttributes(body[0]?.line ?? 0)}>${renderBlocks(body, context)}<a href="#fnref-${safeId}" class="msm-footnote-back" aria-label="Back to reference">↩</a></li>`;
  }

  return `<section class="markedit-preview-footnotes msm-footnotes"><hr><ol>${items}</ol></section>`;
}

/** Hierarchical section numbers (`3.2`) relative to the shallowest heading level used. */
function sectionNumbers(context: SuperContext): string[] {
  const minLevel = Math.min(...context.headings.map(heading => heading.level), 6);
  const counters = [0, 0, 0, 0, 0, 0];
  return context.headings.map(heading => {
    const depth = heading.level - minLevel;
    counters[depth] += 1;
    for (let i = depth + 1; i < counters.length; i += 1) {
      counters[i] = 0;
    }
    return counters.slice(0, depth + 1).map(count => Math.max(count, 1)).join('.');
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function renderToc(context: SuperContext, depth: number): string {
  const headings = context.headings.filter(heading => heading.level <= depth);
  if (headings.length === 0) {
    return '';
  }

  const base = Math.min(...headings.map(heading => heading.level));
  let html = '<nav class="msm-toc-nav"><ul>';
  let level = base;
  let first = true;

  for (const heading of headings) {
    if (heading.level > level) {
      while (level < heading.level) {
        html += '<ul>';
        level += 1;
      }
    } else {
      if (!first) {
        html += '</li>';
      }
      while (level > heading.level) {
        html += '</ul></li>';
        level -= 1;
      }
    }
    html += `<li><a href="#${escapeHtml(heading.id)}">${stripTags(heading.html)}</a>`;
    first = false;
  }

  html += '</li>';
  while (level > base) {
    html += '</ul></li>';
    level -= 1;
  }
  return `${html}</ul></nav>`;
}

function resolvePlaceholders(html: string, context: SuperContext): string {
  const numbers = sectionNumbers(context);

  return html.replace(placeholderPattern, (_match, type: string, value: string) => {
    if (type === 'T') {
      return renderToc(context, parseInt(value, 10) || 3);
    }

    if (type === 'E') {
      const number = context.exampleLabels.get(value);
      return number === undefined
        ? `<span class="msm-error" title="Undefined example">(@${escapeHtml(value)})</span>`
        : `<span class="msm-example-ref">(${number})</span>`;
    }

    const label = context.labels.get(value);
    const safe = escapeHtml(value);
    if (label !== undefined) {
      let text: string;
      switch (label.kind) {
        case 'sec': text = context.crossRefLabels.sec(numbers[label.index] ?? '?'); break;
        case 'heading': text = stripTags((context.headings[label.index] as { html: string } | undefined)?.html ?? value); break;
        case 'fig':
        case 'tbl':
        case 'eq':
        case 'lst':
          text = context.crossRefLabels[label.kind](label.index);
      }
      return `<a class="msm-xref" href="#${escapeHtml(label.id)}">${escapeHtml(text)}</a>`;
    }

    const heading = context.headings.find(item => item.id === value);
    if (heading !== undefined) {
      return `<a class="msm-xref" href="#${safe}">${stripTags(heading.html)}</a>`;
    }

    return `<span class="msm-error" title="Undefined reference">[#${safe}]</span>`;
  });
}

export class SuperMarkdownEngine implements MarkdownRendererEngine {
  readonly id = 'super';
  readonly name = 'SuperMarkdown';
  readonly standard = 'super';
  private readonly blockPlugins: MarkdownBlockPlugin[] = [];

  registerBlockPlugin(plugin: MarkdownBlockPlugin): void {
    this.blockPlugins.push(plugin);
  }

  private createContext(options?: SuperMarkdownOptions): SuperContext {
    const merged: SuperMarkdownOptions = {
      enableFrontmatter: true,
      enableTables: true,
      enableTaskLists: true,
      enableStrikethrough: true,
      enableAutolinks: true,
      enableFootnotes: true,
      enableMath: true,
      enableMermaid: true,
      enableCallouts: true,
      enableCodeHighlight: true,
      outputFormat: 'html',
      ...options,
    };

    return {
      options: merged,
      crossRefLabels: { ...defaultCrossRefLabels, ...merged.crossRefLabels },
      metadata: new Map(),
      execute: false,
      references: new Map(),
      footnoteDefinitions: new Map(),
      footnoteOrder: [],
      headings: [],
      labels: new Map(),
      duplicateLabels: new Set(),
      usedIds: new Map(),
      counters: { fig: 0, tbl: 0, eq: 0, lst: 0, example: 0 },
      exampleLabels: new Map(),
      blockPlugins: [...this.blockPlugins, ...(merged.blockPlugins ?? [])],
      renderMath: (latex, displayMode) => this.renderMath(latex, displayMode),
      renderMermaid: code => this.renderMermaid(code),
      highlightCode: (code, lang) => highlightCode(code, lang),
    };
  }

  render(markdown: string, options?: MarkdownRenderOptions & SuperMarkdownOptions): string {
    const context = this.createContext(options);
    const metadata = extractMetadata(toLines(markdown, null));
    for (const entry of metadata.entries) {
      context.metadata.set(metadataKey(entry.key), entry.value);
    }

    const documentPath = context.options.documentPath ?? null;
    const lines = expandIncludes(metadata.remaining, documentPath, documentPath === null ? [] : [documentPath], context);
    context.execute = (context.metadata.get('execute') ?? '').toLowerCase() === 'true';
    collectDefinitions(lines, context);

    const header = context.options.enableFrontmatter === false ? '' : renderMetadata(metadata.entries);
    const body = renderBlocks(lines, context);
    const footnotes = renderFootnotes(context);
    return resolvePlaceholders(header + body + footnotes, context);
  }

  renderInline(markdown: string, options?: MarkdownRenderOptions & SuperMarkdownOptions): string {
    const context = this.createContext(options);
    return resolvePlaceholders(parseInline(markdown.replace(/[]/g, ''), context), context);
  }

  renderMath(latex: string, displayMode: boolean): string {
    return renderMathWithPlugin(latex, displayMode);
  }

  renderMermaid(code: string): string {
    return renderMermaidToSvg(code);
  }
}
