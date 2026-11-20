import type { MarkdownFormat, MarkdownRendererEngine } from '../../types';
import { SuperMarkdownEngine } from './engine';
import { superSetPreview } from './preview';

/**
 * Markdown Super Set: MultiMarkdown 6 with Pandoc, GFM and Obsidian syntax, plus merged table
 * cells, cross references, run/render chunks, includes and more (see
 * docs/05-testing/samples/MarkdownSuperSetGrammar.md). Its own engine lives in this folder.
 *
 * To update or replace this parser, change only this folder: export any MarkdownRendererEngine as
 * `superMarkdownEngine` (keep the id `super`, which is what the settings save).
 */
export const superMarkdownEngine: MarkdownRendererEngine = new SuperMarkdownEngine();

/** The HTML fragment, plus `@include` files and tab sets (preview.ts). */
export const superSetFormat: MarkdownFormat = { engine: superMarkdownEngine, preview: superSetPreview };

export { SuperMarkdownEngine, superSetPreview };
export { clearSuperSetIncludes } from './preview';
export type { SuperMarkdownOptions } from './context';
