import { createElement } from './utils';
import { clearIncludeCache, includeOptions } from './includeLoader';
import { globalState } from '../common/store';
import {
  renderMarkdown,
  renderMarkdownAsync,
  getActiveMarkdownRenderer,
  setActiveMarkdownRenderer,
  getMarkdownSyntaxStandard,
  setMarkdownSyntaxStandard,
  registerMarkdownRenderer,
  listMarkdownRenderers,
  hydrateDiagrams,
  type MarkdownSyntaxStandard,
} from '../modules/markdown-renderer';

export type MarkdownPreviewMode = 'editor' | 'split' | 'preview';

const previewState: {
  mode: MarkdownPreviewMode;
  pane: HTMLElement | null;
  body: HTMLElement | null;
  syncScroll: boolean;
  splitRatio: number;
  isDragging: boolean;
  updateTimeout: ReturnType<typeof setTimeout> | null;
  lastContent: string;
} = {
  mode: 'editor',
  pane: null,
  body: null,
  syncScroll: true,
  splitRatio: 0.5,
  isDragging: false,
  updateTimeout: null,
  lastContent: '',
};

let editorContainer: HTMLElement | null = null;
let mutationObserver: MutationObserver | null = null;

function getEditorView(): typeof window.editor | undefined {
  return window.editor as typeof window.editor | undefined;
}

function getEditorText(): string {
  const core = window.webModules.core as unknown as { getEditorText?: () => string } | undefined;
  if (core?.getEditorText !== undefined) {
    return core.getEditorText();
  }

  return getEditorView()?.state.doc.toString() ?? '';
}

function getEditorLineStart(line: number): number {
  const doc = getEditorView()?.state.doc;
  if (doc === undefined) {
    return 0;
  }

  const lineObj = doc.line(Math.min(line + 1, doc.lines));
  return lineObj.from;
}

function getEditorLineRange(line: number): { from: number; to: number } {
  const doc = getEditorView()?.state.doc;
  if (doc === undefined) {
    return { from: 0, to: 0 };
  }

  const lineObj = doc.line(Math.min(line + 1, doc.lines));
  return { from: lineObj.from, to: lineObj.to };
}

function updateContent(force = false): void {
  const body = previewState.body;
  if (body === null || previewState.mode === 'editor') {
    return;
  }

  const render = (forced: boolean) => {
    const text = getEditorText();
    if (!forced && text === previewState.lastContent) {
      return;
    }

    previewState.lastContent = text;
    const engine = getActiveMarkdownRenderer();
    if (engine.renderDocument !== undefined) {
      void renderDocumentInFrame(body, engine.renderDocument.bind(engine), text);
      return;
    }

    removePreviewFrame(body);
    // SuperMarkdown @include: files are read ahead and the preview re-renders when they arrive.
    body.innerHTML = renderMarkdown(text, includeOptions(text, () => updateContent(true)));
    attachPreviewInteractions();
    // Async diagram plugins (PlantUML, D2, compressed draw.io, …) finish rendering here.
    void hydrateDiagrams(body);
  };

  if (force) {
    if (previewState.updateTimeout !== null) {
      clearTimeout(previewState.updateTimeout);
      previewState.updateTimeout = null;
    }

    render(true);
    return;
  }

  if (previewState.updateTimeout !== null) {
    clearTimeout(previewState.updateTimeout);
  }

  previewState.updateTimeout = setTimeout(() => render(false), 50);
}

// ---------------------------------------------------------------------------------------------
// Self-styled documents (e.g. markdown-it from the MarkEdit Preview extension) are shown in a
// sandboxed frame: their CSS cannot reach the app and their inline scripts do not run
// (`allow-same-origin` without `allow-scripts` lets the preview update and scroll the frame).
// ---------------------------------------------------------------------------------------------

let frameRenderToken = 0;

function previewFrame(body: HTMLElement): HTMLIFrameElement | null {
  return body.querySelector<HTMLIFrameElement>(':scope > iframe.markedit-preview-frame');
}

function removePreviewFrame(body: HTMLElement): void {
  previewFrame(body)?.remove();
  body.classList.remove('has-frame');
}

async function renderDocumentInFrame(body: HTMLElement, renderDocument: (markdown: string) => Promise<string>, text: string): Promise<void> {
  const token = ++frameRenderToken;
  let html: string;
  try {
    html = await renderDocument(text);
  } catch (error) {
    console.error('[MarkEdit] Preview rendering failed:', error);
    return;
  }

  // A newer render started, or the preview switched to another parser.
  if (token !== frameRenderToken || getActiveMarkdownRenderer().renderDocument === undefined) {
    return;
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html');
  let frame = previewFrame(body);
  const frameDocument = frame?.contentDocument ?? null;
  const headSignature = parsed.head.innerHTML.length.toString();

  // Same styles as before: swap the body in place so scroll position and styles stay put.
  if (frame !== null && frameDocument !== null && frame.dataset.head === headSignature) {
    frameDocument.body.innerHTML = parsed.body.innerHTML;
    return;
  }

  if (frame === null) {
    body.replaceChildren();
    frame = document.createElement('iframe');
    frame.className = 'markedit-preview-frame';
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.title = 'Markdown preview';
    body.appendChild(frame);
    body.classList.add('has-frame');
  }

  frame.dataset.head = headSignature;
  const scrollTop = frame.contentDocument?.scrollingElement?.scrollTop ?? 0;
  frame.addEventListener('load', () => {
    const loaded = frame.contentDocument;
    if (loaded === null) {
      return;
    }
    if (loaded.scrollingElement !== null) {
      loaded.scrollingElement.scrollTop = scrollTop;
    }
    // Links: same-document anchors scroll; nothing navigates the frame away.
    loaded.addEventListener('click', event => {
      const anchor = (event.target as Element | null)?.closest('a');
      if (anchor === null || anchor === undefined) {
        return;
      }
      event.preventDefault();
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        loaded.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();
      }
    });
    syncScroll();
  }, { once: true });
  frame.srcdoc = html;
}

function attachPreviewInteractions(): void {
  if (previewState.body === null) {
    return;
  }

  // Task list checkboxes
  previewState.body.querySelectorAll<HTMLInputElement>('.markedit-preview-task-checkbox').forEach(checkbox => {
    checkbox.addEventListener('click', event => {
      event.preventDefault();
      const lineAttr = checkbox.dataset.line;
      if (lineAttr === undefined) {
        return;
      }

      const line = parseInt(lineAttr, 10);
      const { from, to } = getEditorLineRange(line);
      const lineText = getEditorView()?.state.doc.sliceString(from, to) ?? '';
      const updated = toggleTaskMarker(lineText);
      if (updated !== null && updated !== lineText) {
        getEditorView()?.dispatch({ changes: { from, to, insert: updated } });
      }
    });
  });

  // Double-click blocks to jump to source line
  previewState.body.querySelectorAll<HTMLElement>('.markedit-preview-block').forEach(block => {
    block.addEventListener('dblclick', () => {
      const lineAttr = block.dataset.line;
      if (lineAttr === undefined) {
        return;
      }

      const line = parseInt(lineAttr, 10);
      const pos = getEditorLineStart(line);
      getEditorView()?.dispatch({ selection: { anchor: pos } });
      getEditorView()?.focus();
    });
  });

  // Copy code blocks
  previewState.body.querySelectorAll<HTMLButtonElement>('.markedit-preview-code-copy').forEach(button => {
    button.addEventListener('click', () => {
      const code = button.parentElement?.querySelector('code')?.textContent ?? '';
      void copyToClipboard(code, button, 'Copied!');
    });
  });

  // SuperMarkdown tab sets
  previewState.body.querySelectorAll<HTMLButtonElement>('.msm-tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabset = button.closest('.msm-tabset');
      if (tabset === null) {
        return;
      }

      const index = button.dataset.tab;
      tabset.querySelectorAll<HTMLElement>(':scope > .msm-tab-list > .msm-tab-button, :scope > .msm-tab-panel').forEach(element => {
        element.classList.toggle('is-active', element.dataset.tab === index);
      });
    });
  });

  // Mermaid source toggle
  previewState.body.querySelectorAll<HTMLButtonElement>('.markedit-mermaid-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const container = button.closest('.markedit-preview-mermaid');
      if (container !== null) {
        container.classList.toggle('is-source-visible');
      }
    });
  });
}

/**
 * Toggles the task marker of a list item line. The click handler runs after the browser has
 * already flipped `checkbox.checked`, so the source text (not the DOM state) decides the result:
 * an open task (`[ ]`) becomes done, any other state (`[x]`, `[X]`, `[/]`, `[-]`) becomes open.
 */
export function toggleTaskMarker(lineText: string): string | null {
  const match = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)]|\(@[\w-]*\))[ \t]+)\[([ xX/-])\]/.exec(lineText);
  if (match === null) {
    return null;
  }

  const next = match[2] === ' ' ? 'x' : ' ';
  return `${match[1]}[${next}]${lineText.slice(match[0].length)}`;
}

async function copyToClipboard(text: string, button: HTMLButtonElement, feedback: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = feedback;
  setTimeout(() => { button.textContent = original; }, 1200);
}

function getVisibleEditorLines(scroller: HTMLElement, editor: typeof window.editor): { first: number; last: number } {
  const totalLines = editor.state.doc.lines;

  if (scroller.scrollTop <= 2) {
    return { first: 1, last: Math.min(1, totalLines) };
  }

  const topBlock = editor.lineBlockAtHeight(scroller.scrollTop);
  const bottomBlock = editor.lineBlockAtHeight(scroller.scrollTop + (scroller.clientHeight || 400));

  const hasRealLayout = !(topBlock.from === 0 && bottomBlock.to === 0);
  if (hasRealLayout) {
    return {
      first: editor.state.doc.lineAt(topBlock.from).number,
      last: editor.state.doc.lineAt(bottomBlock.to).number,
    };
  }

  const topFraction = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
  const visibleFraction = (scroller.clientHeight || 200) / Math.max(1, scroller.scrollHeight);
  const first = Math.max(1, Math.floor(topFraction * totalLines) + 1);
  const last = Math.min(totalLines, Math.max(first, Math.ceil((topFraction + visibleFraction) * totalLines)));
  return { first, last };
}

function getEditorViewportOffset(scroller: HTMLElement, editor: typeof window.editor): number {
  if (scroller.scrollTop <= 2) {
    return 0;
  }

  const topBlock = editor.lineBlockAtHeight(scroller.scrollTop);
  if (topBlock.from === 0 && topBlock.to === 0) {
    return 0;
  }

  return Math.max(0, topBlock.top - scroller.scrollTop);
}

function getRelativeOffset(child: HTMLElement, parent: HTMLElement): number {
  const childRect = child.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  if (childRect.height > 0 && parentRect.height > 0) {
    return childRect.top - parentRect.top + parent.scrollTop;
  }

  return child.offsetTop - parent.offsetTop;
}

function findAnchorElement(firstLine: number, lastLine: number): HTMLElement | null {
  const body = previewState.body;
  if (body === null) {
    return null;
  }

  const candidates = Array.from(body.querySelectorAll<HTMLElement>('[data-line]'))
    .map(element => ({ element, line: parseInt(element.dataset.line ?? '-1', 10) }))
    .filter(({ line }) => line >= firstLine && line <= lastLine)
    .sort((a, b) => a.line - b.line);

  if (candidates.length === 0) {
    return null;
  }

  const heading = candidates.find(({ element }) => (
    element.matches('h1, h2, h3, h4, h5, h6, .markedit-preview-heading') ||
    element.querySelector('h1, h2, h3, h4, h5, h6, .markedit-preview-heading') !== null
  ));
  if (heading !== undefined) {
    return heading.element;
  }

  const listItem = candidates.find(({ element }) => (
    element.tagName === 'LI' ||
    element.classList.contains('markedit-preview-task-item') ||
    element.classList.contains('markedit-preview-list')
  ));
  if (listItem !== undefined) {
    return listItem.element;
  }

  return candidates[0].element;
}

export function syncScroll(): void {
  if (!previewState.syncScroll || previewState.mode !== 'split' || previewState.body === null) {
    return;
  }

  const editor = getEditorView();
  const scroller = editor?.scrollDOM;
  if (editor === undefined || scroller === undefined) {
    return;
  }

  const body = previewState.body;

  // Framed documents have no line anchors: keep the same relative position.
  const frameScroller = previewFrame(body)?.contentDocument?.scrollingElement ?? null;
  if (frameScroller !== null) {
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    frameScroller.scrollTop = ratio * Math.max(0, frameScroller.scrollHeight - frameScroller.clientHeight);
    return;
  }

  if (scroller.scrollTop <= 2) {
    body.scrollTop = 0;
    return;
  }

  const { first, last } = getVisibleEditorLines(scroller, editor);
  // Editor line numbers are 1-based; preview `data-line` attributes are 0-based.
  const anchor = findAnchorElement(first - 1, last - 1);

  if (anchor === null) {
    const ratio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);
    body.scrollTop = ratio * (body.scrollHeight - body.clientHeight || 1);
    return;
  }

  const anchorTop = getRelativeOffset(anchor, body);
  const editorOffset = getEditorViewportOffset(scroller, editor);
  const maxOffset = Math.max(0, scroller.clientHeight * 0.35);
  body.scrollTop = Math.max(0, anchorTop - Math.min(editorOffset, maxOffset));
}

function createPreviewPane(): HTMLElement {
  const existingPane = previewState.pane;
  if (existingPane?.isConnected === true) {
    return existingPane;
  }

  previewState.pane = null;
  previewState.body = null;

  const pane = createElement('div', 'markedit-markdown-preview-pane');
  document.body.appendChild(pane);

  const body = createElement('div', 'markedit-preview-body', pane);
  previewState.body = body;

  previewState.pane = pane;
  return pane;
}

function ensureResizer(): HTMLElement | null {
  const existing = document.querySelector('.markedit-preview-resizer') as HTMLElement | null;
  if (existing !== null) {
    return existing;
  }

  const editor = getEditorContainer();
  if (editor === null) {
    return null;
  }

  const resizer = createElement('div', 'markedit-preview-resizer');
  document.body.appendChild(resizer);

  resizer.addEventListener('mousedown', event => {
    previewState.isDragging = true;
    event.preventDefault();
  });

  return resizer;
}

function removeResizer(): void {
  document.querySelector('.markedit-preview-resizer')?.remove();
}

function getEditorContainer(): HTMLElement | null {
  if (editorContainer === null) {
    editorContainer = document.getElementById('editor');
  }

  return editorContainer;
}

function applyLayout(): void {
  const body = document.body;
  const editor = getEditorContainer();

  body.classList.remove('markedit-mode-split', 'markedit-mode-preview');
  removeResizer();

  if (previewState.mode === 'editor') {
    if (editor !== null) {
      editor.style.width = '';
      editor.style.display = '';
    }

    if (previewState.pane !== null) {
      previewState.pane.style.display = 'none';
    }

    return;
  }

  createPreviewPane();
  if (previewState.pane !== null) {
    previewState.pane.style.display = '';
    previewState.pane.style.width = previewState.mode === 'preview' ? '100%' : `${(1 - previewState.splitRatio) * 100}%`;
  }

  body.classList.add(previewState.mode === 'split' ? 'markedit-mode-split' : 'markedit-mode-preview');

  if (previewState.mode === 'split') {
    const resizer = ensureResizer();
    if (editor !== null) {
      editor.style.width = `${previewState.splitRatio * 100}%`;
      editor.style.display = '';
    }
    if (resizer !== null) {
      resizer.style.left = `${previewState.splitRatio * 100}%`;
    }
  } else if (editor !== null) {
    editor.style.width = '';
    editor.style.display = '';
  }

  syncEditorStyles();
  updateContent(true);
}

function startLiveSync(): void {
  const editor = getEditorView();
  if (editor === undefined) {
    return;
  }

  editor.scrollDOM.addEventListener('scroll', syncScroll);

  const target = editor.dom;
  if (mutationObserver === null) {
    mutationObserver = new MutationObserver(() => {
      if (previewState.mode !== 'editor') {
        updateContent();
      }
    });
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }
}

function stopLiveSync(): void {
  if (previewState.updateTimeout !== null) {
    clearTimeout(previewState.updateTimeout);
    previewState.updateTimeout = null;
  }
  getEditorView()?.scrollDOM.removeEventListener('scroll', syncScroll);
  mutationObserver?.disconnect();
  mutationObserver = null;
}

function setupGlobalListeners(): void {
  window.addEventListener('mousemove', event => {
    if (!previewState.isDragging) {
      return;
    }

    const ratio = Math.max(0.25, Math.min(0.75, event.clientX / window.innerWidth));
    previewState.splitRatio = ratio;
    applyLayout();
  });

  window.addEventListener('mouseup', () => {
    previewState.isDragging = false;
  });

  window.addEventListener('editor-colors-changed', () => {
    syncEditorStyles();
  });

  // The View menu is shared by all windows; show this window's state when it is focused.
  window.addEventListener('focus', () => {
    // Included files may have been edited in another window or app.
    clearIncludeCache();
    publishViewState();
  });

  window.addEventListener('markedit-editor-reset', () => {
    clearIncludeCache(true);
    previewState.lastContent = '';
    updateContent(true);
  });
}

function syncEditorStyles(): void {
  const pane = previewState.pane;
  if (pane === null) {
    return;
  }

  const colors = globalState.colors;
  const bodyStyle = getComputedStyle(document.body);
  const background = colors?.background ?? bodyStyle.backgroundColor;
  const foreground = colors?.text ?? bodyStyle.color;
  const accent = colors?.accent ?? bodyStyle.getPropertyValue('--chrome-accent');

  pane.style.setProperty('--preview-bg', background);
  pane.style.setProperty('--preview-fg', foreground);
  pane.style.setProperty('--preview-accent', accent);
}

export function getMarkdownPreviewMode(): MarkdownPreviewMode {
  return previewState.mode;
}

export function setMarkdownPreviewMode(mode: MarkdownPreviewMode): void {
  if (previewState.mode === mode) {
    return;
  }

  const previous = previewState.mode;
  previewState.mode = mode;

  if (previous === 'editor') {
    startLiveSync();
  }

  applyLayout();

  if (mode === 'editor') {
    stopLiveSync();
    getEditorView()?.focus();
  }

  publishViewState();
}

export function toggleMarkdownPreview(preferredMode?: 'split' | 'preview'): void {
  const current = previewState.mode;

  if (current === 'editor') {
    setMarkdownPreviewMode(preferredMode ?? 'split');
    return;
  }

  if (preferredMode === undefined || current === preferredMode) {
    setMarkdownPreviewMode('editor');
    return;
  }

  setMarkdownPreviewMode(preferredMode);
}

export function setMarkdownStandard(standard: MarkdownSyntaxStandard): void {
  setMarkdownSyntaxStandard(standard);
  updateContent(true);
  publishViewState();
}

export function getMarkdownStandard(): MarkdownSyntaxStandard {
  return getMarkdownSyntaxStandard();
}

export { registerMarkdownRenderer };

export function setMarkdownRenderer(id: string): void {
  if (!listMarkdownRenderers().some(engine => engine.id === id)) {
    console.warn(`Unknown markdown renderer: ${id}`);
    return;
  }

  const changed = getActiveMarkdownRenderer().id !== id;
  setActiveMarkdownRenderer(id);
  if (changed) {
    updateContent(true);
    publishViewState();
  }
}

/** Re-renders the preview, e.g. after a renderer plugin or the diagram server changed. */
export function refreshMarkdownPreview(): void {
  updateContent(true);
}

export function isPreviewSyncScroll(): boolean {
  return previewState.syncScroll;
}

/** View → Sync Preview Scroll. */
export function togglePreviewSyncScroll(): void {
  previewState.syncScroll = !previewState.syncScroll;
  if (previewState.syncScroll) {
    syncScroll();
  }
  publishViewState();
}

/** View → Copy Preview HTML: the rendered HTML of the document, in any view mode. */
export async function copyPreviewHtml(): Promise<void> {
  const framed = previewState.body !== null && previewFrame(previewState.body) !== null;
  const html = previewState.mode !== 'editor' && previewState.body !== null && !framed
    ? previewState.body.innerHTML
    : await renderMarkdownAsync(getEditorText());
  try {
    await navigator.clipboard.writeText(html);
  } catch (error) {
    console.error('Failed to copy preview HTML:', error);
  }
}

/**
 * Reports the view mode, Markdown parser and scroll sync to the desktop host, which shows them
 * as checkmarks in the native View menu (the page has no view buttons of its own).
 */
export function publishViewState(): void {
  void reportViewState();
}

async function reportViewState(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke === undefined) {
    return;
  }

  try {
    await invoke('view_state_changed', {
      mode: previewState.mode,
      renderer: getActiveMarkdownRenderer().id,
      syncScroll: previewState.syncScroll,
    });
  } catch (error) {
    console.error('Failed to report view state:', error);
  }
}

setupGlobalListeners();
