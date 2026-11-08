import { createElement } from './utils';

interface DocumentStats {
  characters: number;
  charactersWithoutSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingTime: string;
}

interface CoreModule {
  getEditorText: () => string;
}

interface SelectionModule {
  getText: () => string;
}

function countWords(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const cjkRegex = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const cjkCharacters = text.match(cjkRegex);
  const nonCjkText = text.replace(cjkRegex, ' ');
  const whitespaceWords = nonCjkText.split(/\s+/).filter(token => token.length > 0).length;

  return whitespaceWords + (cjkCharacters?.length ?? 0);
}

function countSentences(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/[.!?]+/).filter(fragment => fragment.trim().length > 0).length;
}

function countParagraphs(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/\n\s*\n/).filter(fragment => fragment.trim().length > 0).length;
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/\r?\n/).length;
}

function readingTime(words: number): string {
  const minutes = Math.ceil(words / 200);
  return words === 0 ? '<1 min' : `${minutes} min`;
}

function computeStats(text: string): DocumentStats {
  return {
    characters: text.length,
    charactersWithoutSpaces: text.replace(/\s/g, '').length,
    words: countWords(text),
    sentences: countSentences(text),
    paragraphs: countParagraphs(text),
    lines: countLines(text),
    readingTime: readingTime(countWords(text)),
  };
}

function appendStats(body: HTMLElement, title: string, stats: DocumentStats) {
  const section = createElement('div', 'markedit-chrome-statistics-section', body);
  createElement('div', 'markedit-chrome-statistics-title', section, title);

  const rows: Array<[string, string | number]> = [
    ['Characters', `${stats.characters} (${stats.charactersWithoutSpaces} without spaces)`],
    ['Words', stats.words],
    ['Sentences', stats.sentences],
    ['Paragraphs', stats.paragraphs],
    ['Lines', stats.lines],
    ['Reading time', stats.readingTime],
  ];

  for (const [label, value] of rows) {
    const row = createElement('div', 'markedit-chrome-statistics-row', section);
    createElement('span', 'markedit-chrome-statistics-label', row, label);
    createElement('span', 'markedit-chrome-statistics-value', row, String(value));
  }
}

export function createStatisticsPopover(): HTMLElement {
  const core = window.webModules.core as unknown as CoreModule;
  const selection = window.webModules.selection as unknown as SelectionModule;

  const root = createElement('div', 'markedit-chrome-panel markedit-chrome-popover markedit-chrome-statistics');
  createElement('div', 'markedit-chrome-popover-header', root, 'Statistics');

  const body = createElement('div', 'markedit-chrome-popover-body', root);
  const fullText = core.getEditorText();
  const selectedText = selection.getText();

  if (selectedText.length > 0) {
    appendStats(body, 'Selection', computeStats(selectedText));
  }

  appendStats(body, 'Document', computeStats(fullText));

  return root;
}
