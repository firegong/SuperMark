import { commonmarkEngine, gfmEngine, extendedEngine, superMarkdownEngine } from './presets';
import type { MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard, MarkdownBlockPlugin, MarkdownInlinePlugin } from './types';

const engines = new Map<string, MarkdownRendererEngine>([
  [commonmarkEngine.id, commonmarkEngine],
  [gfmEngine.id, gfmEngine],
  [extendedEngine.id, extendedEngine],
  [superMarkdownEngine.id, superMarkdownEngine],
]);

let activeEngine: MarkdownRendererEngine = extendedEngine;

/** Renderers provided by built-in extensions that the user turned off. */
const unavailableEngines = new Set<string>();

/**
 * Shows or hides a renderer (built-in extensions such as SuperMarkdown can be turned off in
 * Extensions → Installed). Returns true when the hidden renderer is the active one, so the
 * caller can switch to another parser (and refresh the preview and View menu).
 */
export function setMarkdownRendererAvailable(id: string, available: boolean): boolean {
  if (available) {
    unavailableEngines.delete(id);
    return false;
  }

  unavailableEngines.add(id);
  return activeEngine.id === id;
}

export function isMarkdownRendererAvailable(id: string): boolean {
  return engines.has(id) && !unavailableEngines.has(id);
}

export function registerMarkdownRenderer(engine: MarkdownRendererEngine): void {
  engines.set(engine.id, engine);
}

export function setActiveMarkdownRenderer(id: string): void {
  const engine = unavailableEngines.has(id) ? undefined : engines.get(id);
  if (engine === undefined) {
    throw new Error(`Unknown markdown renderer engine: ${id}`);
  }
  activeEngine = engine;
}

export function getActiveMarkdownRenderer(): MarkdownRendererEngine {
  return activeEngine;
}

export function listMarkdownRenderers(): MarkdownRendererEngine[] {
  return Array.from(engines.values()).filter(engine => !unavailableEngines.has(engine.id));
}

export function setMarkdownSyntaxStandard(standard: MarkdownSyntaxStandard): void {
  const engine = engines.get(standard) ?? engines.get(`${standard}-engine`);
  if (engine !== undefined) {
    activeEngine = engine;
    return;
  }

  // Fallback: switch the active default engine to the requested standard
  if ([commonmarkEngine.id, gfmEngine.id, extendedEngine.id, superMarkdownEngine.id].includes(activeEngine.id)) {
    activeEngine = engines.get(standard) ?? extendedEngine;
  }
}

export function getMarkdownSyntaxStandard(): MarkdownSyntaxStandard {
  return activeEngine.standard;
}

export function registerMarkdownPlugin(plugin: MarkdownBlockPlugin | MarkdownInlinePlugin): void {
  if ('tryRender' in plugin && typeof plugin.tryRender === 'function') {
    if (plugin.tryRender.length === 2) {
      const blockPlugin = plugin as MarkdownBlockPlugin;
      if ('registerBlockPlugin' in activeEngine && typeof activeEngine.registerBlockPlugin === 'function') {
        activeEngine.registerBlockPlugin(blockPlugin);
      }
      return;
    }
  }

  const inlinePlugin = plugin as MarkdownInlinePlugin;
  if ('registerInlinePlugin' in activeEngine && typeof activeEngine.registerInlinePlugin === 'function') {
    activeEngine.registerInlinePlugin(inlinePlugin);
  }
}

export function renderMarkdown(markdown: string, options?: MarkdownRenderOptions): string {
  return activeEngine.render(markdown, options);
}

/** Renders with the active engine, using its asynchronous renderer when it has one. */
export async function renderMarkdownAsync(markdown: string, options?: MarkdownRenderOptions): Promise<string> {
  const engine = activeEngine;
  if (engine.renderAsync === undefined) {
    return engine.render(markdown, options);
  }
  return engine.renderAsync(markdown);
}

export function renderMarkdownInline(markdown: string, options?: MarkdownRenderOptions): string {
  return activeEngine.renderInline?.(markdown, options) ?? activeEngine.render(markdown, options);
}

export function renderMath(latex: string, displayMode: boolean): string {
  return activeEngine.renderMath?.(latex, displayMode) ?? '';
}

export function renderMermaid(code: string): string {
  return activeEngine.renderMermaid?.(code) ?? '';
}

export { commonmarkEngine, gfmEngine, extendedEngine, superMarkdownEngine };
export { SuperMarkdownEngine } from './super/engine';
export {
  registerDiagramPlugin,
  unregisterDiagramPlugin,
  listDiagramPlugins,
  registerMathPlugin,
  setActiveMathPlugin,
  listMathPlugins,
  setDiagramServer,
  getDiagramServer,
  setDiagramRendering,
  getDiagramRendering,
  hydrateDiagrams,
  diagramPlaceholder,
  markDiagramRendered,
  markDiagramFailed,
} from './plugins/registry';
export type { DiagramPlugin, MathPlugin, DiagramRenderContext, DiagramRendering } from './plugins/registry';
export { clearDiagramCache, renderDiagramSources, RendererUnavailableError } from './plugins/strategy';
export { registerBuiltinRendererPlugins } from './plugins/builtin';
export type { SuperMarkdownOptions } from './super/context';
export type { MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard };

// Convenience alias for backward compatibility
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
  return renderMarkdown(markdown, options);
}
