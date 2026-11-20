import { DefaultMarkdownEngine, type SyntaxFeatures } from '../core/blockEngine';
import type { MarkdownRendererEngine } from '../types';

/**
 * Extended Markdown (the default parser): GFM plus front matter, math, Mermaid and other
 * diagrams, and callouts.
 *
 * To update or replace this parser, change only this file: export any MarkdownRendererEngine as
 * `extendedEngine` (keep the id `extended`, which is what the settings save).
 */
export const extendedFeatures: SyntaxFeatures = {
  enableFrontmatter: true,
  enableTables: true,
  enableTaskLists: true,
  enableStrikethrough: true,
  enableAutolinks: true,
  enableFootnotes: true,
  enableMath: true,
  enableMermaid: true,
  enableCallouts: true,
  enableCodeHighlight: true,
};

export const extendedEngine: MarkdownRendererEngine = new DefaultMarkdownEngine('extended', 'Extended Markdown', 'extended', extendedFeatures);
