import { DefaultMarkdownEngine, type SyntaxFeatures } from '../../core/blockEngine';
import type { MarkdownFormat, MarkdownRendererEngine } from '../../types';
import { htmlPreview } from '../../preview/htmlPreview';

/**
 * GitHub Flavored Markdown: CommonMark plus tables, task lists, strikethrough, autolinks,
 * footnotes and code highlighting.
 *
 * To update or replace this parser, change only this folder: export any MarkdownRendererEngine as
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

/** An HTML fragment, styled by the app (chrome/index.css, theme presets). */
export const gfmFormat: MarkdownFormat = { engine: gfmEngine, preview: htmlPreview };
