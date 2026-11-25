import { filterHtmlTag, htmlTagPattern } from '../../core/htmlSanitizer';
import { escapeHtml, isUnsafeUrl } from '../../utils';
import { group, headingId, parseAttributes, safeClasses, safeSize, type GmarkdownAttributes, type GmarkdownContext } from './context';

/**
 * gmarkdown inline syntax (§5), in its processing order: code, escapes, images, links, wiki links,
 * `@ref`, strikethrough, bold italic, bold, italic, autolinks, bare URLs, e-mail addresses and
 * typography. Constructs that later steps must not touch are replaced by placeholders first.
 *
 * Every search for a closing marker is bounded, so pathological input (thousands of `[` or `*`)
 * stays linear.
 */

const placeholderOpen = '';
const placeholderClose = '';
const placeholderPattern = /(\d+)/g;

/** How far to look for a closing marker (`]`, `)`, `` ` ``, `$`). */
const maxSpan = 2000;

const htmlTagSticky = new RegExp(htmlTagPattern.source.replace(/^\^/, ''), 'y');
const emailSticky = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/y;
const urlSticky = /https?:\/\/[^\s<>"]+/y;

const asciiPunctuation = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}_]/u.test(char);
}

/** Index of the `]` that closes the `[` at `open`, or -1 (bounded, nested brackets counted). */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  const end = Math.min(text.length, open + maxSpan);
  for (let index = open; index < end; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    } else if (char === '\n' && text[index + 1] === '\n') {
      return -1;
    }
  }
  return -1;
}

/** `(url "title")` at `start`: the destination, title and the index after `)`. */
function linkDestination(text: string, start: number): { url: string; title: string | null; end: number } | null {
  if (text[start] !== '(') {
    return null;
  }
  const close = text.indexOf(')', start);
  if (close === -1 || close - start > maxSpan) {
    return null;
  }
  const inner = text.slice(start + 1, close).trim();
  const match = /^<?([^\s>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?$/.exec(inner);
  if (match === null) {
    return null;
  }
  return { url: match[1], title: group(match, 2) ?? group(match, 3) ?? null, end: close + 1 };
}

/** `{…}` right after a link or image. */
function trailingAttributes(text: string, start: number): { attributes: GmarkdownAttributes; end: number } | null {
  if (text[start] !== '{') {
    return null;
  }
  const close = text.indexOf('}', start);
  if (close === -1 || close - start > maxSpan || text.slice(start, close).includes('\n')) {
    return null;
  }
  return { attributes: parseAttributes(text.slice(start + 1, close)), end: close + 1 };
}

function attributeHtml(attributes: GmarkdownAttributes | null, baseClass = ''): string {
  const classes = [baseClass, ...safeClasses(attributes?.classes ?? [])].filter(name => name !== '');
  const id = attributes?.id;
  let html = classes.length > 0 ? ` class="${escapeHtml(classes.join(' '))}"` : '';
  if (id !== null && id !== undefined && /^[^\s"'<>&]+$/.test(id)) {
    html += ` id="${escapeHtml(id)}"`;
  }
  return html;
}

function isSafeImageUrl(url: string): boolean {
  // Embedded images (§5.1) are allowed; an <img> cannot run script.
  return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url.trim()) || !isUnsafeUrl(url);
}

/** `[[page]]` → `page.md` (in the app, so the link opens the document), `#anchor` → heading id. */
function wikiHref(target: string): string {
  const [page, ...anchorParts] = target.split('#');
  const anchor = anchorParts.join('#').trim();
  const pagePart = page.trim();
  const file = pagePart === '' ? '' : /[/.]/.test(pagePart) ? pagePart : `${pagePart}.md`;
  return `${encodeURI(file)}${anchor === '' ? '' : `#${headingId(anchor)}`}`;
}

export class InlineRenderer {
  private placeholders: string[] = [];

  constructor(private readonly context: GmarkdownContext) {}

  render(text: string): string {
    const saved = this.placeholders;
    this.placeholders = [];
    try {
      return this.renderProtected(text.replace(/[]/g, ''));
    } finally {
      this.placeholders = saved;
    }
  }

  private put(html: string): string {
    this.placeholders.push(html);
    return `${placeholderOpen}${this.placeholders.length - 1}${placeholderClose}`;
  }

  private restore(html: string): string {
    let result = html;
    // Placeholders inside stored HTML (nested constructs) are restored too.
    for (let pass = 0; pass < 4 && result.includes(placeholderOpen); pass += 1) {
      result = result.replace(placeholderPattern, (_match, index: string) => this.placeholders[Number(index)] ?? '');
    }
    return result;
  }

  private renderProtected(text: string): string {
    let out = '';
    let index = 0;
    while (index < text.length) {
      const char = text[index];
      const next = text[index + 1];
      const consumed = this.tryConstruct(text, index, char, next);
      if (consumed !== null) {
        out += consumed.html;
        index = consumed.end;
      } else {
        out += char;
        index += 1;
      }
    }
    return this.restore(this.decorate(escapeHtml(out)));
  }

  private tryConstruct(text: string, index: number, char: string, next: string | undefined): { html: string; end: number } | null {
    switch (char) {
      case '`':
        return this.codeSpan(text, index);
      case '\\':
        if (next === '\n') {
          return { html: this.put('<br>'), end: index + 1 };
        }
        if (next !== undefined && asciiPunctuation.includes(next)) {
          return { html: this.put(escapeHtml(next)), end: index + 2 };
        }
        return null;
      case '$':
        return this.math(text, index);
      case '!':
        return next === '[' ? this.image(text, index) : null;
      case '[':
        if (next === '[') {
          return this.wikiLink(text, index);
        }
        if (next === '^') {
          return this.footnoteReference(text, index);
        }
        return this.link(text, index);
      case '@':
        return this.crossReference(text, index);
      case '<':
        return this.angle(text, index);
      case '&': {
        const entity = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/iy;
        entity.lastIndex = index;
        const match = entity.exec(text);
        return match === null ? null : { html: this.put(match[0]), end: index + match[0].length };
      }
      default:
        return isWordChar(text[index - 1]) ? null : this.bareLink(text, index);
    }
  }

  private codeSpan(text: string, index: number): { html: string; end: number } {
    let run = 1;
    while (text[index + run] === '`') {
      run += 1;
    }
    const fence = '`'.repeat(run);
    const close = text.indexOf(fence, index + run);
    if (close === -1 || close - index > maxSpan || text[close + run] === '`') {
      // No matching run: the backticks are text.
      return { html: this.put(escapeHtml(fence)), end: index + run };
    }
    let code = text.slice(index + run, close).replace(/\n/g, ' ');
    if (/^ .* $/.test(code) && code.trim() !== '') {
      code = code.slice(1, -1);
    }
    return { html: this.put(`<code class="markedit-preview-code">${escapeHtml(code)}</code>`), end: close + run };
  }

  /** `$…$` and one-line `$$…$$` (§7); protected so `*` and `_` inside are not emphasis. */
  private math(text: string, index: number): { html: string; end: number } | null {
    const display = text[index + 1] === '$';
    const marker = display ? '$$' : '$';
    const start = index + marker.length;
    const lineEnd = text.indexOf('\n', start);
    const limit = Math.min(lineEnd === -1 ? text.length : lineEnd, start + maxSpan);
    const close = text.indexOf(marker, start);
    if (close === -1 || close >= limit) {
      return null;
    }
    const latex = text.slice(start, close);
    if (latex.trim() === '' || (!display && (/^\s|\s$/.test(latex)))) {
      return null;
    }
    return { html: this.put(this.context.hooks.renderMath(latex, display)), end: close + marker.length };
  }

  private image(text: string, index: number): { html: string; end: number } | null {
    const close = closingBracket(text, index + 1);
    if (close === -1) {
      return null;
    }
    const destination = linkDestination(text, close + 1);
    if (destination === null) {
      return null;
    }
    const alt = text.slice(index + 2, close);
    const extra = trailingAttributes(text, destination.end);
    const attributes = extra?.attributes ?? null;
    const end = extra?.end ?? destination.end;
    if (!isSafeImageUrl(destination.url)) {
      return { html: this.put(escapeHtml(alt)), end };
    }
    const title = destination.title ?? attributes?.values.get('caption') ?? null;
    const width = safeSize(attributes?.values.get('width'));
    let html = `<img src="${escapeHtml(destination.url)}" alt="${escapeHtml(alt)}"${attributeHtml(attributes, 'markedit-preview-image')}`;
    if (title !== null && title !== '') {
      html += ` title="${escapeHtml(title)}"`;
    }
    if (width !== null) {
      html += ` style="width: ${escapeHtml(width)}; max-width: 100%"`;
    }
    return { html: this.put(`${html}>`), end };
  }

  private link(text: string, index: number): { html: string; end: number } | null {
    const close = closingBracket(text, index);
    if (close === -1) {
      return null;
    }
    const destination = linkDestination(text, close + 1);
    if (destination === null) {
      // Reference-style links are not supported (§5.2): the brackets stay text.
      return null;
    }
    const label = this.render(text.slice(index + 1, close));
    const extra = trailingAttributes(text, destination.end);
    const end = extra?.end ?? destination.end;
    if (isUnsafeUrl(destination.url)) {
      return { html: this.put(label), end };
    }
    const title = destination.title === null ? '' : ` title="${escapeHtml(destination.title)}"`;
    return { html: this.put(`<a href="${escapeHtml(destination.url)}"${title}${attributeHtml(extra?.attributes ?? null)}>${label}</a>`), end };
  }

  /** `[[target]]`, `[[target#anchor]]`, `[[target|Label]]` (§5.3); `[[toc]]` stays text. */
  private wikiLink(text: string, index: number): { html: string; end: number } | null {
    const close = text.indexOf(']]', index + 2);
    if (close === -1 || close - index > maxSpan) {
      return null;
    }
    const inner = text.slice(index + 2, close);
    if (inner.includes('\n') || inner.trim() === '' || inner.trim().toLowerCase() === 'toc') {
      return null;
    }
    const [target, ...labelParts] = inner.split('|');
    const label = labelParts.length > 0 ? labelParts.join('|') : target;
    return {
      html: this.put(`<a href="${escapeHtml(wikiHref(target))}" class="wiki-link">${escapeHtml(label.trim())}</a>`),
      end: close + 2,
    };
  }

  private footnoteReference(text: string, index: number): { html: string; end: number } | null {
    const match = /\[\^([^\]\s]+)\]/y;
    match.lastIndex = index;
    const found = match.exec(text);
    if (found === null || !this.context.footnoteDefinitions.has(found[1])) {
      return null;
    }
    const id = found[1];
    let number = this.context.footnoteOrder.indexOf(id);
    if (number === -1) {
      this.context.footnoteOrder.push(id);
      number = this.context.footnoteOrder.length - 1;
    }
    const safe = escapeHtml(id);
    return {
      html: this.put(`<sup class="markedit-preview-footnote-ref"><a href="#fn-${safe}" id="fnref-${safe}">${number + 1}</a></sup>`),
      end: index + found[0].length,
    };
  }

  /** `@ref(id)` → a link to the heading (§5.3). */
  private crossReference(text: string, index: number): { html: string; end: number } | null {
    const match = /@ref\(([^)\s]{1,200})\)/y;
    match.lastIndex = index;
    const found = match.exec(text);
    if (found === null) {
      return null;
    }
    const label = this.context.headingTexts.get(found[1]) ?? found[1];
    return {
      html: this.put(`<a href="#${escapeHtml(found[1])}" class="cross-ref">${escapeHtml(label)}</a>`),
      end: index + found[0].length,
    };
  }

  /** `<https://…>`, `<user@host>`, `<br>` and other safe inline tags. */
  private angle(text: string, index: number): { html: string; end: number } | null {
    const autolink = /<((?:https?|ftp):\/\/[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/y;
    autolink.lastIndex = index;
    const link = autolink.exec(text);
    if (link !== null) {
      const href = link[1].includes('://') ? link[1] : `mailto:${link[1]}`;
      return { html: this.put(`<a href="${escapeHtml(href)}">${escapeHtml(link[1])}</a>`), end: index + link[0].length };
    }
    htmlTagSticky.lastIndex = index;
    const tag = htmlTagSticky.exec(text);
    if (tag !== null) {
      const filtered = filterHtmlTag(tag[0]);
      return { html: this.put(filtered ?? escapeHtml(tag[0])), end: index + tag[0].length };
    }
    return null;
  }

  /** Bare `https://…` URLs and e-mail addresses (§5, 12–13). */
  private bareLink(text: string, index: number): { html: string; end: number } | null {
    const char = text[index];
    if (char === 'h') {
      urlSticky.lastIndex = index;
      const url = urlSticky.exec(text);
      if (url !== null) {
        const trimmed = url[0].replace(/[.,:;!?)\]'"]+$/, '');
        return { html: this.put(`<a href="${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</a>`), end: index + trimmed.length };
      }
    }
    if (/[\w.+-]/.test(char)) {
      emailSticky.lastIndex = index;
      const email = emailSticky.exec(text);
      if (email !== null) {
        return { html: this.put(`<a href="mailto:${escapeHtml(email[0])}">${escapeHtml(email[0])}</a>`), end: index + email[0].length };
      }
    }
    return null;
  }

  /** Emphasis, typography and abbreviations on escaped text (placeholders untouched). */
  private decorate(html: string): string {
    const notWord = '(?<![\\p{L}\\p{N}_])';
    const notWordAfter = '(?![\\p{L}\\p{N}_])';
    let result = html
      .replace(/~~(?=\S)([^~]{1,2000}?)(?<=\S)~~/g, '<del>$1</del>')
      .replace(/\*\*\*(?=\S)([^]{1,2000}?)(?<=\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(new RegExp(`${notWord}___(?=\\S)([^]{1,2000}?)(?<=\\S)___${notWordAfter}`, 'gu'), '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([^]{1,2000}?)(?<=\S)\*\*/g, '<strong>$1</strong>')
      .replace(new RegExp(`${notWord}__(?=\\S)([^]{1,2000}?)(?<=\\S)__${notWordAfter}`, 'gu'), '<strong>$1</strong>')
      .replace(/\*(?=[^\s*])([^*]{1,2000}?)(?<=[^\s*])\*/g, '<em>$1</em>')
      .replace(new RegExp(`${notWord}_(?=[^\\s_])([^_]{1,2000}?)(?<=[^\\s_])_${notWordAfter}`, 'gu'), '<em>$1</em>');

    // Typography and abbreviations apply to text only, not inside tags or placeholders.
    result = result.split(/(<[^>]*>|\d+)/).map((part, index) => {
      if (index % 2 === 1) {
        return part;
      }
      let text = part.replace(/\.\.\./g, '&hellip;').replace(/---/g, '&mdash;').replace(/--/g, '&ndash;');
      const pattern = this.context.abbreviationPattern;
      if (pattern !== null) {
        text = text.replace(pattern, match => {
          const entry = this.context.abbreviations.find(abbreviation => escapeHtml(abbreviation.abbr) === match);
          return entry === undefined ? match : `<abbr title="${escapeHtml(entry.title)}">${match}</abbr>`;
        });
      }
      return text;
    }).join('');
    return result;
  }
}
