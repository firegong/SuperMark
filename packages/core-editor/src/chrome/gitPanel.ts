import { createElement } from './utils';

interface InvokeFn {
  (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface GitChange {
  path: string;
  index_status: string;
  worktree_status: string;
  untracked: boolean;
}

interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  is_repo: boolean;
}

function invoke(): InvokeFn | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: InvokeFn } }).__TAURI_INTERNALS__?.invoke;
}

function fileName(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function currentFolderPath(): string | null {
  const w = window as unknown as { __markeditCurrentFolderPath?: string | null };
  return w.__markeditCurrentFolderPath ?? null;
}

export function renderGit(container: HTMLElement): void {
  container.innerHTML = '';
  const root = createElement('div', 'markedit-git-panel', container);

  const header = createElement('div', 'markedit-git-header', root);
  const branchLabel = createElement('span', 'markedit-git-branch', header);
  branchLabel.textContent = '…';

  const statusLine = createElement('div', 'markedit-git-statusline', root);
  statusLine.textContent = '';

  const commitRow = createElement('div', 'markedit-git-commitrow', root);
  const commitInput = createElement('textarea', 'markedit-chrome-input markedit-git-commitmsg') as HTMLTextAreaElement;
  commitInput.placeholder = 'Message (Ctrl+Enter to commit)';
  commitInput.rows = 2;
  commitRow.appendChild(commitInput);
  const commitBtn = createElement('button', 'markedit-chrome-button markedit-git-commitbtn') as HTMLButtonElement;
  commitBtn.textContent = 'Commit';
  commitRow.appendChild(commitBtn);

  const stagedSection = createElement('div', 'markedit-git-section', root);
  const stagedTitle = createElement('div', 'markedit-git-section-title', stagedSection);
  stagedTitle.textContent = 'Staged Changes';
  const stagedList = createElement('div', 'markedit-git-list', stagedSection);

  const changesSection = createElement('div', 'markedit-git-section', root);
  const changesTitle = createElement('div', 'markedit-git-section-title', changesSection);
  changesTitle.textContent = 'Changes';
  const changesList = createElement('div', 'markedit-git-list', changesSection);

  const empty = createElement('div', 'markedit-git-empty', root);
  empty.textContent = 'Open a folder in a git repository.';


  async function refresh(): Promise<void> {
    const inv = invoke();
    const folder = currentFolderPath();
    if (inv === undefined || folder === null) {
      empty.style.display = '';
      stagedSection.style.display = 'none';
      changesSection.style.display = 'none';
      commitRow.style.display = 'none';
      branchLabel.textContent = '';
      statusLine.textContent = 'Open a folder to use Git.';
      return;
    }
    try {
      const isRepo = (await inv('git_is_repo', { folder })) as boolean;
      if (!isRepo) {
        empty.style.display = '';
        empty.textContent = 'Not a git repository.';
        stagedSection.style.display = 'none';
        changesSection.style.display = 'none';
        commitRow.style.display = 'none';
        branchLabel.textContent = '';
        statusLine.textContent = '';
        return;
      }
      empty.style.display = 'none';
      const st = (await inv('git_status', { folder })) as GitStatus;
      branchLabel.textContent = `⎇ ${st.branch || 'HEAD'}${st.ahead ? ' ↑' + st.ahead : ''}${st.behind ? ' ↓' + st.behind : ''}`;
      statusLine.textContent = st.changes.length === 0 ? 'No changes.' : `${st.changes.length} change(s)`;
      commitRow.style.display = '';

      const staged = st.changes.filter((c) => c.index_status !== '.' && c.index_status !== '?');
      const unstaged = st.changes.filter((c) => c.index_status === '.' || c.index_status === '?');

      stagedSection.style.display = staged.length > 0 ? '' : 'none';
      changesSection.style.display = unstaged.length > 0 ? '' : 'none';

      renderList(stagedList, staged, true);
      renderList(changesList, unstaged, false);
    } catch (err) {
      statusLine.textContent = `Error: ${String(err)}`;
    }
  }

  function renderList(list: HTMLElement, items: GitChange[], isStaged: boolean): void {
    list.innerHTML = '';
    for (const c of items) {
      const item = createElement('div', 'markedit-git-item', list);
      const name = createElement('span', 'markedit-git-item-name', item);
      name.textContent = fileName(c.path);
      name.title = c.path;
      const st = createElement('span', 'markedit-git-item-status', item);
      st.textContent = isStaged ? c.index_status : (c.untracked ? 'U' : c.worktree_status);
      const actions = createElement('div', 'markedit-git-item-actions', item);
      if (isStaged) {
        const unstageBtn = createElement('button', 'markedit-git-action', actions) as HTMLButtonElement;
        unstageBtn.textContent = '−';
        unstageBtn.title = 'Unstage';
        unstageBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const inv = invoke();
          const folder = currentFolderPath();
          if (inv === undefined || folder === null) return;
          await inv('git_unstage', { folder, paths: [c.path] });
          await refresh();
        });
        const diffBtn = createElement('button', 'markedit-git-action', actions) as HTMLButtonElement;
        diffBtn.textContent = 'Diff';
        diffBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await showDiff(c.path, true);
        });
      } else {
        const stageBtn = createElement('button', 'markedit-git-action', actions) as HTMLButtonElement;
        stageBtn.textContent = '+';
        stageBtn.title = 'Stage';
        stageBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const inv = invoke();
          const folder = currentFolderPath();
          if (inv === undefined || folder === null) return;
          await inv('git_stage', { folder, paths: [c.path] });
          await refresh();
        });
        const discardBtn = createElement('button', 'markedit-git-action', actions) as HTMLButtonElement;
        discardBtn.textContent = '↩';
        discardBtn.title = 'Discard';
        discardBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Discard changes in ${c.path}?`)) return;
          const inv = invoke();
          const folder = currentFolderPath();
          if (inv === undefined || folder === null) return;
          await inv('git_discard', { folder, paths: [c.path] });
          await refresh();
        });
        const diffBtn = createElement('button', 'markedit-git-action', actions) as HTMLButtonElement;
        diffBtn.textContent = 'Diff';
        diffBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await showDiff(c.path, false);
        });
      }
      item.addEventListener('click', () => {
        void (async () => {
          const inv = invoke();
          if (inv === undefined) return;
          await inv('open_document', { path: `${currentFolderPath()}/${c.path}`.replace(/\\/g, '/') });
        })();
      });
    }
  }

  async function showDiff(path: string, staged: boolean): Promise<void> {
    const inv = invoke();
    const folder = currentFolderPath();
    if (inv === undefined || folder === null) return;
    try {
      const d = (await inv('git_diff', { folder, path, staged })) as string;
      // show in a simple modal-ish alert fallback
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<pre style="white-space:pre-wrap;font-family:monospace;">${escapeHtml(d || '(no diff)')}</pre>`);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  commitBtn.addEventListener('click', async () => {
    const inv = invoke();
    const folder = currentFolderPath();
    const msg = commitInput.value.trim();
    if (inv === undefined || folder === null || msg === '') return;
    try {
      await inv('git_commit', { folder, message: msg });
      commitInput.value = '';
      await refresh();
    } catch (err) {
      statusLine.textContent = `Commit failed: ${String(err)}`;
    }
  });

  commitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitBtn.click();
    }
  });

  // initial
  void refresh();

  // expose refresh for external calls
  (container as unknown as { __refreshGit?: () => void }).__refreshGit = refresh;
}

// auto-refresh when folder changes is handled by sidebar activation
