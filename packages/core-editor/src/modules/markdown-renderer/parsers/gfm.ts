import { DefaultMarkdownEngine, type SyntaxFeatures } from '../core/blockEngine';
import type { MarkdownRendererEngine } from '../types';

/**
 * GitHub Flavored Markdown: CommonMark plus tables, task lists, strikethrough, autolinks,
 * footnotes and code highlighting.
 *
 * To update or replace this parser, change only this file: export any MarkdownRendererEngine as
 * `gfmEngine` (keep the id `gfm`, which is what the settings save).
 */
export const gfmFeatures: SyntaxFeatures = {
  enableFrontmatter: false,
  enableTables: true,
  enableTaskLists: true,
  enableStrikethrough: true,
  enableAutolinks: true,
  enableFootnotes: true,
  enableMath: false,
  enableMermaid: false,
  enableCallouts: false,
  enableCodeHighlight: true,
};

export const gfmEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('gfm', 'GitHub Flavored Markdown', 'gfm', gfmFeatures);
