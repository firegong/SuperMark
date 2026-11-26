import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, test, afterEach } from '@jest/globals';
import {
  registerDiagramPlugin,
  unregisterDiagramPlugin,
  renderDiagramWithPlugin,
  hasDiagramPlugin,
  hydrateDiagrams,
  diagramPlaceholder,
  markDiagramRendered,
  setDiagramServer,
  getDiagramServer,
  setDiagramRendering,
  registerMathPlugin,
  setActiveMathPlugin,
  renderMathWithPlugin,
  type DiagramPlugin,
} from '../src/modules/markdown-renderer/plugins/registry';
import { registerBuiltinRendererPlugins } from '../src/modules/markdown-renderer/plugins/builtin';
import { renderLatexToMathML } from '../src/modules/markdown-renderer/plugins/mathPlugin';
import { renderDrawioToSvg, compressedDiagramPayload } from '../src/modules/markdown-renderer/plugins/drawio';
import { SuperMarkdownEngine } from '../src/modules/markdown-renderer/formats/markdownSuperSet';
import { superMarkdownEngine } from '../src/modules/markdown-renderer/formats';

registerBuiltinRendererPlugins();

const display = (latex: string) => renderLatexToMathML(latex, true);
const inline = (latex: string) => renderLatexToMathML(latex, false);

describe('LaTeX math plugin', () => {
  test('fractions, roots, scripts', () => {
    expect(inline('\\frac{a}{b}')).toContain('<mfrac><mi>a</mi><mi>b</mi></mfrac>');
    expect(inline('\\sqrt[3]{x}')).toContain('<mroot><mi>x</mi><mn>3</mn></mroot>');
    expect(inline('x_{i}^{2}')).toContain('<msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup>');
    expect(inline('3.14')).toContain('<mn>3.14</mn>');
    expect(inline("f'(x)")).toContain('<msup><mi>f</mi><mo>′</mo></msup>');
  });

  test('functions keep a single base under scripts', () => {
    const html = inline('\\sin^2 x');
    expect(html).toContain('<msup><mi mathvariant="normal">sin</mi><mn>2</mn></msup><mo>&#x2061;</mo>');
  });

  test('large operators use limits in display mode only', () => {
    expect(display('\\sum_{k=1}^{n} k')).toContain('<munderover><mo largeop="true" movablelimits="true">∑</mo>');
    expect(inline('\\sum_{k=1}^{n} k')).toContain('<msubsup><mo largeop="true"');
    expect(display('\\int_0^1')).toContain('<msubsup>');
    expect(display('\\lim_{n \\to \\infty}')).toContain('<munder><mi mathvariant="normal">lim</mi>');
  });

  test('environments: matrices, cases, aligned', () => {
    const matrix = display('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}');
    expect(matrix).toContain('<mo fence="true" stretchy="true">(</mo><mtable');
    expect(matrix.match(/<mtr>/g)?.length).toBe(2);
    expect(matrix.match(/<mtd/g)?.length).toBe(4);

    const cases = display('|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}');
    expect(cases).toContain('<mo fence="true" stretchy="true">{</mo>');
    expect(cases).toContain('<mtext>otherwise</mtext>');
    expect(cases).toContain('text-align: left');

    const aligned = display('\\begin{aligned} f(x) &= (x+1)^2 \\\\ &= x^2 + 2x + 1 \\end{aligned}');
    expect(aligned.match(/<mtr>/g)?.length).toBe(2);
    expect(aligned).toContain('text-align: right');

    // Nested environments split only at their own level.
    const nested = display('\\begin{bmatrix} \\begin{pmatrix} a & b \\end{pmatrix} & c \\end{bmatrix}');
    expect(nested.match(/<mtable/g)?.length).toBe(2);
  });

  test('top-level line breaks become an aligned table', () => {
    expect(display('a &= b \\\\ c &= d')).toContain('<mtable');
  });

  test('fonts map to Unicode math alphabets', () => {
    expect(inline('\\mathbb{R}')).toContain('<mi>ℝ</mi>');
    expect(inline('\\mathbb{Z}^n')).toContain('ℤ');
    expect(inline('\\mathcal{L}')).toContain('<mi>ℒ</mi>');
    expect(inline('\\mathfrak{g}')).toContain('<mi>𝔤</mi>');
    expect(inline('\\mathbf{v}')).toContain('<mi>𝐯</mi>');
    expect(inline('\\mathrm{d}x')).toContain('<mi mathvariant="normal">d</mi>');
  });

  test('accents, delimiters, text, colour, negation', () => {
    expect(inline('\\hat{x}')).toContain('<mover accent="true"><mi>x</mi><mo stretchy="false">^</mo></mover>');
    expect(inline('\\vec{v}')).toContain('→');
    expect(inline('\\left( \\frac{1}{2} \\right)')).toContain('<mo fence="true" stretchy="true">(</mo>');
    expect(inline('\\left\\{ x \\right.')).not.toContain('stretchy="true"></mo>');
    expect(inline('\\text{if } x')).toContain('<mtext>if </mtext>');
    expect(inline('\\color{red}{x}')).toContain('<mstyle mathcolor="red">');
    expect(inline('\\color{"onload}{x}')).not.toContain('mathcolor');
    expect(inline('a \\not= b')).toContain('=\u0338');
    expect(inline('\\binom{n}{k}')).toContain('<mfrac linethickness="0">');
    expect(display('\\overbrace{a+b}^{n}')).toContain('<mover><mover>');
  });

  test('unknown and prototype-named commands are errors, output is escaped', () => {
    expect(inline('\\foo')).toContain('<merror><mtext>\\foo</mtext></merror>');
    expect(inline('\\constructor')).toContain('<merror>');
    expect(inline('\\toString')).toContain('<merror>');
    expect(inline('a < b')).toContain('<mo>&lt;</mo>');
    expect(inline('\\text{<script>}')).toContain('&lt;script&gt;');
  });

  test('extended engine passes unescaped LaTeX to the plugin', () => {
    const html = superMarkdownEngine.render('Matrix $\\begin{pmatrix} a & b \\end{pmatrix}$ and $a<b$.');
    expect(html.match(/<mtd/g)?.length).toBe(2);
    expect(html).toContain('<mo>&lt;</mo>');
  });

  test('math plugins can be replaced', () => {
    registerMathPlugin({ id: 'test-math', name: 'Test', render: latex => `<span class="test-math">${latex}</span>` }, true);
    expect(renderMathWithPlugin('x', false)).toBe('<span class="test-math">x</span>');
    registerMathPlugin({ id: 'broken-math', name: 'Broken', render: () => { throw new Error('boom'); } }, true);
    expect(renderMathWithPlugin('x<y', false)).toBe('<code class="markedit-math-source">x&lt;y</code>');
    setActiveMathPlugin('latex-mathml');
    expect(renderMathWithPlugin('x', false)).toContain('<math');
  });
});

describe('draw.io plugin', () => {
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
    <mxCell id="a" value="A &amp; B" style="rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell>
    <mxCell id="g" value="" style="group" vertex="1" parent="1"><mxGeometry x="200" y="100" width="200" height="100" as="geometry"/></mxCell>
    <mxCell id="b" value="&lt;b&gt;Inner&lt;/b&gt;" style="ellipse;html=1;fillColor=javascript:alert(1);" vertex="1" parent="g"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell>
    <mxCell id="e" value="label" style="endArrow=classic;strokeColor=#ff0000;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;

  test('renders vertices, groups and edges to SVG', () => {
    const svg = renderDrawioToSvg(xml) ?? '';
    expect(svg).toContain('<svg');
    expect(svg).toContain('A &amp; B');
    // Child of a group is offset by the group position: (200+10, 100+10).
    expect(svg).toContain('<ellipse cx="250" cy="130" rx="40" ry="20"');
    expect(svg).toContain('>Inner</tspan>');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('fill="#ff0000"/></marker>');
    // Unsafe colour values fall back to the default.
    expect(svg).not.toContain('javascript');
  });

  test('compressed diagrams are detected for async inflation', () => {
    expect(compressedDiagramPayload('<mxfile><diagram name="p">abc==</diagram></mxfile>')).toBe('abc==');
    expect(compressedDiagramPayload(`<mxfile><diagram>${xml}</diagram></mxfile>`)).toBeNull();
    const placeholder = renderDiagramWithPlugin('drawio', '<mxfile><diagram>abc</diagram></mxfile>') ?? '';
    expect(placeholder).toContain('is-pending');
    expect(renderDiagramWithPlugin('drawio', 'not xml') ?? '').toContain('is-error');
  });
});

describe('diagram plugin registry', () => {
  afterEach(() => {
    unregisterDiagramPlugin('test-graph');
    setDiagramServer('https://kroki.io');
  });

  test('built-in plugins cover the requested languages', () => {
    for (const lang of ['mermaid', 'plantuml', 'puml', 'd2', 'drawio']) {
      expect(hasDiagramPlugin(lang)).toBe(true);
    }
    expect(renderDiagramWithPlugin('python', 'x')).toBeNull();
  });

  test('extensions can register and override languages', () => {
    const plugin: DiagramPlugin = { id: 'test-graph', name: 'Test', languages: ['d2'], render: code => `<svg data-test="${code.length}"></svg>` };
    registerDiagramPlugin(plugin);
    expect(renderDiagramWithPlugin('D2', 'abc')).toBe('<svg data-test="3"></svg>');
    unregisterDiagramPlugin('test-graph');
    expect(renderDiagramWithPlugin('d2', 'abc')).toContain('data-diagram-plugin="d2"');
  });

  test('plugin exceptions become an error box with the source', () => {
    registerDiagramPlugin({ id: 'test-graph', name: 'Test', languages: ['testgraph'], render: () => { throw new Error('bad'); } });
    const html = renderDiagramWithPlugin('testgraph', '<b>') ?? '';
    expect(html).toContain('is-error');
    expect(html).toContain('&lt;b&gt;');
  });

  test('mermaid: quick offline drawing first, full rendering (mermaid.js / server) afterwards', () => {
    const flowchart = renderDiagramWithPlugin('mermaid', 'graph TD\nA-->B') ?? '';
    expect(flowchart).toContain('is-pending');
    expect(flowchart).toContain('markedit-diagram-output is-preliminary');
    expect(flowchart).toContain('<svg');

    const classDiagram = renderDiagramWithPlugin('mermaid', 'classDiagram\nA <|-- B') ?? '';
    expect(classDiagram).toContain('is-pending');
    expect(classDiagram).not.toContain('is-preliminary');

    // Server-only mode without a server: the built-in renderer is used directly.
    setDiagramRendering('server');
    setDiagramServer('');
    expect(renderDiagramWithPlugin('mermaid', 'graph TD\nA-->B') ?? '').not.toContain('is-pending');
    setDiagramRendering('auto');
  });

  test('diagram server accepts only http(s) URLs', () => {
    setDiagramServer('https://kroki.example.com/');
    expect(getDiagramServer()).toBe('https://kroki.example.com');
    setDiagramServer('javascript:alert(1)');
    expect(getDiagramServer()).toBeNull();
    setDiagramServer('');
    expect(getDiagramServer()).toBeNull();
  });

  test('hydration completes placeholders once', async () => {
    let calls = 0;
    registerDiagramPlugin({
      id: 'test-graph',
      name: 'Test',
      languages: ['testgraph'],
      render: (code, lang) => diagramPlaceholder('test-graph', lang, code),
      hydrate: async element => {
        calls += 1;
        await Promise.resolve();
        markDiagramRendered(element, '<svg class="done"></svg>');
      },
    });

    document.body.innerHTML = renderDiagramWithPlugin('testgraph', 'source') ?? '';
    await hydrateDiagrams(document.body);
    await hydrateDiagrams(document.body);
    expect(calls).toBe(1);
    expect(document.querySelector('.markedit-diagram.is-rendered svg.done')).not.toBeNull();
  });

  test('server-backed plugins explain how to enable them when offline', async () => {
    setDiagramServer('');
    document.body.innerHTML = renderDiagramWithPlugin('plantuml', '@startuml\nA -> B\n@enduml') ?? '';
    await hydrateDiagrams(document.body);
    const status = document.querySelector('.markedit-diagram.is-error .markedit-diagram-status')?.textContent ?? '';
    expect(status).toContain('local tools are only available in the desktop app');
    expect(status).toContain('no diagram server is set');
    expect(status).toContain('Diagram Rendering');
  });
});

describe('diagram and math samples', () => {
  const sampleDir = path.resolve(__dirname, '../../../docs/05-testing/samples');
  const source = fs.readFileSync(path.join(sampleDir, 'diagrams-and-math.md'), 'utf8');

  test.each([
    ['SuperMarkdown', (markdown: string) => new SuperMarkdownEngine().render(markdown)],
    ['Extended', (markdown: string) => superMarkdownEngine.render(markdown)],
  ])('%s renders every diagram block through a plugin', (_name, render) => {
    const html = render(source);
    for (const lang of ['mermaid', 'plantuml', 'puml', 'd2', 'drawio']) {
      expect(html).toContain(`data-diagram="${lang}"`);
    }
    // Uncompressed draw.io renders offline; compressed/PlantUML/D2/class diagram wait for hydration.
    expect(html).toContain('class="markedit-drawio"');
    // Mermaid ×3, PlantUML ×2, D2, compressed draw.io.
    expect(html.match(/is-pending/g)?.length).toBe(7);
    // Only the deliberate unknown command is an error.
    expect(html.match(/<merror>/g)?.length).toBe(1);
    expect(html).toContain('<mi>ℝ</mi>');
  });
});
