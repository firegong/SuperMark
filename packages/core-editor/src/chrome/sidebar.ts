import { getDocumentPath } from '../common/documentPath';

export type SidebarTab = 'files' | 'outline' | string;

export interface SidebarHeaderAction {
  id: string;
  title: string;
  iconSvg: string;
  onClick: () => void;
}

export interface SidebarTabDefinition {
  id: SidebarTab;
  title: string;
  tooltip: string;
  iconSvg: string;
  render: (container: HTMLElement) => void;
  onActivate?: () => void;
  getHeaderActions?: () => SidebarHeaderAction[];
}

export interface FolderNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FolderNode[];
}

// -----------------------------------------------------------------------------
// State & Storage Keys
// -----------------------------------------------------------------------------

const STORAGE_KEY_OPEN = 'markedit-sidebar-open';
const STORAGE_KEY_TAB = 'markedit-sidebar-active-tab';
const STORAGE_KEY_WIDTH = 'markedit-sidebar-width';

const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;

let isSidebarOpen = true;
let activeTabId: SidebarTab = 'files';
let sidebarWidth = DEFAULT_WIDTH;

let appLayoutRoot: HTMLElement | null = null;
let activityBarEl: HTMLElement | null = null;
let sidebarRoot: HTMLElement | null = null;
let sidebarTitleEl: HTMLElement | null = null;
let sidebarActionsEl: HTMLElement | null = null;
let sidebarContentEl: HTMLElement | null = null;

let currentFolderTree: FolderNode | null = null;
let currentFolderPath: string | null = null;
const expandedPaths: Set<string> = new Set();

const tabRegistry = new Map<SidebarTab, SidebarTabDefinition>();
const tabPanes = new Map<SidebarTab, HTMLElement>();

function invoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (c: string, a?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__?.invoke;
}

function safeGetStorage(key: string, defaultValue: string): string {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

// -----------------------------------------------------------------------------
// VS Code SVG Icons
// -----------------------------------------------------------------------------

const ICONS = {
  explorer: `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.5 2H6.5A2.5 2.5 0 0 0 4 4.5v13A2.5 2.5 0 0 0 6.5 20H15.5A2.5 2.5 0 0 0 18 17.5V4.5A2.5 2.5 0 0 0 15.5 2z"/>
      <path d="M18 6h1.5A2.5 2.5 0 0 1 22 8.5v11A2.5 2.5 0 0 1 19.5 22H9.5A2.5 2.5 0 0 1 7 19.5V18"/>
    </svg>`,
  outline: `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <line x1="4" y1="6" x2="20" y2="6"></line>
      <line x1="8" y1="12" x2="20" y2="12"></line>
      <line x1="12" y1="18" x2="20" y2="18"></line>
      <circle cx="4" cy="6" r="1.5" fill="currentColor"></circle>
      <circle cx="8" cy="12" r="1.5" fill="currentColor"></circle>
      <circle cx="12" cy="18" r="1.5" fill="currentColor"></circle>
    </svg>`,
  toggleSidebar: `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
      <line x1="9" y1="3" x2="9" y2="21"></line>
    </svg>`,
  settings: `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>`,
  close: `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path>
    </svg>`,
  refresh: `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7 7 0 0 1 1.05 8.84a.75.75 0 0 1 .655-.835Zm11.956-.01a.75.75 0 0 1-.834-.656A5.5 5.5 0 0 0 3.235 4.369l1.204 1.204a.25.25 0 0 1-.177.427H.616a.25.25 0 0 1-.25-.25V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7 7 0 0 1 14.316 7.16a.75.75 0 0 1-.655.835Z"></path>
    </svg>`,
  collapseAll: `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9 9H4v1h5V9zM9 12H4v1h5v-1zM2 2h12v12H2V2zm1 1v10h10V3H3z"/>
    </svg>`,
  openFolder: `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 2.5a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75h-5.5a.25.25 0 0 1-.2-.1l-.9-1.2a.75.75 0 0 0-.6-.3H1.75Z"></path>
    </svg>`,
  chevronRight: `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"></path>
    </svg>`,
  chevronDown: `
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path>
    </svg>`,
  folderClosed: `
    <svg width="15" height="15" viewBox="0 0 16 16" fill="#dcb67a">
      <path d="M1.75 2.5a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 .75-.75v-8.5a.75.75 0 0 0-.75-.75h-5.5a.25.25 0 0 1-.2-.1l-.9-1.2a.75.75 0 0 0-.6-.3H1.75Z"></path>
    </svg>`,
  folderOpen: `
    <svg width="15" height="15" viewBox="0 0 16 16" fill="#e5c07b">
      <path d="M.5 4.5A1.5 1.5 0 0 1 2 3h3.5a1.5 1.5 0 0 1 1.2.6l.8 1.067H14a1.5 1.5 0 0 1 1.485 1.272l-1.4 6A1.5 1.5 0 0 1 12.615 13H2a1.5 1.5 0 0 1-1.5-1.5V4.5z"/>
    </svg>`,
  fileMarkdown: `
    <svg width="15" height="15" viewBox="0 0 16 16" fill="#4daafc">
      <path d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1h-11zm1 3h2l1.5 2 1.5-2h2v7h-1.5V6.75L7.5 8.75 6 6.75V11h-1.5V4zm7 0h1.5v4.5H14L12.75 11 11.5 8.5H13V4z"/>
    </svg>`,
  fileDefault: `
    <svg width="15" height="15" viewBox="0 0 16 16" fill="#999999">
      <path d="M3.5 1A1.5 1.5 0 0 0 2 2.5v11A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5v-8L9.5 1h-6zm5 1.5L12 6H8.5V2.5z"/>
    </svg>`,
};

// -----------------------------------------------------------------------------
// Extensibility: Register Tabs
// -----------------------------------------------------------------------------

export function registerSidebarTab(tab: SidebarTabDefinition): void {
  tabRegistry.set(tab.id, tab);
  if (activityBarEl !== null) {
    updateActivityBarButtons();
  }
}

export function getRegisteredTabs(): SidebarTabDefinition[] {
  return Array.from(tabRegistry.values());
}

// -----------------------------------------------------------------------------
// Initialize Sidebar Layout
// -----------------------------------------------------------------------------

export function initSidebar(): void {
  const existingLayout = document.getElementById('markedit-app-layout');
  if (existingLayout?.isConnected === true) {
    return;
  }

  const editor = document.getElementById('editor');
  if (editor === null) {
    return;
  }

  tabPanes.clear();

  // Restore saved state
  isSidebarOpen = safeGetStorage(STORAGE_KEY_OPEN, 'true') !== 'false';
  activeTabId = safeGetStorage(STORAGE_KEY_TAB, 'files');
  const savedWidth = parseInt(safeGetStorage(STORAGE_KEY_WIDTH, String(DEFAULT_WIDTH)), 10);
  sidebarWidth = Number.isFinite(savedWidth) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, savedWidth)) : DEFAULT_WIDTH;

  // 1. Root Layout Container
  const appLayout = document.createElement('div');
  appLayout.id = 'markedit-app-layout';
  appLayout.className = 'markedit-app-layout markedit-sidebar-container';
  appLayoutRoot = appLayout;

  // 2. Activity Bar (VS Code left-most bar)
  const activityBar = document.createElement('aside');
  activityBar.id = 'markedit-activity-bar';
  activityBar.className = 'markedit-activity-bar';
  activityBarEl = activityBar;

  const activityTop = document.createElement('div');
  activityTop.className = 'markedit-activity-bar-top';
  const activityBottom = document.createElement('div');
  activityBottom.className = 'markedit-activity-bar-bottom';
  activityBar.append(activityTop, activityBottom);

  // 3. Primary Side Bar
  const sidebar = document.createElement('aside');
  sidebar.id = 'markedit-sidebar';
  sidebar.className = 'markedit-sidebar';
  sidebar.style.width = `${sidebarWidth}px`;
  sidebarRoot = sidebar;

  // Header
  const sidebarHeader = document.createElement('div');
  sidebarHeader.className = 'markedit-sidebar-header';
  const sidebarTitle = document.createElement('span');
  sidebarTitle.className = 'markedit-sidebar-title';
  sidebarTitleEl = sidebarTitle;
  const sidebarActions = document.createElement('div');
  sidebarActions.className = 'markedit-sidebar-actions';
  sidebarActionsEl = sidebarActions;
  sidebarHeader.append(sidebarTitle, sidebarActions);

  // Content Area
  const sidebarContent = document.createElement('div');
  sidebarContent.className = 'markedit-sidebar-content';
  sidebarContentEl = sidebarContent;

  // Resizer Handle
  const resizer = document.createElement('div');
  resizer.className = 'markedit-sidebar-resizer';
  resizer.title = 'Drag to resize sidebar';
  setupSidebarResizer(resizer, sidebar);

  sidebar.append(sidebarHeader, sidebarContent, resizer);

  // 4. Main Workspace Area (Hosts #editor and markdown preview pane)
  const mainArea = document.createElement('main');
  mainArea.id = 'markedit-main-area';
  mainArea.className = 'markedit-main-area';
  mainArea.appendChild(editor);

  // Put everything into the layout
  appLayout.append(activityBar, sidebar, mainArea);

  // Preserve chrome root (modals, findbar, etc.)
  const chromeRoot = document.querySelector('.markedit-chrome-root');
  document.body.replaceChildren(appLayout);
  if (chromeRoot !== null) {
    document.body.appendChild(chromeRoot);
  }

  // Register default tabs
  registerDefaultTabs();

  // Populate Activity Bar buttons
  updateActivityBarButtons();

  // Setup bottom activity bar items (Toggle Sidebar, Settings)
  setupActivityBarBottom(activityBottom);

  // Apply initial open/closed state
  setSidebarVisible(isSidebarOpen, false);

  // Activate initial tab
  setActiveTab(activeTabId, true);

  // Keyboard shortcut listeners (Ctrl/Cmd + B, Ctrl/Cmd + Shift + B, Ctrl/Cmd + Shift + E)
  setupKeyboardShortcuts();

  // Re-observe editor changes to update outline when active
  setupEditorChangeObserver();
}

// -----------------------------------------------------------------------------
// Register Default Tabs: Explorer & Outline
// -----------------------------------------------------------------------------

function registerDefaultTabs(): void {
  // 1. Files / Explorer Tab
  registerSidebarTab({
    id: 'files',
    title: 'EXPLORER',
    tooltip: 'Explorer (Ctrl+Shift+E)',
    iconSvg: ICONS.explorer,
    render: (container) => {
      if (currentFolderTree !== null) {
        renderFolderTree(currentFolderTree, container);
      } else {
        renderFilesEmptyState(container);
      }
    },
    getHeaderActions: () => {
      const actions: SidebarHeaderAction[] = [];
      actions.push({
        id: 'open-folder',
        title: 'Open Folder…',
        iconSvg: ICONS.openFolder,
        onClick: () => {
          void pickAndOpenFolder();
        },
      });
      if (currentFolderTree !== null) {
        actions.push({
          id: 'collapse-all',
          title: 'Collapse All',
          iconSvg: ICONS.collapseAll,
          onClick: () => {
            expandedPaths.clear();
            if (currentFolderPath !== null) {
              expandedPaths.add(currentFolderPath);
            }
            if (sidebarContentEl !== null && currentFolderTree !== null) {
              const pane = getOrCreatePane('files');
              renderFolderTree(currentFolderTree, pane);
            }
          },
        });
        actions.push({
          id: 'refresh-folder',
          title: 'Refresh Explorer',
          iconSvg: ICONS.refresh,
          onClick: () => {
            void refreshFolder();
          },
        });
      }
      actions.push({
        id: 'close-sidebar',
        title: 'Close Side Bar',
        iconSvg: ICONS.close,
        onClick: () => {
          setSidebarVisible(false);
        },
      });
      return actions;
    },
  });

  // 2. Outline Tab
  registerSidebarTab({
    id: 'outline',
    title: 'OUTLINE',
    tooltip: 'Outline',
    iconSvg: ICONS.outline,
    render: (container) => {
      renderOutline(container);
    },
    onActivate: () => {
      refreshOutline();
    },
    getHeaderActions: () => [
      {
        id: 'refresh-outline',
        title: 'Refresh Outline',
        iconSvg: ICONS.refresh,
        onClick: () => {
          refreshOutline();
        },
      },
      {
        id: 'close-sidebar',
        title: 'Close Side Bar',
        iconSvg: ICONS.close,
        onClick: () => {
          setSidebarVisible(false);
        },
      },
    ],
  });
}

// -----------------------------------------------------------------------------
// Activity Bar Rendering & Updates
// -----------------------------------------------------------------------------

function updateActivityBarButtons(): void {
  if (activityBarEl === null) {
    return;
  }
  const top = activityBarEl.querySelector('.markedit-activity-bar-top');
  if (top === null) {
    return;
  }
  top.innerHTML = '';

  for (const tab of tabRegistry.values()) {
    const btn = document.createElement('button');
    btn.className = `markedit-activity-btn${activeTabId === tab.id && isSidebarOpen ? ' is-active' : ''}`;
    btn.dataset.tab = tab.id;
    btn.title = tab.tooltip;
    btn.setAttribute('aria-label', tab.tooltip);
    btn.innerHTML = tab.iconSvg;

    btn.addEventListener('click', () => {
      handleActivityButtonClick(tab.id);
    });

    top.appendChild(btn);
  }
}

function setupActivityBarBottom(bottomEl: HTMLElement): void {
  bottomEl.innerHTML = '';

  // Toggle Sidebar Button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'markedit-activity-btn';
  toggleBtn.title = 'Toggle Side Bar (Ctrl+B)';
  toggleBtn.setAttribute('aria-label', 'Toggle Side Bar');
  toggleBtn.innerHTML = ICONS.toggleSidebar;
  toggleBtn.addEventListener('click', () => {
    toggleSidebar();
  });

  // Settings Button
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'markedit-activity-btn';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Settings');
  settingsBtn.innerHTML = ICONS.settings;
  settingsBtn.addEventListener('click', () => {
    const chrome = (window as unknown as { chromeUI?: { openSettings?: () => void } }).chromeUI;
    if (typeof chrome?.openSettings === 'function') {
      chrome.openSettings();
    }
  });

  bottomEl.append(toggleBtn, settingsBtn);
}

function handleActivityButtonClick(tabId: SidebarTab): void {
  if (isSidebarOpen && activeTabId === tabId) {
    // VS Code behavior: clicking the currently active tab button closes the sidebar.
    setSidebarVisible(false);
  } else {
    // Open sidebar and switch to this tab.
    setActiveTab(tabId);
    setSidebarVisible(true);
  }
}

// -----------------------------------------------------------------------------
// Tab Switching & Pane Management
// -----------------------------------------------------------------------------

export function setActiveTab(tabId: SidebarTab, forceRender = false): void {
  const tabDef = tabRegistry.get(tabId);
  if (tabDef === undefined) {
    return;
  }

  activeTabId = tabId;
  safeSetStorage(STORAGE_KEY_TAB, tabId);

  // Update Activity Bar active state
  if (activityBarEl !== null) {
    const buttons = activityBarEl.querySelectorAll<HTMLButtonElement>('.markedit-activity-bar-top .markedit-activity-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabId && isSidebarOpen);
    });
  }

  // Update Header Title & Actions
  if (sidebarTitleEl !== null) {
    sidebarTitleEl.textContent = tabDef.title;
  }
  updateHeaderActions(tabDef);

  // Switch Active Pane
  if (sidebarContentEl !== null) {
    for (const [id, pane] of tabPanes.entries()) {
      pane.classList.toggle('is-active', id === tabId);
    }
    const targetPane = getOrCreatePane(tabId);
    targetPane.classList.add('is-active');

    if (forceRender || targetPane.children.length === 0) {
      tabDef.render(targetPane);
    }
  }

  tabDef.onActivate?.();
}

function getOrCreatePane(tabId: SidebarTab): HTMLElement {
  let pane = tabPanes.get(tabId);
  if (pane?.isConnected !== true) {
    pane = document.createElement('div');
    pane.id = `markedit-pane-${tabId}`;
    pane.className = 'markedit-sidebar-pane';
    if (sidebarContentEl !== null) {
      sidebarContentEl.appendChild(pane);
    }
    tabPanes.set(tabId, pane);
  }
  return pane;
}

function updateHeaderActions(tabDef: SidebarTabDefinition): void {
  if (sidebarActionsEl === null) {
    return;
  }
  sidebarActionsEl.innerHTML = '';
  const actions = tabDef.getHeaderActions?.() ?? [];
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'markedit-sidebar-icon-btn';
    btn.title = action.title;
    btn.setAttribute('aria-label', action.title);
    btn.innerHTML = action.iconSvg;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.onClick();
    });
    sidebarActionsEl.appendChild(btn);
  }
}

// -----------------------------------------------------------------------------
// Show / Hide / Toggle Sidebar
// -----------------------------------------------------------------------------

export function isSidebarVisible(): boolean {
  return isSidebarOpen && sidebarRoot !== null && !sidebarRoot.classList.contains('is-hidden');
}

export function setSidebarVisible(visible: boolean, notifyResize = true): void {
  isSidebarOpen = visible;
  safeSetStorage(STORAGE_KEY_OPEN, visible ? 'true' : 'false');

  if (sidebarRoot !== null) {
    sidebarRoot.classList.toggle('is-hidden', !visible);
  }
  if (appLayoutRoot !== null) {
    appLayoutRoot.classList.toggle('sidebar-hidden', !visible);
  }

  // Update Activity Bar active indicator
  if (activityBarEl !== null) {
    const buttons = activityBarEl.querySelectorAll<HTMLButtonElement>('.markedit-activity-bar-top .markedit-activity-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('is-active', visible && btn.dataset.tab === activeTabId);
    });
  }

  if (visible) {
    const tabDef = tabRegistry.get(activeTabId);
    if (tabDef !== undefined) {
      updateHeaderActions(tabDef);
    }
  }

  if (notifyResize) {
    window.dispatchEvent(new Event('resize'));
  }
}

export function toggleSidebar(forceState?: boolean): void {
  if (sidebarRoot?.isConnected !== true) {
    initSidebar();
  }
  const next = forceState !== undefined ? forceState : !isSidebarVisible();
  setSidebarVisible(next);
}

export function sidebarVisibleWidth(): number {
  if (!isSidebarVisible() || sidebarRoot === null) {
    return 0;
  }
  return sidebarRoot.offsetWidth || sidebarWidth;
}

// -----------------------------------------------------------------------------
// Resizable Side Bar Width
// -----------------------------------------------------------------------------

function setupSidebarResizer(resizer: HTMLElement, sidebar: HTMLElement): void {
  let startX = 0;
  let startWidth = 0;
  let isResizing = false;

  const onMouseMove = (e: MouseEvent) => {
    if (!isResizing) {
      return;
    }
    const delta = e.clientX - startX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    sidebarWidth = newWidth;
    sidebar.style.width = `${newWidth}px`;
    safeSetStorage(STORAGE_KEY_WIDTH, String(newWidth));
    window.dispatchEvent(new Event('resize'));
  };

  const onMouseUp = () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('is-col-resizing');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
  };

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth || sidebarWidth;
    document.body.classList.add('is-col-resizing');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  resizer.addEventListener('dblclick', () => {
    sidebarWidth = DEFAULT_WIDTH;
    sidebar.style.width = `${DEFAULT_WIDTH}px`;
    safeSetStorage(STORAGE_KEY_WIDTH, String(DEFAULT_WIDTH));
    window.dispatchEvent(new Event('resize'));
  });
}

// -----------------------------------------------------------------------------
// Explorer View Implementation
// -----------------------------------------------------------------------------

function renderFilesEmptyState(container: HTMLElement): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'markedit-sidebar-empty-state';

  const heading = document.createElement('div');
  heading.className = 'markedit-sidebar-empty-title';
  heading.textContent = 'NO FOLDER OPENED';

  const desc = document.createElement('div');
  desc.className = 'markedit-sidebar-empty-desc';
  desc.textContent = 'You have not yet opened a folder. Open a folder to view and edit Markdown files.';

  const openFolderBtn = document.createElement('button');
  openFolderBtn.className = 'markedit-sidebar-action-btn primary';
  openFolderBtn.innerHTML = `${ICONS.openFolder}<span>Open Folder…</span>`;
  openFolderBtn.addEventListener('click', () => {
    void pickAndOpenFolder();
  });

  const openFileBtn = document.createElement('button');
  openFileBtn.className = 'markedit-sidebar-action-btn secondary';
  openFileBtn.innerHTML = '<span>Open File…</span>';
  openFileBtn.addEventListener('click', () => {
    void pickAndOpenFile();
  });

  wrap.append(heading, desc, openFolderBtn, openFileBtn);
  container.appendChild(wrap);
}

async function pickAndOpenFolder(): Promise<void> {
  const inv = invoke();
  if (inv === undefined) {
    return;
  }
  try {
    const result = await inv('pick_folder');
    if (typeof result === 'string' && result.length > 0) {
      await openFolder(result);
    }
  } catch (error) {
    console.error('[MarkEdit] Failed to pick folder:', error);
  }
}

async function pickAndOpenFile(): Promise<void> {
  const inv = invoke();
  if (inv === undefined) {
    return;
  }
  try {
    const result = await inv('pick_file');
    if (typeof result === 'string' && result.length > 0) {
      await inv('open_document', { path: result });
    }
  } catch (error) {
    console.error('[MarkEdit] Failed to pick file:', error);
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

  try {
    const tree = (await inv('list_folder_tree', { folder: path })) as FolderNode;
    currentFolderPath = path;
    currentFolderTree = tree;
    expandedPaths.add(path);

    const pane = getOrCreatePane('files');
    renderFolderTree(tree, pane);
    setActiveTab('files');
    setSidebarVisible(true);
  } catch (error) {
    console.error('[MarkEdit] Failed to list folder tree:', error);
  }
}

export async function refreshFolder(): Promise<void> {
  if (currentFolderPath === null) {
    return;
  }
  const inv = invoke();
  if (inv === undefined) {
    return;
  }
  try {
    const tree = (await inv('list_folder_tree', { folder: currentFolderPath })) as FolderNode;
    currentFolderTree = tree;
    const pane = getOrCreatePane('files');
    renderFolderTree(tree, pane);
  } catch (error) {
    console.error('[MarkEdit] Failed to refresh folder:', error);
  }
}

function renderFolderTree(rootNode: FolderNode, container: HTMLElement): void {
  container.innerHTML = '';

  const treeRoot = document.createElement('div');
  treeRoot.className = 'markedit-filetree';

  // Section Header: Root folder name (VS Code style)
  const rootHeader = document.createElement('div');
  rootHeader.className = 'markedit-filetree-root-header';

  const rootChevron = document.createElement('span');
  rootChevron.className = 'markedit-filetree-arrow';
  const isRootExpanded = expandedPaths.has(rootNode.path);
  rootChevron.innerHTML = isRootExpanded ? ICONS.chevronDown : ICONS.chevronRight;

  const rootIcon = document.createElement('span');
  rootIcon.className = 'markedit-filetree-icon';
  rootIcon.innerHTML = isRootExpanded ? ICONS.folderOpen : ICONS.folderClosed;

  const rootLabel = document.createElement('span');
  rootLabel.className = 'markedit-filetree-label root-name';
  rootLabel.textContent = rootNode.name.toUpperCase();

  rootHeader.append(rootChevron, rootIcon, rootLabel);

  const rootChildrenContainer = document.createElement('div');
  rootChildrenContainer.className = 'markedit-filetree-children-container';
  rootChildrenContainer.style.display = isRootExpanded ? 'block' : 'none';

  rootHeader.addEventListener('click', () => {
    const nextExpanded = !expandedPaths.has(rootNode.path);
    if (nextExpanded) {
      expandedPaths.add(rootNode.path);
    } else {
      expandedPaths.delete(rootNode.path);
    }
    rootChevron.innerHTML = nextExpanded ? ICONS.chevronDown : ICONS.chevronRight;
    rootIcon.innerHTML = nextExpanded ? ICONS.folderOpen : ICONS.folderClosed;
    rootChildrenContainer.style.display = nextExpanded ? 'block' : 'none';
  });

  treeRoot.append(rootHeader, rootChildrenContainer);

  // Render children sorted: directories first (alphabetical), then files (alphabetical)
  renderNodeChildren(rootNode.children, rootChildrenContainer, 1);

  container.appendChild(treeRoot);

  // Update header action buttons (e.g. collapse all, refresh)
  const tabDef = tabRegistry.get('files');
  if (tabDef !== undefined) {
    updateHeaderActions(tabDef);
  }
}

function renderNodeChildren(children: FolderNode[], parentEl: HTMLElement, depth: number): void {
  const sorted = [...children].sort((a, b) => {
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });

  for (const item of sorted) {
    if (item.is_dir) {
      renderDirectoryNode(item, parentEl, depth);
    } else {
      renderFileNode(item, parentEl, depth);
    }
  }
}

function renderDirectoryNode(node: FolderNode, parentEl: HTMLElement, depth: number): void {
  const isExpanded = expandedPaths.has(node.path);

  const dirItem = document.createElement('div');
  dirItem.className = `markedit-filetree-item markedit-filetree-dir${isExpanded ? ' is-expanded' : ''}`;
  dirItem.style.paddingLeft = `${depth * 14}px`;

  const arrow = document.createElement('span');
  arrow.className = 'markedit-filetree-arrow';
  arrow.innerHTML = isExpanded ? ICONS.chevronDown : ICONS.chevronRight;

  const icon = document.createElement('span');
  icon.className = 'markedit-filetree-icon';
  icon.innerHTML = isExpanded ? ICONS.folderOpen : ICONS.folderClosed;

  const label = document.createElement('span');
  label.className = 'markedit-filetree-label';
  label.textContent = node.name;

  dirItem.append(arrow, icon, label);
  parentEl.appendChild(dirItem);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'markedit-filetree-children';
  childrenContainer.style.display = isExpanded ? 'block' : 'none';
  parentEl.appendChild(childrenContainer);

  dirItem.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextState = !expandedPaths.has(node.path);
    if (nextState) {
      expandedPaths.add(node.path);
    } else {
      expandedPaths.delete(node.path);
    }
    arrow.innerHTML = nextState ? ICONS.chevronDown : ICONS.chevronRight;
    icon.innerHTML = nextState ? ICONS.folderOpen : ICONS.folderClosed;
    dirItem.classList.toggle('is-expanded', nextState);
    childrenContainer.style.display = nextState ? 'block' : 'none';
  });

  renderNodeChildren(node.children, childrenContainer, depth + 1);
}

function renderFileNode(node: FolderNode, parentEl: HTMLElement, depth: number): void {
  const currentPath = getDocumentPath();
  const isActive = currentPath !== null && (currentPath === node.path || currentPath.endsWith(node.path));

  const fileItem = document.createElement('div');
  fileItem.className = `markedit-filetree-item markedit-filetree-file${isActive ? ' is-active' : ''}`;
  fileItem.style.paddingLeft = `${depth * 14 + 12}px`;
  fileItem.title = node.path;

  const icon = document.createElement('span');
  icon.className = 'markedit-filetree-icon';
  icon.innerHTML = getFileIconSvg(node.name);

  const label = document.createElement('span');
  label.className = 'markedit-filetree-label';
  label.textContent = node.name;

  fileItem.append(icon, label);
  parentEl.appendChild(fileItem);

  fileItem.addEventListener('click', () => {
    // Highlight clicked file
    parentEl.closest('.markedit-filetree')?.querySelectorAll('.markedit-filetree-file').forEach(el => {
      el.classList.remove('is-active');
    });
    fileItem.classList.add('is-active');

    const inv = invoke();
    if (inv !== undefined) {
      void (async () => {
        try {
          await inv('open_document', { path: node.path });
        } catch (err) {
          console.error('[MarkEdit] Failed to open document:', err);
        }
      })();
    }
  });
}

function getFileIconSvg(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.mdown') || lower.endsWith('.mkd')) {
    return ICONS.fileMarkdown;
  }
  return ICONS.fileDefault;
}

// -----------------------------------------------------------------------------
// Outline View Implementation
// -----------------------------------------------------------------------------

function getEditorContentText(): string {
  const core = (window as unknown as { webModules?: { core?: { getEditorText?: () => string } } }).webModules?.core;
  if (typeof core?.getEditorText === 'function') {
    return core.getEditorText();
  }
  const view = (window as unknown as { editor?: { state?: { doc?: { toString?: () => string } } } }).editor;
  if (typeof view?.state?.doc?.toString === 'function') {
    return view.state.doc.toString();
  }
  return '';
}

export function refreshOutline(): void {
  const pane = getOrCreatePane('outline');
  renderOutline(pane);
}

function renderOutline(container: HTMLElement): void {
  container.innerHTML = '';

  const text = getEditorContentText();

  const headings: { level: number; text: string; pos: number; line: number }[] = [];
  const lines = text.split('\n');
  let pos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match !== null) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        pos,
        line: i,
      });
    }
    pos += line.length + 1;
  }

  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'markedit-sidebar-empty';
    empty.textContent = 'No headings found in document';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'markedit-outline-list';

  for (const h of headings) {
    const item = document.createElement('div');
    item.className = `markedit-outline-item markedit-outline-h${h.level}`;
    item.style.paddingLeft = `${(h.level - 1) * 14 + 10}px`;
    item.title = h.text;

    const badge = document.createElement('span');
    badge.className = 'markedit-outline-badge';
    badge.textContent = `H${h.level}`;

    const label = document.createElement('span');
    label.className = 'markedit-outline-label';
    label.textContent = h.text;

    item.append(badge, label);

    item.addEventListener('click', () => {
      // 1. Move editor cursor & scroll into view
      const view = (window as unknown as { editor?: { dispatch?: (spec: unknown) => void; focus?: () => void } }).editor;
      if (view !== undefined && typeof view.dispatch === 'function') {
        view.dispatch({ selection: { anchor: h.pos }, scrollIntoView: true });
        view.focus?.();
      }

      // 2. Also scroll preview if visible (Split or Preview mode)
      const previewBody = document.querySelector('.markedit-preview-body');
      if (previewBody !== null) {
        const previewHeadings = Array.from(previewBody.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        const target = previewHeadings.find((el) => el.textContent.trim() === h.text.trim());
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    list.appendChild(item);
  }

  container.appendChild(list);
}

// -----------------------------------------------------------------------------
// Keyboard Shortcuts & Global Event Listeners
// -----------------------------------------------------------------------------

function setupKeyboardShortcuts(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
      return;
    }

    // Ctrl+B or Cmd+B: Toggle Sidebar (VS Code standard)
    // Ctrl+Shift+B or Cmd+Shift+B: Toggle Sidebar (Tauri accelerator)
    if (e.key === 'b' || e.key === 'B') {
      toggleSidebar();
      e.preventDefault();
      return;
    }

    // Ctrl+Shift+E or Cmd+Shift+E: Show Explorer (VS Code standard)
    if (e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      setActiveTab('files');
      setSidebarVisible(true);
      e.preventDefault();
      return;
    }
  }, true);
}

function setupEditorChangeObserver(): void {
  window.addEventListener('markedit-editor-reset', () => {
    if (isSidebarVisible() && activeTabId === 'outline') {
      refreshOutline();
    }
  });

  // Track document path changes to highlight open file in tree
  window.addEventListener('markedit-document-path-changed', () => {
    if (currentFolderTree !== null) {
      const pane = getOrCreatePane('files');
      renderFolderTree(currentFolderTree, pane);
    }
  });
}

// -----------------------------------------------------------------------------
// Global Tauri Hooks
// -----------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  (window as unknown as { __markeditOpenFolder?: (path: string) => void }).__markeditOpenFolder = (path: string) => {
    void openFolder(path);
  };

  (window as unknown as { __markeditToggleSidebar?: () => void }).__markeditToggleSidebar = () => {
    toggleSidebar();
  };

  (window as unknown as { __markeditSidebarWidth?: () => number }).__markeditSidebarWidth = sidebarVisibleWidth;

  window.addEventListener('DOMContentLoaded', () => {
    initSidebar();
  });
}
