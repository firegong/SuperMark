import { describe, expect, jest, test } from '@jest/globals';
import { createFindBar } from '../src/chrome/findBar';
import { SearchOperation } from '../src/modules/search/operations';

describe('Find bar: Replace All in Selection', () => {
  test('the toggle switches Replace All to the selection-only operation', () => {
    const search = {
      setState: jest.fn(),
      updateQuery: jest.fn(),
      findNext: jest.fn(() => true),
      findPrevious: jest.fn(() => true),
      replaceNext: jest.fn(),
      replaceAll: jest.fn(),
      performOperation: jest.fn(),
      getCounterInfo: jest.fn(() => ({ numberOfItems: 0, currentIndex: 0 })),
    };
    window.webModules = { search } as unknown as typeof window.webModules;
    const bar = createFindBar(true, () => undefined);
    document.body.appendChild(bar.element);

    const replaceAll = Array.from(bar.element.querySelectorAll('button')).find(button => button.textContent === 'Replace All') as HTMLButtonElement;
    replaceAll.click();
    expect(search.replaceAll).toHaveBeenCalledTimes(1);
    expect(search.performOperation).not.toHaveBeenCalled();

    const toggle = bar.element.querySelector('.markedit-chrome-findbar-in-selection') as HTMLButtonElement;
    toggle.click();
    expect(toggle.classList.contains('markedit-chrome-active')).toBe(true);
    replaceAll.click();
    expect(search.performOperation).toHaveBeenCalledWith({ operation: SearchOperation.replaceAllInSelection });
    expect(search.replaceAll).toHaveBeenCalledTimes(1);
    bar.dispose();
  });
});
