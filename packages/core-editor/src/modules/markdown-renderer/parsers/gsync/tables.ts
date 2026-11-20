import { blockAttributes, tableOpenTag, taskCheckboxHtml } from '../../previewMarkup';
import { escapeHtml } from '../../utils';
import { group, safeClasses, safeId, type GsyncAttributes, type GsyncLine } from './context';
import type { InlineRenderer } from './inline';

/**
 * gsync tables: GFM tables (§4.6), MPE captions and merged cells (§4.7), and the syntax inside
 * cells (§4.8): lists, task lists, separators and `!`-delimited nested tables.
 */

type Align = 'left' | 'center' | 'right' | null;

const separatorCell = /^\s*:?-+:?\s*$/;

/** Cells of a table row; `\|` is a literal pipe. Trailing empty cells are kept (§4.7.2). */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) {
    text = text.slice(1);
  }
  if (text.endsWith('|') && !text.endsWith('\\|')) {
    text = text.slice(0, -1);
  }
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\' && text[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (text[index] === '|') {
      cells.push(cell);
      cell = '';
    } else {
      cell += text[index];
    }
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes('-') || !/[|]/.test(line) && !/^\s*:?-+:?\s*$/.test(line)) {
    return false;
  }
  const cells = splitRow(line);
  return cells.length > 0 && cells.every(cell => separatorCell.test(cell));
}

/** A table starts here: a row with `|`, then a separator row. */
export function isTableStart(lines: GsyncLine[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1] as GsyncLine | undefined;
  return header.rawHtml !== true && header.text.includes('|') && separator !== undefined && isSeparatorRow(separator.text);
}

/** MPE caption row (§4.7.1): the first header cell starts with `Table…:` or `표…:`. */
function captionRowText(cells: string[]): string | null {
  const first = cells[0] ?? '';
  return /^(?:Table|표)[^:|]*:/.test(first) ? first : null;
}

interface Cell {
  text: string;
  colspan: number;
  rowspan: number;
  hidden: boolean;
}

/** Merges (§4.7.2): `>` joins the cell on the left, trailing empty cells join the last cell, `^` joins the cell above. */
function mergeCells(rows: string[][]): Cell[][] {
  const grid: Cell[][] = [];
  const owners: Cell[][] = [];
  rows.forEach((row, rowIndex) => {
    const cells: Cell[] = row.map(text => ({ text, colspan: 1, rowspan: 1, hidden: false }));
    const rowOwners: Cell[] = [];
    let lastVisible: Cell | null = null;
    const grownAbove = new Set<Cell>();

    let trailingStart = cells.length;
    while (trailingStart > 0 && cells[trailingStart - 1].text === '') {
      trailingStart -= 1;
    }

    cells.forEach((cell, column) => {
      if (cell.text === '>' && lastVisible !== null) {
        lastVisible.colspan += 1;
        cell.hidden = true;
        rowOwners[column] = lastVisible;
      } else if (column >= trailingStart && trailingStart > 0 && lastVisible !== null) {
        lastVisible.colspan += 1;
        cell.hidden = true;
        rowOwners[column] = lastVisible;
      } else if (cell.text === '^' && rowIndex > 0 && (owners[rowIndex - 1][column] as Cell | undefined) !== undefined) {
        const above = owners[rowIndex - 1][column];
        if (!grownAbove.has(above)) {
          above.rowspan += 1;
          grownAbove.add(above);
        }
        cell.hidden = true;
        rowOwners[column] = above;
      } else {
        lastVisible = cell;
        rowOwners[column] = cell;
      }
    });
    grid.push(cells);
    owners.push(rowOwners);
  });
  return grid;
}

export class TableRenderer {
  constructor(private readonly inline: InlineRenderer) {}

  /**
   * Renders the table starting at `index` (header + separator + rows, then an optional `{…}`
   * line). `caption` comes from a `<!-- table title -->` comment or a `Table:` line.
   */
  render(lines: GsyncLine[], index: number, caption: string | null): { html: string; consumed: number } {
    const header = splitRow(lines[index].text);
    const aligns: Align[] = splitRow(lines[index + 1].text).map(cell => {
      const left = cell.startsWith(':');
      const right = cell.endsWith(':');
      return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
    });

    let cursor = index + 2;
    const body: { cells: string[]; line: number }[] = [];
    while (cursor < lines.length && lines[cursor].text.trim() !== '' && lines[cursor].text.includes('|') && lines[cursor].rawHtml !== true) {
      body.push({ cells: splitRow(lines[cursor].text), line: lines[cursor].line });
      cursor += 1;
    }

    let attributes: GsyncAttributes | null = null;
    const attributeLine = lines[cursor] as GsyncLine | undefined;
    const attributeMatch = attributeLine === undefined ? null : /^\s*\{([^{}]*)\}\s*$/.exec(attributeLine.text);
    if (attributeMatch !== null) {
      attributes = parseTableAttributes(attributeMatch[1]);
      cursor += 1;
    }

    // MPE caption row: removed, and the first body row becomes the header.
    let headerCells = header;
    let headerLine = lines[index].line;
    let rows = body;
    let mergeHeader = false;
    const captionRow = captionRowText(header);
    if (captionRow !== null) {
      caption ??= captionRow;
      const first = body.at(0);
      headerCells = first?.cells ?? [];
      headerLine = first?.line ?? headerLine;
      rows = body.slice(1);
      mergeHeader = true;
    }

    const width = Math.max(aligns.length, headerCells.length, ...rows.map(row => row.cells.length));
    const pad = (cells: string[]) => [...cells, ...Array.from({ length: Math.max(0, width - cells.length) }, () => '')];
    const align = (column: number) => {
      const value = aligns[column] as Align | undefined;
      return value === null || value === undefined ? '' : ` style="text-align: ${value}"`;
    };

    // Merges apply to body rows (and to a header promoted from the body).
    const merged = mergeCells(mergeHeader ? [headerCells, ...rows.map(row => row.cells)] : rows.map(row => row.cells));
    const headerGrid = mergeHeader ? merged[0] : headerCells.map(text => ({ text, colspan: 1, rowspan: 1, hidden: false }));
    const bodyGrid = mergeHeader ? merged.slice(1) : merged;

    const cellHtml = (cell: Cell, column: number, tag: 'th' | 'td', line: number) => {
      if (cell.hidden) {
        return '';
      }
      const spans = `${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}`;
      return `<${tag}${align(column)}${spans}>${this.cellContent(cell.text, line)}</${tag}>`;
    };

    const headerHtml = headerGrid.length === 0
      ? ''
      : `<thead><tr>${headerGrid.map((cell, column) => cellHtml(cell, column, 'th', headerLine)).join('')}</tr></thead>`;
    const bodyHtml = bodyGrid.map((cells, rowIndex) => {
      const line = rows[rowIndex].line;
      const padded = cells.length < width ? [...cells, ...pad([]).slice(cells.length).map(text => ({ text, colspan: 1, rowspan: 1, hidden: false }))] : cells;
      return `<tr data-line="${line}">${padded.map((cell, column) => cellHtml(cell, column, 'td', line)).join('')}</tr>`;
    }).join('');

    const classes = safeClasses(attributes?.classes ?? []);
    const id = safeId(attributes?.id ?? null);
    const open = tableOpenTag(classes.join(' '), id === null ? '' : ` id="${escapeHtml(id)}"`);
    const captionHtml = caption === null ? '' : `<p class="gsync-table-caption"><strong>${this.inline.render(caption)}</strong></p>`;
    return {
      html: `<div ${blockAttributes(lines[index].line)}>${captionHtml}${open}${headerHtml}<tbody>${bodyHtml}</tbody></table></div>`,
      consumed: cursor - index,
    };
  }

  /** Cell content (§4.8): lines split at `<br>`, with lists, separators and nested tables. */
  private cellContent(text: string, line: number): string {
    const parts = text.split(/<br\s*\/?>/i).map(part => part.trim());
    const nested = this.nestedTable(parts);
    if (nested !== null) {
      return nested;
    }

    let html = '';
    let list: { ordered: boolean; items: string[] } | null = null;
    const flushList = () => {
      if (list !== null) {
        const tag = list.ordered ? 'ol' : 'ul';
        html += `<${tag} class="gsync-cell-list">${list.items.join('')}</${tag}>`;
        list = null;
      }
    };
    const textParts: string[] = [];
    const flushText = () => {
      if (textParts.length > 0) {
        html += textParts.join('<br>');
        textParts.length = 0;
      }
    };

    for (const part of parts) {
      const bullet = /^[-*][ \t]+(.*)$/.exec(part);
      const numbered = /^\d+\.[ \t]+(.*)$/.exec(part);
      if (part === '---') {
        flushText();
        flushList();
        html += '<hr class="cell-sep">';
      } else if (bullet !== null || numbered !== null) {
        flushText();
        const ordered = numbered !== null;
        const content = (bullet ?? numbered as RegExpExecArray)[1];
        if (list === null || (list as { ordered: boolean }).ordered !== ordered) {
          flushList();
          list = { ordered, items: [] };
        }
        const task = /^\[([ xX])\](?:[ \t]+(.*))?$/.exec(content);
        const item = task === null
          ? this.inline.render(content)
          : `${taskCheckboxHtml(line, task[1] !== ' ')}${this.inline.render(group(task, 2) ?? '')}`;
        (list as { items: string[] }).items.push(`<li>${item}</li>`);
      } else {
        flushList();
        // `\- item` and `\1. item` are written as they are.
        const literal = part.replace(/^\\(?=[-*]|\d+\.)/, '');
        textParts.push(this.inline.render(literal));
      }
    }
    flushText();
    flushList();
    return html;
  }

  /** `! a ! b !` rows inside a cell, the second row being `! --- ! --- !` (§4.8). */
  private nestedTable(parts: string[]): string | null {
    if (parts.length < 2 || !parts.every(part => /^!.*!$/.test(part)) || parts.some(part => part.includes('!['))) {
      return null;
    }
    const split = (part: string) => part.slice(1, -1).split('!').map(cell => cell.trim());
    const separator = split(parts[1]);
    if (!separator.every(cell => /^-{3,}$/.test(cell))) {
      // Malformed: the text as written (gsync adds a parse warning comment).
      return null;
    }
    const header = split(parts[0]);
    const rows = parts.slice(2).map(split);
    const head = `<thead><tr>${header.map(cell => `<th>${this.inline.render(cell)}</th>`).join('')}</tr></thead>`;
    const body = rows.map(row => `<tr>${row.map(cell => `<td>${this.inline.render(cell)}</td>`).join('')}</tr>`).join('');
    return `<table class="gsync-nested-table">${head}<tbody>${body}</tbody></table>`;
  }
}

function parseTableAttributes(source: string): GsyncAttributes {
  const classes: string[] = [];
  let id: string | null = null;
  for (const token of source.trim().split(/\s+/)) {
    if (token.startsWith('#')) {
      id = token.slice(1);
    } else if (token.startsWith('.')) {
      classes.push(token.slice(1));
    }
  }
  return { id, classes, values: new Map(), flags: [] };
}
