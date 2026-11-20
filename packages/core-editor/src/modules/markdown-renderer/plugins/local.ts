import { RendererUnavailableError } from './strategy';
import { sansStack } from '../../../styling/fonts';

/**
 * Local diagram renderers:
 * - PlantUML and D2 through the desktop app (`diagram_render_local`, see src-tauri/src/diagrams)
 * - Mermaid with the bundled mermaid.js (dist/vendor/mermaid.min.js, loaded on first use)
 */

interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

function tauri(): TauriInternals | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
}

/** Renders PlantUML / D2 with the locally installed tool. */
export async function renderWithLocalTool(lang: string, code: string): Promise<string> {
  const host = tauri();
  if (host === undefined) {
    throw new RendererUnavailableError('local tools are only available in the desktop app');
  }

  try {
    return String(await host.invoke('diagram_render_local', { lang, source: code }));
  } catch (error) {
    const message = String(error);
    if (message.startsWith('not-installed:')) {
      throw new RendererUnavailableError(message.slice('not-installed:'.length).trim());
    }
    throw new Error(message.replace(/^failed:\s*/, ''));
  }
}

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, code: string): Promise<{ svg: string }>;
}

/** Where the bundled mermaid.js is served from (next to index.html). */
export const mermaidScriptUrl = 'vendor/mermaid.min.js';

let mermaidLoading: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (mermaidLoading !== null) {
    return mermaidLoading;
  }

  mermaidLoading = new Promise<MermaidApi>((resolve, reject) => {
    const existing = (window as unknown as { mermaid?: MermaidApi }).mermaid;
    if (existing !== undefined) {
      resolve(existing);
      return;
    }

    const script = document.createElement('script');
    script.src = mermaidScriptUrl;
    script.async = true;
    script.addEventListener('load', () => {
      const api = (window as unknown as { mermaid?: MermaidApi }).mermaid;
      if (api === undefined) {
        reject(new RendererUnavailableError('mermaid.js did not load'));
        return;
      }
      api.initialize({
        startOnLoad: false,
        // Strict: no click handlers or scripts in diagrams; HTML labels off so the SVG works as an <img>.
        securityLevel: 'strict',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme: 'default',
        fontFamily: sansStack,
        // Do not draw Mermaid's error graphic into the page; errors are shown by the plugin.
        suppressErrorRendering: true,
        // Gantt charts size themselves to their (off-screen) container; give them a real width.
        gantt: { useWidth: 960 },
      });
      resolve(api);
    }, { once: true });
    script.addEventListener('error', () => {
      mermaidLoading = null;
      reject(new RendererUnavailableError('the bundled mermaid.js is not available'));
    }, { once: true });
    document.head.appendChild(script);
  });

  return mermaidLoading;
}

/**
 * Mermaid SVGs use `width="100%"` with a max-width style, which gives an `<img>` no intrinsic
 * size (it falls back to 300×150). Use the viewBox size instead.
 */
export function withIntrinsicSize(svg: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  const viewBox = open === null ? null : /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(open[0]);
  if (open === null || viewBox === null) {
    return svg;
  }

  const width = Math.ceil(Number(viewBox[1]));
  const height = Math.ceil(Number(viewBox[2]));
  const tag = open[0]
    .replace(/\swidth="[^"]*"/, '')
    .replace(/\sheight="[^"]*"/, '')
    .replace(/max-width:\s*[\d.]+px;?/, '')
    .replace(/^<svg/, `<svg width="${width}" height="${height}"`);
  return svg.replace(open[0], tag);
}

// mermaid.render uses shared state; render one diagram at a time.
let mermaidBusy: Promise<void> = Promise.resolve();
let mermaidCounter = 0;

async function exclusively<T>(task: () => Promise<T>): Promise<T> {
  const previous = mermaidBusy;
  let release = () => {};
  mermaidBusy = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

/** Renders Mermaid with the bundled mermaid.js; returns SVG markup. */
export async function renderWithMermaidJs(code: string): Promise<string> {
  const api = await loadMermaid();
  return exclusively(async () => {
    mermaidCounter += 1;
    const id = `markedit-mermaid-${mermaidCounter}`;
    try {
      const { svg } = await api.render(id, code);
      return withIntrinsicSize(svg);
    } catch (error) {
      // Mermaid leaves an error element behind on failure.
      document.getElementById(`d${id}`)?.remove();
      throw new Error(error instanceof Error ? error.message.split('\n')[0] : String(error));
    }
  });
}
