import type { PreviewHost } from '../types';

/**
 * Tab sets (`.msm-tabset`): clicking a tab shows its panel. Used by previews whose parsers render
 * tabs (Markdown Super Set §26, gsync code tabs).
 */
export function attachTabSets(body: HTMLElement, host: PreviewHost): void {
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
