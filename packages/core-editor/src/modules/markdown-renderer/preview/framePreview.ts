import type { PreviewRenderer } from '../types';
import { resolvePreviewImages } from '../../../common/documentPath';

/**
 * Preview for parsers that produce a complete, self-styled HTML document (`renderDocument`, e.g.
 * markdown-it from the MarkEdit Preview extension). The document is shown in a sandboxed frame:
 * its CSS cannot reach the app and its inline scripts do not run (`allow-same-origin` without
 * `allow-scripts` lets the preview update and scroll the frame).
 */

let frameRenderToken = 0;

export function previewFrame(body: HTMLElement): HTMLIFrameElement | null {
  return body.querySelector<HTMLIFrameElement>(':scope > iframe.markedit-preview-frame');
}

/** Removes the frame (another preview takes over); a render still in progress is dropped. */
export function removePreviewFrame(body: HTMLElement): void {
  frameRenderToken += 1;
  previewFrame(body)?.remove();
  body.classList.remove('has-frame');
}

export const framePreview: PreviewRenderer = {
  id: 'frame',
  render(body, text, engine, host) {
    const renderDocument = engine.renderDocument?.bind(engine);
    if (renderDocument === undefined) {
      return;
    }

    const token = ++frameRenderToken;
    void (async () => {
      let html: string;
      try {
        html = await renderDocument(text);
      } catch (error) {
        console.error('[MarkEdit] Preview rendering failed:', error);
        return;
      }

      // A newer render started, or another preview took over.
      if (token !== frameRenderToken) {
        return;
      }

      const parsed = new DOMParser().parseFromString(html, 'text/html');
      let frame = previewFrame(body);
      const frameDocument = frame?.contentDocument ?? null;
      const headSignature = parsed.head.innerHTML.length.toString();

      // Same styles as before: swap the body in place so scroll position and styles stay put.
      if (frame !== null && frameDocument !== null && frame.dataset.head === headSignature) {
        frameDocument.body.innerHTML = parsed.body.innerHTML;
        host.didChangeLayout();
        return;
      }

      if (frame === null) {
        body.replaceChildren();
        frame = document.createElement('iframe');
        frame.className = 'markedit-preview-frame';
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.title = 'Markdown preview';
        body.appendChild(frame);
        body.classList.add('has-frame');
      }

      frame.dataset.head = headSignature;
      const scrollTop = frame.contentDocument?.scrollingElement?.scrollTop ?? 0;
      frame.addEventListener('load', () => {
        const loaded = frame.contentDocument;
        if (loaded === null) {
          return;
        }
        if (loaded.scrollingElement !== null) {
          loaded.scrollingElement.scrollTop = scrollTop;
        }
        resolvePreviewImages(loaded);
        host.didLoadFrame(loaded);
      }, { once: true });
      frame.srcdoc = html;
    })();
  },
};
