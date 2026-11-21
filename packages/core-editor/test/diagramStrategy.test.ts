import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import { CompressionStream as NodeCompressionStream } from 'node:stream/web';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import {
  renderDiagramWithPlugin,
  hydrateDiagrams,
  setDiagramRendering,
  setDiagramServer,
} from '../src/modules/markdown-renderer/plugins/registry';
import { registerBuiltinRendererPlugins } from '../src/modules/markdown-renderer/plugins/builtin';
import { clearDiagramCache, svgToDataUrl } from '../src/modules/markdown-renderer/plugins/strategy';
import { vizResultSvg, withIntrinsicSize } from '../src/modules/markdown-renderer/plugins/local';
// The CommonJS build of viz.js (Graphviz as WebAssembly), as the bundled dist/vendor/viz-global.js would set it.
import * as vizModule from '@viz-js/viz';

registerBuiltinRendererPlugins();

// jsdom provides neither compression streams, text decoding nor image loading; WebView2 does.
Object.assign(globalThis, { CompressionStream: NodeCompressionStream, TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder });
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true,
  get(this: HTMLImageElement) {
    return this.getAttribute('src') ?? '';
  },
  set(this: HTMLImageElement, value: string) {
    this.setAttribute('src', value);
    setTimeout(() => this.dispatchEvent(new Event(value.includes('broken') ? 'error' : 'load')), 0);
  },
});

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function mockTauri(invoke: Invoke) {
  (window as unknown as { __TAURI_INTERNALS__?: { invoke: Invoke } }).__TAURI_INTERNALS__ = { invoke };
}

async function renderInDocument(lang: string, code: string): Promise<HTMLElement> {
  document.body.innerHTML = renderDiagramWithPlugin(lang, code) ?? '';
  await hydrateDiagrams(document.body);
  return document.body.querySelector('.markedit-diagram') as HTMLElement;
}

describe('diagram rendering strategy (local tools / server)', () => {
  beforeEach(() => {
    clearDiagramCache();
    setDiagramRendering('auto');
    setDiagramServer('https://kroki.example');
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    setDiagramServer('https://kroki.io');
  });

  test('auto: a local tool renders the diagram as an SVG image', async () => {
    const invoke = jest.fn<Invoke>(async () => '<svg id="local">PlantUML</svg>');
    mockTauri(invoke);

    const element = await renderInDocument('plantuml', '@startuml\nA -> B\n@enduml');
    expect(invoke).toHaveBeenCalledWith('diagram_render_local', { lang: 'plantuml', source: '@startuml\nA -> B\n@enduml' });
    const image = element.querySelector('img.markedit-diagram-image') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe(svgToDataUrl('<svg id="local">PlantUML</svg>'));
    expect(element.classList.contains('is-rendered')).toBe(true);

    // Cached: the next preview render shows it immediately, without running the tool again.
    expect(renderDiagramWithPlugin('plantuml', '@startuml\nA -> B\n@enduml')).toContain('is-rendered');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('auto: a missing local tool falls back to the diagram server', async () => {
    mockTauri(async () => {
      // Tauri rejects command errors with plain strings.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'not-installed: \'d2\' was not found on PATH';
    });

    const element = await renderInDocument('d2', 'a -> b');
    const src = element.querySelector('img')?.getAttribute('src') ?? '';
    expect(src.startsWith('https://kroki.example/d2/svg/')).toBe(true);
  });

  test('auto: a diagram error from the local tool is shown, not sent to the server', async () => {
    mockTauri(async () => {
      // Tauri rejects command errors with plain strings.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'failed: Syntax Error? (line 2)';
    });

    const element = await renderInDocument('plantuml', '@startuml\nA -> \n@enduml');
    expect(element.classList.contains('is-error')).toBe(true);
    expect(element.textContent).toContain('Syntax Error? (line 2)');
    expect(element.querySelector('img')).toBeNull();
  });

  test('local only: never contacts the server', async () => {
    setDiagramRendering('local');
    mockTauri(async () => {
      // Tauri rejects command errors with plain strings.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'not-installed: \'plantuml\' was not found on PATH';
    });

    const element = await renderInDocument('plantuml', '@startuml\nA -> B\n@enduml');
    expect(element.classList.contains('is-error')).toBe(true);
    expect(element.textContent).toContain('\'plantuml\' was not found on PATH');
    expect(element.querySelector('img')).toBeNull();
  });

  test('server only: never runs local tools', async () => {
    setDiagramRendering('server');
    const invoke = jest.fn<Invoke>(async () => '<svg></svg>');
    mockTauri(invoke);

    const element = await renderInDocument('d2', 'x -> y');
    expect(invoke).not.toHaveBeenCalled();
    expect(element.querySelector('img')?.getAttribute('src')).toMatch(/^https:\/\/kroki\.example\/d2\/svg\//);
  });

  test('placeholders removed by a newer preview render are skipped', async () => {
    const invoke = jest.fn<Invoke>(async () => '<svg></svg>');
    mockTauri(invoke);

    const container = document.createElement('div');
    container.innerHTML = renderDiagramWithPlugin('d2', 'stale -> diagram') ?? '';
    // Not attached to the document: the preview already replaced it.
    await hydrateDiagrams(container);
    expect(invoke).not.toHaveBeenCalled();
  });

  test('mermaid: mermaid.js unavailable falls back to the server', async () => {
    // jsdom does not load the vendor script; the error event marks it unavailable.
    const appendChild = document.head.appendChild.bind(document.head);
    const spy = jest.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const result = appendChild(node);
      setTimeout(() => node.dispatchEvent(new Event('error')), 0);
      return result;
    });

    const element = await renderInDocument('mermaid', 'classDiagram\nA <|-- B');
    expect(element.querySelector('img')?.getAttribute('src')).toMatch(/^https:\/\/kroki\.example\/mermaid\/svg\//);
    spy.mockRestore();
  });

  test('graphviz: the installed dot command is used first', async () => {
    const invoke = jest.fn<Invoke>(async () => '<svg id="dot">graph</svg>');
    mockTauri(invoke);

    const element = await renderInDocument('dot', 'digraph { a -> b }');
    expect(invoke).toHaveBeenCalledWith('diagram_render_local', { lang: 'dot', source: 'digraph { a -> b }' });
    expect(element.querySelector('img')?.getAttribute('src')).toBe(svgToDataUrl('<svg id="dot">graph</svg>'));
  });

  test('graphviz: without dot and without the bundled viz.js, the server renders it', async () => {
    const appendChild = document.head.appendChild.bind(document.head);
    const spy = jest.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      const result = appendChild(node);
      setTimeout(() => node.dispatchEvent(new Event('error')), 0);
      return result;
    });

    const element = await renderInDocument('graphviz', 'digraph { server -> fallback }');
    expect(element.querySelector('img')?.getAttribute('src')).toMatch(/^https:\/\/kroki\.example\/graphviz\/svg\//);
    spy.mockRestore();
  });

  describe('graphviz with the bundled viz.js', () => {
    beforeEach(() => {
      (window as unknown as { Viz?: unknown }).Viz = vizModule;
    });

    afterEach(() => {
      delete (window as unknown as { Viz?: unknown }).Viz;
    });

    test('dot not installed: viz.js renders the graph offline', async () => {
      mockTauri(async () => {
        // Tauri rejects command errors with plain strings.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'not-installed: \'dot\' was not found on PATH';
      });

      const element = await renderInDocument('dot', 'digraph { rankdir=LR; 안녕 -> world }');
      const src = element.querySelector('img')?.getAttribute('src') ?? '';
      expect(src.startsWith('data:image/svg+xml;base64,')).toBe(true);
      const svg = new TextDecoder().decode(Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), char => char.charCodeAt(0)));
      expect(svg).toContain('<svg');
      expect(svg).toContain('안녕');
    });

    test('outside the desktop app viz.js renders too, even with "local only"', async () => {
      setDiagramRendering('local');
      const element = await renderInDocument('graphviz', 'graph { a -- b -- c }');
      expect(element.classList.contains('is-rendered')).toBe(true);
    });

    test('a DOT error from viz.js is shown, not sent to the server', async () => {
      const element = await renderInDocument('dot', 'digraph { a -> }');
      expect(element.classList.contains('is-error')).toBe(true);
      expect(element.textContent).toMatch(/Graphviz: .*syntax error/i);
      expect(element.querySelector('img')).toBeNull();
    });
  });

  test('viz.js results: the SVG, or Graphviz\'s error messages without warnings', () => {
    expect(vizResultSvg({ status: 'success', output: '<svg/>', errors: [{ level: 'warning', message: 'w' }] })).toBe('<svg/>');
    expect(() => vizResultSvg({
      status: 'failure',
      errors: [{ level: 'warning', message: 'ignored' }, { level: 'error', message: ' syntax error in line 1 ' }],
    })).toThrow('syntax error in line 1');
    expect(() => vizResultSvg({ status: 'failure', errors: [] })).toThrow('the graph could not be rendered');
  });

  test('mermaid SVGs get an intrinsic size so <img> shows them at their real size', () => {
    const svg = '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 713.5px;" viewBox="-8 -8 713.5 184.2"><g/></svg>';
    const sized = withIntrinsicSize(svg);
    expect(sized.startsWith('<svg width="714" height="185" id="m1"')).toBe(true);
    expect(sized).not.toContain('100%');
    expect(sized).not.toContain('max-width');
    expect(withIntrinsicSize('<svg><g/></svg>')).toBe('<svg><g/></svg>');
  });
});
