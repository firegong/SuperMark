import { DefaultMarkdownEngine, type SyntaxFeatures } from '../core/blockEngine';
import type { MarkdownRendererEngine } from '../types';

/**
 * CommonMark (strict): the core Markdown syntax only — no tables, task lists, strikethrough,
 * footnotes, math, diagrams or code highlighting.
 *
 * To update or replace this parser, change only this file: export any MarkdownRendererEngine as
 * `commonmarkEngine` (keep the id `commonmark`, which is what the settings save).
 */
export const commonmarkFeatures: SyntaxFeatures = {
  enableFrontmatter: false,
  enableTables: false,
  enableTaskLists: false,
  enableStrikethrough: false,
  enableAutolinks: false,
  enableFootnotes: false,
  enableMath: false,
  enableMermaid: false,
  enableCallouts: false,
  enableCodeHighlight: false,
};

export const commonmarkEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('commonmark', 'CommonMark', 'commonmark', commonmarkFeatures);
