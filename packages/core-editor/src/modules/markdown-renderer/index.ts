import { builtInFormats, builtInParsers, defaultParser, defaultPreviewFor, commonmarkEngine, gfmEngine, extendedEngine, superMarkdownEngine } from './formats';
import type { MarkdownFormat, MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard, MarkdownBlockPlugin, MarkdownInlinePlugin, PreviewHost, PreviewRenderer } from './types';

// Formats live in formats/, one folder each (parser + preview); this module keeps the list and
// the active one.
const formats = new Map<string, MarkdownFormat>(builtInFormats.map(format => [format.engine.id, format]));
const engines = new Map<string, MarkdownRendererEngine>(builtInParsers.map(engine => [engine.id, engine]));

let activeEngine: MarkdownRendererEngine = defaultParser;

/** Renderers provided by built-in extensions that the user turned off. */
const unavailableEngines = new Set<string>();

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

/** Adds a format module (parser and preview), or replaces the one with the same id. */
export function registerMarkdownFormat(format: MarkdownFormat): void {
  formats.set(format.engine.id, format);
  engines.set(format.engine.id, format.engine);
}

/** Adds a parser (e.g. from an extension) with the default preview for its output. */
export function registerMarkdownRenderer(engine: MarkdownRendererEngine): void {
  registerMarkdownFormat({ engine, preview: defaultPreviewFor(engine) });
}

/** The preview of `engine`'s format (the default preview for an engine that has none). */
export function previewFor(engine: MarkdownRendererEngine): PreviewRenderer {
  const format = formats.get(engine.id);
  return format?.engine === engine ? format.preview : defaultPreviewFor(engine);
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
  if (builtInParsers.some(engine => engine.id === activeEngine.id)) {
    activeEngine = engines.get(standard) ?? defaultParser;
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
export { SuperMarkdownEngine, clearSuperSetIncludes } from './formats/markdownSuperSet';
export { builtInFormats, defaultFormat, builtInParsers, defaultParser, gmarkdownEngine, micromarkEngine } from './formats';
export { markdownItEngine, markdownItEngineId, markdownItFormat, isMarkdownItAvailable } from './formats/markdownIt';
export { htmlPreview } from './preview/htmlPreview';
export { framePreview, previewFrame, removePreviewFrame } from './preview/framePreview';
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
export type { SuperMarkdownOptions } from './formats/markdownSuperSet';
export type { MarkdownFormat, MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard, PreviewHost, PreviewRenderer };

// Convenience alias for backward compatibility
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
  return renderMarkdown(markdown, options);
}
