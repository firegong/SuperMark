import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, jest, test } from '@jest/globals';
import { SuperMarkdownEngine } from '../src/modules/markdown-renderer/parsers/markdownSuperSet/engine';
import { parseCodeInfo, parseAttributes } from '../src/modules/markdown-renderer/parsers/markdownSuperSet/attributes';
import { sanitizeHtml } from '../src/modules/markdown-renderer/core/htmlSanitizer';
import {
  listMarkdownRenderers,
  setActiveMarkdownRenderer,
  renderMarkdown,
  getMarkdownSyntaxStandard,
} from '../src/modules/markdown-renderer';
import { toggleTaskMarker } from '../src/chrome/markdownPreview';
import type { SuperMarkdownOptions } from '../src/modules/markdown-renderer/parsers/markdownSuperSet/context';

const engine = new SuperMarkdownEngine();
const render = (markdown: string, options?: SuperMarkdownOptions) => engine.render(markdown, options);

describe('SuperMarkdown engine selection', () => {
  test('is registered and selectable', () => {
    expect(listMarkdownRenderers().map(item => item.id)).toContain('super');
    setActiveMarkdownRenderer('super');
    expect(getMarkdownSyntaxStandard()).toBe('super');
    expect(renderMarkdown('H~2~O')).toContain('<sub>2</sub>');
    setActiveMarkdownRenderer('extended');
  });
});

describe('SuperMarkdown: headings (§1)', () => {
  test('explicit MMD id and unicode auto id', () => {
    const html = render('## 소개 [#intro]\n\n## 자동 ID 제목');
    expect(html).toContain('<h2 id="intro"');
    expect(html).not.toContain('[#intro]');
    expect(html).toContain('id="자동-id-제목"');
  });

  test('duplicate auto ids are made unique', () => {
    const html = render('# A\n\n# A');
    expect(html).toContain('id="a"');
    expect(html).toContain('id="a-1"');
  });

  test('setext headings', () => {
    expect(render('Title\n=====')).toContain('<h1');
    expect(render('Sub\n---')).toContain('<h2');
  });

  test('closing hashes are removed', () => {
    expect(render('## Title ##')).toContain('>Title</h2>');
  });
});

describe('SuperMarkdown: inline formatting (§2)', () => {
  test.each([
    ['*a*', '<em>a</em>'],
    ['_a_', '<em>a</em>'],
    ['**a**', '<strong>a</strong>'],
    ['***a***', '<strong><em>a</em></strong>'],
    ['~~a~~', '<del>a</del>'],
    ['H~2~O', 'H<sub>2</sub>O'],
    ['x^2^', 'x<sup>2</sup>'],
    ['[a]{.underline}', '<u>a</u>'],
    ['==a==', '<mark>a</mark>'],
    ['\\*a\\*', '*a*'],
  ])('%s', (source, expected) => {
    expect(render(source)).toContain(expected);
  });

  test('intraword underscores stay literal', () => {
    expect(render('snake_case_name')).not.toContain('<em>');
  });

  test('sub/superscript require no spaces', () => {
    expect(render('a ~b c~ d')).not.toContain('<sub>');
    expect(render('a ^b c^ d')).not.toContain('<sup>');
  });

  test('markers inside code spans and URLs are not interpreted', () => {
    const html = render('`a_b_c` and [x](https://ex.com/a_b_c?a=1&b=2)');
    expect(html).toContain('<code class="markedit-preview-code">a_b_c</code>');
    expect(html).toContain('href="https://ex.com/a_b_c?a=1&amp;b=2"');
    expect(html).not.toContain('<em>');
  });

  test('hard line breaks', () => {
    expect(render('a\\\nb')).toContain('a<br>');
    expect(render('a  \nb')).toContain('a<br>');
  });
});

describe('SuperMarkdown: lists (§3, §30)', () => {
  test('ordered list keeps start number', () => {
    expect(render('5. a\n6. b')).toContain('<ol class="markedit-preview-list" start="5">');
  });

  test('extended task states', () => {
    const html = render('- [ ] a\n- [/] b\n- [x] c\n- [X] d\n- [-] e');
    expect(html).toContain('is-todo');
    expect(html).toContain('is-doing');
    expect(html.match(/checkbox is-done/g)?.length).toBe(2);
    expect(html).toContain('is-cancelled');
    expect(html.match(/ checked/g)?.length).toBe(2);
  });

  test('nested items keep absolute source line numbers', () => {
    const html = render('---\ntitle: x\n---\n- top\n  - [ ] nested');
    expect(html).toContain('data-line="4" data-state=" "');
  });

  test('definition list', () => {
    const html = render('Term\n: Definition one\n: Definition two');
    expect(html).toContain('<dl class="msm-definition-list">');
    expect(html).toContain('<dd>Definition one</dd>');
    expect(html).toContain('<dd>Definition two</dd>');
  });

  test('example lists and references', () => {
    const html = render('(@a) first\n(@b) second\n\nSee (@b).');
    expect(html).toContain('msm-example-list');
    expect(html).toContain('<span class="msm-example-ref">(2)</span>');
  });

  test('toggleTaskMarker flips open and non-open states', () => {
    expect(toggleTaskMarker('- [ ] a')).toBe('- [x] a');
    expect(toggleTaskMarker('- [x] a')).toBe('- [ ] a');
    expect(toggleTaskMarker('  1. [/] a')).toBe('  1. [ ] a');
    expect(toggleTaskMarker('- [-] a [x](link)')).toBe('- [ ] a [x](link)');
    expect(toggleTaskMarker('plain [ ] text')).toBeNull();
  });
});

describe('SuperMarkdown: code and chunks (§4, §13–15)', () => {
  test('info string parsing', () => {
    expect(parseCodeInfo('python caption="예시 코드" label=lst:hello')).toMatchObject({ lang: 'python', braced: false });
    const chunk = parseCodeInfo('{python run label=calc caption=계산 예시}');
    expect(chunk).toMatchObject({ lang: 'python', braced: true, run: true, render: false });
    expect(chunk.attributes.values.get('caption')).toBe('계산 예시');
    expect(chunk.attributes.values.get('label')).toBe('calc');
    expect(parseCodeInfo('{=latex}').rawFormat).toBe('latex');
    expect(parseAttributes('.warning #x title="a b"')).toMatchObject({ id: 'x', classes: ['warning'] });
  });

  test('code caption and listing label', () => {
    const html = render('```python caption=예시 label=lst:hello\nprint(1)\n```\n\nSee [#lst:hello].');
    expect(html).toContain('목록 1:</span> 예시');
    expect(html).toContain('<a class="msm-xref" href="#lst:hello">목록 1</a>');
  });

  test('run chunks only execute with execute: true', () => {
    const source = '```{python run}\n#| echo: false\nprint(1)\n```';
    const runner = jest.fn((_lang: string, _code: string, _options: Map<string, string>) => '1');
    const off = render(source, { codeRunner: runner });
    expect(runner).not.toHaveBeenCalled();
    expect(off).toContain('markedit-preview-code-block');
    expect(off).not.toContain('msm-output');

    const on = render(`---\nexecute: true\n---\n${source}`, { codeRunner: runner });
    expect(runner).toHaveBeenCalledWith('python', 'print(1)', expect.any(Map));
    expect(on).toContain('<pre class="msm-output"><code>1</code></pre>');
    expect(on).not.toContain('markedit-preview-code-copy');
  });

  test('run chunk without runner shows a notice', () => {
    expect(render('---\nexecute: true\n---\n```{python run}\nprint(1)\n```')).toContain('msm-notice');
  });

  test('raw blocks', () => {
    expect(render('```{=latex}\n\\newpage\n```')).toBe('');
    expect(render('```{=html}\n<b onclick="x()">hi</b>\n```')).toContain('<b>hi</b>');
    const rawMermaid = render('```{=mermaid}\ngraph TD\nA-->B\n```');
    expect(rawMermaid).toContain('markedit-preview-code-block');
    expect(rawMermaid).not.toContain('<svg');
  });

  test('static mermaid renders, render chunk honours echo and figure label', () => {
    expect(render('```mermaid\ngraph TD\nA-->B\n```')).toContain('<svg');
    const html = render('---\nexecute: true\n---\n```{mermaid render caption="흐름" label=fig:flow}\n#| echo: true\ngraph TD\nA-->B\n```\n\n[#fig:flow]');
    expect(html).toContain('markedit-preview-code-block');
    expect(html).toContain('<figure class="msm-figure" id="fig:flow">');
    expect(html).toContain('그림 1:</span> 흐름');
    expect(html).toContain('>그림 1</a>');
  });

  test('plantuml uses diagramRenderer when provided', () => {
    const diagramRenderer = jest.fn((_lang: string, _code: string, _options: Map<string, string>) => '<svg id="puml"></svg>');
    const html = render('```plantuml\n@startuml\nA -> B\n@enduml\n```', { diagramRenderer });
    expect(html).toContain('<svg id="puml"></svg>');
  });

  test('indented code', () => {
    expect(render('    code line')).toContain('<code>code line</code>');
  });
});

describe('SuperMarkdown: quotes, callouts, breaks (§5, §17, §22)', () => {
  test('nested blockquote', () => {
    expect(render('> a\n>> b').match(/<blockquote/g)?.length).toBe(2);
  });

  test('callout types, titles and folding', () => {
    const plain = render('> [!NOTE] 제목\n> body');
    expect(plain).toContain('msm-callout is-note');
    expect(plain).toContain('제목');
    expect(render('> [!tip]+ t\n> b')).toContain('<details class="markedit-preview-alert msm-callout is-tip msm-callout-tip" data-callout="tip" open>');
    expect(render('> [!bug]- t\n> b')).not.toContain(' open>');
    expect(render('> [!question]\n> b')).toContain('>Question</div>');
  });

  test('nested callouts', () => {
    expect(render('> [!NOTE] outer\n> > [!TIP] inner\n> > text').match(/msm-callout /g)?.length).toBe(2);
  });

  test('page breaks are exact', () => {
    expect(render('<!-- pb -->')).toContain('msm-pagebreak');
    expect(render('<!-- pagebreak -->')).toContain('msm-pagebreak');
    expect(render('<!-- pb later -->')).toBe('');
  });
});

describe('SuperMarkdown: links (§6)', () => {
  test('reference, autolink, bare URL', () => {
    const html = render('[a][r] [r] <https://x.dev> https://y.dev/path.\n\n[r]: https://ref.dev "T"');
    expect(html.match(/href="https:\/\/ref.dev" title="T"/g)?.length).toBe(2);
    expect(html).toContain('<a href="https://x.dev">');
    expect(html).toContain('<a href="https://y.dev/path">https://y.dev/path</a>.');
  });

  test('wiki links and embeds', () => {
    const html = render('[[Doc]] [[Doc|alias]] [[Doc#My Heading]] [[#^blk]] ![[img.png|300]]');
    expect(html).toContain('href="Doc.md"');
    expect(html).toContain('>alias</a>');
    expect(html).toContain('href="Doc.md#my-heading"');
    expect(html).toContain('href="#blk"');
    expect(html).toContain('<img src="img.png" alt="img.png" style="width: 300px;"');
  });

  test('image size attributes', () => {
    expect(render('![a](b.png){width=50%}')).toContain('style="width: 50%;"');
    expect(render('![a](b.png){width=expression(1)}')).not.toContain('style=');
  });

  test('unsafe URLs are not linked, including control-character prefixes', () => {
    expect(render('[x](javascript:alert(1))')).not.toContain('href');
    expect(render('[x](\u0001javascript:alert(1))')).not.toContain('href');
    expect(render('[x](JaVaScRiPt:alert(1))')).not.toContain('href');
    expect(render('<javascript:alert(1)>')).not.toContain('href');
  });
});

describe('SuperMarkdown: tables (§7, §12, §18)', () => {
  test('merge markers', () => {
    const html = render('| 구분 | 측정 | < |\n|---|---|---|\n| 속도 | 1회차 | 10 |\n| ^ | 2회차 | 12 |');
    expect(html).toContain('<th colspan="2">측정</th>');
    expect(html).toContain('<td rowspan="2">속도</td>');
    expect(html).not.toContain('>^<');
  });

  test('right merge and multi-row headers', () => {
    const html = render('| > | A |\n| x | y |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<th colspan="2">A</th>');
    expect(html.match(/<tr[ >]/g)?.length).toBe(3);
  });

  test('merging across the header separator is an error', () => {
    const html = render('| a |\n|---|\n| ^ |');
    expect(html).toContain('msm-error');
  });

  test('escaped markers and pipes are literal', () => {
    const html = render('| a | b | c |\n|---|---|---|\n| \\^ | \\< | `x \\| y` |');
    expect(html).toContain('<td>^</td>');
    expect(html).toContain('<td>&lt;</td>');
    expect(html).toContain('x | y');
  });

  test('table caption and label', () => {
    const html = render('| a |\n|---|\n| 1 |\n[Table: 캡션] [#tbl:x]\n\n[#tbl:x]');
    expect(html).toContain('<caption class="msm-caption"><span class="msm-caption-label">표 1:</span> 캡션</caption>');
    expect(html).toContain('>표 1</a>');
  });

  test('table cell checkboxes', () => {
    const html = render('| a | b |\n|---|---|\n| x | [x] |\n| y | [/] |');
    expect(html).toContain('msm-checkbox is-done');
    expect(html).toContain('msm-checkbox is-doing');
  });

  test('grid table with multi-line cell and wide characters', () => {
    const html = render('+------+------+\n| 과일 | 설명 |\n+======+======+\n| 사과 | - a  |\n|      | - b  |\n+------+------+');
    expect(html).toContain('<th>과일</th>');
    expect(html).toContain('<td>사과</td>');
    expect(html.match(/<li /g)?.length).toBe(2);
  });

  test('a lone pipe line does not hang', () => {
    expect(render('| a')).toContain('| a');
    expect(render('text\n| a')).toContain('| a');
  });
});

describe('SuperMarkdown: math, footnotes, citations, metadata (§8, §20, §23)', () => {
  test('numbered equation and reference', () => {
    const html = render('$$\nE = mc^2\n$$ [#eq:energy]\n\n식 [#eq:energy]');
    expect(html).toContain('id="eq:energy"');
    expect(html).toContain('<span class="msm-equation-number">(1)</span>');
    expect(html).toContain('식 <a class="msm-xref" href="#eq:energy">(1)</a>');
  });

  test('%% inside math is not a comment', () => {
    const html = render('a $x %% y$ b %%hidden%% c');
    expect(html).not.toContain('hidden');
    expect(html).toContain('<math');
  });

  test('footnotes with multi-paragraph definitions', () => {
    const html = render('Text[^n].\n\n[^n]: First.\n\n    Second.\n\nAfter.');
    expect(html).toContain('<a href="#fn-n" id="fnref-n">1</a>');
    expect(html).toContain('First.');
    expect(html).toContain('Second.');
    expect(html.indexOf('After.')).toBeLessThan(html.indexOf('msm-footnotes'));
  });

  test('citations but not e-mails', () => {
    const html = render('[@doe2020] and @knuth, mail a@b.com');
    expect(html).toContain('data-cite="doe2020"');
    expect(html).toContain('data-cite="knuth"');
    expect(html).not.toContain('data-cite="b.com"');
  });

  test('MMD metadata and variables', () => {
    const html = render('Title: 설계서\nVersion: 1.2\n\n{{title}} v{{ version }} {{missing}}');
    expect(html).toContain('설계서 v1.2');
    expect(html).toContain('<span class="msm-error" title="Undefined variable: missing">');
  });

  test('variables are not substituted in code', () => {
    expect(render('---\nk: v\n---\n`{{k}}`')).toContain('{{k}}');
  });

  test('a reference does not repeat the word written before it', () => {
    const html = render('$$\nE = mc^2\n$$ [#eq:e]\n\n식 [#eq:e]에 따라, [#eq:e] 참조, 수식 [#eq:e]');
    expect(html).toContain('식 <a class="msm-xref" href="#eq:e">(1)</a>에');
    expect(html).toContain(', <a class="msm-xref" href="#eq:e">식 (1)</a> 참조');
    expect(html).toContain('수식 <a class="msm-xref" href="#eq:e">(1)</a>');
  });

  test('section cross references use hierarchical numbers', () => {
    const html = render('# A\n\n## B [#sec:b]\n\n# C\n\n## D [#sec:d]\n\n[#sec:d]');
    expect(html).toContain('>2.1절</a>');
  });

  test('duplicate and undefined labels are errors', () => {
    const html = render('## A [#sec:x]\n\n## B [#sec:x]\n\n[#nope]');
    expect(html).toContain('title="Duplicate label"');
    expect(html).toContain('title="Undefined reference"');
  });
});

describe('SuperMarkdown: HTML, comments, tags, block refs (§9, §10)', () => {
  test('raw HTML is filtered', () => {
    const html = render('<div onclick="x()" class="a markedit-chrome-modal">ok</div>\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> <a href="javascript:x">l</a>');
    expect(html).toContain('<div class="a">ok</div>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/onerror|onclick|javascript:x"/);
  });

  test('sanitizeHtml drops comments and entity-encoded javascript URLs', () => {
    expect(sanitizeHtml('<!-- c --><a href="jav&#x61;script:x">a</a>')).toBe('<a>a</a>');
    expect(sanitizeHtml('<svg><animate attributeName="href" to="javascript:x"/></svg>')).toContain('&lt;animate');
  });

  test('obsidian comments', () => {
    expect(render('%%\nhidden\n%%\n\nvisible')).not.toContain('hidden');
  });

  test('tags', () => {
    const html = render('#notag and #tag and #123 and #a/b');
    expect(html).not.toContain('>#notag<');
    expect(html).toContain('<span class="msm-tag">#tag</span>');
    expect(html).not.toContain('>#123<');
    expect(html).toContain('<span class="msm-tag">#a/b</span>');
  });

  test('block reference id', () => {
    expect(render('Paragraph text ^blk1')).toContain('id="blk1">Paragraph text</p>');
  });
});

describe('SuperMarkdown: divs, tabs, TOC, includes, keys (§16–29)', () => {
  test('fenced div with attributes and nesting', () => {
    const html = render('::::{.outer}\n:::{.warning title=주의}\n본문\n:::\n::::');
    expect(html).toContain('msm-div outer');
    expect(html).toContain('msm-div warning');
    expect(html).toContain('<div class="msm-div-title">주의</div>');
  });

  test('conditional blocks', () => {
    const html = render(':::{.only-html}\nH\n:::\n\n:::{.only-latex}\nL\n:::');
    expect(html).toContain('>H</p>');
    expect(html).not.toContain('>L</p>');
  });

  test('::: inside code blocks is ignored', () => {
    const html = render(':::{.box}\n```\n:::\n```\nafter\n:::');
    expect(html).toContain('<code>:::</code>');
    expect(html).toContain('>after</p>');
  });

  test('tab sets', () => {
    const html = render('::::{.tabset}\n:::{.tab title=Python}\nA\n:::\n:::{.tab title=R}\nB\n:::\n::::');
    expect(html.match(/msm-tab-button/g)?.length).toBe(2);
    expect(html).toContain('>Python</button>');
    expect(html.match(/msm-tab-panel/g)?.length).toBe(2);
  });

  test('table of contents', () => {
    const html = render('[TOC depth=2]\n\n# A\n\n## B\n\n### C');
    expect(html).toContain('<a href="#a">A</a>');
    expect(html).toContain('<a href="#b">B</a>');
    expect(html).not.toContain('<a href="#c">C</a>');
    expect(render('text [TOC] text')).not.toContain('msm-toc');
  });

  test('includes with resolver, nesting and cycle detection', () => {
    const files: Record<string, string> = {
      'a.md': 'From A\n\n@include b.md',
      'b.md': 'From B\n\n@include a.md',
    };
    const html = render('@include a.md', { includeResolver: file => files[file] ?? null, documentPath: 'main.md' });
    expect(html).toContain('From A');
    expect(html).toContain('From B');
    expect(html).toContain('circular include');
    expect(render('@include x.md')).toContain('not available');
    expect(render('```\n@include x.md\n```')).toContain('@include x.md</code>');
  });

  test('keyboard keys', () => {
    const html = render('[Ctrl]+[S], [link](u), [ref][], [1], [ ]');
    expect(html).toContain('<kbd class="msm-kbd">Ctrl</kbd>+<kbd class="msm-kbd">S</kbd>');
    expect(html).toContain('<a href="u">link</a>');
    expect(html).not.toContain('<kbd class="msm-kbd">1</kbd>');
  });
});

describe('Extended engine regression', () => {
  test('a lone pipe line does not hang the default engine', () => {
    setActiveMarkdownRenderer('extended');
    expect(renderMarkdown('| a')).toContain('| a');
    expect(renderMarkdown('| a | b |\nplain')).toContain('plain');
  });

  test('data-line stays absolute for front matter, nested lists and quotes', () => {
    setActiveMarkdownRenderer('extended');
    const html = renderMarkdown('---\ntitle: x\n---\n- [ ] a\n- top\n  - [ ] nested\n\n> quoted');
    expect(html).toContain('data-line="3"');
    expect(html).toContain('class="markedit-preview-task-checkbox" data-line="5"');
    expect(html).toContain('data-line="7">quoted');
  });

  test('javascript: URLs with control-character prefixes are rejected', () => {
    setActiveMarkdownRenderer('extended');
    expect(renderMarkdown('[x](\u0001javascript:alert%281%29)')).not.toContain('href');
    expect(renderMarkdown('[x]( JAVASCRIPT:alert)')).not.toContain('href');
  });
});

describe('SuperMarkdown: sample document', () => {
  test('renders the bundled sample without unexpected errors', () => {
    const sampleDir = path.resolve(__dirname, '../../../docs/05-testing/samples');
    const source = fs.readFileSync(path.join(sampleDir, 'supermarkdown-sample.md'), 'utf8');
    const html = render(source, { includeResolver: file => fs.readFileSync(path.join(sampleDir, file), 'utf8') });

    // Only the two deliberate errors in the last section.
    expect(html.match(/class="msm-error"/g)?.length).toBe(2);
    expect(html).toContain('포함된 장: 소개');
    expect(html).not.toMatch(/<script|onclick=/);
  });

  test('handles CRLF documents', () => {
    expect(render('# A\r\n\r\n- [ ] b\r\n')).toContain('data-line="2"');
  });
});
