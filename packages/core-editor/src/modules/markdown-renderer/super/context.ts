import type { MarkdownBlockPlugin, MarkdownRenderOptions } from '../types';

/** Source line with its absolute (0-based) line number in the editor document. */
export interface SourceLine {
  text: string;
  line: number;
  /** Set for `[ref]: url` definitions collected in the pre-pass. */
  isDefinition?: boolean;
  /** Why an `@include` line could not be expanded. */
  includeError?: string;
}

export type CrossRefKind = 'sec' | 'fig' | 'tbl' | 'eq' | 'lst' | 'heading';

export interface CrossRefLabels {
  sec: (number: string) => string;
  fig: (number: number) => string;
  tbl: (number: number) => string;
  eq: (number: number) => string;
  lst: (number: number) => string;
}

export interface SuperMarkdownOptions extends MarkdownRenderOptions {
  /** Resolves `@include path` (§27). Return `null` when the file cannot be read. */
  includeResolver?: (path: string, fromPath: string | null) => string | null;
  /** Path of the document being rendered, passed to `includeResolver`. */
  documentPath?: string | null;
  /** Runs an executable chunk (§13). Return plain-text output, or `null` when unsupported. */
  codeRunner?: (lang: string, code: string, options: Map<string, string>) => string | null;
  /** Renders a diagram that has no built-in renderer, e.g. PlantUML (§14). Must return safe SVG/HTML. */
  diagramRenderer?: (lang: string, code: string, options: Map<string, string>) => string | null;
  /** Output format used for `.only-*` blocks (§24). The preview is `html`. */
  outputFormat?: 'html' | 'latex' | 'docx';
  crossRefLabels?: Partial<CrossRefLabels>;
}

export interface HeadingInfo {
  level: number;
  id: string;
  html: string;
  label: string | null;
}

export interface LabelInfo {
  kind: CrossRefKind;
  id: string;
  /** Sequence number for fig/tbl/eq/lst; heading index for sec/heading. */
  index: number;
}

export interface SuperContext {
  options: SuperMarkdownOptions;
  crossRefLabels: CrossRefLabels;
  metadata: Map<string, string>;
  execute: boolean;
  references: Map<string, { href: string; title: string }>;
  footnoteDefinitions: Map<string, SourceLine[]>;
  footnoteOrder: string[];
  headings: HeadingInfo[];
  labels: Map<string, LabelInfo>;
  duplicateLabels: Set<string>;
  usedIds: Map<string, number>;
  counters: { fig: number; tbl: number; eq: number; lst: number; example: number };
  exampleLabels: Map<string, number>;
  blockPlugins: MarkdownBlockPlugin[];
  renderMath(latex: string, displayMode: boolean): string;
  renderMermaid(code: string): string;
  highlightCode(code: string, lang: string): string;
}

export const defaultCrossRefLabels: CrossRefLabels = {
  sec: number => `${number}절`,
  fig: number => `그림 ${number}`,
  tbl: number => `표 ${number}`,
  eq: number => `식 (${number})`,
  lst: number => `목록 ${number}`,
};

/** Private-use markers for placeholders resolved after the whole document is rendered. */
/** Optional regex capture group (TypeScript types groups as always present). */
export function group(match: RegExpExecArray, index: number): string | undefined {
  return match[index] as string | undefined;
}

export const placeholderStart = '';
export const placeholderEnd = '';

export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Unicode-aware heading slug (keeps Hangul and other letters). */
export function slugifyUnicode(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/&[#\w]+;/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug.length > 0 ? slug.slice(0, 80) : 'section';
}

export function uniqueId(context: SuperContext, base: string): string {
  const count = context.usedIds.get(base) ?? 0;
  context.usedIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function labelKind(label: string, fallback: CrossRefKind): CrossRefKind {
  const prefix = /^(sec|fig|tbl|eq|lst):/.exec(label)?.[1];
  return (prefix as CrossRefKind | undefined) ?? fallback;
}

/**
 * Registers a cross-reference target. Returns the sequence number for numbered kinds,
 * or `null` when the label is a duplicate (§21: defining a label twice is an error).
 */
export function registerLabel(context: SuperContext, label: string, kind: CrossRefKind, id: string, headingIndex = -1): number | null {
  if (context.labels.has(label)) {
    context.duplicateLabels.add(label);
    return null;
  }

  let index = headingIndex;
  if (kind === 'fig' || kind === 'tbl' || kind === 'eq' || kind === 'lst') {
    context.counters[kind] += 1;
    index = context.counters[kind];
  }

  context.labels.set(label, { kind, id, index });
  return index;
}
