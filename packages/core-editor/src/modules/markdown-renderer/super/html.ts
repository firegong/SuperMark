import { escapeHtml } from '../utils';

/**
 * Minimal, DOM-free HTML filter for raw HTML written inside SuperMarkdown documents.
 *
 * The preview is rendered into the app's own document, so raw HTML must never be able to run
 * script, load frames, restyle the app or navigate to `javascript:` URLs. Instead of a full
 * parser this works tag-by-tag, which also lets it filter *fragments* such as an inline `<span>`
 * whose closing tag appears later in the paragraph.
 */

const blockedTags = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta',
  'base', 'form', 'textarea', 'title', 'xmp', 'plaintext', 'noscript', 'noembed', 'noframes',
  'template', 'portal', 'animate', 'set', 'animatetransform', 'animatemotion', 'handler',
  'foreignobject', 'listing',
]);

const urlAttributes = new Set(['href', 'src', 'xlink:href', 'action', 'background', 'poster', 'cite', 'data', 'srcset', 'lowsrc', 'dynsrc']);

/** Matches a single start/end tag at the beginning of the string. */
export const htmlTagPattern = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/;
const attributePattern = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16) || 0x20))
    .replace(/&#(\d+);?/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10) || 0x20))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

export function isSafeUrl(url: string, allowDataImage = false): boolean {
  // eslint-disable-next-line no-control-regex
  const normalized = decodeEntities(url).replace(/[\u0000- \u007f-\u009f]/g, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized);
  if (scheme === null) {
    return true;
  }

  if (['http', 'https', 'mailto', 'tel', 'file', 'ftp'].includes(scheme[1])) {
    return true;
  }

  return allowDataImage && /^data:image\/(png|gif|jpe?g|webp|bmp|avif);/.test(normalized);
}

function isSafeStyle(style: string): boolean {
  const decoded = decodeEntities(style).toLowerCase().replace(/\\/g, '');
  return !/(javascript:|vbscript:|expression\s*\(|behavior\s*:|-moz-binding|@import)/.test(decoded);
}

/** Returns a filtered tag, or `null` when the tag must be shown as text. */
export function filterHtmlTag(tag: string): string | null {
  const match = htmlTagPattern.exec(tag);
  if (match?.[0].length !== tag.length) {
    return null;
  }

  const [, closing, rawName, rawAttributes, selfClosing] = match;
  const name = rawName.toLowerCase();
  if (blockedTags.has(name)) {
    return null;
  }

  if (closing === '/') {
    return `</${name}>`;
  }

  const attributes: string[] = [];
  for (const attr of rawAttributes.matchAll(attributePattern)) {
    const attrName = attr[1].toLowerCase();
    const rawValue = attr[2] as string | undefined;
    let value = rawValue ?? '';
    if (value.startsWith('"') || value.startsWith('\'')) {
      value = value.slice(1, -1);
    }

    if (attrName.startsWith('on') || attrName === 'formaction' || attrName === 'srcdoc' || attrName.startsWith('xmlns:')) {
      continue;
    }

    if (urlAttributes.has(attrName) && !isSafeUrl(value, name === 'img' && attrName === 'src')) {
      continue;
    }

    if (attrName === 'style' && !isSafeStyle(value)) {
      continue;
    }

    // Keep user markup away from the app's own chrome classes.
    if (attrName === 'class') {
      value = value.split(/\s+/).filter(cls => cls.length > 0 && !cls.startsWith('markedit-')).join(' ');
    }

    attributes.push(rawValue === undefined ? ` ${attrName}` : ` ${attrName}="${value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`);
  }

  return `<${name}${attributes.join('')}${selfClosing === '/' ? ' /' : ''}>`;
}

/** Filters a block of raw HTML. Comments are dropped, unsafe tags become visible text. */
export function sanitizeHtml(html: string): string {
  let output = '';
  let index = 0;

  while (index < html.length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      output += html.slice(index);
      break;
    }

    output += html.slice(index, lt);
    const rest = html.slice(lt);

    if (rest.startsWith('<!--')) {
      const end = rest.indexOf('-->', 4);
      index = end === -1 ? html.length : lt + end + 3;
      continue;
    }

    const tag = htmlTagPattern.exec(rest);
    if (tag !== null) {
      output += filterHtmlTag(tag[0]) ?? escapeHtml(tag[0]);
      index = lt + tag[0].length;
      continue;
    }

    output += '&lt;';
    index = lt + 1;
  }

  return output;
}
