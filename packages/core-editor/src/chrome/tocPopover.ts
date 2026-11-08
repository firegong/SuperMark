import { HeadingInfo } from '../modules/toc/types';
import { createElement } from './utils';

interface TocModule {
  getTableOfContents: () => HeadingInfo[];
  gotoHeader: (args: { headingInfo: HeadingInfo }) => void;
}

export function createTocPopover(onClose: () => void): HTMLElement {
  const toc = window.webModules.toc as unknown as TocModule;

  const root = createElement('div', 'markedit-chrome-panel markedit-chrome-popover markedit-chrome-toc');
  createElement('div', 'markedit-chrome-popover-header', root, 'Table of Contents');

  const filterInput = createElement('input', 'markedit-chrome-input markedit-chrome-filter');
  filterInput.type = 'text';
  filterInput.placeholder = 'Filter headings';
  root.appendChild(filterInput);

  const list = createElement('div', 'markedit-chrome-popover-body', root);
  const headings = toc.getTableOfContents();

  function render(items: HeadingInfo[]) {
    while (list.firstChild !== null) {
      list.removeChild(list.firstChild);
    }

    if (items.length === 0) {
      createElement('div', 'markedit-chrome-statistics-label', list, 'No headings found');
      return;
    }

    for (const item of items) {
      const button = createElement('button', 'markedit-chrome-list-item', list);
      button.type = 'button';
      button.style.paddingLeft = `${(item.level - 1) * 16 + 12}px`;
      button.textContent = item.title;

      if (item.selected) {
        button.classList.add('markedit-chrome-selected');
      }

      button.addEventListener('click', () => {
        toc.gotoHeader({ headingInfo: item });
        onClose();
      });
    }
  }

  render(headings);

  filterInput.addEventListener('input', () => {
    const term = filterInput.value.toLowerCase();
    render(headings.filter(heading => heading.title.toLowerCase().includes(term)));
  });

  return root;
}
