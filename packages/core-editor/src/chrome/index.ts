import type { WebModuleCore } from '../bridge/web/core';
import type { WebModuleSelection } from '../bridge/web/selection';
import type { WebModuleSearch } from '../bridge/web/search';
import type { WebModuleTableOfContents } from '../bridge/web/toc';

import { createFindBar, FindBarApi } from './findBar';
import { createTocPopover } from './tocPopover';
import { createStatisticsPopover } from './statisticsPopover';
import { createGotoLinePrompt } from './gotoLine';

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

  let activePanel: HTMLElement | null = null;
  let activeFindBar: FindBarApi | null = null;

  const closeActive = () => {
    activeFindBar?.dispose();
    activeFindBar = null;
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
    closeAll() {
      closeActive();
    },
  };

  window.chromeUI = chromeUI;

  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      chromeUI.closeAll();
      webModules.core.restoreFocus();
      event.preventDefault();
      return;
    }

    if (!event.ctrlKey) {
      return;
    }

    if (!event.shiftKey && event.key === 'f') {
      chromeUI.openFindBar(false);
      event.preventDefault();
    } else if (!event.shiftKey && event.key === 'h') {
      chromeUI.openFindBar(true);
      event.preventDefault();
    } else if (!event.shiftKey && event.key === 'g') {
      chromeUI.openGotoLine();
      event.preventDefault();
    } else if (event.shiftKey && event.key === 'O') {
      chromeUI.toggleToc();
      event.preventDefault();
    } else if (event.shiftKey && event.key === 'I') {
      chromeUI.toggleStatistics();
      event.preventDefault();
    }
  }, true);
}
