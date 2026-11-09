import { createButton, createElement } from './utils';

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

function getInitials(name: string): string {
  return name
    .split(/[\s\-_]+/)
    .map(part => part[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase();
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
  createElement('div', 'markedit-chrome-extensions-title', titleRow, 'Extensions');
  const headerActions = createElement('div', 'markedit-chrome-extensions-header-actions', titleRow);

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

  const closeButton = createButton('×', close, 'markedit-chrome-button markedit-chrome-icon-button markedit-chrome-close-button');
  headerActions.appendChild(closeButton);

  const tabsRow = createElement('div', 'markedit-chrome-extensions-tabs', header);
  const tabs: Record<ExtensionsManagerTab, { label: string; count: () => number }> = {
    discover: { label: 'Discover', count: () => getFilteredCatalog().length },
    installed: { label: 'Installed', count: () => state.installed.length },
    updates: { label: 'Updates', count: () => state.updates.length },
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

    const icon = createElement('div', 'markedit-chrome-extensions-icon', card);
    createElement('span', '', icon, getInitials(entry.name));

    const content = createElement('div', 'markedit-chrome-extensions-card-content', card);
    const top = createElement('div', 'markedit-chrome-extensions-card-top', content);
    createElement('div', 'markedit-chrome-extensions-card-name', top, entry.name);

    const meta = createElement('div', 'markedit-chrome-extensions-card-meta', top);
    if (entry.featured === true) {
      createElement('span', 'markedit-chrome-extensions-badge markedit-chrome-extensions-featured', meta, '★ Featured');
    }

    createElement('span', 'markedit-chrome-extensions-category', meta, entry.category === 'theme' ? 'Theme' : 'Extension');
    createElement('span', 'markedit-chrome-extensions-version', meta, `v${entry.latest.version}`);
    if (entry.author !== undefined && entry.author.length > 0) {
      createElement('span', 'markedit-chrome-extensions-author', meta, `by ${entry.author}`);
    }

    createElement('div', 'markedit-chrome-extensions-card-description', content, entry.description);

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

    const main = createElement('div', 'markedit-chrome-extensions-row-main', row);
    const icon = createElement('div', 'markedit-chrome-extensions-icon markedit-chrome-extensions-icon-small', main);
    createElement('span', '', icon, getInitials(catalog?.name ?? record.id));

    const info = createElement('div', 'markedit-chrome-extensions-row-info', main);
    createElement('div', 'markedit-chrome-extensions-row-name', info, catalog?.name ?? record.id);
    createElement('div', 'markedit-chrome-extensions-row-description', info, catalog?.description ?? record.file);

    const actions = createElement('div', 'markedit-chrome-extensions-row-actions', row);

    const versionBadge = createElement('span', 'markedit-chrome-extensions-version', actions, record.version ?? 'Local');
    versionBadge.title = `Installed: ${record.file}`;

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

    const main = createElement('div', 'markedit-chrome-extensions-row-main', row);
    const icon = createElement('div', 'markedit-chrome-extensions-icon markedit-chrome-extensions-icon-small', main);
    createElement('span', '', icon, getInitials(catalog?.name ?? update.id));

    const info = createElement('div', 'markedit-chrome-extensions-row-info', main);
    createElement('div', 'markedit-chrome-extensions-row-name', info, catalog?.name ?? update.id);

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
