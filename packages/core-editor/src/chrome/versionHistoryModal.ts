import { createButton, createElement } from './utils';

interface VersionListResult {
  filePath: string | null;
  versions: string[];
}

interface VersionHistoryController {
  readonly element: HTMLElement;
  focus(): void;
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke === undefined) {
    return undefined as T;
  }

  return await invoke(cmd, args) as T;
}

export function createVersionHistoryModal(onClose: () => void): VersionHistoryController {
  let filePath: string | null = null;
  let versions: string[] = [];
  let selectedVersion = '';
  let content = '';
  let inFlight = false;

  const core = window.webModules.core as unknown as { restoreFocus: () => void } | undefined;

  const backdrop = createElement('div', 'markedit-chrome-modal-backdrop markedit-chrome-versions-backdrop');
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      close();
    }
  });

  const dialog = createElement('div', 'markedit-chrome-panel markedit-chrome-versions-modal', backdrop);

  const header = createElement('div', 'markedit-chrome-versions-header', dialog);
  const titleRow = createElement('div', 'markedit-chrome-versions-title-row', header);
  createElement('div', 'markedit-chrome-versions-title', titleRow, 'Version History');
  const closeButton = createButton('×', close, 'markedit-chrome-button markedit-chrome-icon-button markedit-chrome-close-button');
  titleRow.appendChild(closeButton);

  const body = createElement('div', 'markedit-chrome-versions-body', dialog);
  const sidebar = createElement('div', 'markedit-chrome-versions-sidebar', body);
  const preview = createElement('div', 'markedit-chrome-versions-preview', body);
  const previewContent = createElement('textarea', 'markedit-chrome-versions-preview-content', preview) as HTMLTextAreaElement;
  previewContent.readOnly = true;
  previewContent.placeholder = 'Select a version to preview its content.';

  const footer = createElement('div', 'markedit-chrome-versions-footer', dialog);
  const deleteAllButton = createButton('Delete All Versions', () => { void deleteAllVersions(); }, 'markedit-chrome-button');
  deleteAllButton.dataset.action = 'delete-all-versions';
  const cancelButton = createButton('Cancel', close, 'markedit-chrome-button');
  const restoreButton = createButton('Restore Selected Version', () => { void restoreSelected(); }, 'markedit-chrome-button markedit-chrome-action-button');
  restoreButton.dataset.action = 'restore-version';
  footer.appendChild(deleteAllButton);
  footer.appendChild(cancelButton);
  footer.appendChild(restoreButton);

  async function refreshVersions(): Promise<void> {
    inFlight = true;
    render();

    try {
      const result = await invokeTauri<VersionListResult | undefined>('versions_list');
      if (result !== undefined) {
        filePath = result.filePath;
        versions = result.versions;
        selectedVersion = versions[0] ?? '';
      }
    } finally {
      inFlight = false;
      render();
    }

    if (selectedVersion.length > 0) {
      await loadContent(selectedVersion);
    }
  }

  async function loadContent(version: string): Promise<void> {
    if (version.length === 0) {
      content = '';
      render();
      return;
    }

    inFlight = true;
    render();

    try {
      const result = await invokeTauri<string | null>('versions_get_content', { version });
      content = result ?? '';
    } finally {
      inFlight = false;
      render();
    }
  }

  async function restoreSelected(): Promise<void> {
    if (selectedVersion.length === 0) {
      return;
    }

    inFlight = true;
    render();

    try {
      const success = await invokeTauri<boolean | undefined>('versions_restore', { version: selectedVersion });
      if (success === true) {
        close();
        return;
      }
    } finally {
      inFlight = false;
      render();
    }
  }

  async function deleteAllVersions(): Promise<void> {
    inFlight = true;
    render();

    try {
      const success = await invokeTauri<boolean | undefined>('versions_delete_all');
      if (success === true) {
        versions = [];
        selectedVersion = '';
        content = '';
      }
    } finally {
      inFlight = false;
      render();
    }
  }

  function close(): void {
    backdrop.remove();
    onClose();
    core?.restoreFocus();
  }

  function renderSidebar(): void {
    sidebar.innerHTML = '';

    if (filePath === null) {
      createElement('div', 'markedit-chrome-versions-empty', sidebar, 'Version history is not available for this document.');
      return;
    }

    if (versions.length === 0) {
      createElement('div', 'markedit-chrome-versions-empty', sidebar, 'No saved versions yet.');
      return;
    }

    for (const version of versions) {
      const item = createElement('button', 'markedit-chrome-versions-item');
      item.type = 'button';
      item.textContent = version;
      item.classList.toggle('is-selected', version === selectedVersion);
      item.addEventListener('click', () => {
        selectedVersion = version;
        void loadContent(version);
      });
      sidebar.appendChild(item);
    }
  }

  function render(): void {
    const existingSubtitle = header.querySelector('.markedit-chrome-versions-subtitle');
    existingSubtitle?.remove();
    if (filePath !== null) {
      createElement('div', 'markedit-chrome-versions-subtitle', header, filePath);
    }

    renderSidebar();
    previewContent.value = content;

    deleteAllButton.disabled = inFlight || versions.length === 0;
    restoreButton.disabled = inFlight || selectedVersion.length === 0;
  }

  const focus = () => {
    const firstItem = sidebar.querySelector('.markedit-chrome-versions-item') as HTMLElement | null;
    firstItem?.focus();
  };

  void refreshVersions();

  return { element: backdrop, focus };
}
