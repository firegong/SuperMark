import { escapeHtml } from '../utils';
import { renderMermaidToSvg } from './mermaidPlugin';
import { latexMathPlugin } from './mathPlugin';
import { drawioPlugin } from './drawio';
import { d2Plugin, graphvizPlugin, plantumlPlugin, renderCachedOrPlaceholder } from './kroki';
import { registerDiagramPlugin, registerMathPlugin, type DiagramPlugin } from './registry';
import { renderDiagramSources } from './strategy';
import { renderWithMermaidJs } from './local';

/** Diagram types the offline Mermaid renderer draws itself. */
const offlineMermaidTypes = /^(graph|flowchart)\b|^sequenceDiagram\b/i;

function mermaidType(code: string): string {
  return code.split('\n').map(line => line.trim()).find(line => line.length > 0 && !line.startsWith('%%')) ?? '';
}

/**
 * Mermaid: rendered locally by the bundled mermaid.js (all diagram types) or by the diagram
 * server, per the Diagram Rendering setting. Flowcharts and sequence diagrams show the built-in
 * quick renderer's drawing at once, until the full rendering is ready.
 */
export const mermaidDiagramPlugin: DiagramPlugin = {
  id: 'mermaid',
  name: 'Mermaid',
  languages: ['mermaid', 'mmd'],
  render(code, lang, context) {
    const quick = offlineMermaidTypes.test(mermaidType(code)) ? renderMermaidToSvg(code) : undefined;
    // Server-only mode without a server: the built-in renderer is all there is.
    if (context.rendering === 'server' && context.server === null && quick !== undefined) {
      return quick;
    }
    return renderCachedOrPlaceholder('mermaid', 'Mermaid', lang, code, context, quick);
  },
  async hydrate(element, code, lang, context) {
    await renderDiagramSources(element, {
      name: 'Mermaid',
      lang,
      code,
      local: async () => renderWithMermaidJs(code),
      serverType: 'mermaid',
    }, context);
  },
};

let registered = false;

/** Registers the built-in diagram and math plugins once. */
export function registerBuiltinRendererPlugins(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerDiagramPlugin(drawioPlugin);
  registerDiagramPlugin(d2Plugin);
  registerDiagramPlugin(plantumlPlugin);
  registerDiagramPlugin(graphvizPlugin);
  registerDiagramPlugin(mermaidDiagramPlugin);
  registerMathPlugin(latexMathPlugin, true);
}

/** Wraps plugin output the way fenced diagrams appear in the preview (with a source toggle). */
export function diagramBlockHtml(lang: string, code: string, rendered: string): string {
  return `<div class="markedit-preview-mermaid markedit-preview-diagram" data-diagram="${escapeHtml(lang)}"><div class="markedit-mermaid-diagram">${rendered}</div><button type="button" class="markedit-mermaid-toggle">Source</button><pre class="markedit-mermaid-source"><code>${escapeHtml(code)}</code></pre></div>`;
}
