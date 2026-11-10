import { EditorView, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { getMarkdownSyntaxStandard, renderMath, renderMermaid } from '../modules/markdown-renderer';

function isRangeActive(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(range => range.from < to && range.to > from);
}

function isLineActive(state: EditorState, line: { from: number; to: number }): boolean {
  return isRangeActive(state, line.from, line.to);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseInlineCells(row: string): string[] {
  const trimmed = row.trim();
  const inner = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined);
  return inner.split('|').map(cell => cell.trim());
}

function isTableSeparator(row: string): boolean {
  const cells = parseInlineCells(row);
  return cells.length > 0 && cells.every(cell => /^:?-+(:?)?$/.test(cell));
}

function isTableRow(row: string): boolean {
  const trimmed = row.trim();
  return trimmed.startsWith('|');
}

function renderTableHtml(header: string, separator: string, rows: string[]): string {
  const headerCells = parseInlineCells(header);
  const separatorCells = parseInlineCells(separator);
  const aligns = separatorCells.map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) {
      return 'center';
    }
    if (right) {
      return 'right';
    }
    return 'left';
  });

  const renderCells = (cells: string[], tag: string) => cells.map((cell, index) => {
    const align = aligns[index] ?? 'left';
    return `<${tag} style="text-align: ${align}">${escapeHtml(cell)}</${tag}>`;
  }).join('');

  const bodyRows = rows.map(row => `<tr>${renderCells(parseInlineCells(row), 'td')}</tr>`).join('');
  return `<table class="cm-live-table"><thead><tr>${renderCells(headerCells, 'th')}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly lineFrom: number,
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-live-checkbox';
    input.checked = this.checked;
    input.addEventListener('change', () => {
      const line = view.state.doc.lineAt(this.lineFrom);
      const text = line.text;
      const updated = input.checked
        ? text.replace(/\[ \]/, '[x]')
        : text.replace(/\[x\]/i, '[ ]');
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: updated },
        selection: { anchor: line.from },
      });
    });
    return input;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'cm-live-hr';
    return hr;
  }
}

class MathWidget extends WidgetType {
  constructor(
    private readonly latex: string,
    private readonly displayMode: boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement(this.displayMode ? 'div' : 'span');
    wrapper.className = this.displayMode ? 'cm-live-math cm-live-math-block' : 'cm-live-math';
    wrapper.innerHTML = renderMath(this.latex, this.displayMode);
    return wrapper;
  }
}

class MermaidWidget extends WidgetType {
  constructor(private readonly source: string) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-mermaid';
    wrapper.innerHTML = renderMermaid(this.source);
    return wrapper;
  }
}

class TableWidget extends WidgetType {
  constructor(
    private readonly header: string,
    private readonly separator: string,
    private readonly rows: string[],
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-live-table-wrap';
    wrapper.innerHTML = renderTableHtml(this.header, this.separator, this.rows);
    return wrapper;
  }
}

class CalloutBadgeWidget extends WidgetType {
  constructor(private readonly type: string) {
    super();
  }

  toDOM(): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'cm-live-callout-badge';
    badge.textContent = this.type.toUpperCase();
    return badge;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Array<{ from: number; to: number; value: Decoration }> = [];
  const doc = state.doc;
  const standard = getMarkdownSyntaxStandard();
  const supportsGfm = standard !== 'commonmark';
  const supportsExtended = standard === 'extended' || (standard !== 'commonmark' && standard !== 'gfm');
  let inCodeBlock = false;

  for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    const trimmed = line.text.trim();

    // Mermaid fenced block must be detected before generic fence toggling
    const mermaidMatch = supportsExtended ? /^(```|~~~)\s*mermaid\s*$/.exec(trimmed) : null;
    if (mermaidMatch !== null) {
      const fence = mermaidMatch[1];
      const parts: string[] = [];
      let current = lineNumber + 1;
      let endLine = line;

      while (current <= doc.lines) {
        const nextLine = doc.line(current);
        endLine = nextLine;
        if (nextLine.text.trim().startsWith(fence)) {
          break;
        }
        parts.push(nextLine.text);
        current += 1;
      }

      const source = parts.join('\n').trim();
      if (source.length > 0 && !isRangeActive(state, line.from, endLine.to)) {
        decorations.push(Decoration.replace({ widget: new MermaidWidget(source), block: true }).range(line.from, endLine.to));
      }
      lineNumber = current;
      continue;
    }

    const fenceMatch = /^```|~~~/.exec(line.text);
    if (fenceMatch !== null) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (isLineActive(state, line)) {
      continue;
    }

    // Horizontal rule
    if (/^([*\-_])(\s*\1){2,}\s*$/.test(trimmed)) {
      decorations.push(Decoration.replace({ widget: new HrWidget() }).range(line.from, line.to));
      continue;
    }

    // Task list checkbox
    const taskMatch = /^(\s*)[-*+](\s+)\[([ x])\](\s+)/.exec(line.text);
    if (taskMatch !== null && supportsGfm) {
      const checked = taskMatch[3] === 'x';
      const prefix = taskMatch[0];
      const bracketIndex = prefix.indexOf('[');
      const from = line.from + bracketIndex;
      const to = from + 3;
      decorations.push(Decoration.replace({ widget: new CheckboxWidget(checked, line.from) }).range(from, to));
    }

    // Display math block
    if (trimmed.startsWith('$$') && supportsExtended) {
      const startLine = line;
      let endLine = line;
      let latex = '';

      if (trimmed.endsWith('$$') && trimmed.length > 4) {
        latex = trimmed.slice(2, -2).trim();
      } else {
        const parts: string[] = [];
        const opener = trimmed.slice(2).trim();
        if (opener.length > 0) {
          parts.push(opener);
        }

        let current = lineNumber + 1;
        while (current <= doc.lines) {
          const nextLine = doc.line(current);
          const nextTrimmed = nextLine.text.trim();
          endLine = nextLine;
          if (nextTrimmed.endsWith('$$')) {
            const inner = nextTrimmed.slice(0, -2).trim();
            if (inner.length > 0) {
              parts.push(inner);
            }
            break;
          }
          parts.push(nextLine.text);
          current += 1;
        }
        latex = parts.join('\n').trim();
        lineNumber = current;
      }

      if (latex.length > 0 && !isRangeActive(state, startLine.from, endLine.to)) {
        decorations.push(Decoration.replace({ widget: new MathWidget(latex, true), block: true }).range(startLine.from, endLine.to));
      }
      continue;
    }

    // GFM table
    if (isTableRow(line.text) && supportsGfm) {
      const header = line.text;
      const nextLine = lineNumber + 1 <= doc.lines ? doc.line(lineNumber + 1) : null;
      if (nextLine !== null && isTableSeparator(nextLine.text)) {
        const rows: string[] = [];
        let current = lineNumber + 2;
        while (current <= doc.lines) {
          const rowLine = doc.line(current);
          if (!isTableRow(rowLine.text)) {
            break;
          }
          rows.push(rowLine.text);
          current += 1;
        }

        const tableEnd = rows.length > 0 ? doc.line(current - 1).to : nextLine.to;
        if (!isRangeActive(state, line.from, tableEnd)) {
          decorations.push(Decoration.replace({ widget: new TableWidget(header, nextLine.text, rows), block: true }).range(line.from, tableEnd));
        }
        lineNumber = current - 1;
        continue;
      }
    }

    // Inline math
    if (supportsExtended) {
      const inlineMath = /\$([^\s$][^$]*?)\$/g;
      let match: RegExpExecArray | null;
      while ((match = inlineMath.exec(line.text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;
        if (!isRangeActive(state, from, to)) {
          decorations.push(Decoration.replace({ widget: new MathWidget(match[1], false) }).range(from, to));
        }
      }
    }

    // Callout badge
    const calloutMatch = /^(\s*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/.exec(line.text);
    if (calloutMatch !== null && supportsExtended) {
      const type = calloutMatch[2].toLowerCase();
      const prefix = calloutMatch[1];
      const badgeStart = prefix.length;
      const from = line.from + badgeStart;
      const to = from + calloutMatch[2].length + 4; // [!TYPE]
      decorations.push(Decoration.line({ class: `cm-live-callout is-${type}` }).range(line.from, line.from));
      decorations.push(Decoration.replace({ widget: new CalloutBadgeWidget(type) }).range(from, to));
    }
  }

  return Decoration.set(decorations, true);
}

export function createLivePreviewExtension(): Extension {
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state);
    },
    update(decorations, transaction) {
      if (transaction.docChanged || transaction.selection) {
        return buildDecorations(transaction.state);
      }
      return decorations;
    },
    provide: f => EditorView.decorations.from(f),
  });

  return field;
}
