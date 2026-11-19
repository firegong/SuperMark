import { escapeHtml } from '../utils';
import { filterHtmlTag, htmlTagPattern, isSafeUrl } from './html';
import { parseAttributes, safeClassNames, sanitizeSize } from './attributes';
import { normalizeLabel, placeholderEnd, placeholderStart, slugifyUnicode, type SuperContext } from './context';

/**
 * Left-to-right inline scanner for SuperMarkdown.
 *
 * Code spans, math, links and raw HTML are recognised before emphasis so that markers inside
 * them are never re-interpreted (the regex-chain approach of the default engine rewrites its own
 * output, e.g. `_` inside URLs).
 */

const asciiPunctuation = /[!-/:-@[-`{-~]/;
const imageExtensions = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const taskStates = new Set([' ', 'x', 'X', '/', '-']);

interface InlineState {
  context: SuperContext;
  /** Nested inside a link label: do not create nested links. */
  inLink: boolean;
}

export function parseInline(text: string, context: SuperContext, inLink = false): string {
  return scan(text, { context, inLink });
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/** Index of the matching closing backtick run, or -1. */
function findCodeSpanEnd(text: string, start: number, length: number): number {
  let index = start + length;
  while (index < text.length) {
    const next = text.indexOf('`', index);
    if (next === -1) {
      return -1;
    }

    let runEnd = next;
    while (text[runEnd] === '`') {
      runEnd += 1;
    }

    if (runEnd - next === length) {
      return next;
    }

    index = runEnd;
  }

  return -1;
}

function backtickRun(text: string, index: number): number {
  let end = index;
  while (text[end] === '`') {
    end += 1;
  }
  return end - index;
}

/** Index of the `]` matching the `[` at `start`, honouring escapes and code spans. */
function findClosingBracket(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
    } else if (char === '`') {
      const length = backtickRun(text, index);
      const end = findCodeSpanEnd(text, index, length);
      index = end === -1 ? index + length - 1 : end + length - 1;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/** Parses `(dest "title")` starting at the `(`; returns end index (after `)`). */
function parseInlineDestination(text: string, start: number): { href: string; title: string; end: number } | null {
  let index = start + 1;
  while (text[index] === ' ' || text[index] === '\n') {
    index += 1;
  }

  let href = '';
  if (text[index] === '<') {
    const close = text.indexOf('>', index);
    if (close === -1) {
      return null;
    }
    href = text.slice(index + 1, close);
    index = close + 1;
  } else {
    let depth = 0;
    const begin = index;
    while (index < text.length) {
      const char = text[index];
      if (char === '\\' && index + 1 < text.length) {
        index += 2;
        continue;
      }
      if (/\s/.test(char)) {
        break;
      }
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      }
      index += 1;
    }
    href = text.slice(begin, index).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }

  while (text[index] === ' ' || text[index] === '\n') {
    index += 1;
  }

  let title = '';
  const quote = text[index];
  if (quote === '"' || quote === '\'' || quote === '(') {
    const closeChar = quote === '(' ? ')' : quote;
    const close = text.indexOf(closeChar, index + 1);
    if (close === -1) {
      return null;
    }
    title = text.slice(index + 1, close);
    index = close + 1;
    while (text[index] === ' ' || text[index] === '\n') {
      index += 1;
    }
  }

  if (text[index] !== ')') {
    return null;
  }

  return { href, title, end: index + 1 };
}

/** Parses a trailing `{...}` attribute block at `start`. */
function parseTrailingAttributes(text: string, start: number): { source: string; end: number } | null {
  if (text[start] !== '{') {
    return null;
  }

  const close = text.indexOf('}', start);
  if (close === -1 || text.slice(start, close).includes('\n')) {
    return null;
  }

  return { source: text.slice(start + 1, close), end: close + 1 };
}

function linkHtml(href: string, title: string, label: string, extraClass = ''): string {
  const titleAttr = title.length > 0 ? ` title="${escapeHtml(title)}"` : '';
  const classAttr = extraClass.length > 0 ? ` class="${extraClass}"` : '';
  return `<a href="${escapeHtml(href)}"${titleAttr}${classAttr}>${label}</a>`;
}

function imageHtml(src: string, alt: string, title: string, attributeSource: string | null): string {
  const titleAttr = title.length > 0 ? ` title="${escapeHtml(title)}"` : '';
  let style = '';
  if (attributeSource !== null) {
    const attributes = parseAttributes(attributeSource);
    const width = sanitizeSize(attributes.values.get('width'));
    const height = sanitizeSize(attributes.values.get('height'));
    style = [width === null ? '' : `width: ${width};`, height === null ? '' : `height: ${height};`].join(' ').trim();
  }

  const styleAttr = style.length > 0 ? ` style="${style}"` : '';
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}${styleAttr} class="markedit-preview-image">`;
}

/** Plain-text version of a label for `alt` attributes. */
function stripMarkup(text: string): string {
  return text.replace(/[*_~=`^]/g, '').replace(/\\(.)/g, '$1');
}

function wikiHref(target: string): string {
  const [page, ...anchorParts] = target.split('#');
  const anchor = anchorParts.join('#').trim();
  const anchorHref = anchor.length === 0
    ? ''
    : `#${anchor.startsWith('^') ? anchor.slice(1) : slugifyUnicode(anchor)}`;
  const trimmedPage = page.trim();
  if (trimmedPage.length === 0) {
    return anchorHref;
  }

  const file = /\.[A-Za-z0-9]+$/.test(trimmedPage) ? trimmedPage : `${trimmedPage}.md`;
  return `${encodeURI(file)}${anchorHref}`;
}

/**
 * Finds the closing delimiter for a simple paired marker (`~~`, `~`, `^`, `==`, `*`, `_`).
 * The closing run must have exactly the same length and must not be preceded by whitespace.
 */
function findCloser(text: string, start: number, delimiter: string, allowSpaces: boolean): number {
  const char = delimiter[0];
  for (let index = start; index < text.length; index += 1) {
    const current = text[index];
    if (current === '\\') {
      index += 1;
      continue;
    }

    if (current === '`') {
      const length = backtickRun(text, index);
      const end = findCodeSpanEnd(text, index, length);
      index = end === -1 ? index + length - 1 : end + length - 1;
      continue;
    }

    if (!allowSpaces && /\s/.test(current)) {
      return -1;
    }

    if (current !== char) {
      continue;
    }

    let runEnd = index;
    while (text[runEnd] === char) {
      runEnd += 1;
    }

    if (runEnd - index === delimiter.length && !isWhitespace(text[index - 1]) && index > start) {
      if (char === '_' && isAlphanumeric(text[runEnd])) {
        index = runEnd - 1;
        continue;
      }
      return index;
    }

    index = runEnd - 1;
  }

  return -1;
}

function scan(text: string, state: InlineState): string {
  const { context } = state;
  let out = '';
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    const rest = text.slice(index);

    switch (char) {
      case '\\': {
        const next = text[index + 1] as string | undefined;
        if (next === '\n') {
          out += '<br>\n';
          index += 2;
          continue;
        }
        if (next !== undefined && asciiPunctuation.test(next)) {
          out += escapeHtml(next);
          index += 2;
          continue;
        }
        out += '\\';
        index += 1;
        continue;
      }

      case '`': {
        const length = backtickRun(text, index);
        const end = findCodeSpanEnd(text, index, length);
        if (end === -1) {
          out += '`'.repeat(length);
          index += length;
          continue;
        }

        let code = text.slice(index + length, end).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim().length > 0) {
          code = code.slice(1, -1);
        }
        out += `<code class="markedit-preview-code">${escapeHtml(code)}</code>`;
        index = end + length;
        continue;
      }

      case '$': {
        if (context.options.enableMath === false) {
          break;
        }

        if (rest.startsWith('$$')) {
          const close = text.indexOf('$$', index + 2);
          if (close > index + 2) {
            out += context.renderMath(text.slice(index + 2, close).trim(), true);
            index = close + 2;
            continue;
          }
          break;
        }

        if (!isWhitespace(text[index + 1])) {
          let close = index + 1;
          while (close < text.length) {
            close = text.indexOf('$', close);
            if (close === -1) {
              break;
            }
            if (text[close - 1] !== '\\' && !isWhitespace(text[close - 1]) && !/\d/.test(text[close + 1] ?? '')) {
              break;
            }
            close += 1;
          }

          if (close !== -1 && close > index + 1) {
            out += context.renderMath(text.slice(index + 1, close), false);
            index = close + 1;
            continue;
          }
        }
        break;
      }

      case '<': {
        const autolink = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest);
        if (autolink !== null) {
          const url = autolink[1];
          out += isSafeUrl(url) ? linkHtml(url, '', escapeHtml(url)) : escapeHtml(autolink[0]);
          index += autolink[0].length;
          continue;
        }

        const email = /^<([\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)+)>/.exec(rest);
        if (email !== null) {
          out += linkHtml(`mailto:${email[1]}`, '', escapeHtml(email[1]));
          index += email[0].length;
          continue;
        }

        if (rest.startsWith('<!--')) {
          const close = text.indexOf('-->', index + 4);
          if (close !== -1) {
            index = close + 3;
            continue;
          }
        }

        const tag = htmlTagPattern.exec(rest);
        if (tag !== null) {
          out += filterHtmlTag(tag[0]) ?? escapeHtml(tag[0]);
          index += tag[0].length;
          continue;
        }

        out += '&lt;';
        index += 1;
        continue;
      }

      case '%': {
        // §9 Obsidian comment. Math was handled earlier in the scan, so `%%` inside `$...$` survives.
        if (rest.startsWith('%%')) {
          const close = text.indexOf('%%', index + 2);
          if (close !== -1) {
            index = close + 2;
            continue;
          }
        }
        break;
      }

      case '!': {
        if (rest.startsWith('![[')) {
          const close = text.indexOf(']]', index + 3);
          if (close !== -1 && !text.slice(index + 3, close).includes('\n')) {
            out += renderEmbed(text.slice(index + 3, close), state);
            index = close + 2;
            continue;
          }
        }

        if (text[index + 1] === '[') {
          const close = findClosingBracket(text, index + 1);
          if (close !== -1) {
            const alt = text.slice(index + 2, close);
            const image = tryLinkTail(text, close + 1, state, alt);
            if (image !== null) {
              if (image.href !== null && isSafeUrl(image.href, true)) {
                const attrs = parseTrailingAttributes(text, image.end);
                out += imageHtml(image.href, stripMarkup(alt), image.title, attrs?.source ?? null);
                index = attrs?.end ?? image.end;
                continue;
              }
            }
          }
        }
        break;
      }

      case '[': {
        const consumed = scanBracket(text, index, state);
        if (consumed !== null) {
          out += consumed.html;
          index = consumed.end;
          continue;
        }
        break;
      }

      case '*':
      case '_': {
        let runEnd = index;
        while (text[runEnd] === char) {
          runEnd += 1;
        }
        const length = runEnd - index;
        const intraword = char === '_' && isAlphanumeric(text[index - 1]);
        if (length <= 3 && !isWhitespace(text[runEnd]) && !intraword) {
          const delimiter = char.repeat(length);
          const close = findCloser(text, runEnd, delimiter, true);
          if (close !== -1) {
            const inner = scan(text.slice(runEnd, close), state);
            out += length === 1 ? `<em>${inner}</em>` : length === 2 ? `<strong>${inner}</strong>` : `<strong><em>${inner}</em></strong>`;
            index = close + length;
            continue;
          }
        }
        out += escapeHtml(text.slice(index, runEnd));
        index = runEnd;
        continue;
      }

      case '~': {
        if (rest.startsWith('~~') && text[index + 2] !== '~' && !isWhitespace(text[index + 2])) {
          const close = findCloser(text, index + 2, '~~', true);
          if (close !== -1) {
            out += `<del>${scan(text.slice(index + 2, close), state)}</del>`;
            index = close + 2;
            continue;
          }
        } else if (text[index + 1] !== '~' && !isWhitespace(text[index + 1])) {
          // §2 subscript: no spaces inside.
          const close = findCloser(text, index + 1, '~', false);
          if (close !== -1) {
            out += `<sub>${scan(text.slice(index + 1, close), state)}</sub>`;
            index = close + 1;
            continue;
          }
        }
        break;
      }

      case '^': {
        if (!isWhitespace(text[index + 1]) && text[index + 1] !== '^') {
          const close = findCloser(text, index + 1, '^', false);
          if (close !== -1) {
            out += `<sup>${scan(text.slice(index + 1, close), state)}</sup>`;
            index = close + 1;
            continue;
          }
        }
        break;
      }

      case '=': {
        if (rest.startsWith('==') && text[index + 2] !== '=' && !isWhitespace(text[index + 2])) {
          const close = findCloser(text, index + 2, '==', true);
          if (close !== -1) {
            out += `<mark>${scan(text.slice(index + 2, close), state)}</mark>`;
            index = close + 2;
            continue;
          }
        }
        break;
      }

      case '(': {
        // Pandoc example reference (@label), resolved after all example lists are numbered.
        const example = /^\(@([\w-]+)\)/.exec(rest);
        if (example !== null) {
          out += `${placeholderStart}E:${example[1]}${placeholderEnd}`;
          index += example[0].length;
          continue;
        }
        break;
      }

      case '{': {
        const variable = /^\{\{\s*([\w.-]+)\s*\}\}/.exec(rest);
        if (variable !== null) {
          const value = context.metadata.get(variable[1].toLowerCase());
          out += value === undefined
            ? `<span class="msm-error" title="Undefined variable: ${escapeHtml(variable[1])}">${escapeHtml(variable[0])}</span>`
            : escapeHtml(value);
          index += variable[0].length;
          continue;
        }
        break;
      }

      case '@': {
        if (!isAlphanumeric(text[index - 1]) && text[index - 1] !== '@') {
          const citation = /^@([A-Za-z0-9_][\w:.#$%&+?<>~/-]*)/.exec(rest);
          if (citation !== null) {
            const key = citation[1].replace(/[.:,;?]+$/, '');
            out += `<cite class="msm-cite" data-cite="${escapeHtml(key)}">@${escapeHtml(key)}</cite>`;
            index += key.length + 1;
            continue;
          }
        }
        break;
      }

      case '#': {
        // §10 tags: no space after `#`, never at the start of a line.
        if (text[index - 1] === ' ' || text[index - 1] === '\t') {
          const tag = /^#([\p{L}\p{N}_/-]+)/u.exec(rest);
          if (tag !== null && /[^\d]/.test(tag[1])) {
            out += `<span class="msm-tag">#${escapeHtml(tag[1])}</span>`;
            index += tag[0].length;
            continue;
          }
        }
        break;
      }

      case 'h':
      case 'w': {
        if (!state.inLink && !isAlphanumeric(text[index - 1])) {
          const url = /^(?:https?:\/\/|www\.)[^\s<]+/.exec(rest);
          if (url !== null) {
            let raw = url[0];
            // Trim trailing punctuation, keeping balanced parentheses.
            while (/[.,;:!?'"*_~)]$/.test(raw)) {
              if (raw.endsWith(')') && (raw.match(/\(/g)?.length ?? 0) >= (raw.match(/\)/g)?.length ?? 0)) {
                break;
              }
              raw = raw.slice(0, -1);
            }
            const href = raw.startsWith('www.') ? `https://${raw}` : raw;
            out += linkHtml(href, '', escapeHtml(raw));
            index += raw.length;
            continue;
          }
        }
        break;
      }

      case '&': {
        const entity = /^&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i.exec(rest);
        if (entity !== null) {
          out += entity[0];
          index += entity[0].length;
          continue;
        }
        break;
      }

      case '\n': {
        // Hard break: two or more trailing spaces.
        if (/ {2,}$/.test(text.slice(0, index))) {
          out = out.replace(/ +$/, '');
          out += '<br>\n';
        } else {
          out = out.replace(/ +$/, '');
          out += '\n';
        }
        index += 1;
        continue;
      }
    }

    out += escapeHtml(char);
    index += 1;
  }

  return out;
}

/** Handles `(url)`, `[ref]`, `[]` after a closing bracket. `href` is null for unresolved refs. */
function tryLinkTail(text: string, start: number, state: InlineState, label?: string): { href: string | null; title: string; end: number } | null {
  if (text[start] === '(') {
    const destination = parseInlineDestination(text, start);
    if (destination !== null) {
      return { href: destination.href, title: destination.title, end: destination.end };
    }
    return null;
  }

  if (text[start] === '[') {
    const close = text.indexOf(']', start);
    if (close === -1) {
      return null;
    }
    const refLabel = text.slice(start + 1, close);
    const key = normalizeLabel(refLabel.length > 0 ? refLabel : label ?? '');
    const reference = state.context.references.get(key);
    return reference === undefined ? null : { href: reference.href, title: reference.title, end: close + 1 };
  }

  return null;
}

function renderEmbed(target: string, state: InlineState): string {
  const [rawPath, ...options] = target.split('|');
  const path = rawPath.trim();
  if (imageExtensions.test(path.split('#')[0])) {
    const size = options[0]?.trim() ?? '';
    const sizeMatch = /^(\d+)(?:x(\d+))?$/.exec(size);
    const style = sizeMatch === null ? '' : ` style="width: ${sizeMatch[1]}px;${(sizeMatch[2] as string | undefined) === undefined ? '' : ` height: ${sizeMatch[2]}px;`}"`;
    if (!isSafeUrl(path, true)) {
      return escapeHtml(`![[${target}]]`);
    }
    return `<img src="${escapeHtml(encodeURI(path))}" alt="${escapeHtml(path)}"${style} class="markedit-preview-image msm-embed-image">`;
  }

  const label = options.length > 0 ? options.join('|').trim() : path;
  return `<span class="msm-embed">${linkHtml(wikiHref(path), '', parseInline(label, state.context, true), 'msm-wikilink')}</span>`;
}

function scanBracket(text: string, index: number, state: InlineState): { html: string; end: number } | null {
  const { context } = state;
  const rest = text.slice(index);

  // Wiki link [[target]], [[target|alias]], [[doc#heading]], [[doc#^block]]
  if (rest.startsWith('[[')) {
    const close = text.indexOf(']]', index + 2);
    if (close !== -1 && !text.slice(index + 2, close).includes('\n') && !state.inLink) {
      const inner = text.slice(index + 2, close);
      const [target, ...aliasParts] = inner.split('|');
      const display = aliasParts.length > 0 ? aliasParts.join('|') : target;
      const html = linkHtml(wikiHref(target), '', parseInline(display.trim(), context, true), 'msm-wikilink');
      return { html: html.replace('<a ', `<a data-wikilink="${escapeHtml(target.trim())}" `), end: close + 2 };
    }
    return null;
  }

  // Footnote reference [^id]
  const footnote = /^\[\^([^\]\s]+)\]/.exec(rest);
  if (footnote !== null && text[index + footnote[0].length] !== ':') {
    const id = footnote[1];
    if (!context.footnoteDefinitions.has(id)) {
      return null;
    }
    let number = context.footnoteOrder.indexOf(id) + 1;
    if (number === 0) {
      context.footnoteOrder.push(id);
      number = context.footnoteOrder.length;
    }
    const safeId = escapeHtml(id);
    return { html: `<sup class="markedit-preview-footnote-ref msm-fnref"><a href="#fn-${safeId}" id="fnref-${safeId}">${number}</a></sup>`, end: index + footnote[0].length };
  }

  // Cross reference [#label] (resolved after the whole document is rendered)
  const crossRef = /^\[#([^\]\s]+)\]/.exec(rest);
  if (crossRef !== null && text[index + crossRef[0].length] !== '(') {
    return { html: `${placeholderStart}X:${crossRef[1]}${placeholderEnd}`, end: index + crossRef[0].length };
  }

  // Citation [@key], [see @key, p. 3; @other]
  const citation = /^\[([^[\]\n]*?@[A-Za-z0-9_][^[\]\n]*)\]/.exec(rest);
  if (citation !== null && !['(', '['].includes(text[index + citation[0].length] ?? '')) {
    return { html: `<span class="msm-citation">[${parseInline(citation[1], context, state.inLink)}]</span>`, end: index + citation[0].length };
  }

  const close = findClosingBracket(text, index);
  if (close === -1) {
    return null;
  }

  const label = text.slice(index + 1, close);

  // Bracketed span [text]{.underline} / [text]{.class #id}
  const spanAttributes = parseTrailingAttributes(text, close + 1);
  if (spanAttributes !== null) {
    const attributes = parseAttributes(spanAttributes.source);
    const inner = parseInline(label, context, state.inLink);
    if (attributes.classes.includes('underline') || attributes.classes.includes('ul')) {
      return { html: `<u>${inner}</u>`, end: spanAttributes.end };
    }
    const classes = safeClassNames(attributes.classes);
    const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
    const idAttr = attributes.id !== null ? ` id="${escapeHtml(attributes.id)}"` : '';
    return { html: `<span${classAttr}${idAttr}>${inner}</span>`, end: spanAttributes.end };
  }

  if (!state.inLink) {
    const tail = tryLinkTail(text, close + 1, state, label);
    if (tail !== null && tail.href !== null) {
      if (!isSafeUrl(tail.href)) {
        return null;
      }
      return { html: linkHtml(tail.href, tail.title, parseInline(label, context, true)), end: tail.end };
    }

    // Shortcut reference link [ref]
    const shortcut = context.references.get(normalizeLabel(label));
    if (shortcut !== undefined && text[close + 1] !== '(' && isSafeUrl(shortcut.href)) {
      return { html: linkHtml(shortcut.href, shortcut.title, parseInline(label, context, true)), end: close + 1 };
    }
  }

  // §29 keyboard keys: [Ctrl]+[S]. Not followed by ( or [, single token, not a checkbox state.
  const next = text[close + 1];
  if (next !== '(' && next !== '[' && /^[^\s[\]^@#!]{1,24}$/.test(label) && !/^\d+$/.test(label) && !taskStates.has(label)) {
    return { html: `<kbd class="msm-kbd">${escapeHtml(label)}</kbd>`, end: close + 1 };
  }

  return null;
}
