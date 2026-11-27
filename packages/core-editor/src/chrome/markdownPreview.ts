import { createElement } from './utils';
import { isEditorLivePreview } from './liveEditorPreview';
import {
  buildAnchors,
  lineToOffset,
  matchHeadings,
  offsetToLine,
  referenceOffset,
  scrollTopForOffset,
  sourceHeadings,
  type ScrollAnchor,
} from './scrollSync';
import { globalState } from '../common/store';
import {
  renderMarkdownAsync,
  getActiveMarkdownRenderer,
  setActiveMarkdownRenderer,
  getMarkdownSyntaxStandard,
  setMarkdownSyntaxStandard,
  registerMarkdownRenderer,
  listMarkdownRenderers,
  hydrateDiagrams,
  clearSuperSetIncludes,
  previewFor,
  previewFrame,
  type MarkdownSyntaxStandard,
  type PreviewHost,
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
let liveSyncRaf: number | null = null;

let previewContextMenu: HTMLElement | null = null;

function hidePreviewContextMenu(): void {
  if (previewContextMenu !== null) {
    previewContextMenu.remove();
    previewContextMenu = null;
  }
}

async function copyPreviewContent(): Promise<void> {
  const pane = previewState.pane;
  if (pane === null) {
    return;
  }
  const frame = pane.querySelector<HTMLIFrameElement>('iframe.markedit-preview-frame');
  let html = '';
  let text = '';
  try {
    const doc = frame?.contentDocument ?? null;
    const selection = doc?.getSelection() ?? null;
    if (selection !== null && selection.rangeCount > 0 && !selection.isCollapsed) {
      const container = document.createElement('div');
      container.appendChild(selection.getRangeAt(0).cloneContents());
      html = container.innerHTML;
      text = selection.toString();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (doc?.body !== null && doc?.body !== undefined) {
      html = doc.body.innerHTML;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      text = doc.body.textContent ?? '';
    }
  } catch {
    // Fall through to pane-level fallback below.
  }
  if (html === '') {
    html = pane.innerHTML;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    text = pane.textContent ?? '';
  }
  try {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
  } catch {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }
}

function showPreviewContextMenu(x: number, y: number): void {
  try {
    hidePreviewContextMenu();
    const menu = document.createElement('div');
    menu.className = 'markedit-preview-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.zIndex = '100000';
    menu.style.background = '#ffffff';
    menu.style.border = '1px solid #d0d0d0';
    menu.style.borderRadius = '6px';
    menu.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    menu.style.padding = '4px 0';
    menu.style.minWidth = '120px';
    menu.style.fontFamily = 'system-ui, sans-serif';
    menu.style.fontSize = '13px';

    // Determine whether the preview currently has a text selection.
    let hasSelection = false;
    try {
      const pane = previewState.pane;
      const doc = (pane === null ? null : pane.querySelector<HTMLIFrameElement>('iframe.markedit-preview-frame')?.contentDocument ?? null);
      const selection = doc?.getSelection() ?? null;
      hasSelection = selection !== null && selection.isCollapsed === false && selection.rangeCount > 0;
    } catch {
      hasSelection = false;
    }

    const makeItem = (label: string, action: () => void): HTMLElement => {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.padding = '6px 14px';
      item.style.cursor = 'pointer';
      item.addEventListener('mouseenter', () => {
        item.style.background = '#e8f0fe';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'transparent';
      });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        hidePreviewContextMenu();
        action();
      });
      return item;
    };

    menu.appendChild(makeItem(hasSelection ? 'Copy' : 'Copy All', () => {
      void copyPreviewContent();
    }));
    menu.appendChild(makeItem('Reload', () => {
      updateContent(true);
    }));

    document.body.appendChild(menu);
    previewContextMenu = menu;

    // Keep the menu on screen.
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(4, window.innerWidth - rect.width - 4)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(4, window.innerHeight - rect.height - 4)}px`;
    }

    setTimeout(() => {
      document.addEventListener('click', hidePreviewContextMenu, { once: true });
      document.addEventListener('contextmenu', hidePreviewContextMenu, { once: true });
    }, 0);
  } catch (error) {
    console.error('preview context menu failed', error);
  }
}

document.addEventListener('contextmenu', (event: MouseEvent) => {
  const pane = previewState.pane;
  if (pane === null || !(event.target instanceof Node) || !pane.contains(event.target)) {
    return;
  }
  event.preventDefault();
  showPreviewContextMenu(event.clientX, event.clientY);
});

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
    // Each format shows its parser's output with its own preview (modules/markdown-renderer/formats/).
    const engine = getActiveMarkdownRenderer();
    previewFor(engine).render(body, text, engine, previewHost);
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

/** What the format previews (modules/markdown-renderer/formats/, preview/) call back into. */
const previewHost: PreviewHost = {
  rerender() {
    updateContent(true);
  },
  didRenderHtml(body) {
    attachPreviewInteractions();
    realignAfterRender();
    // Async diagram plugins (PlantUML, D2, compressed draw.io, …) finish rendering here; their
    // final size moves everything below them.
    void hydrateAndRealign(body);
  },
  didLoadFrame(frameDocument) {
    // Links: same-document anchors scroll, others open outside the preview (open_link).
    frameDocument.addEventListener('click', event => handlePreviewLinkClick(event, frameDocument));
    attachFrameScrollSync(frameDocument);
    // Right-click inside the preview frame opens our custom menu (Copy/Copy All + Reload).
    const showMenuFromEvent = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      showPreviewContextMenu(event.clientX, event.clientY);
    };
    frameDocument.addEventListener('contextmenu', showMenuFromEvent, true);
    frameDocument.body.addEventListener('contextmenu', showMenuFromEvent, true);
    if (frameDocument.defaultView !== null) {
      frameDocument.defaultView.addEventListener('contextmenu', showMenuFromEvent, true);
    }
    realignAfterRender();
  },
  didChangeLayout() {
    invalidateScrollAnchors();
    realignAfterRender();
  },
};

/**
 * Clicking a link must never navigate the app's own page (or the preview frame) away from the
 * editor: in-page anchors scroll, everything else goes to the host, which opens web links in the
 * browser, documents in the app and nothing unsafe (src-tauri/src/links.rs).
 */
export function handlePreviewLinkClick(event: MouseEvent, owner: Document): void {
  const anchor = (event.target as Element | null)?.closest('a');
  if (anchor === null || anchor === undefined) {
    return;
  }
  const href = anchor.getAttribute('href') ?? '';
  // Links made by the preview itself (tabs, copy buttons, footnote back-links handle their own).
  if (event.defaultPrevented) {
    return;
  }
  event.preventDefault();

  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    const target = owner.getElementById(id) ?? Array.from(owner.querySelectorAll('[name]')).find(element => element.getAttribute('name') === id);
    target?.scrollIntoView({ block: 'start' });
    return;
  }
  if (href.trim() === '') {
    return;
  }

  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke === undefined) {
    console.warn('[MarkEdit] Links open from the desktop app only:', href);
    return;
  }
  void openLink(invoke, href);
}

async function openLink(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>, href: string): Promise<void> {
  try {
    await invoke('open_link', { href });
  } catch (error) {
    console.error('[MarkEdit] Failed to open link:', error);
  }
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

  // Mermaid source toggle
  previewState.body.querySelectorAll<HTMLButtonElement>('.markedit-mermaid-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const container = button.closest('.markedit-preview-mermaid');
      if (container !== null) {
        container.classList.toggle('is-source-visible');
        invalidateScrollAnchors();
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

// ---------------------------------------------------------------------------------------------
// Scroll sync (split view), in both directions. See scrollSync.ts for the geometry.
// ---------------------------------------------------------------------------------------------

type ScrollSide = 'editor' | 'preview';

interface PreviewSurface {
  scroller: HTMLElement;
  root: HTMLElement;
  framed: boolean;
  /** Offset of an element from the top of the scrollable content. */
  offsetOf: (element: Element) => number;
}

const scrollSyncState: {
  anchors: ScrollAnchor[] | null;
  anchorsKey: string;
  anchorsTime: number;
  contentVersion: number;
  /** Last user input (wheel, click, key, touch) in each pane: the more recent one drives. */
  lastInput: Record<ScrollSide, number>;
  /** Positions this code set: the scroll events they cause are not user scrolling. */
  echo: Record<ScrollSide, { top: number; until: number } | null>;
} = {
  anchors: null,
  anchorsKey: '',
  anchorsTime: 0,
  contentVersion: 0,
  lastInput: { editor: 0, preview: 0 },
  echo: { editor: null, preview: null },
};

const ANCHOR_CACHE_MS = 1500;
const ECHO_MS = 300;
/** After input in the preview, editor scroll adjustments (re-measuring) do not move it back. */
const PREVIEW_DRIVE_MS = 1000;

function now(): number {
  return Date.now();
}

function isScrollSyncActive(): boolean {
  return previewState.syncScroll && previewState.mode === 'split' && previewState.body !== null && !isSyncPaused();
}

// ---------------------------------------------------------------------------------------------
// Sync pauses while the user edits or has a selection (in either pane), so the panes do not
// jump under the cursor or a drag selection. It resumes once there has been no edit and no
// selection for SYNC_RESUME_MS, and then re-aligns the panes.
// ---------------------------------------------------------------------------------------------

const SYNC_RESUME_MS = 1000;
/** While a selection exists, how often to check whether it was cleared. */
const SELECTION_POLL_MS = 250;

const syncPause: {
  until: number;
  selection: boolean;
  doc: unknown;
  timer: ReturnType<typeof setTimeout> | null;
} = {
  until: 0,
  selection: false,
  doc: null,
  timer: null,
};

/** Starts tracking edits from the current document without pausing (new document, mode change). */
function resetSyncPause(): void {
  syncPause.until = 0;
  syncPause.selection = false;
  syncPause.doc = getEditorView()?.state.doc ?? null;
  if (syncPause.timer !== null) {
    clearTimeout(syncPause.timer);
    syncPause.timer = null;
  }
}

function hasActiveSelection(): boolean {
  if (getEditorView()?.state.selection.ranges.some(range => !range.empty) === true) {
    return true;
  }

  const pane = previewState.pane;
  const selection = document.getSelection();
  if (pane !== null && selection !== null && !selection.isCollapsed && selection.anchorNode !== null && pane.contains(selection.anchorNode)) {
    return true;
  }

  const body = previewState.body;
  const frameSelection = body === null ? null : previewFrame(body)?.contentWindow?.getSelection() ?? null;
  return frameSelection !== null && !frameSelection.isCollapsed;
}

/** Notices edits: every change to the editor gives it a new document. */
function noteEditorEdits(): void {
  const doc = getEditorView()?.state.doc;
  if (doc === undefined || doc === syncPause.doc) {
    return;
  }
  const edited = syncPause.doc !== null;
  syncPause.doc = doc;
  if (edited) {
    pauseSync();
  }
}

function pauseSync(): void {
  syncPause.until = now() + SYNC_RESUME_MS;
  scheduleSyncResume();
}

function isSyncPaused(): boolean {
  noteEditorEdits();
  if (hasActiveSelection()) {
    if (!syncPause.selection) {
      syncPause.selection = true;
      scheduleSyncResume();
    }
    return true;
  }
  if (syncPause.selection) {
    // The selection was just cleared: wait the full quiet period from now.
    syncPause.selection = false;
    pauseSync();
    return true;
  }
  return now() < syncPause.until;
}

function scheduleSyncResume(): void {
  if (syncPause.timer !== null) {
    clearTimeout(syncPause.timer);
  }
  const delay = syncPause.selection ? SELECTION_POLL_MS : Math.max(0, syncPause.until - now()) + 20;
  syncPause.timer = setTimeout(() => {
    syncPause.timer = null;
    if (previewState.mode !== 'split') {
      return;
    }
    if (isSyncPaused()) {
      // Still selecting, or edited again: keep checking (replaces any check scheduled meanwhile).
      scheduleSyncResume();
      return;
    }
    realignAfterRender();
  }, delay);
}

/** Selection changes in the page or the preview frame update the pause right away. */
function handleSelectionChange(): void {
  if (previewState.mode === 'split') {
    isSyncPaused();
  }
}

function previewSurface(): PreviewSurface | null {
  const body = previewState.body;
  if (body === null) {
    return null;
  }

  const frame = previewFrame(body);
  if (frame !== null) {
    const frameDocument = frame.contentDocument;
    const scroller = frameDocument?.scrollingElement as HTMLElement | null | undefined;
    if (frameDocument === null || scroller === null || scroller === undefined) {
      return null;
    }
    return {
      scroller,
      root: frameDocument.body,
      framed: true,
      offsetOf: element => element.getBoundingClientRect().top + scroller.scrollTop,
    };
  }

  return {
    scroller: body,
    root: body,
    framed: false,
    offsetOf: element => element.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop,
  };
}

function isRendered(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

/** Forget measured preview positions (content re-rendered). */
function invalidateScrollAnchors(): void {
  scrollSyncState.contentVersion += 1;
  scrollSyncState.anchors = null;
}

/**
 * Anchors of the preview, cached while its size and content stay the same. Late layout changes
 * (images, diagrams, tabs, details) change the content height or width, which rebuilds them.
 */
function previewAnchors(surface: PreviewSurface, totalLines: number): ScrollAnchor[] {
  const { scroller, root } = surface;
  const key = `${scrollSyncState.contentVersion}:${totalLines}:${scroller.scrollHeight}:${scroller.clientWidth}:${surface.framed ? 1 : 0}`;
  if (scrollSyncState.anchors !== null && scrollSyncState.anchorsKey === key && now() - scrollSyncState.anchorsTime < ANCHOR_CACHE_MS) {
    return scrollSyncState.anchors;
  }

  const raw: ScrollAnchor[] = [];
  root.querySelectorAll<HTMLElement>('[data-line]').forEach(element => {
    const line = parseInt(element.dataset.line ?? '', 10);
    if (!Number.isNaN(line) && isRendered(element)) {
      raw.push({ line, top: surface.offsetOf(element) });
    }
  });

  // No line attributes (e.g. markdown-it in a frame): match headings by text instead.
  if (raw.length === 0) {
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter(isRendered);
    const lines = matchHeadings(headings.map(heading => heading.textContent), sourceHeadings(getEditorText()));
    headings.forEach((heading, index) => {
      const line = lines.at(index);
      if (line !== null && line !== undefined) {
        raw.push({ line, top: surface.offsetOf(heading) });
      }
    });
  }

  scrollSyncState.anchors = buildAnchors(raw, totalLines, scroller.scrollHeight);
  scrollSyncState.anchorsKey = key;
  scrollSyncState.anchorsTime = now();
  return scrollSyncState.anchors;
}

/** Offset of the editor's document inside its scroller (content padding, top panels). */
function editorDocumentOffset(editor: typeof window.editor): number {
  const scroller = editor.scrollDOM;
  const offset = editor.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return Number.isFinite(offset) ? offset : 0;
}

/** Fractional 0-based source line at a content offset of the editor scroller. */
function editorLineAtOffset(editor: typeof window.editor, offset: number): number {
  const doc = editor.state.doc;
  const height = offset - editorDocumentOffset(editor);
  if (height <= 0) {
    return 0;
  }

  const block = editor.lineBlockAtHeight(height);
  if (block.height <= 0) {
    // No layout (e.g. hidden): fall back to the share of the content height.
    const scroller = editor.scrollDOM;
    return doc.lines * Math.min(1, offset / Math.max(1, scroller.scrollHeight));
  }
  if (height >= block.top + block.height && block.to >= doc.length) {
    return doc.lines;
  }

  const first = doc.lineAt(block.from).number - 1;
  const last = doc.lineAt(block.to).number - 1;
  const fraction = Math.max(0, Math.min(1, (height - block.top) / block.height));
  return first + fraction * (last - first + 1);
}

/** Content offset of the editor scroller at a fractional 0-based source line. */
function editorOffsetAtLine(editor: typeof window.editor, line: number): number {
  const doc = editor.state.doc;
  const base = editorDocumentOffset(editor);
  if (line >= doc.lines) {
    const lastBlock = editor.lineBlockAt(doc.length);
    return base + lastBlock.top + lastBlock.height;
  }

  const index = Math.max(0, Math.floor(line));
  const docLine = doc.line(index + 1);
  const block = editor.lineBlockAt(docLine.from);
  if (block.height <= 0) {
    // No layout: the same share of the content height as editorLineAtOffset.
    return editor.scrollDOM.scrollHeight * Math.max(0, line) / Math.max(1, doc.lines);
  }
  const first = doc.lineAt(block.from).number - 1;
  const span = doc.lineAt(block.to).number - first;
  const fraction = (line - first) / Math.max(1, span);
  return base + block.top + Math.max(0, Math.min(1, fraction)) * block.height;
}

/** Scrolls `element` and remembers the position, so its scroll event is not taken as user input. */
function setSyncedScrollTop(side: ScrollSide, element: HTMLElement, top: number): void {
  const before = element.scrollTop;
  if (Math.abs(before - top) < 0.5) {
    return;
  }
  element.scrollTop = top;
  const after = element.scrollTop;
  if (Math.abs(after - before) >= 0.5) {
    scrollSyncState.echo[side] = { top: after, until: now() + ECHO_MS };
  }
}

/** Whether a scroll event is the result of `setSyncedScrollTop`. */
function isScrollEcho(side: ScrollSide, top: number): boolean {
  const echo = scrollSyncState.echo[side];
  if (echo === null) {
    return false;
  }
  if (now() > echo.until) {
    scrollSyncState.echo[side] = null;
    return false;
  }
  if (Math.abs(top - echo.top) <= 1) {
    scrollSyncState.echo[side] = null;
    return true;
  }
  return false;
}

/** Editor → preview: shows the part of the preview that matches the editor's viewport. */
export function syncScroll(): void {
  if (!isScrollSyncActive()) {
    return;
  }

  const editor = getEditorView();
  const surface = previewSurface();
  if (editor === undefined || surface === null) {
    return;
  }

  const line = editorLineAtOffset(editor, referenceOffset(editor.scrollDOM));
  const offset = lineToOffset(previewAnchors(surface, editor.state.doc.lines), line);
  setSyncedScrollTop('preview', surface.scroller, scrollTopForOffset(offset, surface.scroller));
}

/** Preview → editor: scrolls the editor to the source of what the preview shows. */
export function syncEditorScroll(): void {
  if (!isScrollSyncActive()) {
    return;
  }

  const editor = getEditorView();
  const surface = previewSurface();
  if (editor === undefined || surface === null) {
    return;
  }

  const line = offsetToLine(previewAnchors(surface, editor.state.doc.lines), referenceOffset(surface.scroller));
  const offset = editorOffsetAtLine(editor, line);
  setSyncedScrollTop('editor', editor.scrollDOM, scrollTopForOffset(offset, editor.scrollDOM));
}

function handleEditorScroll(): void {
  const scroller = getEditorView()?.scrollDOM;
  if (scroller === undefined || isScrollEcho('editor', scroller.scrollTop)) {
    return;
  }

  // The user is scrolling the preview and the editor moved by itself: it re-measured lines that
  // had estimated heights. Put it back at the preview's position instead of moving the preview.
  const { editor: editorInput, preview: previewInput } = scrollSyncState.lastInput;
  if (previewInput > editorInput && now() - previewInput < PREVIEW_DRIVE_MS) {
    syncEditorScroll();
    return;
  }

  syncScroll();
}

function handlePreviewScroll(): void {
  const surface = previewSurface();
  if (surface === null || isScrollEcho('preview', surface.scroller.scrollTop)) {
    return;
  }

  // Only scrolling the user started in the preview moves the editor (not re-rendering).
  const { editor: editorInput, preview: previewInput } = scrollSyncState.lastInput;
  if (previewInput <= editorInput) {
    return;
  }

  syncEditorScroll();
}

function notePreviewInput(): void {
  scrollSyncState.lastInput.preview = now();
}

function noteInput(event: Event): void {
  const target = event.target;
  const pane = previewState.pane;
  if (pane !== null && target instanceof Node && pane.contains(target)) {
    notePreviewInput();
  } else {
    scrollSyncState.lastInput.editor = now();
  }
}

const inputEvents = ['wheel', 'mousedown', 'touchstart', 'keydown'] as const;

/** Tracks input in the frame of a self-styled document (its events do not reach the page). */
function attachFrameScrollSync(frameDocument: Document): void {
  frameDocument.addEventListener('scroll', handlePreviewScroll, { passive: true });
  frameDocument.addEventListener('selectionchange', handleSelectionChange);
  for (const name of inputEvents) {
    frameDocument.addEventListener(name, notePreviewInput, { capture: true, passive: true });
  }
}

async function hydrateAndRealign(body: HTMLElement): Promise<void> {
  await hydrateDiagrams(body);
  realignAfterRender();
}

/** Re-aligns the preview after it was re-rendered, unless the user is scrolling it. */
function realignAfterRender(): void {
  invalidateScrollAnchors();
  if (!isScrollSyncActive()) {
    return;
  }
  const { editor: editorInput, preview: previewInput } = scrollSyncState.lastInput;
  if (previewInput > editorInput) {
    syncEditorScroll();
  } else {
    syncScroll();
  }
}

function createPreviewPane(): HTMLElement {
  const existingPane = previewState.pane;
  if (existingPane?.isConnected === true) {
    return existingPane;
  }

  previewState.pane = null;
  previewState.body = null;

  const pane = createElement('div', 'markedit-markdown-preview-pane');
  const mainArea = document.getElementById('markedit-main-area');
  if (mainArea !== null) {
    mainArea.appendChild(pane);
  } else {
    document.body.appendChild(pane);
  }

  const body = createElement('div', 'markedit-preview-body', pane);
  body.addEventListener('scroll', handlePreviewScroll, { passive: true });
  body.addEventListener('click', event => handlePreviewLinkClick(event, document));
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
  const mainArea = document.getElementById('markedit-main-area');
  if (mainArea !== null) {
    mainArea.appendChild(resizer);
  } else {
    document.body.appendChild(resizer);
  }

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
    if (previewState.mode === 'preview') {
      previewState.pane.style.left = '';
      previewState.pane.style.width = '';
    } else {
      previewState.pane.style.left = '';
      previewState.pane.style.width = `${(1 - previewState.splitRatio) * 100}%`;
    }
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
    editor.style.display = 'none';
  }

  syncEditorStyles();
  updateContent(true);
}

function handleEditorInputForPreview(): void {
  if (previewState.mode === 'editor') {
    return;
  }
  noteEditorEdits();
  updateContent();
}

function handleWindowFocusForPreview(): void {
  if (previewState.mode === 'editor') {
    return;
  }
  updateContent(true);
}

function startLiveSync(): void {
  const editor = getEditorView();
  if (editor === undefined) {
    return;
  }

  editor.scrollDOM.addEventListener('scroll', handleEditorScroll, { passive: true });
  resetSyncPause();

  const target = editor.dom;
  // Reliable update trigger: CodeMirror input/keyup events fire on every edit,
  // including IME composition commits, where MutationObserver can miss changes.
  target.addEventListener('input', handleEditorInputForPreview);
  target.addEventListener('keyup', handleEditorInputForPreview);
  window.addEventListener('focus', handleWindowFocusForPreview);

  // Fallback: poll the editor document so preview updates even if DOM input
  // events are swallowed by CodeMirror or the IME.
  let lastDoc = getEditorView()?.state.doc ?? null;
  const tick = () => {
    if (previewState.mode === 'editor') {
      liveSyncRaf = null;
      return;
    }
    const doc = getEditorView()?.state.doc ?? null;
    if (doc !== null && doc !== lastDoc) {
      lastDoc = doc;
      handleEditorInputForPreview();
    }
    liveSyncRaf = requestAnimationFrame(tick);
  };
  liveSyncRaf = requestAnimationFrame(tick);

  if (mutationObserver === null) {
    mutationObserver = new MutationObserver(() => {
      if (previewState.mode !== 'editor') {
        noteEditorEdits();
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
  const editor = getEditorView();
  editor?.scrollDOM.removeEventListener('scroll', handleEditorScroll);
  editor?.dom.removeEventListener('input', handleEditorInputForPreview);
  editor?.dom.removeEventListener('keyup', handleEditorInputForPreview);
  window.removeEventListener('focus', handleWindowFocusForPreview);
  if (liveSyncRaf !== null) {
    cancelAnimationFrame(liveSyncRaf);
    liveSyncRaf = null;
  }
  mutationObserver?.disconnect();
  mutationObserver = null;
}

function setupGlobalListeners(): void {
  // Which pane the user works in decides the direction of scroll sync.
  for (const name of inputEvents) {
    window.addEventListener(name, noteInput, { capture: true, passive: true });
  }

  window.addEventListener('mousemove', event => {
    if (!previewState.isDragging) {
      return;
    }

    const mainArea = document.getElementById('markedit-main-area');
    const bounds = mainArea?.getBoundingClientRect() ?? { left: 0, width: window.innerWidth };
    const relativeX = event.clientX - bounds.left;
    const ratio = Math.max(0.15, Math.min(0.85, relativeX / Math.max(1, bounds.width)));
    previewState.splitRatio = ratio;
    applyLayout();
  });

  window.addEventListener('mouseup', () => {
    previewState.isDragging = false;
  });

  window.addEventListener('editor-colors-changed', () => {
    syncEditorStyles();
    // Code is highlighted with the theme's own classes: render it again for the new theme.
    updateContent(true);
  });

  // The View menu is shared by all windows; show this window's state when it is focused.
  window.addEventListener('focus', () => {
    // Included files may have been edited in another window or app.
    clearSuperSetIncludes();
    publishViewState();
  });

  document.addEventListener('selectionchange', handleSelectionChange);

  window.addEventListener('markedit-editor-reset', () => {
    resetSyncPause();
    clearSuperSetIncludes(true);
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
      livePreview: isEditorLivePreview(),
    });
  } catch (error) {
    console.error('Failed to report view state:', error);
  }
}

setupGlobalListeners();
