import { DefaultMarkdownEngine, type SyntaxFeatures } from '../../core/blockEngine';
import type { MarkdownFormat, MarkdownRendererEngine } from '../../types';
import { htmlPreview } from '../../preview/htmlPreview';

/**
 * CommonMark (strict): the core Markdown syntax only — no tables, task lists, strikethrough,
 * footnotes, math, diagrams or code highlighting.
 *
 * To update or replace this parser, change only this folder: export any MarkdownRendererEngine as
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

/** An HTML fragment, styled by the app (chrome/index.css, theme presets). */
export const commonmarkFormat: MarkdownFormat = { engine: commonmarkEngine, preview: htmlPreview };
