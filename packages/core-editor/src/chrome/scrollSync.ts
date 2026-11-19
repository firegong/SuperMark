/**
 * Geometry for editor ⇄ preview scroll sync.
 *
 * The preview marks rendered blocks with `data-line` (0-based source line). Those elements give
 * a list of anchors — (source line, vertical offset in the preview) — and positions between two
 * anchors are interpolated linearly, so a long paragraph, table or code block scrolls smoothly
 * instead of jumping from block to block. The same map is used in both directions.
 *
 * Each pane is synced at a "reference point" that slides from the top of the viewport (scrolled
 * to the top) to its bottom (scrolled to the end): both panes reach their start and end together
 * even though their content heights differ.
 */

export interface ScrollAnchor {
  /** Source line, 0-based; may be fractional. */
  line: number;
  /** Offset from the top of the scrollable content, in pixels. */
  top: number;
}

/**
 * Turns raw anchors into a monotonic map: sorted by line, each line once (topmost element), and
 * offsets never decreasing. Out-of-order elements (e.g. footnote definitions that render at the
 * end of the document) are dropped by keeping the longest monotonic run. The start of the
 * document and its end (`totalLines` at `contentHeight`) are added as fixed points.
 */
export function buildAnchors(raw: ScrollAnchor[], totalLines: number, contentHeight: number): ScrollAnchor[] {
  const byLine = new Map<number, number>();
  for (const { line, top } of raw) {
    if (!Number.isFinite(line) || !Number.isFinite(top) || line < 0) {
      continue;
    }
    const existing = byLine.get(line);
    if (existing === undefined || top < existing) {
      byLine.set(line, top);
    }
  }

  const sorted = [...byLine.entries()]
    .map(([line, top]) => ({ line, top }))
    .filter(anchor => anchor.line < totalLines)
    .sort((a, b) => a.line - b.line);

  const anchors = longestMonotonic(sorted);
  if (anchors.length === 0 || anchors[0].line > 0) {
    anchors.unshift({ line: 0, top: 0 });
  } else {
    // Padding above the first block: the document starts at the top of the pane.
    anchors[0] = { line: 0, top: 0 };
  }

  const last = anchors[anchors.length - 1];
  if (totalLines > last.line) {
    anchors.push({ line: totalLines, top: Math.max(last.top, contentHeight) });
  }
  return anchors;
}

/** Longest subsequence with non-decreasing `top` (input is sorted by line). */
function longestMonotonic(anchors: ScrollAnchor[]): ScrollAnchor[] {
  // Patience sorting: tails[k] = index of the smallest tail of a run of length k + 1.
  const tails: number[] = [];
  const previous = new Array<number>(anchors.length).fill(-1);

  anchors.forEach((anchor, index) => {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (anchors[tails[mid]].top <= anchor.top) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    previous[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  });

  const result: ScrollAnchor[] = [];
  for (let index = tails.length > 0 ? tails[tails.length - 1] : -1; index >= 0; index = previous[index]) {
    result.push(anchors[index]);
  }
  return result.reverse();
}

/** Preview offset of a (fractional) source line. */
export function lineToOffset(anchors: ScrollAnchor[], line: number): number {
  if (anchors.length === 0) {
    return 0;
  }
  if (line <= anchors[0].line) {
    return anchors[0].top;
  }

  const index = upperBound(anchors, line, anchor => anchor.line);
  if (index >= anchors.length) {
    return anchors[anchors.length - 1].top;
  }

  const start = anchors[index - 1];
  const end = anchors[index];
  const span = end.line - start.line;
  return span > 0 ? start.top + (end.top - start.top) * (line - start.line) / span : start.top;
}

/** Source line (fractional) shown at a preview offset. */
export function offsetToLine(anchors: ScrollAnchor[], top: number): number {
  if (anchors.length === 0) {
    return 0;
  }
  if (top <= anchors[0].top) {
    return anchors[0].line;
  }

  const index = upperBound(anchors, top, anchor => anchor.top);
  if (index >= anchors.length) {
    return anchors[anchors.length - 1].line;
  }

  const start = anchors[index - 1];
  const end = anchors[index];
  const span = end.top - start.top;
  return span > 0 ? start.line + (end.line - start.line) * (top - start.top) / span : start.line;
}

/** First index whose key is greater than `value` (keys are non-decreasing). */
function upperBound(anchors: ScrollAnchor[], value: number, key: (anchor: ScrollAnchor) => number): number {
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (key(anchors[mid]) <= value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Content offset of the pane's reference point: the top edge when scrolled to the top, the
 * bottom edge when scrolled to the end, and proportionally in between.
 */
export function referenceOffset({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): number {
  const range = scrollHeight - clientHeight;
  if (range <= 0 || scrollHeight <= 0) {
    return 0;
  }
  const top = Math.max(0, Math.min(scrollTop, range));
  return top * scrollHeight / range;
}

/** Inverse of `referenceOffset`: the scrollTop that puts the reference point at `offset`. */
export function scrollTopForOffset(offset: number, { scrollHeight, clientHeight }: Omit<ScrollMetrics, 'scrollTop'>): number {
  const range = scrollHeight - clientHeight;
  if (range <= 0 || scrollHeight <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(range, offset * range / scrollHeight));
}

// ---------------------------------------------------------------------------------------------
// Documents without line anchors (e.g. markdown-it in a frame) are matched by their headings.
// ---------------------------------------------------------------------------------------------

export interface SourceHeading {
  /** 0-based source line. */
  line: number;
  text: string;
}

/** ATX and setext headings of a Markdown document, skipping front matter and fenced code. */
export function sourceHeadings(markdown: string): SourceHeading[] {
  const lines = markdown.split(/\r\n|\r|\n/);
  const headings: SourceHeading[] = [];
  let fence: string | null = null;
  let start = 0;

  if (/^---\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((text, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(text));
    if (end > 0) {
      start = end + 1;
    }
  }

  for (let index = start; index < lines.length; index += 1) {
    const text = lines[index];
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence !== null) {
      if (fenceMatch !== null && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch !== null) {
      fence = fenceMatch[1];
      continue;
    }

    const atx = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(text);
    if (atx !== null) {
      headings.push({ line: index, text: atx.at(1) ?? '' });
      continue;
    }

    const next = lines.at(index + 1);
    if (next !== undefined && /^ {0,3}(=+|-+)[ \t]*$/.test(next) && text.trim().length > 0
      && !/^ {0,3}([-*+>]|\d+[.)])\s/.test(text) && !/^ {0,3}(=+|-+)[ \t]*$/.test(text)) {
      headings.push({ line: index, text: text.trim() });
      index += 1;
    }
  }
  return headings;
}

function normalizeHeading(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Pairs rendered headings (in document order) with source headings by their text; when no
 * text matches but the counts agree, they are paired in order.
 */
export function matchHeadings(rendered: string[], source: SourceHeading[]): (number | null)[] {
  const result: (number | null)[] = [];
  let cursor = 0;
  let matched = 0;
  for (const text of rendered) {
    const key = normalizeHeading(text);
    let found = -1;
    for (let index = cursor; index < source.length && key.length > 0; index += 1) {
      if (normalizeHeading(source[index].text) === key) {
        found = index;
        break;
      }
    }
    if (found >= 0) {
      result.push(source[found].line);
      cursor = found + 1;
      matched += 1;
    } else {
      result.push(null);
    }
  }

  if (matched === 0 && rendered.length > 0 && rendered.length === source.length) {
    return source.map(heading => heading.line);
  }
  return result;
}
