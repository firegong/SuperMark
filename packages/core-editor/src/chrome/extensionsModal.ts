import { createButton, createElement, setupModalTitleBar } from './utils';

export type ExtensionsManagerTab = 'discover' | 'installed' | 'updates';
export type ExtensionUpdateBehavior = 'never' | 'quiet' | 'notify' | 'automatic';

export interface ExtensionCatalogEntry {
  id: string;
  name: string;
  description: string;
  author?: string;
  homepage?: string;
  addedDate?: string;
  category?: 'extension' | 'theme';
  colorScheme?: 'light' | 'dark' | 'both';
  colorPatterns?: string[];
  featured?: boolean;
  latest: {
    version: string;
    url: string;
    sha256: string;
    minAppVersion?: string;
    date?: string;
    notes?: string;
  };
}

export interface InstalledExtensionRecord {
  id: string;
  version?: string;
  url?: string;
  sha256?: string;
  file: string;
  enabled?: boolean;
  installDate?: string;
}

export interface ExtensionUpdateInfo {
  id: string;
  installedVersion?: string;
  latestVersion: string;
}

export interface ExtensionsManagerState {
  catalog: ExtensionCatalogEntry[];
  installed: InstalledExtensionRecord[];
  updates: ExtensionUpdateInfo[];
  updateBehavior: ExtensionUpdateBehavior;
  appVersion: string;
}

interface ExtensionsModalController {
  readonly element: HTMLElement;
  focus(): void;
}

const emptyState: ExtensionsManagerState = {
  catalog: [],
  installed: [],
  updates: [],
  updateBehavior: 'quiet',
  appVersion: '0.1.0',
};

const behaviorLabels: Record<ExtensionUpdateBehavior, string> = {
  never: 'Never Check',
  quiet: 'Check Silently',
  notify: 'Notify Me',
  automatic: 'Update Automatically',
};

const categoryLabels: Record<'all' | 'extension' | 'theme', string> = {
  all: 'All',
  extension: 'Extensions',
  theme: 'Themes',
};

const svgNS = 'http://www.w3.org/2000/svg';

function svgIcon(pathD: string | string[], size = 16): SVGSVGElement {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  const ds = Array.isArray(pathD) ? pathD : [pathD];
  for (const d of ds) {
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }

  return svg;
}

function createCategoryIcon(category: 'extension' | 'theme' | 'local', size = 16): SVGSVGElement {
  const paths: Record<typeof category, string | string[]> = {
    theme: 'M12.82 5.58l-1.41-1.41A3.996 3.996 0 0012 2a4 4 0 00-4 4c0 .73.21 1.41.56 2H5.44c.35-.59.56-1.27.56-2a4 4 0 00-4-4 .996.996 0 00-.707.293C.388 1.962 0 3.458 0 5c0 3.06 1.9 5.67 4.58 6.74L4 14c0 .55.45 1 1 1h6c.55 0 1-.45 1-1l-.58-2.26C14.1 10.67 16 8.06 16 5c0-1.542-.388-3.038-1.293-3.707A.996.996 0 0014 2c.73 0 1.41.21 2 .56l-1.18 3.02z',
    extension: 'M13.5 7.5h-1.88A4.98 4.98 0 008.5 4.38V2.5a1.5 1.5 0 00-3 0v1.88A4.98 4.98 0 002.38 7.5H.5a1.5 1.5 0 000 3h1.88a4.98 4.98 0 002.62 2.62v1.88a1.5 1.5 0 003 0v-1.88a4.98 4.98 0 002.62-2.62h1.88a1.5 1.5 0 000-3zM7 10.5A2.5 2.5 0 117 5.5a2.5 2.5 0 010 5z',
    local: [
      'M5.5 1A3.5 3.5 0 0 0 2 4.5c0 1.06.47 2.01 1.21 2.66L1.5 9.5l1 1 1.71-1.71A3.5 3.5 0 1 0 5.5 1z',
      'M12 1h2v4h-2V1zm1 5 2 7h-6l2-7z',
    ],
  };

  return svgIcon(paths[category], size);
}

function createSparklesIcon(size = 14): SVGSVGElement {
  return svgIcon('M11.5 2.5c-.28 0-.5.22-.5.5v1.5h-1.5c-.28 0-.5.22-.5.5s.22.5.5.5h1.5V7c0 .28.22.5.5.5s.5-.22.5-.5V5.5h1.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5H12V3c0-.28-.22-.5-.5-.5zM5 1c-.55 0-1 .45-1 1v1.5H2.5c-.28 0-.5.22-.5.5s.22.5.5.5H4V6c0 .55.45 1 1 1s1-.45 1-1V4.5h1.5c.28 0 .5-.22.5-.5s-.22-.5-.5-.5H6V2c0-.55-.45-1-1-1zm3.5 7c-.28 0-.5.22-.5.5v1h-1c-.28 0-.5.22-.5.5s.22.5.5.5h1v1c0 .28.22.5.5.5s.5-.22.5-.5v-1h1c.28 0 .5-.22.5-.5s-.22-.5-.5-.5h-1v-1c0-.28-.22-.5-.5-.5z', size);
}

function createBoxIcon(size = 14): SVGSVGElement {
  return svgIcon('M14.25 4.2l-6-2.5a.75.75 0 00-.5 0l-6 2.5A.75.75 0 001 4.9v6.2c0 .3.18.57.45.7l6 2.5a.75.75 0 00.1.04l.05.01h.05a.75.75 0 00.2-.05l6-2.5a.75.75 0 00.45-.7V4.9a.75.75 0 00-.45-.7zm-6.75-1l4.78 2-1.78.74-4.78-2 1.78-.74zM2.5 5.55l4.5 1.88v5.42l-4.5-1.88V5.55zm6 7.3V7.43l4.5-1.88v5.42l-4.5 1.88z', size);
}

function createUpdateIcon(size = 14): SVGSVGElement {
  return svgIcon('M7 0a7 7 0 100 14A7 7 0 007 0zm0 12.5A5.5 5.5 0 017 1.5a5.5 5.5 0 010 11zm.75-5.75V3.5a.75.75 0 00-1.5 0v3.25H4.5a.75.75 0 000 1.5h3.25a.75.75 0 00.75-.75v-.75z', size);
}

function createVerifiedSeal(size = 14): SVGSVGElement {
  return svgIcon('M7 .5l1.74 1.05L10.9.9l.65 2.16L13.7 3.8l-.75 2.25 1.05 1.74-1.74 1.05.75 2.25-2.15.74-.65 2.16-2.16-.65-2.25 1.05-1.74-1.05L3.1 13.1l-2.16.65-.65-2.16-2.15-.74.75-2.25-1.05-1.74 1.05-1.74-.75-2.25 2.15-.74.65-2.16 2.16.65L7 .5zm2.85 5.35L6.5 9.21 4.65 7.35l-1.05 1.06 2.9 2.9 4.4-4.4-1.05-1.06z', size);
}

function createLaurelIcon(size = 14): SVGSVGElement {
  return svgIcon('M7 1c-.55 0-1 .45-1 1 0 1.66-1.34 3-3 3-.55 0-1 .45-1 1s.45 1 1 1c1.66 0 3 1.34 3 3 0 .55.45 1 1 1s1-.45 1-1c0-1.66 1.34-3 3-3 .55 0 1-.45 1-1s-.45-1-1-1c-1.66 0-3-1.34-3-3 0-.55-.45-1-1-1zm-2.12 2.88C3.5 4.5 2.25 5.75 1.38 7.38c.87 1.62 2.12 2.87 3.5 3.5-.5-1.62-.5-3.38 0-5zm4.24 0c.5 1.62.5 3.38 0 5 1.38-.63 2.63-1.88 3.5-3.5-.87-1.63-2.12-2.88-3.5-3.5z', size);
}

function deriveGitHubOwner(author?: string, homepage?: string): string | undefined {
  if (homepage !== undefined && homepage.length > 0) {
    const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\//i.exec(homepage);
    if (match !== null && match[1].length > 0) {
      return match[1];
    }
  }

  if (author !== undefined && /^[A-Za-z0-9-]+$/.test(author)) {
    return author;
  }

  return undefined;
}

function createExtensionIcon(entry: ExtensionCatalogEntry | null, record?: InstalledExtensionRecord): HTMLElement {
  const category = entry?.category ?? 'extension';
  const isLocal = record !== undefined && record.version === undefined && entry === null;
  const effectiveCategory: 'extension' | 'theme' | 'local' = isLocal ? 'local' : category;

  const wrapper = createElement('div', 'markedit-ext-icon');
  const fallback = createCategoryIcon(effectiveCategory, 20);
  fallback.classList.add('markedit-ext-icon-fallback');
  wrapper.appendChild(fallback);

  const owner = deriveGitHubOwner(entry?.author, entry?.homepage);
  if (owner !== undefined) {
    const img = document.createElement('img');
    img.className = 'markedit-ext-icon-img';
    img.src = `https://github.com/${owner}.png?size=80`;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('load', () => {
      wrapper.classList.add('is-loaded');
    });
    img.addEventListener('error', () => {
      img.remove();
      wrapper.classList.remove('is-loaded');
    });
    wrapper.appendChild(img);

    const badge = createElement('div', 'markedit-ext-icon-badge', wrapper);
    badge.appendChild(createCategoryIcon(category, 12));
  }

  return wrapper;
}

function createThemePreview(entry: ExtensionCatalogEntry): HTMLElement | null {
  if (entry.category !== 'theme' || entry.colorPatterns === undefined || entry.colorPatterns.length === 0) {
    return null;
  }

  const patterns = entry.colorPatterns;
  const both = entry.colorScheme === 'both' && patterns.length >= 2;
  const first = patterns[0].split(',').map(color => color.trim());
  const second = both ? patterns[1].split(',').map(color => color.trim()) : [];

  if (first.length < 6) {
    return null;
  }

  const rows = [[2, 3], [4, 1], [3, 5], [5], [2, 1]];
  const container = createElement('div', 'markedit-ext-theme-preview');

  const createPane = (colors: string[]) => {
    const pane = createElement('div', 'markedit-ext-theme-pane');
    pane.style.backgroundColor = colors[0];
    const content = createElement('div', 'markedit-ext-theme-pane-content', pane);
    for (const columns of rows) {
      const row = createElement('div', 'markedit-ext-theme-row', content);
      for (const index of columns) {
        const token = createElement('span', 'markedit-ext-theme-token', row);
        token.style.backgroundColor = colors[index];
      }
    }

    return pane;
  };

  container.appendChild(createPane(first));
  if (both && second.length >= 6) {
    container.appendChild(createPane(second));
  }

  return container;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke === undefined) {
    if (cmd === 'extensions_get_state') {
      return emptyState as unknown as T;
    }

    return emptyState as unknown as T;
  }

  return await invoke(cmd, args) as T;
}

function matchesSearch(entry: ExtensionCatalogEntry, query: string): boolean {
  if (query.length === 0) {
    return true;
  }

  const lower = query.toLowerCase();
  return (
    entry.name.toLowerCase().includes(lower) ||
    entry.description.toLowerCase().includes(lower) ||
    (entry.author?.toLowerCase().includes(lower) ?? false)
  );
}

export function createExtensionsModal(
  initialTab: ExtensionsManagerTab = 'discover',
  onClose: () => void,
): ExtensionsModalController {
  let state = emptyState;
  let activeTab: ExtensionsManagerTab = initialTab;
  let searchQuery = '';
  let discoverCategory: 'all' | 'extension' | 'theme' = 'all';
  let errorMessage = '';
  let inFlight = false;
  let urlInputValue = '';

  const core = window.webModules.core as unknown as { restoreFocus: () => void } | undefined;

  const backdrop = createElement('div', 'markedit-chrome-modal-backdrop markedit-chrome-extensions-backdrop');
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      close();
    }
  });

  const dialog = createElement('div', 'markedit-chrome-panel markedit-chrome-extensions-modal', backdrop);

  const header = createElement('div', 'markedit-chrome-extensions-header', dialog);
  const titleRow = createElement('div', 'markedit-chrome-extensions-title-row', header);
  const titleEl = createElement('div', 'markedit-chrome-extensions-title', titleRow, 'Extensions');
  const headerActions = createElement('div', 'markedit-chrome-extensions-header-actions');

  const refreshButton = createButton('↻', () => { void refreshState(true); }, 'markedit-chrome-button markedit-chrome-icon-button');
  refreshButton.title = 'Refresh';
  headerActions.appendChild(refreshButton);

  const installUrlButton = createButton('Install from URL...', () => {
    urlInputValue = urlInputValue.length === 0 ? ' ' : '';
    render();
    if (urlInputValue === ' ') {
      (dialog.querySelector('.markedit-chrome-extensions-url-input') as HTMLInputElement | null)?.focus();
    }
  }, 'markedit-chrome-button');
  headerActions.appendChild(installUrlButton);

  const openFolderButton = createButton('Open Folder', () => {
    void invokeTauri<void>('extensions_open_folder', {});
  }, 'markedit-chrome-button');
  headerActions.appendChild(openFolderButton);

  setupModalTitleBar(titleRow, titleEl, close, { rightActions: headerActions, centeredTitle: false });

  const tabsRow = createElement('div', 'markedit-chrome-extensions-tabs', header);
  const tabs: Record<ExtensionsManagerTab, { label: string; icon: () => SVGSVGElement; count: () => number }> = {
    discover: { label: 'Discover', icon: () => createSparklesIcon(), count: () => getFilteredCatalog().length },
    installed: { label: 'Installed', icon: () => createBoxIcon(), count: () => state.installed.length },
    updates: { label: 'Updates', icon: () => createUpdateIcon(), count: () => state.updates.length },
  };

  const tabButtons = new Map<ExtensionsManagerTab, HTMLButtonElement>();
  for (const key of Object.keys(tabs) as ExtensionsManagerTab[]) {
    const button = createElement('button', 'markedit-chrome-extensions-tab');
    button.type = 'button';
    button.addEventListener('click', () => {
      activeTab = key;
      render();
    });
    tabButtons.set(key, button);
    tabsRow.appendChild(button);
  }

  const urlBar = createElement('div', 'markedit-chrome-extensions-url-bar markedit-chrome-hidden', header);
  const urlInput = createElement('input', 'markedit-chrome-input markedit-chrome-extensions-url-input');
  urlInput.type = 'url';
  urlInput.placeholder = 'https://example.com/extension.js';
  urlInput.addEventListener('input', event => {
    urlInputValue = (event.target as HTMLInputElement).value;
  });
  urlInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && urlInputValue.length > 0) {
      void installFromUrl(urlInputValue);
    } else if (event.key === 'Escape') {
      urlInputValue = '';
      render();
    }
  });
  urlBar.appendChild(urlInput);

  const urlInstallButton = createButton('Install', () => {
    if (urlInputValue.length > 0) {
      void installFromUrl(urlInputValue);
    }
  }, 'markedit-chrome-button markedit-chrome-action-button');
  urlBar.appendChild(urlInstallButton);

  const subToolbar = createElement('div', 'markedit-chrome-extensions-subtoolbar', dialog);
  const searchInput = createElement('input', 'markedit-chrome-input markedit-chrome-extensions-search');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search extensions by name, description, or author...';
  searchInput.addEventListener('input', event => {
    searchQuery = (event.target as HTMLInputElement).value;
    render();
  });
  subToolbar.appendChild(searchInput);

  const filterPills = createElement('div', 'markedit-chrome-extensions-pills', subToolbar);

  const updateAllButton = createButton('', () => { void updateAll(); }, 'markedit-chrome-button markedit-chrome-action-button');
  updateAllButton.dataset.action = 'update-all';
  subToolbar.appendChild(updateAllButton);

  const errorBanner = createElement('div', 'markedit-chrome-extensions-error markedit-chrome-hidden', dialog);
  const errorClose = createButton('×', () => {
    errorMessage = '';
    render();
  }, 'markedit-chrome-button markedit-chrome-icon-button');
  errorBanner.appendChild(errorClose);
  const errorText = createElement('span', '', errorBanner);

  const body = createElement('div', 'markedit-chrome-extensions-body', dialog);

  const footer = createElement('div', 'markedit-chrome-extensions-footer', dialog);
  createElement('label', 'markedit-chrome-extensions-behavior-label', footer, 'Auto-update:');
  const behaviorSelect = createElement('select', 'markedit-chrome-input markedit-chrome-extensions-behavior-select');
  behaviorSelect.dataset.action = 'update-behavior';
  for (const value of Object.keys(behaviorLabels) as ExtensionUpdateBehavior[]) {
    const option = createElement('option', '', behaviorSelect, behaviorLabels[value]);
    option.value = value;
  }
  behaviorSelect.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value as ExtensionUpdateBehavior;
    void setUpdateBehavior(value);
  });
  footer.appendChild(behaviorSelect);

  async function withStateUpdate(promise: Promise<ExtensionsManagerState>): Promise<void> {
    inFlight = true;
    errorMessage = '';
    render();

    try {
      state = await promise;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      inFlight = false;
      render();
    }
  }

  async function refreshState(forceRefresh = false): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_get_state', { forceRefresh }));
  }

  async function installExtension(id: string): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_install', { id }));
  }

  async function installFromUrl(url: string): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_install_url', { url }));
    urlInputValue = '';
  }

  async function uninstallExtension(id: string): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_uninstall', { id }));
  }

  async function setEnabled(id: string, enabled: boolean): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_set_enabled', { id, enabled }));
  }

  async function updateExtension(id?: string): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_update', id === undefined ? {} : { id }));
  }

  async function updateAll(): Promise<void> {
    await updateExtension(undefined);
  }

  async function setUpdateBehavior(behavior: ExtensionUpdateBehavior): Promise<void> {
    await withStateUpdate(invokeTauri<ExtensionsManagerState>('extensions_set_update_behavior', { behavior }));
  }

  function close(): void {
    backdrop.remove();
    onClose();
    core?.restoreFocus();
  }

  function getFilteredCatalog(): ExtensionCatalogEntry[] {
    return state.catalog
      .filter(entry => {
        const matchesCategory = discoverCategory === 'all'
          ? true
          : discoverCategory === 'extension'
            ? entry.category !== 'theme'
            : entry.category === 'theme';
        return matchesCategory && matchesSearch(entry, searchQuery);
      })
      .sort((a, b) => {
        if (a.featured === b.featured) {
          return a.name.localeCompare(b.name);
        }

        return a.featured === true ? -1 : 1;
      });
  }

  function getInstalledById(id: string): InstalledExtensionRecord | undefined {
    return state.installed.find(record => record.id === id);
  }

  function getUpdateInfo(id: string): ExtensionUpdateInfo | undefined {
    return state.updates.find(update => update.id === id);
  }

  function getCatalogEntry(id: string): ExtensionCatalogEntry | undefined {
    return state.catalog.find(entry => entry.id === id);
  }

  function renderTabs(): void {
    for (const key of Object.keys(tabs) as ExtensionsManagerTab[]) {
      const button = tabButtons.get(key);
      if (button === undefined) {
        continue;
      }

      const isActive = activeTab === key;
      const count = tabs[key].count();
      button.classList.toggle('markedit-chrome-active', isActive);
      button.innerHTML = '';
      button.appendChild(tabs[key].icon());
      createElement('span', '', button, tabs[key].label);
      createElement('span', 'markedit-chrome-extensions-badge', button, String(count));
    }
  }

  function renderSubToolbar(): void {
    filterPills.innerHTML = '';
    updateAllButton.classList.add('markedit-chrome-hidden');

    if (activeTab === 'discover') {
      for (const key of Object.keys(categoryLabels) as Array<'all' | 'extension' | 'theme'>) {
        const pill = createButton(categoryLabels[key], () => {
          discoverCategory = key;
          render();
        }, 'markedit-chrome-button markedit-chrome-extensions-pill');
        pill.classList.toggle('markedit-chrome-active', discoverCategory === key);
        filterPills.appendChild(pill);
      }
    } else if (activeTab === 'updates' && state.updates.length > 0) {
      updateAllButton.textContent = `Update All (${state.updates.length})`;
      updateAllButton.classList.remove('markedit-chrome-hidden');
    }
  }

  function renderError(): void {
    if (errorMessage.length === 0) {
      errorBanner.classList.add('markedit-chrome-hidden');
      return;
    }

    errorBanner.classList.remove('markedit-chrome-hidden');
    errorText.textContent = errorMessage;
  }

  function renderDiscoverCard(entry: ExtensionCatalogEntry): HTMLElement {
    const installed = getInstalledById(entry.id);
    const update = getUpdateInfo(entry.id);
    const isInstalled = installed !== undefined;
    const needsUpdate = update !== undefined;

    const card = createElement('div', 'markedit-chrome-extensions-card');

    const icon = createExtensionIcon(entry);
    icon.classList.add('markedit-chrome-extensions-card-icon');
    card.appendChild(icon);

    const content = createElement('div', 'markedit-chrome-extensions-card-content', card);
    const top = createElement('div', 'markedit-chrome-extensions-card-top', content);
    createElement('div', 'markedit-chrome-extensions-card-name', top, entry.name);

    const meta = createElement('div', 'markedit-chrome-extensions-card-meta', top);
    if (entry.featured === true) {
      const featuredBadge = createElement('span', 'markedit-chrome-extensions-badge markedit-ext-badge-featured', meta);
      featuredBadge.appendChild(createLaurelIcon());
      createElement('span', '', featuredBadge, 'Featured');
      featuredBadge.appendChild(createLaurelIcon());
    }

    createElement('span', 'markedit-chrome-extensions-category', meta, entry.category === 'theme' ? 'Theme' : 'Extension');
    createElement('span', 'markedit-chrome-extensions-version', meta, `v${entry.latest.version}`);
    if (entry.author !== undefined && entry.author.length > 0) {
      createElement('span', 'markedit-chrome-extensions-author', meta, `by ${entry.author}`);
      if (entry.author.toLowerCase() === 'markedit-app') {
        const seal = createVerifiedSeal();
        seal.classList.add('markedit-ext-verified-seal');
        seal.setAttribute('title', 'Official MarkEdit Extension');
        meta.appendChild(seal);
      }
    }

    createElement('div', 'markedit-chrome-extensions-card-description', content, entry.description);

    const themePreview = createThemePreview(entry);
    if (themePreview !== null) {
      content.appendChild(themePreview);
    }

    const actions = createElement('div', 'markedit-chrome-extensions-card-actions', content);

    if (entry.homepage !== undefined && entry.homepage.length > 0) {
      const homepageButton = createButton('Homepage', () => {
        void invokeTauri<void>('extensions_open_homepage', { url: entry.homepage as string });
      }, 'markedit-chrome-button');
      actions.appendChild(homepageButton);
    }

    if (!isInstalled) {
      const installButton = createButton('Install', () => { void installExtension(entry.id); }, 'markedit-chrome-button markedit-chrome-action-button');
      installButton.dataset.action = 'install';
      installButton.dataset.extensionId = entry.id;
      installButton.disabled = inFlight;
      actions.appendChild(installButton);
    } else if (needsUpdate) {
      const updateButton = createButton('Update', () => { void updateExtension(entry.id); }, 'markedit-chrome-button markedit-chrome-action-button');
      updateButton.dataset.action = 'update';
      updateButton.dataset.extensionId = entry.id;
      updateButton.disabled = inFlight;
      actions.appendChild(updateButton);

      const uninstallButton = createButton('Uninstall', () => { void uninstallExtension(entry.id); }, 'markedit-chrome-button');
      uninstallButton.dataset.action = 'uninstall';
      uninstallButton.dataset.extensionId = entry.id;
      uninstallButton.disabled = inFlight;
      actions.appendChild(uninstallButton);
    } else {
      createElement('span', 'markedit-chrome-extensions-status', actions, 'Installed');

      const uninstallButton = createButton('Uninstall', () => { void uninstallExtension(entry.id); }, 'markedit-chrome-button');
      uninstallButton.dataset.action = 'uninstall';
      uninstallButton.dataset.extensionId = entry.id;
      uninstallButton.disabled = inFlight;
      actions.appendChild(uninstallButton);
    }

    return card;
  }

  function renderInstalledRow(record: InstalledExtensionRecord): HTMLElement {
    const catalog = getCatalogEntry(record.id);
    const row = createElement('div', 'markedit-chrome-extensions-row');

    const icon = createExtensionIcon(catalog ?? null, record);
    icon.classList.add('markedit-chrome-extensions-row-icon');
    row.appendChild(icon);

    const main = createElement('div', 'markedit-chrome-extensions-row-main', row);
    const info = createElement('div', 'markedit-chrome-extensions-row-info', main);
    const nameRow = createElement('div', 'markedit-chrome-extensions-row-name-line', info);
    createElement('span', '', nameRow, catalog?.name ?? record.id);
    if (catalog?.author?.toLowerCase() === 'markedit-app') {
      const seal = createVerifiedSeal();
      seal.classList.add('markedit-ext-verified-seal');
      seal.setAttribute('title', 'Official MarkEdit Extension');
      nameRow.appendChild(seal);
    }

    createElement('div', 'markedit-chrome-extensions-row-description', info, catalog?.description ?? record.file);

    const meta = createElement('div', 'markedit-chrome-extensions-row-meta', info);
    createElement('span', 'markedit-chrome-extensions-version', meta, record.version ?? 'Local');
    if (catalog?.category !== undefined) {
      createElement('span', 'markedit-chrome-extensions-category', meta, catalog.category === 'theme' ? 'Theme' : 'Extension');
    }

    const actions = createElement('div', 'markedit-chrome-extensions-row-actions', row);

    const toggle = createElement('label', 'markedit-chrome-extensions-toggle');
    const toggleInput = createElement('input', '') as HTMLInputElement;
    toggleInput.type = 'checkbox';
    toggleInput.checked = record.enabled !== false;
    toggleInput.disabled = inFlight;
    toggleInput.dataset.action = 'toggle-enabled';
    toggleInput.dataset.extensionId = record.id;
    toggleInput.addEventListener('change', event => {
      const checked = (event.target as HTMLInputElement).checked;
      void setEnabled(record.id, checked);
    });
    toggle.appendChild(toggleInput);
    createElement('span', 'markedit-chrome-extensions-toggle-slider', toggle);
    actions.appendChild(toggle);

    const uninstallButton = createButton('Uninstall', () => { void uninstallExtension(record.id); }, 'markedit-chrome-button');
    uninstallButton.dataset.action = 'uninstall';
    uninstallButton.dataset.extensionId = record.id;
    uninstallButton.disabled = inFlight;
    actions.appendChild(uninstallButton);

    return row;
  }

  function renderUpdateRow(update: ExtensionUpdateInfo): HTMLElement {
    const catalog = getCatalogEntry(update.id);
    const row = createElement('div', 'markedit-chrome-extensions-row');

    const icon = createExtensionIcon(catalog ?? null);
    icon.classList.add('markedit-chrome-extensions-row-icon');
    row.appendChild(icon);

    const main = createElement('div', 'markedit-chrome-extensions-row-main', row);
    const info = createElement('div', 'markedit-chrome-extensions-row-info', main);
    const nameRow = createElement('div', 'markedit-chrome-extensions-row-name-line', info);
    createElement('span', '', nameRow, catalog?.name ?? update.id);
    if (catalog?.author?.toLowerCase() === 'markedit-app') {
      const seal = createVerifiedSeal();
      seal.classList.add('markedit-ext-verified-seal');
      seal.setAttribute('title', 'Official MarkEdit Extension');
      nameRow.appendChild(seal);
    }

    const meta = createElement('div', 'markedit-chrome-extensions-row-meta', info);
    createElement('span', 'markedit-chrome-extensions-version', meta, `v${update.installedVersion ?? 'unknown'}`);
    createElement('span', '', meta, '→');
    createElement('span', 'markedit-chrome-extensions-version markedit-chrome-extensions-version-latest', meta, `v${update.latestVersion}`);

    if (catalog?.latest.notes !== undefined && catalog.latest.notes.length > 0) {
      createElement('div', 'markedit-chrome-extensions-release-notes', info, catalog.latest.notes);
    }

    const actions = createElement('div', 'markedit-chrome-extensions-row-actions', row);
    const updateButton = createButton('Update', () => { void updateExtension(update.id); }, 'markedit-chrome-button markedit-chrome-action-button');
    updateButton.dataset.action = 'update';
    updateButton.dataset.extensionId = update.id;
    updateButton.disabled = inFlight;
    actions.appendChild(updateButton);

    return row;
  }

  function renderBody(): void {
    body.innerHTML = '';

    if (activeTab === 'discover') {
      const items = getFilteredCatalog();
      if (items.length === 0) {
        createElement('div', 'markedit-chrome-extensions-empty', body, 'No extensions found.');
        return;
      }

      for (const entry of items) {
        body.appendChild(renderDiscoverCard(entry));
      }
    } else if (activeTab === 'installed') {
      if (state.installed.length === 0) {
        createElement('div', 'markedit-chrome-extensions-empty', body, 'No installed extensions.');
        return;
      }

      for (const record of state.installed) {
        body.appendChild(renderInstalledRow(record));
      }
    } else {
      if (state.updates.length === 0) {
        createElement('div', 'markedit-chrome-extensions-empty', body, 'Everything is up to date.');
        return;
      }

      for (const update of state.updates) {
        body.appendChild(renderUpdateRow(update));
      }
    }
  }

  function render(): void {
    renderTabs();
    renderSubToolbar();
    renderError();
    renderBody();

    urlBar.classList.toggle('markedit-chrome-hidden', urlInputValue.length === 0);
    urlInput.value = urlInputValue;
    behaviorSelect.value = state.updateBehavior;

    const controls = dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input');
    controls.forEach(control => {
      if (control !== searchInput && control !== urlInput) {
        control.disabled = inFlight;
      }
    });
  }

  const focus = () => {
    searchInput.focus();
  };

  void refreshState(false);

  return { element: backdrop, focus };
}
