import { transformBytes } from './compression';
import { diagramPlaceholder, renderedDiagram, type DiagramPlugin, type DiagramRenderContext } from './registry';
import { cachedDiagramHtml, renderDiagramSources } from './strategy';
import { renderGraphvizLocally, renderWithLocalTool } from './local';

/**
 * Diagram plugins backed by a Kroki-compatible server (https://kroki.io or self-hosted).
 *
 * The diagram is loaded as an `<img>` from `GET {server}/{type}/svg/{encoded}` where `encoded`
 * is the source compressed with zlib deflate and base64url-encoded (Kroki's URL format). Using an
 * image keeps server output out of the document: an SVG inside `<img>` cannot run script.
 */

const urlCache = new Map<string, string>();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** zlib-deflates `text` (UTF-8) and returns base64url, as expected by Kroki GET requests. */
export async function encodeKrokiSource(text: string): Promise<string> {
  const bytes = await transformBytes(new TextEncoder().encode(text), new CompressionStream('deflate'));
  return toBase64Url(bytes);
}

export async function krokiImageUrl(server: string, type: string, source: string): Promise<string> {
  const key = `${server}\u0000${type}\u0000${source}`;
  const cached = urlCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const url = `${server}/${encodeURIComponent(type)}/svg/${await encodeKrokiSource(source)}`;
  if (urlCache.size > 200) {
    urlCache.clear();
  }
  urlCache.set(key, url);
  return url;
}

type LocalRenderer = (lang: string, code: string) => Promise<string>;

function createDiagramPlugin(id: string, name: string, languages: string[], local: LocalRenderer = renderWithLocalTool): DiagramPlugin {
  return {
    id,
    name,
    languages,
    render(code, lang, context) {
      return renderCachedOrPlaceholder(id, name, lang, code, context);
    },
    async hydrate(element, code, lang, context) {
      await renderDiagramSources(element, {
        name,
        lang,
        code,
        local: async () => local(lang, code),
        serverType: id,
      }, context);
    },
  };
}

/** Shows a cached result immediately, or a placeholder that `hydrate` completes. */
export function renderCachedOrPlaceholder(id: string, name: string, lang: string, code: string, context: DiagramRenderContext, previewHtml?: string): string {
  const cached = cachedDiagramHtml(context, lang, code);
  if (cached !== null) {
    return renderedDiagram(cached);
  }
  return diagramPlaceholder(id, lang, code, `Rendering ${name} diagram…`, previewHtml);
}

/** PlantUML: local `plantuml` (or plantuml.jar) first, then the diagram server. */
export const plantumlPlugin = createDiagramPlugin('plantuml', 'PlantUML', ['plantuml', 'puml', 'uml']);

/** D2: local `d2` first, then the diagram server. */
export const d2Plugin = createDiagramPlugin('d2', 'D2', ['d2']);

/** Graphviz: local `dot`, else the bundled viz.js (Graphviz as WebAssembly), then the diagram server. */
export const graphvizPlugin = createDiagramPlugin('graphviz', 'Graphviz', ['dot', 'graphviz'], renderGraphvizLocally);
