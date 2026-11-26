import type { MarkdownFormat, MarkdownRendererEngine, PreviewRenderer } from '../types';
import { framePreview } from '../preview/framePreview';
import { htmlPreview } from '../preview/htmlPreview';
import { superSetFormat } from './markdownSuperSet';

/**
 * The Markdown formats that ship with the app. Only Markdown Super Set ships built in;
 * every other parser is delivered as an extension (see SuperMark-extensions registry).
 *
 * To add a format, create its folder and list it here. markdown-it (markdownIt/) is added at
 * run time when the MarkEdit Preview extension provides it.
 */
export const builtInFormats: readonly MarkdownFormat[] = [
  superSetFormat,
];

export const defaultFormat: MarkdownFormat = superSetFormat;

/** The built-in parsers (the engines of builtInFormats). */
export const builtInParsers: readonly MarkdownRendererEngine[] = builtInFormats.map(format => format.engine);

export const defaultParser: MarkdownRendererEngine = defaultFormat.engine;

/**
 * The preview for a parser registered without one (e.g. by an extension): the frame preview when
 * it produces complete documents (`renderDocument`), else the HTML fragment preview.
 */
export function defaultPreviewFor(engine: MarkdownRendererEngine): PreviewRenderer {
  return engine.renderDocument !== undefined ? framePreview : htmlPreview;
}

export { superSetFormat };
export { superMarkdownEngine } from './markdownSuperSet';
