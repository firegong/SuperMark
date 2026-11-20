import type { MarkdownRendererEngine } from '../../modules/markdown-renderer';

/**
 * What a preview needs from the preview pane (markdownPreview.ts), which owns what all previews
 * share: layout, scroll sync, task checkboxes, code copy buttons and link clicks.
 */
export interface PreviewHost {
  /** Renders again (e.g. when files included by the document have arrived). */
  rerender(): void;
  /** HTML was put into the body: attach the shared interactions, realign scrolling, hydrate diagrams. */
  didRenderHtml(body: HTMLElement): void;
  /** A preview frame loaded a new document. */
  didLoadFrame(frameDocument: Document): void;
  /** The preview's content changed size or position without a new render (e.g. a tab switched). */
  didChangeLayout(): void;
}

/**
 * Shows one parser's output in the preview body. One file per kind of preview, chosen per parser
 * in index.ts, so a preview can be updated or replaced without touching the others.
 */
export interface PreviewRenderer {
  readonly id: string;
  render(body: HTMLElement, text: string, engine: MarkdownRendererEngine, host: PreviewHost): void;
}
