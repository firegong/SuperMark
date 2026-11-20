import { sanitizeHtml } from '../../core/htmlSanitizer';
import { blockAttributes, codeBlockHtml, taskCheckboxHtml } from '../../previewMarkup';
import { escapeHtml } from '../../utils';
import {
  headingId,
  maxNestingDepth,
  safeClasses,
  safeId,
  splitTrailingAttributes,
  group,
  type GsyncAttributes,
  type GsyncContext,
  type GsyncLine,
} from './context';
import { InlineRenderer } from './inline';
import { isTableStart, TableRenderer } from './tables';

/**
 * gsync block syntax (§4), tried in its priority order: blank line → HTML comment → fenced code
 * → container / `???` → ATX heading → horizontal rule → blockquote → lists → `Table:` caption →
 * GFM table → raw HTML block → paragraph. Definition lists, footnotes and math blocks are
 * recognised before paragraphs.
 */

const fenceOpen = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const atxHeading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const horizontalRule = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const blockquote = /^ {0,3}>/;
const bulletItem = /^( *)([-*+])[ \t]+(.*)$/;
const orderedItem = /^( *)(\d{1,9})\.[ \t]+(.*)$/;
const containerOpen = /^ {0,3}:::[ \t]*([A-Za-z][\w-]*)(.*)$/;
const containerClose = /^ {0,3}:::[ \t]*$/;
const collapsibleOpen = /^(\?\?\?\+?)(?:[ \t]+(.*))?$/;
const tableCaptionLine = /^Table:[ \t]*(.*)$/;
const htmlBlockStart = /^ {0,3}<\/?(?:div|table|pre|p|ul|ol|dl|details|summary|section|figure|figcaption|header|footer|nav|article|aside|main|blockquote|center|h[1-6]|hr)(?=[\s>/]|$)/i;
const commentStart = /^ {0,3}<!--/;
const footnoteDefinition = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const definitionLine = /^[:~][ \t]+(.*)$/;
const mathFence = /^ {0,3}\$\$[ \t]*$/;
const mathLine = /^ {0,3}\$\$(.+)\$\$[ \t]*$/;

const diagramLanguages = new Set(['plantuml', 'puml', 'dot', 'graphviz']);
const alertTypes = new Set(['note', 'tip', 'important', 'warning', 'caution']);
const bulletMarkers = ['disc', 'circle', 'square', 'hollow-square'];
const orderedTypes = ['A', 'a', 'I', 'i'];

function isBlank(line: GsyncLine | undefined): boolean {
  return line !== undefined && line.notice === undefined && line.rawHtml !== true && line.text.trim() === '';
}

function attributeHtml(attributes: GsyncAttributes | null): string {
  const id = safeId(attributes?.id ?? null);
  return id === null ? '' : ` id="${escapeHtml(id)}"`;
}

function extraClasses(attributes: GsyncAttributes | null): string {
  return safeClasses(attributes?.classes ?? []).join(' ');
}

interface ListEntry {
  indent: number;
  ordered: boolean;
  number: number;
  text: string;
  line: number;
}

export class BlockRenderer {
  readonly inline: InlineRenderer;
  private readonly tables: TableRenderer;

  constructor(private readonly context: GsyncContext) {
    this.inline = new InlineRenderer(context);
    this.tables = new TableRenderer(this.inline);
  }

  /**
   * First pass: headings (so `@ref(id)` shows heading text anywhere in the document) and
   * footnote definitions (so references before their definition work).
   */
  collectReferences(lines: GsyncLine[]): void {
    const seen = new Map<string, number>();
    let fence: string | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const open = fenceOpen.exec(line.text);
      if (fence !== null) {
        if (open !== null && open[2][0] === fence[0] && open[2].length >= fence.length && open[3].trim() === '') {
          fence = null;
        }
        continue;
      }
      if (open !== null) {
        fence = open[2];
        continue;
      }
      const heading = atxHeading.exec(line.text);
      if (heading !== null) {
        const { id, text } = this.headingParts(group(heading, 2) ?? '', seen);
        this.context.headingTexts.set(id, text);
        continue;
      }
      const footnote = footnoteDefinition.exec(line.text);
      if (footnote !== null && !this.context.footnoteDefinitions.has(footnote[1])) {
        const body: GsyncLine[] = [{ text: footnote[2], line: line.line }];
        while (index + 1 < lines.length && !isBlank(lines[index + 1]) && !footnoteDefinition.test(lines[index + 1].text)) {
          index += 1;
          body.push(lines[index]);
        }
        this.context.footnoteDefinitions.set(footnote[1], body);
      }
    }
  }

  private headingParts(raw: string, used: Map<string, number>): { id: string; text: string; attributes: GsyncAttributes | null } {
    const withoutClosing = raw.replace(/(?:^|[ \t]+)#+[ \t]*$/, '');
    const { text, attributes } = splitTrailingAttributes(withoutClosing);
    const base = safeId(attributes?.id ?? null) ?? headingId(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return { id: count === 0 ? base : `${base}-${count}`, text: text.trim(), attributes };
  }

  render(lines: GsyncLine[]): string {
    if (this.context.depth >= maxNestingDepth) {
      return `<p>${escapeHtml(lines.map(line => line.text).join('\n'))}</p>`;
    }
    this.context.depth += 1;
    try {
      return this.renderBlocks(lines);
    } finally {
      this.context.depth -= 1;
    }
  }

  private renderBlocks(lines: GsyncLine[]): string {
    let html = '';
    let index = 0;
    let pendingCaption: string | null = null;

    while (index < lines.length) {
      const line = lines[index];
      const text = line.text;

      if (line.notice !== undefined) {
        html += `<div ${blockAttributes(line.line, 'msm-notice')}>${escapeHtml(line.notice)}</div>`;
        index += 1;
        continue;
      }
      if (line.rawHtml === true) {
        html += `<div ${blockAttributes(line.line)}>${sanitizeHtml(text)}</div>`;
        index += 1;
        continue;
      }
      if (text.trim() === '') {
        index += 1;
        continue;
      }

      if (commentStart.test(text)) {
        const end = this.commentEnd(lines, index);
        const comment = lines.slice(index, end + 1).map(entry => entry.text).join('\n');
        const caption = /^\s*<!--\s*table\s+title\s*=\s*(["'])(.*?)\1\s*-->\s*$/i.exec(comment);
        // Comments do not show; a table title applies to the table right below.
        pendingCaption = caption === null ? pendingCaption : caption[2];
        index = end + 1;
        continue;
      }

      const fence = fenceOpen.exec(text);
      if (fence !== null && !(fence[2][0] === '`' && fence[3].includes('`'))) {
        const result = this.fencedCode(lines, index, fence);
        html += result.html;
        index += result.consumed;
        continue;
      }

      if (mathFence.test(text) || mathLine.test(text)) {
        const result = this.mathBlock(lines, index);
        html += result.html;
        index += result.consumed;
        continue;
      }

      const container = containerOpen.exec(text);
      if (container !== null) {
        const result = this.container(lines, index, container);
        html += result.html;
        index += result.consumed;
        continue;
      }

      const collapsible = collapsibleOpen.exec(text);
      if (collapsible !== null) {
        const result = this.collapsible(lines, index, collapsible);
        html += result.html;
        index += result.consumed;
        continue;
      }

      const heading = atxHeading.exec(text);
      if (heading !== null) {
        html += this.heading(line, heading[1].length, group(heading, 2) ?? '');
        index += 1;
        continue;
      }

      if (horizontalRule.test(text)) {
        html += `<hr ${blockAttributes(line.line)}>`;
        index += 1;
        continue;
      }

      if (blockquote.test(text)) {
        const result = this.blockquote(lines, index);
        html += result.html;
        index += result.consumed;
        continue;
      }

      if (bulletItem.test(text) || orderedItem.test(text)) {
        const result = this.list(lines, index);
        html += result.html;
        index += result.consumed;
        continue;
      }

      const captionLine = tableCaptionLine.exec(text);
      if (captionLine !== null) {
        let next = index + 1;
        while (next < lines.length && isBlank(lines[next])) {
          next += 1;
        }
        if (next < lines.length && isTableStart(lines, next)) {
          // A comment title takes precedence over a `Table:` line (§4.7.1).
          pendingCaption ??= captionLine[1].trim();
          index = next;
          continue;
        }
      }

      if (isTableStart(lines, index)) {
        const result = this.tables.render(lines, index, pendingCaption);
        pendingCaption = null;
        html += result.html;
        index += result.consumed;
        continue;
      }

      if (htmlBlockStart.test(text)) {
        let end = index;
        while (end + 1 < lines.length && !isBlank(lines[end + 1])) {
          end += 1;
        }
        html += `<div ${blockAttributes(line.line)}>${sanitizeHtml(lines.slice(index, end + 1).map(entry => entry.text).join('\n'))}</div>`;
        index = end + 1;
        continue;
      }

      const footnote = footnoteDefinition.exec(text);
      if (footnote !== null) {
        let end = index;
        while (end + 1 < lines.length && !isBlank(lines[end + 1]) && !footnoteDefinition.test(lines[end + 1].text)) {
          end += 1;
        }
        const body = [{ text: footnote[2], line: line.line }, ...lines.slice(index + 1, end + 1)];
        if (!this.context.footnoteDefinitions.has(footnote[1])) {
          this.context.footnoteDefinitions.set(footnote[1], body);
        }
        index = end + 1;
        continue;
      }

      const definitions = this.definitionList(lines, index);
      if (definitions !== null) {
        html += definitions.html;
        index += definitions.consumed;
        continue;
      }

      const paragraph = this.paragraph(lines, index);
      html += paragraph.html;
      index += Math.max(1, paragraph.consumed);
    }

    return html;
  }

  private commentEnd(lines: GsyncLine[], index: number): number {
    for (let cursor = index; cursor < lines.length; cursor += 1) {
      const text = cursor === index ? lines[cursor].text.replace(/^\s*<!--/, '') : lines[cursor].text;
      if (text.includes('-->')) {
        return cursor;
      }
    }
    return lines.length - 1;
  }

  /** `` ```lang key="value" {attrs}`` (§4.5); diagrams become images (§9.1). */
  private fencedCode(lines: GsyncLine[], index: number, fence: RegExpExecArray): { html: string; consumed: number } {
    const indent = fence[1].length;
    const marker = fence[2];
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const closing = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(lines[cursor].text);
      if (closing !== null && closing[2][0] === marker[0] && closing[2].length >= marker.length) {
        cursor += 1;
        break;
      }
      body.push(lines[cursor].text.replace(new RegExp(`^ {0,${indent}}`), ''));
      cursor += 1;
    }

    const { text: infoWithoutAttributes, attributes } = splitTrailingAttributes(fence[3].trim());
    // `c{title="…"}` (MPE style) puts the braces right after the language.
    const glued = /^([^\s{]+)\{([^{}]*)\}(.*)$/.exec(fence[3].trim());
    const info = glued === null ? infoWithoutAttributes : `${glued[1]} ${glued[2]} ${glued[3]}`;
    const lang = /^([^\s{]+)/.exec(info.trim())?.[1] ?? '';
    const meta = new Map<string, string>();
    for (const pair of info.matchAll(/([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/g)) {
      meta.set(pair[1].toLowerCase(), group(pair, 2) ?? group(pair, 3) ?? group(pair, 4) ?? '');
    }
    for (const [key, value] of attributes?.values ?? []) {
      meta.set(key, value);
    }
    const title = meta.get('title') ?? null;
    const code = body.join('\n');
    const line = lines[index].line;

    if (diagramLanguages.has(lang.toLowerCase())) {
      const diagram = this.context.hooks.renderDiagram(lang, code);
      if (diagram !== null) {
        const caption = title === null ? '' : `<p class="gsync-figure-caption"><em>${this.inline.render(title)}</em></p>`;
        return { html: `<div ${blockAttributes(line, 'gsync-diagram')}>${diagram}${caption}</div>`, consumed: cursor - index };
      }
    }

    const highlighted = lang === '' ? escapeHtml(code) : this.context.hooks.highlightCode(code, lang);
    const titleHtml = title === null ? '' : `<div class="gsync-code-title">${this.inline.render(title)}</div>`;
    const titleAttribute = title === null ? '' : ` data-title="${escapeHtml(title)}"`;
    return {
      html: `<div ${blockAttributes(line, extraClasses(attributes))}${titleAttribute}${attributeHtml(attributes)}>${titleHtml}${codeBlockHtml(highlighted, lang)}</div>`,
      consumed: cursor - index,
    };
  }

  /** `$$` … `$$` on their own lines, or `$$…$$` alone on a line (§7). */
  private mathBlock(lines: GsyncLine[], index: number): { html: string; consumed: number } {
    const line = lines[index];
    const single = mathLine.exec(line.text);
    if (single !== null) {
      return { html: `<div ${blockAttributes(line.line)}>${this.context.hooks.renderMath(single[1], true)}</div>`, consumed: 1 };
    }
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !mathFence.test(lines[cursor].text)) {
      body.push(lines[cursor].text);
      cursor += 1;
    }
    const consumed = Math.min(lines.length, cursor + 1) - index;
    return { html: `<div ${blockAttributes(line.line)}>${this.context.hooks.renderMath(body.join('\n'), true)}</div>`, consumed };
  }

  /** `::: type [title] [{attrs}]` … `:::`, nested; `code-tabs` splits at `@tab` (§4.9). */
  private container(lines: GsyncLine[], index: number, open: RegExpExecArray): { html: string; consumed: number } {
    let depth = 1;
    let cursor = index + 1;
    let fence: string | null = null;
    while (cursor < lines.length) {
      const text = lines[cursor].text;
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (fence !== null) {
        if (fenceMatch !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && text.trim() === fenceMatch[1]) {
          fence = null;
        }
      } else if (fenceMatch !== null) {
        fence = fenceMatch[1];
      } else if (containerOpen.test(text)) {
        depth += 1;
      } else if (containerClose.test(text)) {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
      cursor += 1;
    }
    const inner = lines.slice(index + 1, cursor);
    const consumed = Math.min(lines.length, cursor + 1) - index;
    const type = open[1].toLowerCase();
    const { text: titleText, attributes } = splitTrailingAttributes(open[2].trim());
    const title = titleText.trim();
    const line = lines[index].line;

    if (type === 'code-tabs') {
      return { html: this.codeTabs(inner, line), consumed };
    }

    const classes = ['container', `container-${type.replace(/[^\w-]/g, '')}`, extraClasses(attributes)].filter(name => name !== '').join(' ');
    const titleHtml = title === '' ? '' : `<div class="container-title">${this.inline.render(title)}</div>`;
    return {
      html: `<div ${blockAttributes(line, classes)}${attributeHtml(attributes)}>${titleHtml}${this.render(inner)}</div>`,
      consumed,
    };
  }

  private codeTabs(inner: GsyncLine[], line: number): string {
    const tabs: { title: string; lines: GsyncLine[] }[] = [];
    let fence: string | null = null;
    for (const entry of inner) {
      const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(entry.text);
      if (fence === null) {
        const tab = /^@tab[ \t]+(.*)$/.exec(entry.text);
        if (tab !== null) {
          tabs.push({ title: tab[1].trim(), lines: [] });
          continue;
        }
        if (fenceMatch !== null) {
          fence = fenceMatch[1];
        }
      } else if (fenceMatch !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && entry.text.trim() === fenceMatch[1]) {
        fence = null;
      }
      if (tabs.length === 0) {
        tabs.push({ title: 'Tab 1', lines: [] });
      }
      tabs[tabs.length - 1].lines.push(entry);
    }
    const buttons = tabs.map((tab, i) => `<button type="button" class="msm-tab-button${i === 0 ? ' is-active' : ''}" data-tab="${i}" role="tab">${this.inline.render(tab.title)}</button>`).join('');
    const panels = tabs.map((tab, i) => `<div class="msm-tab-panel${i === 0 ? ' is-active' : ''}" data-tab="${i}" role="tabpanel">${this.render(tab.lines)}</div>`).join('');
    return `<div ${blockAttributes(line, 'msm-tabset container container-code-tabs')}><div class="msm-tab-list" role="tablist">${buttons}</div>${panels}</div>`;
  }

  /** `??? [type] "title"` with content indented by 4 spaces or a tab (§4.10). */
  private collapsible(lines: GsyncLine[], index: number, open: RegExpExecArray): { html: string; consumed: number } {
    const header = (group(open, 2) ?? '').trim();
    const titleMatch = /"([^"]*)"\s*$/.exec(header);
    const type = (titleMatch === null ? header : header.slice(0, titleMatch.index)).trim().split(/\s+/)[0] || 'details';
    const title = titleMatch === null ? type : titleMatch[1];

    const body: GsyncLine[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const text = lines[cursor].text;
      if (/^(?: {4}|\t)/.test(text)) {
        body.push({ ...lines[cursor], text: text.replace(/^(?: {4}|\t)/, '') });
        cursor += 1;
      } else if (text.trim() === '' && cursor + 1 < lines.length && /^(?: {4}|\t)/.test(lines[cursor + 1].text)) {
        body.push({ ...lines[cursor], text: '' });
        cursor += 1;
      } else {
        break;
      }
    }
    const safeType = type.toLowerCase().replace(/[^\w-]/g, '') || 'details';
    return {
      html: `<details ${blockAttributes(lines[index].line, `admonition admonition-${safeType}`)}><summary>${this.inline.render(title)}</summary>${this.render(body)}</details>`,
      consumed: cursor - index,
    };
  }

  /** ATX heading with optional `{#id .class}` (§3); ids keep Hangul and are unique. */
  private heading(line: GsyncLine, level: number, raw: string): string {
    const { id, text, attributes } = this.headingParts(raw, this.context.headingIds);
    const classes = ['markedit-preview-heading', ...safeClasses(attributes?.classes ?? [])].join(' ');
    const safe = escapeHtml(id);
    return `<div ${blockAttributes(line.line)}><h${level} id="${safe}" class="${escapeHtml(classes)}" data-heading-level="${level}"><a class="markedit-preview-anchor" href="#${safe}" aria-hidden="true">#</a>${this.inline.render(text)}</h${level}></div>`;
  }

  /** `>` lines with lazy continuation; a blank line ends it; `[!TYPE]` makes an alert (§4.3, §8). */
  private blockquote(lines: GsyncLine[], index: number): { html: string; consumed: number } {
    const inner: GsyncLine[] = [];
    let cursor = index;
    while (cursor < lines.length && !isBlank(lines[cursor]) && lines[cursor].notice === undefined && lines[cursor].rawHtml !== true) {
      const text = lines[cursor].text;
      inner.push({ ...lines[cursor], text: blockquote.test(text) ? text.replace(/^ {0,3}> ?/, '') : text });
      cursor += 1;
    }
    const line = lines[index].line;
    const alert = /^\[!\s*([A-Za-z]+)\s*\][ \t]*(.*)$/.exec(inner[0]?.text ?? '');
    if (alert !== null && alertTypes.has(alert[1].toLowerCase())) {
      const type = alert[1].toLowerCase();
      const rest = alert[2].trim();
      // The text after the marker stays as the first line of the body (§8).
      const body = rest === '' ? inner.slice(1) : [{ ...inner[0], text: rest }, ...inner.slice(1)];
      return {
        html: `<div ${blockAttributes(line)}><div class="markedit-preview-alert is-${type} gh-alert gh-alert-${type}"><div class="markedit-preview-alert-title">${alert[1].toUpperCase()}</div><div class="markedit-preview-alert-content">${this.render(body)}</div></div></div>`,
        consumed: cursor - index,
      };
    }
    return {
      html: `<div ${blockAttributes(line)}><blockquote class="markedit-preview-blockquote">${this.render(inner)}</blockquote></div>`,
      consumed: cursor - index,
    };
  }

  /** Lists (§4.4): nesting by indentation, no blocks inside items, a blank line ends the list. */
  private list(lines: GsyncLine[], index: number): { html: string; consumed: number } {
    const entries: ListEntry[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const text = line.text;
      if (isBlank(line) || line.notice !== undefined || line.rawHtml === true) {
        break;
      }
      const bullet = bulletItem.exec(text);
      const ordered = orderedItem.exec(text);
      if (horizontalRule.test(text) && bullet !== null) {
        break;
      }
      if (bullet !== null || ordered !== null) {
        const match = (bullet ?? ordered) as RegExpExecArray;
        entries.push({ indent: match[1].length, ordered: ordered !== null && bullet === null, number: ordered === null ? 1 : Number(ordered[2]), text: match[3], line: line.line });
        cursor += 1;
        continue;
      }
      const last = entries.at(-1);
      const indent = /^ */.exec(text)?.[0].length ?? 0;
      const startsBlock = fenceOpen.test(text) || atxHeading.test(text) || blockquote.test(text) || containerOpen.test(text) || htmlBlockStart.test(text) || commentStart.test(text);
      if (last !== undefined && indent > last.indent && !startsBlock) {
        // A line indented under the item continues it.
        last.text += `\n${text.trim()}`;
        cursor += 1;
        continue;
      }
      break;
    }
    return { html: this.listLevel(entries, 0, 0).html, consumed: cursor - index };
  }

  private listLevel(entries: ListEntry[], start: number, depth: number): { html: string; next: number } {
    let html = '';
    let index = start;
    const indent = entries[start].indent;
    while (index < entries.length && entries[index].indent >= indent) {
      // One list of the same kind at this indentation.
      const ordered = entries[index].ordered;
      const tag = ordered ? 'ol' : 'ul';
      const hasTask = entries.some(entry => /^\[[ xX]\](?:[ \t]|$)/.test(entry.text));
      const attributes = ordered
        ? `${entries[index].number !== 1 ? ` start="${entries[index].number}"` : ''}${depth > 0 ? ` type="${orderedTypes[(depth - 1) % orderedTypes.length]}"` : ''}`
        : ` data-marker="${bulletMarkers[depth % bulletMarkers.length]}"`;
      let items = '';
      while (index < entries.length && entries[index].indent === indent && entries[index].ordered === ordered) {
        const entry = entries[index];
        index += 1;
        let children = '';
        if (index < entries.length && entries[index].indent > indent) {
          const nested = depth + 1 >= maxNestingDepth ? null : this.listLevel(entries, index, depth + 1);
          if (nested === null) {
            while (index < entries.length && entries[index].indent > indent) {
              children += `<br>${escapeHtml(entries[index].text)}`;
              index += 1;
            }
          } else {
            children = nested.html;
            index = nested.next;
          }
        }
        const task = /^\[([ xX])\](?:[ \t]+([^]*))?$/.exec(entry.text);
        const content = task === null ? entry.text : group(task, 2) ?? '';
        const checkbox = task === null ? '' : taskCheckboxHtml(entry.line, task[1] !== ' ');
        const inline = this.inline.render(content).replace(/\n/g, '<br>');
        items += `<li ${blockAttributes(entry.line, task === null ? '' : 'markedit-preview-task-item')}>${checkbox}${inline}${children}</li>`;
      }
      const listClass = hasTask ? 'markedit-preview-list markedit-preview-task-list' : 'markedit-preview-list';
      html += `<${tag} class="${listClass}"${attributes}>${items}</${tag}>`;
    }
    return { html, next: index };
  }

  /** `Term` then `: definition` / `~ definition` (one blank line allowed), §4.11. */
  private definitionList(lines: GsyncLine[], index: number): { html: string; consumed: number } | null {
    const definitionAt = (cursor: number) => {
      if (cursor < lines.length && definitionLine.test(lines[cursor].text)) {
        return cursor;
      }
      return isBlank(lines[cursor]) && cursor + 1 < lines.length && definitionLine.test(lines[cursor + 1].text) ? cursor + 1 : -1;
    };
    if (definitionAt(index + 1) === -1) {
      return null;
    }
    let html = '';
    let cursor = index;
    while (cursor < lines.length && !isBlank(lines[cursor])) {
      const first = definitionAt(cursor + 1);
      if (definitionLine.test(lines[cursor].text) || first === -1) {
        break;
      }
      html += `<dt>${this.inline.render(lines[cursor].text.trim())}</dt>`;
      cursor = first;
      while (cursor < lines.length && definitionLine.test(lines[cursor].text)) {
        html += `<dd>${this.inline.render((definitionLine.exec(lines[cursor].text) as RegExpExecArray)[1])}</dd>`;
        cursor += 1;
      }
      if (isBlank(lines[cursor]) && cursor + 2 < lines.length && definitionLine.test(lines[cursor + 2].text)) {
        cursor += 1;
      }
    }
    return { html: `<dl ${blockAttributes(lines[index].line, 'gsync-definitions')}>${html}</dl>`, consumed: Math.max(1, cursor - index) };
  }

  /** Lines until a blank line or another block; every line break is `<br>` (§4.1). */
  private paragraph(lines: GsyncLine[], index: number): { html: string; consumed: number } {
    const content: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const text = line.text;
      if (isBlank(line) || line.notice !== undefined || line.rawHtml === true) {
        break;
      }
      if (cursor > index && (
        fenceOpen.test(text) || atxHeading.test(text) || horizontalRule.test(text) || blockquote.test(text)
        || bulletItem.test(text) || orderedItem.test(text) || containerOpen.test(text) || collapsibleOpen.test(text)
        || commentStart.test(text) || htmlBlockStart.test(text) || isTableStart(lines, cursor) || mathFence.test(text)
      )) {
        break;
      }
      content.push(text.replace(/(?: {2,}|\\)$/, '').trim());
      cursor += 1;
    }
    if (content.length === 0) {
      content.push(lines[index].text);
      cursor = index + 1;
    }

    // `{…}` at the end belongs to the paragraph, unless it follows a link or image `)` (§4.1).
    let source = content.join('\n');
    let attributes: GsyncAttributes | null = null;
    const trailing = /[ \t]*\{([^{}]*)\}$/.exec(source);
    if (trailing !== null && source[trailing.index - 1] !== ')') {
      attributes = splitTrailingAttributes(source).attributes;
      source = source.slice(0, trailing.index);
    }
    const inline = this.inline.render(source).replace(/\n/g, '<br>');
    return {
      html: `<p ${blockAttributes(lines[index].line, extraClasses(attributes))}${attributeHtml(attributes)}>${inline}</p>`,
      consumed: cursor - index,
    };
  }

  /** Footnotes collected from `[^id]: text` paragraphs, in order of first reference (§4.12). */
  footnotes(): string {
    if (this.context.footnoteOrder.length === 0) {
      return '';
    }
    let items = '';
    for (let index = 0; index < this.context.footnoteOrder.length; index += 1) {
      const id = this.context.footnoteOrder[index];
      const body = this.context.footnoteDefinitions.get(id) ?? [];
      const safe = escapeHtml(id);
      const content = this.inline.render(body.map(line => line.text).join('\n')).replace(/\n/g, '<br>');
      items += `<li id="fn-${safe}" ${blockAttributes(body[0]?.line ?? 0)}>${content} <a href="#fnref-${safe}" class="markedit-preview-footnote-back" aria-label="Back to reference">↩</a></li>`;
    }
    return `<section class="markedit-preview-footnotes"><hr><ol>${items}</ol></section>`;
  }
}
