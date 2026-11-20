import { superMarkdownEngine, type MarkdownRendererEngine } from '../../modules/markdown-renderer';
import { framePreview } from './framePreview';
import { htmlPreview } from './htmlPreview';
import { superSetPreview } from './superSetPreview';
import type { PreviewRenderer } from './types';

/**
 * Which preview shows which parser's output. Parsers without an entry get the frame preview when
 * they produce complete documents (`renderDocument`), else the HTML fragment preview.
 */
const previewsByParser = new Map<string, PreviewRenderer>([
  [superMarkdownEngine.id, superSetPreview],
]);

export function previewFor(engine: MarkdownRendererEngine): PreviewRenderer {
  return previewsByParser.get(engine.id) ?? (engine.renderDocument !== undefined ? framePreview : htmlPreview);
}

/** Uses `preview` for the parser `parserId` (e.g. a parser added by an extension). */
export function setParserPreview(parserId: string, preview: PreviewRenderer): void {
  previewsByParser.set(parserId, preview);
}

export { framePreview, htmlPreview, superSetPreview };
export { previewFrame, removePreviewFrame } from './framePreview';
export { clearSuperSetIncludes } from './superSetPreview';
export type { PreviewHost, PreviewRenderer } from './types';
