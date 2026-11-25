import type { MarkdownFormat, MarkdownRendererEngine, PreviewRenderer } from '../types';
import { framePreview } from '../preview/framePreview';
import { htmlPreview } from '../preview/htmlPreview';
import { commonmarkFormat } from './commonmark';
import { gfmFormat } from './gfm';
import { extendedFormat } from './extended';
import { superSetFormat } from './markdownSuperSet';
import { micromarkFormat } from './micromark';
import { gmarkdownFormat } from './gmarkdown';

/**
 * The Markdown formats that ship with the app, one folder each, in the order of
 * View → Markdown Parser. A format module (formats/<name>/index.ts) holds the parser, which
 * renders HTML following the markup contract (previewMarkup.ts), and the preview that shows it.
 * What formats share stays shared: core/ (block engine, mdast renderer, HTML filter), plugins/
 * (diagrams, math, code coloring) and preview/ (HTML fragment and frame previews, tab sets,
 * included files).
 *
 * To add a format, create its folder and list it here. markdown-it (markdownIt/) is added at
 * run time when the MarkEdit Preview extension provides it.
 */
export const builtInFormats: readonly MarkdownFormat[] = [
  commonmarkFormat,
  gfmFormat,
  extendedFormat,
  superSetFormat,
  micromarkFormat,
  gmarkdownFormat,
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

export { commonmarkFormat, gfmFormat, extendedFormat, superSetFormat, micromarkFormat, gmarkdownFormat };
export { commonmarkEngine } from './commonmark';
export { gfmEngine } from './gfm';
export { extendedEngine } from './extended';
export { superMarkdownEngine } from './markdownSuperSet';
export { micromarkEngine } from './micromark';
export { gmarkdownEngine } from './gmarkdown';
