import { includeOptions } from '../../preview/includeLoader';
import { removePreviewFrame } from '../../preview/framePreview';
import { attachTabSets } from '../../preview/tabSets';
import { resolvePreviewImages } from '../../../../common/documentPath';
import type { PreviewRenderer } from '../../types';

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
    resolvePreviewImages(body);
    host.didRenderHtml(body);
  },
};
