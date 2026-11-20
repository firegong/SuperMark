import { extendedEngine } from './extended';
import type { MarkdownRendererEngine } from '../types';

/**
 * markdown-it, as bundled by the MarkEdit Preview extension (`markedit-preview.js`), offered as
 * one more parser in View → Markdown Parser. The extension exposes its renderer as
 * `window.MarkEditRenderHtml(markdown, styled)`; the built-in preview shows the styled document
 * in an isolated frame, so there is a single preview UI whichever parser is chosen.
 */

export const markdownItEngineId = 'markdown-it';

/** Capability (file name) of the extension that provides the renderer. */
export const markdownItExtension = 'markedit-preview.js';

type RenderHtml = (markdown: string, styled: boolean) => Promise<string>;

function extensionRenderer(): RenderHtml | undefined {
  const render = (window as unknown as { MarkEditRenderHtml?: unknown }).MarkEditRenderHtml;
  return typeof render === 'function' ? render as RenderHtml : undefined;
}

function stripMetaCharset(html: string): string {
  return html.replace(/^\s*<meta charset="UTF-8">\s*/i, '');
}

export const markdownItEngine: MarkdownRendererEngine = {
  id: markdownItEngineId,
  name: 'markdown-it (MarkEdit Preview)',
  standard: 'markdown-it',
  // Synchronous callers get the built-in Extended rendering; the preview uses renderDocument.
  render(markdown, options) {
    return extendedEngine.render(markdown, options);
  },
  async renderAsync(markdown) {
    const render = extensionRenderer();
    if (render === undefined) {
      return extendedEngine.render(markdown);
    }
    return stripMetaCharset(await render(markdown, false));
  },
  async renderDocument(markdown) {
    const render = extensionRenderer();
    if (render === undefined) {
      return `<!doctype html><html><body>${extendedEngine.render(markdown)}</body></html>`;
    }
    return render(markdown, true);
  },
};

/** Whether the extension's renderer is loaded and the extension is enabled. */
export function isMarkdownItAvailable(extensionScripts: { capability: string }[]): boolean {
  return extensionRenderer() !== undefined && extensionScripts.some(script => script.capability === markdownItExtension);
}
