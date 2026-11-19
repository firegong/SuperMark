import { replaceText, resetEditor, ReplaceGranularity } from './core';
import { notifyAppReady } from './api/methods';
import {
  applyThemeSelection,
  beginExtensionScript,
  endExtensionScript,
  resetThemeContributions,
  setThemeExtension,
} from './chrome/themeExtensions';
import {
  getActiveMarkdownRenderer,
  listMarkdownRenderers,
  registerMarkdownRenderer,
  setActiveMarkdownRenderer,
  setMarkdownRendererAvailable,
} from './modules/markdown-renderer';
import { isMarkdownItAvailable, markdownItEngine, markdownItEngineId } from './modules/markdown-renderer/markdownIt';

/**
 * Loads the document and installed extensions that the desktop host returns from
 * `core.notifyWindowDidLoad` (and later through `document_content` / `extensions_bootstrap`).
 *
 * Everything arrives as data over IPC and is applied here, instead of being injected as one
 * large script: a multi-megabyte `eval` (e.g. with a big extension installed) can fail in
 * WebView2, which left windows empty. Each extension runs on its own, so one broken extension
 * cannot keep the document from loading.
 */

export interface ExtensionStyle {
  name: string;
  css: string;
}

export interface ExtensionScript {
  path: string;
  capability: string;
  source: string;
}

export interface ExtensionBootstrap {
  styles: ExtensionStyle[];
  scripts: ExtensionScript[];
  /** Built-in extensions the user turned off (e.g. `supermarkdown`). */
  disabledBuiltins?: string[];
}

/** Built-in extension id → the Markdown renderer it provides. */
const builtinRenderers: Record<string, string> = {
  supermarkdown: 'super',
};

/** Applies the on/off state of built-in extensions (their renderers come and go). */
export function applyBuiltinExtensions(disabled: string[]): void {
  let activeChanged = false;
  for (const [builtin, renderer] of Object.entries(builtinRenderers)) {
    activeChanged = setMarkdownRendererAvailable(renderer, !disabled.includes(builtin)) || activeChanged;
  }

  // The active parser was turned off: switch to Extended (re-renders, updates the View menu).
  if (activeChanged) {
    switchRenderer('extended');
  }
}

export interface HostDocument {
  text?: string;
  /** Unsaved text recovered from a backup, applied as an undoable edit. */
  restoreText?: string | null;
  extensions?: ExtensionBootstrap;
}

interface ScriptHooks {
  __prepareScriptContexts__?: (scripts: { path: string; capability: string }[]) => void;
  __runScriptWithContext__?: (key: string, execute: (...args: unknown[]) => void) => void;
}

function invokeHost(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined {
  return window.__TAURI_INTERNALS__?.invoke;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Replaces the user stylesheets and runs the enabled scripts in their script contexts. */
function switchRenderer(id: string): void {
  if (window.chromeUI === undefined) {
    setActiveMarkdownRenderer(id);
  } else {
    window.chromeUI.setMarkdownRenderer(id);
  }
}

/** The parser saved in settings (`preview.markdownRenderer`). */
function savedRenderer(): string | undefined {
  const settings = (globalThis as { MarkEdit?: { userSettings?: Record<string, unknown> } }).MarkEdit?.userSettings;
  const value = settings?.markdownRenderer ?? settings?.['preview.markdownRenderer'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Offers markdown-it (from the MarkEdit Preview extension) as a parser while that extension is
 * enabled. A saved markdown-it choice is applied once the extension has loaded, since saved
 * settings are read before extensions run.
 */
export function syncExtensionRenderers(scripts: { capability: string }[]): void {
  const available = isMarkdownItAvailable(scripts);
  if (available) {
    if (!listMarkdownRenderers().some(engine => engine.id === markdownItEngineId)) {
      registerMarkdownRenderer(markdownItEngine);
    }
    setMarkdownRendererAvailable(markdownItEngineId, true);
    if (savedRenderer() === markdownItEngineId && getActiveMarkdownRenderer().id !== markdownItEngineId) {
      switchRenderer(markdownItEngineId);
    }
    return;
  }

  if (setMarkdownRendererAvailable(markdownItEngineId, false)) {
    switchRenderer('extended');
  }
}

/** The theme extension chosen in Settings (`editor.themeExtension`); none uses the built-in theme. */
function configuredThemeExtension(): string {
  const value = (window.config as { themeExtension?: unknown } | undefined)?.themeExtension;
  return typeof value === 'string' ? value : '';
}

export function applyExtensions(bootstrap: ExtensionBootstrap): void {
  applyBuiltinExtensions(bootstrap.disabledBuiltins ?? []);
  document.querySelectorAll('style[data-markedit-user-style]').forEach(element => element.remove());
  for (const style of bootstrap.styles) {
    const element = document.createElement('style');
    element.setAttribute('data-markedit-user-style', style.name);
    element.textContent = style.css;
    document.head.appendChild(element);
  }

  // Theme extensions: the theme chosen in Settings decides which one (if any) applies.
  resetThemeContributions();
  setThemeExtension(configuredThemeExtension());

  if (bootstrap.scripts.length === 0) {
    syncExtensionRenderers([]);
    return;
  }

  const hooks = window as unknown as ScriptHooks;
  try {
    hooks.__prepareScriptContexts__?.(bootstrap.scripts.map(({ path, capability }) => ({ path, capability })));
  } catch (error) {
    console.error('[MarkEdit] Failed to prepare extension contexts:', error);
  }

  for (const script of bootstrap.scripts) {
    beginExtensionScript();
    try {
      // Compiling here turns a syntax error into an exception for this script only.
      const run = new Function('MarkEdit', 'require', `${script.source}\n//# sourceURL=${script.capability}`) as (...args: unknown[]) => void;
      hooks.__runScriptWithContext__?.(script.capability, run);
    } catch (error) {
      console.error(`[MarkEdit] Failed to run extension ${script.capability}:`, error);
    } finally {
      endExtensionScript(script.capability);
    }
  }
  applyThemeSelection();

  syncExtensionRenderers(bootstrap.scripts);
}

/** Applies a `notifyWindowDidLoad` reply: extensions first, then the document, then app-ready. */
export async function loadHostDocument(reply: unknown): Promise<void> {
  if (!isObject(reply)) {
    return;
  }

  const document = reply as HostDocument;
  if (isObject(document.extensions)) {
    applyExtensions({
      styles: Array.isArray(document.extensions.styles) ? document.extensions.styles : [],
      scripts: Array.isArray(document.extensions.scripts) ? document.extensions.scripts : [],
      disabledBuiltins: Array.isArray(document.extensions.disabledBuiltins) ? document.extensions.disabledBuiltins : [],
    });
  }

  if (typeof document.text === 'string') {
    try {
      await resetEditor(document.text);
      if (typeof document.restoreText === 'string' && document.restoreText !== document.text) {
        replaceText(document.restoreText, ReplaceGranularity.wholeDocument);
      }
    } catch (error) {
      console.error('[MarkEdit] Failed to load the document:', error);
    }
  }

  try {
    notifyAppReady();
  } catch (error) {
    console.error('[MarkEdit] notifyAppReady failed:', error);
  }
}

/** Fetches the window's document again (after File > Open, Reopen with Encoding, …). */
export async function reloadDocumentFromHost(): Promise<void> {
  const invoke = invokeHost();
  if (invoke === undefined) {
    return;
  }

  const reply = await invoke('document_content');
  if (isObject(reply) && typeof reply.text === 'string') {
    await resetEditor(reply.text);
  }
}

/** Fetches and re-applies the installed extensions (after install, enable, reload, …). */
export async function reloadExtensionsFromHost(): Promise<void> {
  const invoke = invokeHost();
  if (invoke === undefined) {
    return;
  }

  const reply = await invoke('extensions_bootstrap');
  if (isObject(reply)) {
    applyExtensions({
      styles: Array.isArray(reply.styles) ? reply.styles as ExtensionStyle[] : [],
      scripts: Array.isArray(reply.scripts) ? reply.scripts as ExtensionScript[] : [],
      disabledBuiltins: Array.isArray(reply.disabledBuiltins) ? reply.disabledBuiltins as string[] : [],
    });
  }
}
