import { createElement } from './utils';

interface InvokeFn {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface SearchMatch {
  line_number: number;
  line_text: string;
  start: number;
  end: number;
}

interface FileMatches {
  path: string;
  matches: SearchMatch[];
}

interface SearchResult {
  files: FileMatches[];
  total_matches: number;
  files_searched: number;
}

function invoke(): InvokeFn | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }).__TAURI_INTERNALS__?.invoke;
}

function fileName(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderSearch(container: HTMLElement): void {
  container.innerHTML = '';

  const root = createElement('div', 'markedit-search-panel');

  // Query row
  const queryRow = createElement('div', 'markedit-search-row', root);
  const queryInput = createElement('input', 'markedit-chrome-input markedit-search-input') as HTMLInputElement;
  queryInput.type = 'text';
  queryInput.placeholder = 'Search';
  queryRow.appendChild(queryInput);

  const toggles = createElement('div', 'markedit-search-toggles', queryRow);
  const caseToggle = createToggleBtn('Aa', 'Match Case');
  const wordToggle = createToggleBtn('ab', 'Match Whole Word');
  const regexToggle = createToggleBtn('.*', 'Use Regular Expression');
  toggles.append(caseToggle.btn, wordToggle.btn, regexToggle.btn);

  // Replace row
  const replaceRow = createElement('div', 'markedit-search-row', root);
  const replaceInput = createElement('input', 'markedit-chrome-input markedit-search-input') as HTMLInputElement;
  replaceInput.type = 'text';
  replaceInput.placeholder = 'Replace';
  replaceRow.appendChild(replaceInput);
  const replaceAllBtn = createElement('button', 'markedit-chrome-button markedit-search-action') as HTMLButtonElement;
  replaceAllBtn.textContent = 'Replace All';
  replaceRow.appendChild(replaceAllBtn);

  // Status
  const status = createElement('div', 'markedit-search-status', root);
  status.textContent = 'Type to search…';

  // Results
  const results = createElement('div', 'markedit-search-results', root);

  let currentQuery = '';
  let caseSensitive = false;
  let wholeWord = false;
  let useRegex = false;

  function createToggleBtn(label: string, title: string): { btn: HTMLButtonElement; getState: () => boolean; setState: (v: boolean) => void } {
    const btn = createElement('button', 'markedit-chrome-button markedit-search-toggle') as HTMLButtonElement;
    btn.textContent = label;
    btn.title = title;
    let state = false;
    btn.addEventListener('click', () => {
      state = !state;
      btn.classList.toggle('markedit-search-toggle-active', state);
      runSearch();
    });
    return { btn, getState: () => state, setState: (v) => { state = v; btn.classList.toggle('markedit-search-toggle-active', v); } };
  }

  // redefine toggles state bindings (createToggleBtn defined above but called before? hoist issue)
  // We called createToggleBtn before definition is fine due to function hoisting? It's a function declaration, hoisted.
  // Rebind state variables to toggle states:
  caseToggle.btn.addEventListener('click', () => { caseSensitive = caseToggle.getState(); }, { once: false });
  // Actually state vars updated in runSearch via getState

  function highlightLine(text: string, start: number, end: number): string {
    const before = escapeHtml(text.slice(0, start));
    const mid = escapeHtml(text.slice(start, end));
    const after = escapeHtml(text.slice(end));
    return `${before}<mark class="markedit-search-match">${mid}</mark>${after}`;
  }

  async function runSearch(): Promise<void> {
    const q = queryInput.value;
    currentQuery = q;
    const inv = invoke();
    const folder = currentFolderPath();
    if (q === '') {
      results.innerHTML = '';
      status.textContent = 'Type to search…';
      return;
    }
    if (inv === undefined || folder === null) {
      status.textContent = 'Open a folder to search.';
      results.innerHTML = '';
      return;
    }
    caseSensitive = caseToggle.getState();
    wholeWord = wordToggle.getState();
    useRegex = regexToggle.getState();
    status.textContent = 'Searching…';
    try {
      const res = (await inv('search_in_folder', {
        folder,
        query: q,
        caseSensitive,
        wholeWord,
        useRegex,
      })) as SearchResult;
      if (currentQuery !== q) return;
      renderResults(res);
    } catch (err) {
      status.textContent = `Error: ${String(err)}`;
    }
  }

  function currentFolderPath(): string | null {
    // access module-level from sidebar via window
    const w = window as unknown as { __markeditCurrentFolderPath?: string | null };
    return w.__markeditCurrentFolderPath ?? null;
  }

  function renderResults(res: SearchResult): void {
    results.innerHTML = '';
    if (res.files.length === 0) {
      status.textContent = `No results (${res.files_searched} files searched)`;
      return;
    }
    status.textContent = `${res.total_matches} result(s) in ${res.files.length} file(s)`;
    for (const f of res.files) {
      const fileHeader = createElement('div', 'markedit-search-file', results);
      fileHeader.textContent = fileName(f.path);
      fileHeader.title = f.path;
      const matchList = createElement('div', 'markedit-search-matches', results);
      for (const m of f.matches) {
        const item = createElement('div', 'markedit-search-match-item', matchList);
        const lineNo = createElement('span', 'markedit-search-lineno', item);
        lineNo.textContent = String(m.line_number);
        const line = createElement('span', 'markedit-search-line', item);
        line.innerHTML = highlightLine(m.line_text.trim(), m.start, m.end);
        item.addEventListener('click', () => {
          void openFileAt(f.path, m.line_number);
        });
      }
    }
  }

  async function openFileAt(path: string, line: number): Promise<void> {
    const inv = invoke();
    if (inv === undefined) return;
    try {
      await inv('open_document', { path });
      setTimeout(() => {
        const sel = (window as unknown as { webModules?: { selection?: { gotoLine: (a: { lineNumber: number }) => void } } }).webModules?.selection;
        sel?.gotoLine({ lineNumber: line });
      }, 300);
    } catch (err) {
      console.error('[MarkEdit] open failed:', err);
    }
  }

  replaceAllBtn.addEventListener('click', async () => {
    const inv = invoke();
    const folder = currentFolderPath();
    const q = queryInput.value;
    const repl = replaceInput.value;
    if (inv === undefined || folder === null || q === '') return;
    caseSensitive = caseToggle.getState();
    wholeWord = wordToggle.getState();
    useRegex = regexToggle.getState();
    try {
      const count = (await inv('replace_in_files', {
        folder,
        query: q,
        replacement: repl,
        caseSensitive,
        wholeWord,
        useRegex,
        targetFile: null,
      })) as number;
      status.textContent = `Replaced ${count} occurrence(s).`;
      void runSearch();
    } catch (err) {
      status.textContent = `Replace error: ${String(err)}`;
    }
  });

  queryInput.addEventListener('input', () => {
    void runSearch();
  });
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      void runSearch();
    }
  });

  // expose current folder path global for sidebar to set
  // (sidebar sets window.__markeditCurrentFolderPath)
}

