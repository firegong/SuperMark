import { createButton, createElement } from './utils';
import { globalState } from '../common/store';
import {
  renderMarkdown,
  getActiveMarkdownRenderer,
  setActiveMarkdownRenderer,
  getMarkdownSyntaxStandard,
  setMarkdownSyntaxStandard,
  registerMarkdownRenderer,
  listMarkdownRenderers,
  type MarkdownSyntaxStandard,
} from '../modules/markdown-renderer';

export type MarkdownPreviewMode = 'editor' | 'split' | 'preview';

const previewState: {
  mode: MarkdownPreviewMode;
  pane: HTMLElement | null;
  toolbar: HTMLElement | null;
  body: HTMLElement | null;
  syncScroll: boolean;
  splitRatio: number;
  isDragging: boolean;
  updateTimeout: ReturnType<typeof setTimeout> | null;
  lastContent: string;
} = {
  mode: 'editor',
  pane: null,
  toolbar: null,
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

function updateSummary(): void {
  if (previewState.toolbar === null) {
    return;
  }

  const text = getEditorText();
  const words = countWords(text);
  const badge = previewState.toolbar.querySelector('.markedit-preview-summary') as HTMLElement | null;
  if (badge !== null) {
    badge.textContent = `${words} words · ${readingTime(words)}`;
  }
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+/gu);
  return matches?.length ?? 0;
}

function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
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
    body.innerHTML = renderMarkdown(text);
    attachPreviewInteractions();
    updateSummary();
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
      const checked = checkbox.checked;
      const { from, to } = getEditorLineRange(line);
      const lineText = getEditorView()?.state.doc.sliceString(from, to) ?? '';
      const updated = checked
        ? lineText.replace(/\[x\]/i, '[ ]')
        : lineText.replace(/\[ \]/, '[x]');

      getEditorView()?.dispatch({ changes: { from, to, insert: updated } });
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
      }
    });
  });
}

async function copyToClipboard(text: string, button: HTMLButtonElement, feedback: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = feedback;
  setTimeout(() => { button.textContent = original; }, 1200);
}

function syncScroll(): void {
  if (!previewState.syncScroll || previewState.mode !== 'split' || previewState.body === null) {
    return;
  }

  const scroller = getEditorView()?.scrollDOM;
  if (scroller === undefined) {
    return;
  }

  const ratio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);
  const body = previewState.body;
  body.scrollTop = ratio * (body.scrollHeight - body.clientHeight || 1);
}

function createPreviewPane(): HTMLElement {
  const existingPane = previewState.pane;
  if (existingPane?.isConnected === true) {
    return existingPane;
  }

  previewState.pane = null;
  previewState.toolbar = null;
  previewState.body = null;

  const pane = createElement('div', 'markedit-markdown-preview-pane');
  document.body.appendChild(pane);

  const toolbar = createElement('div', 'markedit-preview-toolbar', pane);
  previewState.toolbar = toolbar;

  const left = createElement('div', 'markedit-preview-toolbar-left', toolbar);
  const modeGroup = createElement('div', 'markedit-preview-mode-group', left);

  const editorButton = createButton('Editor', () => setMarkdownPreviewMode('editor'), 'markedit-preview-mode-button');
  editorButton.dataset.mode = 'editor';
  modeGroup.appendChild(editorButton);

  const splitButton = createButton('Split', () => setMarkdownPreviewMode('split'), 'markedit-preview-mode-button');
  splitButton.dataset.mode = 'split';
  modeGroup.appendChild(splitButton);

  const previewButton = createButton('Preview', () => setMarkdownPreviewMode('preview'), 'markedit-preview-mode-button');
  previewButton.dataset.mode = 'preview';
  modeGroup.appendChild(previewButton);

  const rendererSelect = createSyntaxStandardSelect();
  modeGroup.appendChild(rendererSelect);

  const summary = createElement('span', 'markedit-preview-summary', left, '0 words · 1 min read');
  summary.title = 'Document summary';

  const right = createElement('div', 'markedit-preview-toolbar-right', toolbar);

  const syncButton = createButton('Sync Scroll', () => {
    previewState.syncScroll = !previewState.syncScroll;
    syncButton.classList.toggle('is-active', previewState.syncScroll);
  }, 'markedit-preview-toolbar-button');
  syncButton.classList.add('is-active');
  syncButton.title = 'Sync editor scroll to preview';
  right.appendChild(syncButton);

  const copyButton = createButton('Copy HTML', () => {
    const html = previewState.body?.innerHTML ?? '';
    void copyToClipboard(html, copyButton, 'Copied!');
  }, 'markedit-preview-toolbar-button');
  right.appendChild(copyButton);

  const closeButton = createButton('×', () => setMarkdownPreviewMode('editor'), 'markedit-chrome-button markedit-chrome-icon-button markedit-chrome-close-button');
  right.appendChild(closeButton);

  const body = createElement('div', 'markedit-preview-body', pane);
  previewState.body = body;

  previewState.pane = pane;
  return pane;
}

function createSyntaxStandardSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'markedit-preview-standard-select';
  select.title = 'Markdown syntax standard';

  const standards: { value: MarkdownSyntaxStandard; label: string }[] = [
    { value: 'extended', label: 'Extended' },
    { value: 'gfm', label: 'GFM' },
    { value: 'commonmark', label: 'CommonMark' },
  ];

  for (const { value, label } of standards) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  for (const engine of listMarkdownRenderers()) {
    if (engine.id === 'commonmark' || engine.id === 'gfm' || engine.id === 'extended') {
      continue;
    }
    const option = document.createElement('option');
    option.value = engine.id;
    option.textContent = engine.name;
    select.appendChild(option);
  }

  select.value = getActiveMarkdownRenderer().id;

  select.addEventListener('change', () => {
    setActiveMarkdownRenderer(select.value);
    updateContent(true);
  });

  return select;
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
  ensureModeSwitcher();

  if (previewState.mode === 'editor') {
    if (editor !== null) {
      editor.style.width = '';
      editor.style.display = '';
    }

    if (previewState.pane !== null) {
      previewState.pane.style.display = 'none';
    }

    updateModeSwitcher();
    return;
  }

  createPreviewPane();
  if (previewState.pane !== null) {
    previewState.pane.style.display = '';
    previewState.pane.style.width = previewState.mode === 'preview' ? '100%' : '';
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

  previewState.toolbar?.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.mode === previewState.mode);
  });

  updateModeSwitcher();
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

  window.addEventListener('markedit-editor-reset', () => {
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

function ensureModeSwitcher(): void {
  const root = document.getElementById('markedit-chrome-root');
  if (root?.querySelector('#markedit-mode-switcher') !== null) {
    return;
  }

  const pill = createElement('div', 'markedit-mode-switcher', root);
  pill.id = 'markedit-mode-switcher';

  const modes: MarkdownPreviewMode[] = ['editor', 'split', 'preview'];
  for (const mode of modes) {
    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
    const button = createButton(label, () => setMarkdownPreviewMode(mode), 'markedit-mode-switcher-button');
    button.dataset.mode = mode;
    pill.appendChild(button);
  }

  const rendererSelect = createSyntaxStandardSelect();
  pill.appendChild(rendererSelect);
}

function updateModeSwitcher(): void {
  const pill = document.getElementById('markedit-mode-switcher');
  if (pill === null) {
    return;
  }

  pill.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.mode === previewState.mode);
  });

  const select = pill.querySelector<HTMLSelectElement>('.markedit-preview-standard-select');
  if (select !== null) {
    select.value = getActiveMarkdownRenderer().id;
  }
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
}

export function getMarkdownStandard(): MarkdownSyntaxStandard {
  return getMarkdownSyntaxStandard();
}

export { registerMarkdownRenderer };

export function setMarkdownRenderer(id: string): void {
  setActiveMarkdownRenderer(id);
  updateContent(true);
}

export function ensureChromeUIModeSwitcher(): void {
  ensureModeSwitcher();
  updateModeSwitcher();
}

setupGlobalListeners();
