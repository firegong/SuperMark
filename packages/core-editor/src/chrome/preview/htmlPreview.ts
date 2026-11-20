import { removePreviewFrame } from './framePreview';
import type { PreviewRenderer } from './types';

/**
 * Preview for parsers that produce an HTML fragment (CommonMark, GFM, Extended): the fragment is
 * put into the preview body and styled by the app (chrome/index.css, theme presets).
 */
export const htmlPreview: PreviewRenderer = {
  id: 'html',
  render(body, text, engine, host) {
    removePreviewFrame(body);
    body.innerHTML = engine.render(text);
    host.didRenderHtml(body);
  },
};
