import type { MarkdownRendererEngine } from '../types';
import { commonmarkEngine } from './commonmark';
import { gfmEngine } from './gfm';
import { extendedEngine } from './extended';
import { superMarkdownEngine } from './markdownSuperSet';

/**
 * The parsers that ship with the app, one file (or folder) each, in the order of
 * View → Markdown Parser. To add a parser, create its file and list it here; markdown-it
 * (markdownIt.ts) is added at run time when the MarkEdit Preview extension provides it.
 * How each parser's output is shown is chosen in src/chrome/preview/.
 */
export const builtInParsers: readonly MarkdownRendererEngine[] = [
  commonmarkEngine,
  gfmEngine,
  extendedEngine,
  superMarkdownEngine,
];

export const defaultParser: MarkdownRendererEngine = extendedEngine;

export { commonmarkEngine, gfmEngine, extendedEngine, superMarkdownEngine };
