import { escapeHtml } from '../utils';
import { krokiImageUrl } from './kroki';
import { markDiagramFailed, markDiagramRendered, type DiagramRenderContext } from './registry';

/**
 * Local-then-server rendering for diagrams that need an external renderer.
 *
 * - local: tools on this computer (PlantUML/D2 through the desktop app, bundled mermaid.js)
 * - server: a Kroki-compatible diagram server
 *
 * In `auto` mode a missing local tool falls back to the server; a diagram *error* from the local
 * tool is shown as is (sending a broken diagram to the server would not help). Results are
 * cached by source, so re-rendering the preview while typing elsewhere shows them immediately.
 */

/** Thrown by a local renderer that is not available (tool not installed, not in the desktop app). */
export class RendererUnavailableError extends Error {}

export interface DiagramSources {
  /** Display name, e.g. "PlantUML". */
  name: string;
  lang: string;
  code: string;
  /** Renders locally and returns SVG markup; throws RendererUnavailableError when unavailable. */
  local?: () => Promise<string>;
  /** Kroki diagram type for server rendering (`plantuml`, `d2`, `mermaid`), if supported. */
  serverType?: string;
}

const resultCache = new Map<string, string>();
const maxCacheEntries = 150;

function cacheKey(context: DiagramRenderContext, lang: string, code: string): string {
  return `${context.rendering}\u0000${context.server ?? ''}\u0000${lang}\u0000${code}`;
}

/** Cached `<img>` HTML for a diagram rendered earlier with the same settings, if any. */
export function cachedDiagramHtml(context: DiagramRenderContext, lang: string, code: string): string | null {
  return resultCache.get(cacheKey(context, lang, code)) ?? null;
}

function remember(context: DiagramRenderContext, lang: string, code: string, html: string): void {
  if (resultCache.size >= maxCacheEntries) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) {
      resultCache.delete(oldest);
    }
  }
  resultCache.set(cacheKey(context, lang, code), html);
}

export function clearDiagramCache(): void {
  resultCache.clear();
}

/** SVG markup as an image: an SVG inside `<img>` cannot run script or reach the document. */
export function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function imageHtml(src: string, name: string): string {
  return `<img class="markedit-diagram-image" alt="${escapeHtml(name)} diagram" src="${escapeHtml(src)}">`;
}

async function loadImage(src: string, name: string): Promise<HTMLImageElement> {
  const image = document.createElement('img');
  image.className = 'markedit-diagram-image';
  image.alt = `${name} diagram`;
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('image failed to load')), { once: true });
    image.src = src;
  });
  return image;
}

// Local tools are slow processes (PlantUML starts a JVM); run at most two at a time and skip
// placeholders that left the document (the preview re-rendered while they were waiting).
let running = 0;
const waiting: (() => void)[] = [];

async function withLocalSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) {
    await new Promise<void>(resolve => waiting.push(resolve));
  }
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

class StaleElementError extends Error {}

/** Renders a placeholder with the sources allowed by `context.rendering`. */
export async function renderDiagramSources(element: HTMLElement, sources: DiagramSources, context: DiagramRenderContext): Promise<void> {
  const order = context.rendering === 'local' ? ['local'] : context.rendering === 'server' ? ['server'] : ['local', 'server'];
  const reasons: string[] = [];

  for (const source of order) {
    if (source === 'local') {
      if (sources.local === undefined) {
        reasons.push(`no local ${sources.name} renderer`);
        continue;
      }

      try {
        const local = sources.local;
        const svg = await withLocalSlot(async () => {
          if (!element.isConnected) {
            throw new StaleElementError();
          }
          return local();
        });
        const src = svgToDataUrl(svg);
        const image = await loadImage(src, sources.name);
        remember(context, sources.lang, sources.code, imageHtml(src, sources.name));
        markDiagramRendered(element, image);
        return;
      } catch (error) {
        if (error instanceof StaleElementError) {
          return;
        }
        if (error instanceof RendererUnavailableError) {
          reasons.push(error.message);
          continue;
        }
        markDiagramFailed(element, `${sources.name}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    if (source === 'server') {
      if (sources.serverType === undefined) {
        reasons.push(`the diagram server does not support ${sources.name}`);
        continue;
      }
      if (context.server === null) {
        reasons.push('no diagram server is set');
        continue;
      }

      try {
        const url = await krokiImageUrl(context.server, sources.serverType, sources.code);
        const image = await loadImage(url, sources.name);
        remember(context, sources.lang, sources.code, imageHtml(url, sources.name));
        markDiagramRendered(element, image);
      } catch {
        markDiagramFailed(element, `${sources.name}: the diagram server could not render this diagram (check the syntax or the server).`);
      }
      return;
    }
  }

  markDiagramFailed(element, `${sources.name} could not be rendered: ${reasons.join('; ')}. See Settings → General → Diagram Rendering.`);
}
