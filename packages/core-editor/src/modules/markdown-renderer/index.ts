import { commonmarkEngine, gfmEngine, extendedEngine } from './presets';
import type { MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard, MarkdownBlockPlugin, MarkdownInlinePlugin } from './types';

const engines = new Map<string, MarkdownRendererEngine>([
  [commonmarkEngine.id, commonmarkEngine],
  [gfmEngine.id, gfmEngine],
  [extendedEngine.id, extendedEngine],
]);

let activeEngine: MarkdownRendererEngine = extendedEngine;

export function registerMarkdownRenderer(engine: MarkdownRendererEngine): void {
  engines.set(engine.id, engine);
}

export function setActiveMarkdownRenderer(id: string): void {
  const engine = engines.get(id);
  if (engine === undefined) {
    throw new Error(`Unknown markdown renderer engine: ${id}`);
  }
  activeEngine = engine;
}

export function getActiveMarkdownRenderer(): MarkdownRendererEngine {
  return activeEngine;
}

export function listMarkdownRenderers(): MarkdownRendererEngine[] {
  return Array.from(engines.values());
}

export function setMarkdownSyntaxStandard(standard: MarkdownSyntaxStandard): void {
  const engine = engines.get(standard) ?? engines.get(`${standard}-engine`);
  if (engine !== undefined) {
    activeEngine = engine;
    return;
  }

  // Fallback: switch the active default engine to the requested standard
  if (activeEngine.id === commonmarkEngine.id || activeEngine.id === gfmEngine.id || activeEngine.id === extendedEngine.id) {
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

export function renderMarkdownInline(markdown: string, options?: MarkdownRenderOptions): string {
  return activeEngine.renderInline?.(markdown, options) ?? activeEngine.render(markdown, options);
}

export function renderMath(latex: string, displayMode: boolean): string {
  return activeEngine.renderMath?.(latex, displayMode) ?? '';
}

export function renderMermaid(code: string): string {
  return activeEngine.renderMermaid?.(code) ?? '';
}

export { commonmarkEngine, gfmEngine, extendedEngine };
export type { MarkdownRendererEngine, MarkdownRenderOptions, MarkdownSyntaxStandard };

// Convenience alias for backward compatibility
export function renderMarkdownToHtml(markdown: string, options?: MarkdownRenderOptions): string {
  return renderMarkdown(markdown, options);
}
