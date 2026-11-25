import type { Abbreviation, GmarkdownLine, GmarkdownOptions } from './context';

/**
 * gmarkdown pre-processing (§1): document header (§2), `@import` (§9.3) and abbreviations (§9.2).
 * Line numbers of the edited document are kept on every line; imported lines take the number
 * of their `@import` line, so preview sync still points somewhere sensible.
 */

/** Keys of inline metadata comments (§2.2), lowercase. */
const metadataKeys = new Set([
  'space', 'title', 'parent', 'label', 'attachment', 'section', 'content-appearance',
  'no-delete', 'hierarchy', 'hierarchy-rule',
]);

export const maxImportDepth = 20;

export interface DocumentHeader {
  frontMatter: string | null;
  metadata: { key: string; value: string }[];
}

export function toLines(text: string, fixedLine?: number): GmarkdownLine[] {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => ({ text: line, line: fixedLine ?? index }));
}

/** YAML (`---` … `---`/`...`) or TOML (`+++` … `+++`) front matter at the top. */
function frontMatterEnd(lines: GmarkdownLine[]): number {
  const first = lines[0]?.text.trim();
  if (first !== '---' && first !== '+++') {
    return -1;
  }
  for (let index = 1; index < lines.length; index += 1) {
    const text = lines[index].text.trim();
    if (first === '---' ? text === '---' || text === '...' : text === '+++') {
      return index;
    }
  }
  return -1;
}

export function stripFrontMatter(lines: GmarkdownLine[]): { frontMatter: string | null; body: GmarkdownLine[] } {
  const end = frontMatterEnd(lines);
  if (end === -1) {
    return { frontMatter: null, body: lines };
  }
  return {
    frontMatter: lines.slice(1, end).map(line => line.text).join('\n'),
    body: lines.slice(end + 1),
  };
}

/** Front matter and the metadata comments right after it (§2.1, §2.2), removed from the body. */
export function extractHeader(lines: GmarkdownLine[]): { header: DocumentHeader; body: GmarkdownLine[] } {
  const { frontMatter, body } = stripFrontMatter(lines);
  const metadata: { key: string; value: string }[] = [];
  const keep: GmarkdownLine[] = [];
  let scanning = true;
  for (const line of body) {
    if (scanning) {
      if (line.text.trim() === '') {
        keep.push(line);
        continue;
      }
      const comment = /^\s*<!--\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*-->\s*$/.exec(line.text);
      if (comment !== null && metadataKeys.has(comment[1].toLowerCase())) {
        metadata.push({ key: comment[1], value: comment[2] });
        continue;
      }
      scanning = false;
    }
    keep.push(line);
  }
  return { header: { frontMatter, metadata }, body: keep };
}

function isFenceLine(text: string): RegExpExecArray | null {
  return /^ {0,3}(`{3,}|~{3,})/.exec(text);
}

/** Calls `visit` for each line outside fenced code; lines inside fences are passed through. */
function mapOutsideFences(lines: GmarkdownLine[], visit: (line: GmarkdownLine) => GmarkdownLine[] | null): GmarkdownLine[] {
  const result: GmarkdownLine[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = line.rawHtml === true ? null : isFenceLine(line.text);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length && line.text.trim() === fenceMatch[1].trim()) {
        fence = null;
      }
      result.push(line);
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1];
      result.push(line);
      continue;
    }
    const replaced = visit(line);
    result.push(...(replaced ?? [line]));
  }
  return result;
}

function joinPath(from: string | null, path: string): string {
  if (/^([A-Za-z]:[\\/]|[\\/])/.test(path) || from === null) {
    return path;
  }
  const parts = from.replace(/[\\/][^\\/]*$/, '').split(/[\\/]+/).concat(path.split(/[\\/]+/));
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..' && resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
      resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return `${from.startsWith('/') ? '/' : ''}${resolved.join('/')}`;
}

/** Parses CSV (quoted fields with commas, quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

/** A CSV file as a Markdown table (first row = header), §9.3. */
function csvTable(text: string): string[] {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return [];
  }
  const width = Math.max(...rows.map(row => row.length));
  const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>').trim();
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => cell(row[index] ?? '')).join(' | ')} |`;
  return [line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)];
}

/** Expands `@import "path"` at the start of a line, outside code (§9.3). */
export function expandImports(lines: GmarkdownLine[], options: GmarkdownOptions, fromPath: string | null = options.documentPath ?? null, stack: string[] = []): GmarkdownLine[] {
  return mapOutsideFences(lines, line => {
    const directive = /^@import[ \t]+"([^"]+)"[ \t]*$/.exec(line.text);
    if (directive === null) {
      return null;
    }
    const path = directive[1];
    const notice = (message: string): GmarkdownLine[] => [{ text: '', line: line.line, notice: `@import "${path}": ${message}` }];
    const resolver = options.includeResolver;
    if (resolver === undefined) {
      return notice('file imports are not available in this preview');
    }
    if (stack.length >= maxImportDepth) {
      return notice(`more than ${maxImportDepth} nested imports`);
    }
    const fullPath = joinPath(fromPath, path);
    if (stack.includes(fullPath)) {
      return notice('circular import');
    }
    const content = resolver(path, fromPath);
    if (content === null) {
      return notice('file not found');
    }

    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? '';
    const imported = toLines(content, line.line);
    if (extension === 'md' || extension === 'markdown') {
      return expandImports(stripFrontMatter(imported).body, options, fullPath, [...stack, fullPath]);
    }
    if (extension === 'html' || extension === 'htm') {
      return [{ text: content, line: line.line, rawHtml: true }];
    }
    if (extension === 'csv') {
      return csvTable(content).map(text => ({ text, line: line.line }));
    }
    // Any other file is shown as code in the language of its extension.
    const longest = Math.max(2, ...Array.from(content.matchAll(/`+/g), match => match[0].length));
    const fence = '`'.repeat(longest + 1);
    return [
      { text: `${fence}${extension}`, line: line.line },
      ...imported,
      { text: fence, line: line.line },
    ];
  });
}

/** Collects `*[ABBR]: title` lines outside code (§9.2); the first definition wins. */
export function extractAbbreviations(lines: GmarkdownLine[]): { abbreviations: Abbreviation[]; body: GmarkdownLine[] } {
  const abbreviations: Abbreviation[] = [];
  const body = mapOutsideFences(lines, line => {
    const definition = /^\*\[([^\]]+)\]:[ \t]*(.*)$/.exec(line.text);
    if (definition === null) {
      return null;
    }
    if (!abbreviations.some(entry => entry.abbr === definition[1])) {
      abbreviations.push({ abbr: definition[1], title: definition[2].trim() });
    }
    return [];
  });
  return { abbreviations, body };
}
