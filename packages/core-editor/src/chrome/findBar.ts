import SearchOptions from '../modules/search/options';
import SearchCounterInfo from '../modules/search/counterInfo';
import { SearchOperation } from '../modules/search/operations';
import { createButton, createElement, createToggle } from './utils';

export interface FindBarApi {
  element: HTMLElement;
  focus(): void;
  dispose(): void;
}

interface SearchModule {
  setState: (args: { enabled: boolean }) => void;
  updateQuery: (args: { options: SearchOptions }) => void;
  findNext: (args: { search: string }) => boolean;
  findPrevious: (args: { search: string }) => boolean;
  replaceNext: () => void;
  replaceAll: () => void;
  performOperation?: (args: { operation: SearchOperation }) => void;
  getCounterInfo: () => SearchCounterInfo;
}

export function createFindBar(withReplace: boolean, onClose: () => void): FindBarApi {
  const search = window.webModules.search as unknown as SearchModule;

  const state = {
    query: '',
    replace: '',
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
    // Replace All works only inside the selection.
    inSelection: false,
  };

  let replaceVisible = withReplace;

  const root = createElement('div', 'markedit-chrome-panel markedit-chrome-findbar');

  const header = createElement('div', 'markedit-chrome-findbar-row', root);
  const searchInput = createElement('input', 'markedit-chrome-input markedit-chrome-findbar-input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Find';
  header.appendChild(searchInput);

  const counter = createElement('span', 'markedit-chrome-counter', header, '0 of 0');
  const previousButton = createButton('↑', () => find('previous'), 'markedit-chrome-button markedit-chrome-icon-button');
  previousButton.title = 'Previous Match (Shift+Enter)';
  const nextButton = createButton('↓', () => find('next'), 'markedit-chrome-button markedit-chrome-icon-button');
  nextButton.title = 'Next Match (Enter)';
  header.appendChild(previousButton);
  header.appendChild(nextButton);

  const replaceToggle = createButton(
    replaceVisible ? '▼' : '▶',
    () => {
      replaceVisible = !replaceVisible;
      replaceRow.classList.toggle('markedit-chrome-hidden', !replaceVisible);
      replaceToggle.textContent = replaceVisible ? '▼' : '▶';
      refreshQuery();
    },
    'markedit-chrome-button markedit-chrome-icon-button',
  );
  replaceToggle.title = 'Toggle Replace (Ctrl+H)';
  header.appendChild(replaceToggle);

  const closeButton = createButton('×', onClose, 'markedit-chrome-button markedit-chrome-icon-button markedit-chrome-close-button');
  closeButton.title = 'Close (Esc)';
  header.appendChild(closeButton);

  const replaceRow = createElement('div', 'markedit-chrome-findbar-row markedit-chrome-replace-row markedit-chrome-hidden');
  const replaceInput = createElement('input', 'markedit-chrome-input markedit-chrome-findbar-input');
  replaceInput.type = 'text';
  replaceInput.placeholder = 'Replace';
  replaceRow.appendChild(replaceInput);
  const replaceButton = createButton('Replace', () => performReplace(false), 'markedit-chrome-button markedit-chrome-action-button');
  const replaceAllButton = createButton('Replace All', () => performReplace(true), 'markedit-chrome-button markedit-chrome-action-button');
  replaceRow.appendChild(replaceButton);
  replaceRow.appendChild(replaceAllButton);
  root.appendChild(replaceRow);

  replaceRow.classList.toggle('markedit-chrome-hidden', !replaceVisible);

  const optionsRow = createElement('div', 'markedit-chrome-findbar-row markedit-chrome-options-row', root);
  const caseButton = createToggle('Aa', () => state.caseSensitive, () => { state.caseSensitive = !state.caseSensitive; refreshQuery(); refreshCounter(); });
  caseButton.title = 'Match Case';
  const wordButton = createToggle('ab', () => state.wholeWord, () => { state.wholeWord = !state.wholeWord; refreshQuery(); refreshCounter(); });
  wordButton.title = 'Match Whole Word';
  const regexButton = createToggle('.*', () => state.regexp, () => { state.regexp = !state.regexp; refreshQuery(); refreshCounter(); });
  regexButton.title = 'Use Regular Expression';
  const selectionButton = createToggle('⌶', () => state.inSelection, () => { state.inSelection = !state.inSelection; });
  selectionButton.title = 'Replace All in Selection';
  selectionButton.classList.add('markedit-chrome-findbar-in-selection');
  optionsRow.appendChild(caseButton);
  optionsRow.appendChild(wordButton);
  optionsRow.appendChild(regexButton);
  optionsRow.appendChild(selectionButton);

  search.setState({ enabled: true });

  function refreshQuery() {
    const options: SearchOptions = {
      search: state.query,
      caseSensitive: state.caseSensitive,
      diacriticInsensitive: false,
      wholeWord: state.wholeWord,
      literal: !state.regexp,
      regexp: state.regexp,
      refocus: true,
    };

    if (replaceVisible) {
      options.replace = state.replace;
    }

    search.setState({ enabled: true });
    search.updateQuery({ options });
  }

  function refreshCounter() {
    const { currentIndex, numberOfItems } = search.getCounterInfo();
    counter.textContent = numberOfItems === 0 ? '0 of 0' : `${currentIndex + 1} of ${numberOfItems}`;
  }

  function find(direction: 'next' | 'previous') {
    refreshQuery();
    if (direction === 'next') {
      search.findNext({ search: state.query });
    } else {
      search.findPrevious({ search: state.query });
    }
    refreshCounter();
  }

  function performReplace(all: boolean) {
    refreshQuery();
    if (all && state.inSelection && search.performOperation !== undefined) {
      search.performOperation({ operation: SearchOperation.replaceAllInSelection });
    } else if (all) {
      search.replaceAll();
    } else {
      search.replaceNext();
    }
    refreshCounter();
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    refreshQuery();
    refreshCounter();
  });

  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      find(event.shiftKey ? 'previous' : 'next');
      event.preventDefault();
    }
  });

  replaceInput.addEventListener('input', () => {
    state.replace = replaceInput.value;
    refreshQuery();
  });

  replaceInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      performReplace(false);
      event.preventDefault();
    }
  });

  return {
    element: root,
    focus() {
      searchInput.focus();
      searchInput.select();
    },
    dispose() {
      search.setState({ enabled: false });
    },
  };
}
