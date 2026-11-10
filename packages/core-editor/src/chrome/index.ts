import type { WebModuleCore } from '../bridge/web/core';
import type { WebModuleSelection } from '../bridge/web/selection';
import type { WebModuleSearch } from '../bridge/web/search';
import type { WebModuleTableOfContents } from '../bridge/web/toc';

import { createFindBar, FindBarApi } from './findBar';
import { createTocPopover } from './tocPopover';
import { createStatisticsPopover } from './statisticsPopover';
import { createGotoLinePrompt } from './gotoLine';
import { createPromptModal } from './promptModal';
import { showContextMenu } from './contextMenu';
import { createExtensionsModal, ExtensionsManagerTab } from './extensionsModal';
import { createSettingsModal, SettingsTab } from './settingsModal';
import { createVersionHistoryModal } from './versionHistoryModal';
import {
  getMarkdownPreviewMode,
  setMarkdownPreviewMode,
  toggleMarkdownPreview,
  setMarkdownStandard,
  getMarkdownStandard,
  registerMarkdownRenderer,
  setMarkdownRenderer,
  ensureChromeUIModeSwitcher,
  MarkdownPreviewMode,
} from './markdownPreview';
import type { MarkdownRendererEngine } from '../modules/markdown-renderer';

const rootId = 'markedit-chrome-root';

export function initChromeUI(): void {
  if (document.getElementById(rootId) !== null) {
    return;
  }

  const webModules = window.webModules as unknown as {
    core: WebModuleCore;
    selection: WebModuleSelection;
    search: WebModuleSearch;
    toc: WebModuleTableOfContents;
  };

  const root = document.createElement('div');
  root.id = rootId;
  root.className = 'markedit-chrome-root';
  document.body.appendChild(root);
  ensureChromeUIModeSwitcher();

  let activePanel: HTMLElement | null = null;
  let activeFindBar: FindBarApi | null = null;
  let activeCloseHandler: (() => void) | null = null;

  const closeActive = () => {
    activeFindBar?.dispose();
    activeFindBar = null;
    activeCloseHandler?.();
    activeCloseHandler = null;
    activePanel?.remove();
    activePanel = null;
  };

  const chromeUI: ChromeUI = {
    openFindBar(withReplace = false) {
      closeActive();
      const findBar = createFindBar(withReplace, () => chromeUI.closeFindBar());
      activeFindBar = findBar;
      activePanel = findBar.element;
      root.appendChild(activePanel);
      findBar.focus();
    },
    closeFindBar() {
      closeActive();
    },
    toggleToc() {
      if (activePanel?.classList.contains('markedit-chrome-toc') === true) {
        closeActive();
        return;
      }

      closeActive();
      activePanel = createTocPopover(() => {
        activePanel?.remove();
        activePanel = null;
      });
      root.appendChild(activePanel);
      activePanel.querySelector('input')?.focus();
    },
    toggleStatistics() {
      if (activePanel?.classList.contains('markedit-chrome-statistics') === true) {
        closeActive();
        return;
      }

      closeActive();
      activePanel = createStatisticsPopover();
      root.appendChild(activePanel);
    },
    openGotoLine() {
      closeActive();
      activePanel = createGotoLinePrompt(() => chromeUI.closeAll());
      root.appendChild(activePanel);
      activePanel.querySelector('input')?.focus();
    },
    showTextBox(options) {
      closeActive();

      const modal = createPromptModal(options, () => {
        activePanel = null;
        activeCloseHandler = null;
      });

      activePanel = modal.element;
      activeCloseHandler = modal.close;
      root.appendChild(activePanel);
      modal.focus();

      return modal.promise;
    },
    showContextMenu(options) {
      closeActive();

      const menu = showContextMenu({
        items: options.items,
        location: options.location,
      }, () => {
        activePanel = null;
        activeCloseHandler = null;
      });

      activePanel = menu;
      activeCloseHandler = () => menu.remove();
      root.appendChild(menu);
    },
    openExtensionsManager(initialTab = 'discover') {
      closeActive();

      const modal = createExtensionsModal(initialTab as ExtensionsManagerTab, () => {
        activePanel = null;
        activeCloseHandler = null;
      });

      activePanel = modal.element;
      activeCloseHandler = () => modal.element.remove();
      root.appendChild(activePanel);
      modal.focus();
    },
    openSettings(initialTab = 'editor') {
      closeActive();

      const modal = createSettingsModal(initialTab as SettingsTab, () => {
        activePanel = null;
        activeCloseHandler = null;
      });

      activePanel = modal.element;
      activeCloseHandler = () => modal.element.remove();
      root.appendChild(activePanel);
      modal.focus();
    },
    openVersionHistory() {
      closeActive();

      const modal = createVersionHistoryModal(() => {
        activePanel = null;
        activeCloseHandler = null;
      });

      activePanel = modal.element;
      activeCloseHandler = () => modal.element.remove();
      root.appendChild(activePanel);
      modal.focus();
    },
    toggleMarkdownPreview(preferredMode) {
      toggleMarkdownPreview(preferredMode as 'split' | 'preview' | undefined);
    },
    setMarkdownPreviewMode(mode) {
      setMarkdownPreviewMode(mode as MarkdownPreviewMode);
    },
    getMarkdownPreviewMode() {
      return getMarkdownPreviewMode();
    },
    closeAll() {
      const previewMode = getMarkdownPreviewMode();
      closeActive();
      if (previewMode === 'preview') {
        setMarkdownPreviewMode('editor');
      }
    },
    setMarkdownStandard(standard) {
      setMarkdownStandard(standard);
    },
    getMarkdownStandard() {
      return getMarkdownStandard();
    },
    registerMarkdownRenderer(engine) {
      registerMarkdownRenderer(engine);
    },
    setMarkdownRenderer(id) {
      setMarkdownRenderer(id);
    },
  };

  window.chromeUI = chromeUI;

  const markEdit = MarkEdit as unknown as Record<string, unknown>;
  markEdit.setMarkdownStandard = (standard: string) => chromeUI.setMarkdownStandard(standard);
  markEdit.getMarkdownStandard = () => chromeUI.getMarkdownStandard();
  markEdit.registerMarkdownRenderer = (engine: MarkdownRendererEngine) => chromeUI.registerMarkdownRenderer(engine);
  markEdit.setMarkdownRenderer = (id: string) => chromeUI.setMarkdownRenderer(id);

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      chromeUI.closeAll();
      webModules.core.restoreFocus();
      event.preventDefault();
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) {
      return;
    }

    if (!event.shiftKey && !event.altKey && event.key === 'f') {
      chromeUI.openFindBar(false);
      event.preventDefault();
    } else if (!event.shiftKey && !event.altKey && event.key === 'h') {
      chromeUI.openFindBar(true);
      event.preventDefault();
    } else if (!event.shiftKey && !event.altKey && event.key === 'g') {
      chromeUI.openGotoLine();
      event.preventDefault();
    } else if (event.shiftKey && !event.altKey && event.key === 'O') {
      chromeUI.toggleToc();
      event.preventDefault();
    } else if (event.shiftKey && !event.altKey && event.key === 'I') {
      chromeUI.toggleStatistics();
      event.preventDefault();
    } else if (event.shiftKey && !event.altKey && event.key === 'X') {
      chromeUI.openExtensionsManager('discover');
      event.preventDefault();
    } else if (event.shiftKey && !event.altKey && (event.key === 'P' || event.key === 'p')) {
      chromeUI.toggleMarkdownPreview('split');
      event.preventDefault();
    } else if (event.altKey && (event.key === 'p' || event.key === 'P')) {
      chromeUI.toggleMarkdownPreview('preview');
      event.preventDefault();
    }
  }, true);
}
