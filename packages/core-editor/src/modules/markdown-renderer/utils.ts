export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isUnsafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

export function parseLinkDestination(text: string): { href: string; title: string; rest: string } | null {
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

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches?.length ?? 0;
}

export function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}
