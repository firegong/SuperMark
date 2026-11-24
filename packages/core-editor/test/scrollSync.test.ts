import { describe, expect, test } from '@jest/globals';
import {
  buildAnchors,
  lineToOffset,
  matchHeadings,
  offsetToLine,
  referenceOffset,
  scrollTopForOffset,
  sourceHeadings,
} from '../src/chrome/scrollSync';

describe('Scroll sync geometry', () => {
  test('builds a monotonic anchor map with start and end points', () => {
    const anchors = buildAnchors([
      { line: 4, top: 300 },
      { line: 2, top: 100 },
      { line: 2, top: 120 }, // same line, lower element: the topmost wins
      { line: 3, top: 900 }, // footnote rendered at the end: out of order
      { line: 6, top: 500 },
    ], 10, 1000);

    expect(anchors).toEqual([
      { line: 0, top: 0 },
      { line: 2, top: 100 },
      { line: 4, top: 300 },
      { line: 6, top: 500 },
      { line: 10, top: 1000 },
    ]);
  });

  test('interpolates between anchors in both directions', () => {
    const anchors = buildAnchors([{ line: 2, top: 100 }, { line: 6, top: 500 }], 10, 1000);
    expect(lineToOffset(anchors, 4)).toBe(300);
    expect(lineToOffset(anchors, 1)).toBe(50);
    expect(lineToOffset(anchors, 8)).toBe(750);
    expect(offsetToLine(anchors, 300)).toBe(4);
    expect(offsetToLine(anchors, 750)).toBe(8);
    expect(offsetToLine(anchors, 5000)).toBe(10);

    for (const line of [0, 0.5, 3.25, 7, 9.9]) {
      expect(offsetToLine(anchors, lineToOffset(anchors, line))).toBeCloseTo(line);
    }
  });

  test('keeps blocks sharing an offset from dividing by zero', () => {
    const anchors = buildAnchors([{ line: 1, top: 100 }, { line: 2, top: 100 }, { line: 3, top: 200 }], 4, 300);
    expect(offsetToLine(anchors, 100)).toBe(2);
    expect(offsetToLine(anchors, 150)).toBe(2.5);
  });

  test('reference point slides from the top edge to the bottom edge', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 200 };
    expect(referenceOffset({ ...metrics, scrollTop: 0 })).toBe(0);
    expect(referenceOffset({ ...metrics, scrollTop: 800 })).toBe(1000);
    expect(referenceOffset({ ...metrics, scrollTop: 400 })).toBe(500);
    expect(scrollTopForOffset(500, metrics)).toBe(400);
    expect(scrollTopForOffset(2000, metrics)).toBe(800);
    expect(referenceOffset({ scrollTop: 0, scrollHeight: 100, clientHeight: 200 })).toBe(0);
    expect(scrollTopForOffset(50, { scrollHeight: 100, clientHeight: 200 })).toBe(0);
  });

  test('finds source headings outside front matter and code', () => {
    const markdown = [
      '---', 'title: x', '# not a heading', '---',
      '# Intro',
      '```', '# code', '```',
      'Setext',
      '------',
      '- item',
      '---',
      '## Closing ##',
    ].join('\n');

    expect(sourceHeadings(markdown)).toEqual([
      { line: 4, text: 'Intro' },
      { line: 8, text: 'Setext' },
      { line: 12, text: 'Closing' },
    ]);
  });

  test('matches rendered headings to source headings by text', () => {
    const source = [{ line: 0, text: 'Intro' }, { line: 5, text: '**Usage**' }, { line: 9, text: 'End' }];
    expect(matchHeadings(['Intro', 'Usage', 'End'], source)).toEqual([0, 5, 9]);
    expect(matchHeadings(['#Intro', 'Other', 'End'], source)).toEqual([0, null, 9]);
    // Texts differ (e.g. rendered placeholders) but the counts agree: paired in order.
    expect(matchHeadings(['A', 'B', 'C'], source)).toEqual([0, 5, 9]);
  });
});
