import { describe, expect, jest, test, beforeEach } from '@jest/globals';
import { handlePreviewLinkClick } from '../src/chrome/markdownPreview';

describe('Preview link clicks', () => {
  let invoke: jest.Mock<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="preview">
        <a id="web" href="https://example.com/page">web</a>
        <a id="doc" href="Notes%20Today.md#todo">doc</a>
        <a id="anchor" href="#section"><span id="inner">anchor</span></a>
        <a id="empty" href="">empty</a>
        <h2 id="section">Section</h2>
      </div>`;
    invoke = jest.fn(async () => undefined);
    window.__TAURI_INTERNALS__ = { invoke } as unknown as typeof window.__TAURI_INTERNALS__;
  });

  const click = (id: string) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: document.getElementById(id) });
    handlePreviewLinkClick(event, document);
    return event;
  };

  test('links never navigate the page; non-anchor links go to the host', () => {
    expect(click('web').defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith('open_link', { href: 'https://example.com/page' });

    expect(click('doc').defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledWith('open_link', { href: 'Notes%20Today.md#todo' });

    expect(click('empty').defaultPrevented).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test('in-page anchors scroll and stay in the preview', () => {
    const section = document.getElementById('section') as HTMLElement;
    const scrollIntoView = jest.fn();
    section.scrollIntoView = scrollIntoView;

    // A click on an element inside the link counts too.
    expect(click('inner').defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  test('clicks outside links are left alone', () => {
    expect(click('section').defaultPrevented).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
