// (invoke accessed inline via window.__TAURI_INTERNALS__)

export type SidebarTab = 'files' | 'outline';

interface FolderNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FolderNode[];
}

let sidebarRoot: HTMLElement | null = null;
let filesContainer: HTMLElement | null = null;
let outlineContainer: HTMLElement | null = null;
// state retained for future use

function invoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
}

export function initSidebar(): void {
  if (sidebarRoot?.isConnected === true) {
    return;
  }
  sidebarRoot = null;
  const body = document.body;
  const editor = document.getElementById('editor');
  if (editor === null) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'markedit-sidebar-container';
  container.className = 'markedit-sidebar-container';

  const sidebar = document.createElement('aside');
  sidebar.id = 'markedit-sidebar';
  sidebar.className = 'markedit-sidebar';

  const tabs = document.createElement('div');
  tabs.className = 'markedit-sidebar-tabs';
  const filesTab = document.createElement('button');
  filesTab.className = 'markedit-sidebar-tab is-active';
  filesTab.textContent = 'Files';
  filesTab.addEventListener('click', () => setActiveTab('files'));
  const outlineTab = document.createElement('button');
  outlineTab.className = 'markedit-sidebar-tab';
  outlineTab.textContent = 'Outline';
  outlineTab.addEventListener('click', () => setActiveTab('outline'));
  tabs.append(filesTab, outlineTab);

  filesContainer = document.createElement('div');
  filesContainer.className = 'markedit-sidebar-pane is-active';
  outlineContainer = document.createElement('div');
  outlineContainer.className = 'markedit-sidebar-pane';

  sidebar.append(tabs, filesContainer, outlineContainer);
  const chromeRoot = document.querySelector('.markedit-chrome-root');
  container.append(sidebar, editor);
  body.replaceChildren(container);
  if (chromeRoot !== null) {
    body.appendChild(chromeRoot);
  }

  sidebarRoot = sidebar;

  showFilesEmptyState();
}

function showFilesEmptyState(): void {
  if (filesContainer === null) {
    return;
  }
  filesContainer.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'markedit-sidebar-empty-state';

  const openFolderBtn = document.createElement('button');
  openFolderBtn.className = 'markedit-sidebar-action-btn';
  openFolderBtn.textContent = 'Open Folder…';
  openFolderBtn.addEventListener('click', () => {
    const inv = invoke();
    if (inv !== undefined) {
      void (async () => {
        try {
          const result = await inv('pick_folder');
          if (typeof result === 'string' && result.length > 0) {
            await openFolder(result);
          }
        } catch {
          // ignore
        }
      })();
    }
  });

  const openFileBtn = document.createElement('button');
  openFileBtn.className = 'markedit-sidebar-action-btn secondary';
  openFileBtn.textContent = 'Open File…';
  openFileBtn.addEventListener('click', () => {
    const inv = invoke();
    if (inv !== undefined) {
      void (async () => {
        try {
          const result = await inv('pick_file');
          if (typeof result === 'string' && result.length > 0) {
            await inv('open_document', { path: result });
          }
        } catch {
          // ignore
        }
      })();
    }
  });

  wrap.append(openFolderBtn, openFileBtn);
  filesContainer.append(wrap);
}

function setActiveTab(tab: SidebarTab): void {
  // tab tracking not needed currently
  if (sidebarRoot === null) {
    return;
  }
  const tabs = sidebarRoot.querySelectorAll<HTMLButtonElement>('.markedit-sidebar-tab');
  tabs.forEach((t, i) => {
    t.classList.toggle('is-active', (i === 0 && tab === 'files') || (i === 1 && tab === 'outline'));
  });
  if (filesContainer !== null) {
    filesContainer.classList.toggle('is-active', tab === 'files');
  }
  if (outlineContainer !== null) {
    outlineContainer.classList.toggle('is-active', tab === 'outline');
  }
  if (tab === 'outline') {
    refreshOutline();
  }
}

export async function openFolder(path: string): Promise<void> {
  if (sidebarRoot?.isConnected !== true) {
    initSidebar();
  }
  const inv = invoke();
  if (inv === undefined) {
    return;
  }
  // folder tracking not needed currently
  try {
    const tree = (await inv('list_folder_tree', { folder: path })) as FolderNode;
    renderFolderTree(tree);
    setActiveTab('files');
  } catch (error) {
    console.error('[MarkEdit] Failed to list folder:', error);
  }
}

function renderFolderTree(node: FolderNode): void {
  if (filesContainer === null) {
    return;
  }
  filesContainer.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'markedit-filetree';
  renderFolderNode(node, root, 0);
  filesContainer.append(root);
}

function renderFolderNode(node: FolderNode, parent: HTMLElement, depth: number): void {
  let dirWrap: HTMLElement | null = null;
  let childrenWrap: HTMLElement | null = null;

  if (node.is_dir && depth > 0) {
    const dirEl = document.createElement('div');
    dirEl.className = 'markedit-filetree-dir';
    const arrow = document.createElement('span');
    arrow.className = 'markedit-filetree-arrow';
    arrow.textContent = '▸';
    const icon = document.createElement('span');
    icon.className = 'markedit-filetree-icon';
    icon.textContent = '📁';
    const label = document.createElement('span');
    label.className = 'markedit-filetree-label';
    label.textContent = node.name;
    dirEl.append(arrow, icon, label);

    dirWrap = document.createElement('div');
    dirWrap.className = 'markedit-filetree-dirwrap';
    dirWrap.style.paddingLeft = `${depth * 8}px`;
    dirWrap.append(dirEl);

    // Children container with a vertical guide line on the left.
    childrenWrap = document.createElement('div');
    childrenWrap.className = 'markedit-filetree-children';
    childrenWrap.style.marginLeft = `${(depth + 1) * 8 - 4}px`;

    let collapsed = false;
    const toggle = () => {
      collapsed = !collapsed;
      if (childrenWrap !== null) {
        childrenWrap.style.display = collapsed ? 'none' : '';
      }
      arrow.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(90deg)';
      dirWrap?.classList.toggle('is-collapsed', collapsed);
    };
    // Start expanded.
    arrow.style.transform = 'rotate(90deg)';
    dirEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    parent.append(dirWrap);
  }

  const targetParent = childrenWrap !== null ? childrenWrap : parent;

  for (const child of node.children) {
    if (child.is_dir) {
      renderFolderNode(child, targetParent, depth + 1);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'markedit-filetree-file';
      const icon = document.createElement('span');
      icon.className = 'markedit-filetree-icon';
      icon.textContent = '📄';
      const label = document.createElement('span');
      label.className = 'markedit-filetree-label';
      label.textContent = child.name;
      fileEl.append(icon, label);
      fileEl.style.paddingLeft = '8px';
      fileEl.addEventListener('click', () => {
        const inv = invoke();
        if (inv !== undefined) {
          void (async () => {
            try {
              await inv('open_document', { path: child.path });
            } catch (e) {
              console.error(e);
            }
          })();
        }
      });
      targetParent.append(fileEl);
    }
  }

  if (childrenWrap !== null && node.children.length > 0) {
    if (dirWrap !== null) {
      dirWrap.append(childrenWrap);
    } else {
      parent.append(childrenWrap);
    }
  }
}

export function refreshOutline(): void {
  if (outlineContainer === null) {
    return;
  }
  outlineContainer.innerHTML = '';
  const text = (window as unknown as { webModules?: { core?: { getEditorText?: () => string } } }).webModules?.core?.getEditorText?.() ?? '';
  const headings: { level: number; text: string; pos: number }[] = [];
  const lines = text.split('\n');
  let pos = 0;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.+)$/.exec(line);
    if (m !== null) {
      headings.push({ level: m[1].length, text: m[2].trim(), pos });
    }
    pos += line.length + 1;
  }
  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'markedit-sidebar-empty';
    empty.textContent = 'No headings';
    outlineContainer.append(empty);
    return;
  }
  for (const h of headings) {
    const el = document.createElement('div');
    el.className = 'markedit-outline-item';
    el.style.paddingLeft = `${(h.level - 1) * 12}px`;
    el.textContent = h.text;
    el.addEventListener('click', () => {
      const view = (window as unknown as { editor?: { dispatch?: (spec: unknown) => void } }).editor;
      // Jump by selecting the position; best-effort.
      if (view !== undefined && typeof view.dispatch === 'function') {
        view.dispatch({ selection: { anchor: h.pos } });
        view.dispatch({ scrollIntoView: true } as unknown);
      }
    });
    outlineContainer.append(el);
  }
}

// Register global hook used by Rust menu "Open Folder...".
(window as unknown as { __markeditOpenFolder?: (path: string) => void }).__markeditOpenFolder = (path: string) => {
  void openFolder(path);
};

// Register global hook used by Rust menu "Toggle Sidebar".
(window as unknown as { __markeditToggleSidebar?: () => void }).__markeditToggleSidebar = () => {
  if (sidebarRoot?.isConnected !== true) {
    initSidebar();
  }
  if (sidebarRoot === null) {
    return;
  }
  const container = sidebarRoot.parentElement;
  if (container === null) {
    return;
  }
  const hidden = container.classList.toggle('sidebar-hidden');
  sidebarRoot.style.display = hidden ? 'none' : '';
  // adjust editor flex
  const editor = document.getElementById('editor');
  if (editor !== null) {
    editor.style.flex = hidden ? '1' : '1';
  }
};

// Register sidebar init on load.
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initSidebar();
  });
}
