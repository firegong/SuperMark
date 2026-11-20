import type { MarkdownRendererEngine } from '../../types';
import { SuperMarkdownEngine } from './engine';

/**
 * Markdown Super Set: MultiMarkdown 6 with Pandoc, GFM and Obsidian syntax, plus merged table
 * cells, cross references, run/render chunks, includes and more (see
 * docs/05-testing/samples/MarkdownSuperSetGrammar.md). Its own engine lives in this folder.
 *
 * To update or replace this parser, change only this folder: export any MarkdownRendererEngine as
 * `superMarkdownEngine` (keep the id `super`, which is what the settings save).
 */
export const superMarkdownEngine: MarkdownRendererEngine = new SuperMarkdownEngine();

export { SuperMarkdownEngine };
export type { SuperMarkdownOptions } from './context';
