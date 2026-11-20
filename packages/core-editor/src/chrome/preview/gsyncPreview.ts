import { includeOptions } from '../includeLoader';
import { removePreviewFrame } from './framePreview';
import { attachTabSets } from './tabSets';
import type { PreviewRenderer } from './types';

/**
 * Preview for gsync Markdown (docs/reference/GSYNC-MARKDOWN-SYNTAX.md): an HTML fragment, plus
 * files brought in with `@import "path"` (read ahead; the preview renders again when they arrive)
 * and code tabs (`::: code-tabs`).
 */
export const gsyncPreview: PreviewRenderer = {
  id: 'gsync',
  render(body, text, engine, host) {
    removePreviewFrame(body);
    body.innerHTML = engine.render(text, includeOptions(text, () => host.rerender()));
    attachTabSets(body, host);
    host.didRenderHtml(body);
  },
};
