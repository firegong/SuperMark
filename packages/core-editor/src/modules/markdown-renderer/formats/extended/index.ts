import { DefaultMarkdownEngine, type SyntaxFeatures } from '../../core/blockEngine';
import type { MarkdownFormat, MarkdownRendererEngine } from '../../types';
import { htmlPreview } from '../../preview/htmlPreview';

/**
 * Extended Markdown (the default parser): GFM plus front matter, math, Mermaid and other
 * diagrams, and callouts.
 *
 * To update or replace this parser, change only this folder: export any MarkdownRendererEngine as
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

/** An HTML fragment, styled by the app (chrome/index.css, theme presets). */
export const extendedFormat: MarkdownFormat = { engine: extendedEngine, preview: htmlPreview };
