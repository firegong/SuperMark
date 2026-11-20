import { clearIncludeCache, includeOptions } from '../includeLoader';
import { removePreviewFrame } from './framePreview';
import type { PreviewHost, PreviewRenderer } from './types';

/**
 * Preview for Markdown Super Set: an HTML fragment like htmlPreview, plus what only this format
 * has — files included with `@include` (read ahead; the preview renders again when they arrive)
 * and tab sets (§26).
 */
export const superSetPreview: PreviewRenderer = {
  id: 'super-set',
  render(body, text, engine, host) {
    removePreviewFrame(body);
    body.innerHTML = engine.render(text, includeOptions(text, () => host.rerender()));
    attachTabSets(body, host);
    host.didRenderHtml(body);
  },
};

/** Forgets cached included files (e.g. when the window is focused again, they may have changed). */
export function clearSuperSetIncludes(all = false): void {
  clearIncludeCache(all);
}

function attachTabSets(body: HTMLElement, host: PreviewHost): void {
  body.querySelectorAll<HTMLButtonElement>('.msm-tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabset = button.closest('.msm-tabset');
      if (tabset === null) {
        return;
      }

      const index = button.dataset.tab;
      tabset.querySelectorAll<HTMLElement>(':scope > .msm-tab-list > .msm-tab-button, :scope > .msm-tab-panel').forEach(element => {
        element.classList.toggle('is-active', element.dataset.tab === index);
      });
      host.didChangeLayout();
    });
  });
}
