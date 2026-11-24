import type { MarkdownFormat } from '../../types';
import { htmlPreview } from '../../preview/htmlPreview';
import { micromarkEngine } from './parser';

/**
 * micromark (CommonMark + GFM + math, strictly to the specifications): parser.ts parses into an
 * mdast tree and renders it with the shared core/mdastRenderer.ts; the HTML fragment is shown by
 * the shared HTML preview. To update or replace this format, change only this folder.
 */
export const micromarkFormat: MarkdownFormat = { engine: micromarkEngine, preview: htmlPreview };

export { micromarkEngine, tamePathologicalInput } from './parser';
