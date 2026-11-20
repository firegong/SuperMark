import { describe, expect, jest, test } from '@jest/globals';
import { builtInParsers, defaultParser, commonmarkEngine, gfmEngine, extendedEngine, gsyncEngine, superMarkdownEngine } from '../src/modules/markdown-renderer/formats';
import { markdownItEngine } from '../src/modules/markdown-renderer/formats/markdownIt';
import type { MarkdownRendererEngine } from '../src/modules/markdown-renderer';
import { framePreview, htmlPreview, previewFor, registerMarkdownFormat, registerMarkdownRenderer, type PreviewHost, type PreviewRenderer } from '../src/modules/markdown-renderer';
import { builtInFormats } from '../src/modules/markdown-renderer/formats';
import { superSetPreview } from '../src/modules/markdown-renderer/formats/markdownSuperSet';
import { gsyncPreview } from '../src/modules/markdown-renderer/formats/gsync';

const host = (): PreviewHost & { [K in keyof PreviewHost]: jest.Mock } => ({
  rerender: jest.fn(),
  didRenderHtml: jest.fn(),
  didLoadFrame: jest.fn(),
  didChangeLayout: jest.fn(),
});

describe('Format modules, one folder each', () => {
  test('each format module pairs its parser with its preview', () => {
    expect(builtInFormats.map(format => format.engine)).toEqual(builtInParsers);
    expect(builtInFormats.every(format => typeof format.preview.render === 'function')).toBe(true);
  });

  test('the built-in parsers keep the ids the settings save, in menu order', () => {
    expect(builtInParsers.map(parser => parser.id)).toEqual(['commonmark', 'gfm', 'extended', 'super', 'micromark', 'gsync']);
    expect(defaultParser).toBe(extendedEngine);
    expect(superMarkdownEngine.name).toBe('Markdown Super Set');
  });

  test('each parser has its own syntax', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(commonmarkEngine.render(table)).not.toContain('<table');
    expect(gfmEngine.render(table)).toContain('<table');

    const math = '$$\nx^2\n$$';
    expect(gfmEngine.render(math)).not.toContain('<math');
    expect(extendedEngine.render(math)).toContain('<math');

    const merged = '| a | b |\n|---|---|\n| 1 | < |';
    expect(superMarkdownEngine.render(merged)).toContain('colspan="2"');
    expect(extendedEngine.render(merged)).not.toContain('colspan');
  });
});

describe('Previews', () => {
  test('each parser gets its preview', () => {
    expect(previewFor(commonmarkEngine)).toBe(htmlPreview);
    expect(previewFor(gfmEngine)).toBe(htmlPreview);
    expect(previewFor(extendedEngine)).toBe(htmlPreview);
    expect(previewFor(superMarkdownEngine)).toBe(superSetPreview);
    expect(previewFor(gsyncEngine)).toBe(gsyncPreview);
    // Complete, self-styled documents go into a frame.
    expect(previewFor(markdownItEngine)).toBe(framePreview);
  });

  test('a parser can be given another preview', () => {
    const custom: PreviewRenderer = { id: 'custom', render: jest.fn() };
    const parser: MarkdownRendererEngine = { id: 'custom-parser', name: 'Custom', standard: 'custom', render: () => '' };
    expect(previewFor(parser)).toBe(htmlPreview);
    registerMarkdownFormat({ engine: parser, preview: custom });
    expect(previewFor(parser)).toBe(custom);
    // A parser registered on its own (e.g. by an extension) gets the default preview.
    registerMarkdownRenderer(parser);
    expect(previewFor(parser)).toBe(htmlPreview);
  });

  test('the HTML preview renders fragments and hands over to the host', () => {
    const body = document.createElement('div');
    const callbacks = host();
    htmlPreview.render(body, '# Title', gfmEngine, callbacks);
    expect(body.querySelector('h1')?.textContent).toContain('Title');
    expect(callbacks.didRenderHtml).toHaveBeenCalledWith(body);
  });

  test('the Markdown Super Set preview handles its tab sets', () => {
    const body = document.createElement('div');
    const callbacks = host();
    superSetPreview.render(body, '::::{.tabset}\n:::{.tab title=One}\nfirst\n:::\n:::{.tab title=Two}\nsecond\n:::\n::::', superMarkdownEngine, callbacks);
    const buttons = body.querySelectorAll<HTMLButtonElement>('.msm-tab-button');
    expect(buttons.length).toBe(2);
    buttons[1].click();
    expect(buttons[1].classList.contains('is-active')).toBe(true);
    expect(callbacks.didChangeLayout).toHaveBeenCalled();
  });

  test('switching away from the frame preview drops a render in progress', async () => {
    const body = document.createElement('div');
    let finish: (html: string) => void = () => undefined;
    const documentParser: MarkdownRendererEngine = {
      id: 'document-parser',
      name: 'Document',
      standard: 'document',
      render: () => '',
      renderDocument: () => new Promise<string>(resolve => { finish = resolve; }),
    };
    framePreview.render(body, 'text', documentParser, host());
    // Another parser takes over before the document arrives.
    htmlPreview.render(body, 'plain', gfmEngine, host());
    finish('<html><head></head><body>late</body></html>');
    await Promise.resolve();
    await Promise.resolve();
    expect(body.querySelector('iframe')).toBeNull();
    expect(body.textContent).toContain('plain');
  });
});
