import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import * as editor from './utils/editor';
import { initChromeUI } from '../src/chrome';

describe('Chrome UI', () => {
  let mockedWebModules: {
    search: {
      setState: jest.Mock;
      updateQuery: jest.Mock;
      findNext: jest.Mock;
      findPrevious: jest.Mock;
      replaceNext: jest.Mock;
      replaceAll: jest.Mock;
      getCounterInfo: jest.Mock;
    };
    toc: {
      getTableOfContents: jest.Mock;
      gotoHeader: jest.Mock;
    };
    core: {
      getEditorText: jest.Mock;
      restoreFocus: jest.Mock;
    };
    selection: {
      getText: jest.Mock;
      gotoLine: jest.Mock;
    };
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    editor.setUp('# Hello\n\nWorld.\n\n## Section\n\nMore text.');

    mockedWebModules = {
      search: {
        setState: jest.fn(),
        updateQuery: jest.fn(),
        findNext: jest.fn(),
        findPrevious: jest.fn(),
        replaceNext: jest.fn(),
        replaceAll: jest.fn(),
        getCounterInfo: jest.fn(() => ({ currentIndex: 0, numberOfItems: 0 })),
      },
      toc: {
        getTableOfContents: jest.fn(() => [
          { title: 'Hello', level: 1, from: 0, to: 7, selected: true, lineNumber: 1 },
          { title: 'Section', level: 2, from: 10, to: 19, selected: false, lineNumber: 4 },
        ]),
        gotoHeader: jest.fn(),
      },
      core: {
        getEditorText: jest.fn(() => window.editor.state.doc.toString()),
        restoreFocus: jest.fn(),
      },
      selection: {
        getText: jest.fn(() => ''),
        gotoLine: jest.fn(),
      },
    };

    window.webModules = mockedWebModules as unknown as typeof window.webModules;
    initChromeUI();
  });

  test('initChromeUI creates root and exposes controller', () => {
    expect(document.getElementById('markedit-chrome-root')).not.toBeNull();
    expect(window.chromeUI).toBeDefined();
  });

  test('openFindBar renders find bar and enables search state', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);

    expect(document.querySelector('.markedit-chrome-findbar')).not.toBeNull();
    expect(mockedWebModules.search.setState).toHaveBeenCalledWith({ enabled: true });
  });

  test('openFindBar with replace shows replace controls', () => {
    (window.chromeUI as ChromeUI).openFindBar(true);

    const replaceRow = document.querySelector('.markedit-chrome-replace-row');
    expect(replaceRow).not.toBeNull();
    expect(replaceRow?.classList.contains('markedit-chrome-hidden')).toBe(false);
  });

  test('toggleToc renders headings and supports filtering', () => {
    (window.chromeUI as ChromeUI).toggleToc();

    const items = document.querySelectorAll('.markedit-chrome-toc .markedit-chrome-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Hello');
    expect(items[1].textContent).toBe('Section');

    const filter = document.querySelector('.markedit-chrome-toc input') as HTMLInputElement;
    filter.value = 'sect';
    filter.dispatchEvent(new Event('input', { bubbles: true }));

    expect(document.querySelectorAll('.markedit-chrome-toc .markedit-chrome-list-item').length).toBe(1);
  });

  test('toggleStatistics computes document statistics', () => {
    (window.chromeUI as ChromeUI).toggleStatistics();

    const body = document.querySelector('.markedit-chrome-statistics .markedit-chrome-popover-body');
    expect(body?.textContent).toContain('Characters');
    expect(body?.textContent).toContain('Words');
    expect(body?.textContent).toContain('Document');
  });

  test('openGotoLine prompts and jumps on Enter', () => {
    (window.chromeUI as ChromeUI).openGotoLine();

    const input = document.querySelector('.markedit-chrome-goto input') as HTMLInputElement;
    expect(input).not.toBeNull();

    input.value = '2';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(mockedWebModules.selection.gotoLine).toHaveBeenCalledWith({ lineNumber: 2 });
  });

  test('closeAll removes active panel', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);
    (window.chromeUI as ChromeUI).closeAll();

    expect(document.querySelector('.markedit-chrome-findbar')).toBeNull();
  });

  test('Escape closes overlays and restores focus', () => {
    (window.chromeUI as ChromeUI).openFindBar(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(document.querySelector('.markedit-chrome-findbar')).toBeNull();
    expect(mockedWebModules.core.restoreFocus).toHaveBeenCalled();
  });
});
