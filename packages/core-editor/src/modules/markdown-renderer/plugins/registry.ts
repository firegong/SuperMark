import { escapeHtml } from '../utils';

/**
 * Renderer plugins for fenced diagram blocks (```plantuml, ```mermaid, ```d2, ```drawio …) and
 * LaTeX math. Built-in plugins are registered by `builtin.ts`; extensions can add their own with
 * `MarkEdit.registerDiagramPlugin` / `MarkEdit.registerMathPlugin`.
 *
 * Rendering is synchronous because the Markdown engines produce an HTML string. A plugin that
 * needs async work (network, decompression) returns a placeholder from `render` and finishes in
 * `hydrate`, which the preview calls once the HTML is in the document.
 */

/**
 * Where diagrams that need an external renderer (PlantUML, D2, Mermaid) are drawn:
 * `auto` tries local tools first and falls back to the server, `local` and `server` use only one.
 */
export type DiagramRendering = 'auto' | 'local' | 'server';

export interface DiagramRenderContext {
  /** Diagram server base URL (Kroki-compatible), or `null` when online rendering is off. */
  server: string | null;
  rendering: DiagramRendering;
  /** Chunk options (`#| width: 60%` …) for SuperMarkdown chunks; empty otherwise. */
  options: Map<string, string>;
}

export interface DiagramPlugin {
  readonly id: string;
  readonly name: string;
  /** Fenced code languages handled by this plugin, lower case. */
  readonly languages: readonly string[];
  /**
   * Returns trusted HTML (e.g. SVG) for the diagram, a placeholder created with
   * `diagramPlaceholder()` for async rendering, or `null` to show the block as code.
   */
  render(code: string, lang: string, context: DiagramRenderContext): string | null;
  /** Completes a placeholder produced by `render`. */
  hydrate?(element: HTMLElement, code: string, lang: string, context: DiagramRenderContext): Promise<void>;
}

export interface MathPlugin {
  readonly id: string;
  readonly name: string;
  /** Returns trusted HTML (MathML, SVG …) for a LaTeX expression. */
  render(latex: string, displayMode: boolean): string;
}

const diagramPlugins: DiagramPlugin[] = [];
const mathPlugins = new Map<string, MathPlugin>();
let activeMathPluginId: string | null = null;
let diagramServer: string | null = 'https://kroki.io';
let diagramRendering: DiagramRendering = 'auto';

export function registerDiagramPlugin(plugin: DiagramPlugin): void {
  const existing = diagramPlugins.findIndex(item => item.id === plugin.id);
  if (existing === -1) {
    // Later registrations win, so extensions can override built-in languages.
    diagramPlugins.unshift(plugin);
  } else {
    diagramPlugins[existing] = plugin;
  }
}

export function unregisterDiagramPlugin(id: string): void {
  const index = diagramPlugins.findIndex(item => item.id === id);
  if (index !== -1) {
    diagramPlugins.splice(index, 1);
  }
}

export function listDiagramPlugins(): DiagramPlugin[] {
  return [...diagramPlugins];
}

export function getDiagramPlugin(lang: string): DiagramPlugin | undefined {
  const key = lang.toLowerCase();
  return diagramPlugins.find(plugin => plugin.languages.includes(key));
}

export function hasDiagramPlugin(lang: string): boolean {
  return getDiagramPlugin(lang) !== undefined;
}

export function registerMathPlugin(plugin: MathPlugin, activate = false): void {
  mathPlugins.set(plugin.id, plugin);
  if (activate || activeMathPluginId === null) {
    activeMathPluginId = plugin.id;
  }
}

export function setActiveMathPlugin(id: string): void {
  if (!mathPlugins.has(id)) {
    throw new Error(`Unknown math plugin: ${id}`);
  }
  activeMathPluginId = id;
}

export function getActiveMathPlugin(): MathPlugin | undefined {
  return activeMathPluginId === null ? undefined : mathPlugins.get(activeMathPluginId);
}

export function listMathPlugins(): MathPlugin[] {
  return Array.from(mathPlugins.values());
}

/** Renders LaTeX with the active math plugin (falls back to showing the source). */
export function renderMathWithPlugin(latex: string, displayMode: boolean): string {
  const plugin = getActiveMathPlugin();
  if (plugin === undefined) {
    return `<code class="markedit-math-source">${escapeHtml(latex)}</code>`;
  }

  try {
    return plugin.render(latex, displayMode);
  } catch (error) {
    console.error(`Math plugin "${plugin.id}" failed:`, error);
    return `<code class="markedit-math-source">${escapeHtml(latex)}</code>`;
  }
}

/**
 * Sets the diagram server used by online plugins (PlantUML, D2, …). Accepts an http(s) URL;
 * an empty value turns online rendering off.
 */
export function setDiagramServer(url: string | null): void {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  diagramServer = /^https?:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null;
}

export function getDiagramServer(): string | null {
  return diagramServer;
}

export function setDiagramRendering(mode: string): void {
  diagramRendering = mode === 'local' || mode === 'server' ? mode : 'auto';
}

export function getDiagramRendering(): DiagramRendering {
  return diagramRendering;
}

function context(options?: Map<string, string>): DiagramRenderContext {
  return { server: diagramServer, rendering: diagramRendering, options: options ?? new Map() };
}

/**
 * Renders a diagram block with the plugin registered for `lang`.
 * Returns `null` when no plugin handles the language (the caller shows plain code).
 */
export function renderDiagramWithPlugin(lang: string, code: string, options?: Map<string, string>): string | null {
  const plugin = getDiagramPlugin(lang);
  if (plugin === undefined) {
    return null;
  }

  try {
    return plugin.render(code, lang.toLowerCase(), context(options));
  } catch (error) {
    console.error(`Diagram plugin "${plugin.id}" failed:`, error);
    return diagramError(`The ${plugin.name} renderer failed: ${String(error)}`, code);
  }
}

/**
 * Placeholder HTML for plugins that render asynchronously in `hydrate`. `previewHtml` (trusted)
 * is shown until the final rendering arrives, e.g. a quick offline approximation.
 */
export function diagramPlaceholder(pluginId: string, lang: string, code: string, message = 'Rendering diagram…', previewHtml?: string): string {
  const status = previewHtml === undefined
    ? `<div class="markedit-diagram-status">${escapeHtml(message)}</div>`
    : `<div class="markedit-diagram-output is-preliminary">${previewHtml}</div>`;
  return `<div class="markedit-diagram is-pending" data-diagram-plugin="${escapeHtml(pluginId)}" data-diagram-lang="${escapeHtml(lang)}">${status}<pre class="markedit-diagram-source"><code>${escapeHtml(code)}</code></pre></div>`;
}

/** Rendered diagram HTML, e.g. from the result cache, ready to return from `render`. */
export function renderedDiagram(html: string): string {
  return `<div class="markedit-diagram is-rendered"><div class="markedit-diagram-output">${html}</div></div>`;
}

/** Error box that keeps the diagram source visible. */
export function diagramError(message: string, code: string): string {
  return `<div class="markedit-diagram is-error"><div class="markedit-diagram-status">${escapeHtml(message)}</div><pre class="markedit-diagram-source"><code>${escapeHtml(code)}</code></pre></div>`;
}

/**
 * Completes every pending diagram placeholder inside `root`. Safe to call repeatedly: each
 * placeholder is hydrated once.
 */
export async function hydrateDiagrams(root: ParentNode): Promise<void> {
  const pending = Array.from(root.querySelectorAll<HTMLElement>('.markedit-diagram.is-pending[data-diagram-plugin]:not([data-hydrating])'));
  await Promise.all(pending.map(async element => {
    element.dataset.hydrating = 'true';
    const plugin = diagramPlugins.find(item => item.id === element.dataset.diagramPlugin);
    const code = element.querySelector('.markedit-diagram-source code')?.textContent ?? '';
    const lang = element.dataset.diagramLang ?? '';
    if (plugin?.hydrate === undefined) {
      return;
    }

    try {
      await plugin.hydrate(element, code, lang, context());
    } catch (error) {
      markDiagramFailed(element, `The ${plugin.name} renderer failed: ${String(error)}`);
    }
  }));
}

/** Shows `content` (trusted HTML or a node) in a placeholder and hides the source. */
export function markDiagramRendered(element: HTMLElement, content: Node | string): void {
  const holder = document.createElement('div');
  holder.className = 'markedit-diagram-output';
  if (typeof content === 'string') {
    holder.innerHTML = content;
  } else {
    holder.appendChild(content);
  }

  element.querySelector('.markedit-diagram-status')?.remove();
  element.querySelector('.markedit-diagram-output.is-preliminary')?.remove();
  element.insertBefore(holder, element.firstChild);
  element.classList.remove('is-pending');
  element.classList.add('is-rendered');
}

export function markDiagramFailed(element: HTMLElement, message: string): void {
  let status = element.querySelector('.markedit-diagram-status');
  if (status === null) {
    status = document.createElement('div');
    status.className = 'markedit-diagram-status';
    element.insertBefore(status, element.firstChild);
  }
  status.textContent = message;
  element.classList.remove('is-pending');
  element.classList.add('is-error');
}
