import type { MarkdownRenderOptions } from '../../types';

/**
 * Shared types of the gmarkdown parser (docs/reference/GMARKDOWN-SYNTAX.md).
 */

/** A source line after pre-processing; `line` is the 0-based line in the edited document. */
export interface GmarkdownLine {
  text: string;
  line: number;
  /** HTML imported with `@import "x.html"` (sanitized when rendered). */
  rawHtml?: boolean;
  /** A problem to show in its place (e.g. an `@import` that failed). */
  notice?: string;
}

export interface GmarkdownOptions extends MarkdownRenderOptions {
  /** Reads a file for `@import "path"`; `null` when it cannot be read. */
  includeResolver?: (path: string, fromPath: string | null) => string | null;
  /** Path of the edited document, for relative `@import` paths. */
  documentPath?: string | null;
}

export interface GmarkdownHooks {
  highlightCode(code: string, lang: string): string;
  renderMath(latex: string, displayMode: boolean): string;
  /** A rendered diagram (PlantUML, Graphviz), or null when it cannot be rendered. */
  renderDiagram(lang: string, code: string): string | null;
}

export interface Abbreviation {
  abbr: string;
  title: string;
}

export interface GmarkdownContext {
  hooks: GmarkdownHooks;
  abbreviations: Abbreviation[];
  /** One pattern matching every abbreviation, longest first; null without abbreviations. */
  abbreviationPattern: RegExp | null;
  footnoteDefinitions: Map<string, GmarkdownLine[]>;
  footnoteOrder: string[];
  /** Heading ids already used (ids are made unique within the document). */
  headingIds: Map<string, number>;
  /** Heading id → heading text, for `@ref(id)`. */
  headingTexts: Map<string, string>;
  /** Nesting depth of container blocks (quotes, `:::`, `???`, tabs). */
  depth: number;
}

/** An optional capture group (typed as always present by TypeScript). */
export function group(match: RegExpExecArray, index: number): string | undefined {
  return match[index] as string | undefined;
}

/** Deeper container nesting is shown as plain text (each level recurses). */
export const maxNestingDepth = 64;

/** `{#id .class key=value key="value with space" flag}` (§6). */
export interface GmarkdownAttributes {
  id: string | null;
  classes: string[];
  values: Map<string, string>;
  flags: string[];
}

export function parseAttributes(source: string): GmarkdownAttributes {
  const result: GmarkdownAttributes = { id: null, classes: [], values: new Map(), flags: [] };
  const token = /\s*(?:#([^\s"'{}]+)|\.([^\s"'{}]+)|([A-Za-z_][\w:.-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'{}]+))|([A-Za-z_][\w:.-]*))/y;
  let index = 0;
  while (index < source.length) {
    token.lastIndex = index;
    const match = token.exec(source);
    if (match === null || match[0].length === 0) {
      index += 1;
      continue;
    }
    index = token.lastIndex;
    const id = group(match, 1);
    const className = group(match, 2);
    const key = group(match, 3);
    const flag = group(match, 7);
    if (id !== undefined) {
      result.id = id;
    } else if (className !== undefined) {
      result.classes.push(className);
    } else if (key !== undefined) {
      result.values.set(key.toLowerCase(), group(match, 4) ?? group(match, 5) ?? group(match, 6) ?? '');
    } else if (flag !== undefined) {
      result.flags.push(flag.toLowerCase());
    }
  }
  return result;
}

/** Class names safe to put into `class="…"`. */
export function safeClasses(classes: string[]): string[] {
  return classes.filter(name => /^[A-Za-z_][\w-]*$/.test(name));
}

/** An id safe to put into `id="…"` (any script, no quotes or spaces). */
export function safeId(id: string | null): string | null {
  return id !== null && /^[^\s"'<>&]+$/.test(id) ? id : null;
}

/** A size for `width`: a number (pixels) or a number with a CSS unit. */
export function safeSize(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)(px|%|em|rem|vw)?$/.exec(value.trim());
  return match === null ? null : group(match, 2) === undefined ? `${match[1]}px` : value.trim();
}

/** Trailing `{…}` of a line: the attributes and the line without them. */
export function splitTrailingAttributes(text: string): { text: string; attributes: GmarkdownAttributes | null } {
  const match = /[ \t]*\{([^{}]*)\}[ \t]*$/.exec(text);
  if (match === null) {
    return { text, attributes: null };
  }
  return { text: text.slice(0, match.index), attributes: parseAttributes(match[1]) };
}

/** Heading ids (§3.2): lowercase, letters and digits of any script kept, space/`-`/`_` → `-`. */
export function headingId(text: string): string {
  let id = '';
  for (const char of text.toLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      id += char;
    } else if (char === ' ' || char === '-' || char === '_' || char === '\t') {
      id += '-';
    }
  }
  return id.length > 0 ? id : 'heading';
}
