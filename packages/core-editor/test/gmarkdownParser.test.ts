import { describe, expect, test } from '@jest/globals';
import { gmarkdownEngine } from '../src/modules/markdown-renderer/formats';
import type { GmarkdownOptions } from '../src/modules/markdown-renderer/formats/gmarkdown';

/** gmarkdown Markdown, section by section of docs/reference/GMARKDOWN-SYNTAX.md. */

const render = (markdown: string, options?: GmarkdownOptions) => gmarkdownEngine.render(markdown, options);
const dom = (markdown: string, options?: GmarkdownOptions) => {
  const container = document.createElement('div');
  container.innerHTML = render(markdown, options);
  return container;
};

describe('gmarkdown §2 document header', () => {
  test('front matter and metadata comments are removed from the body and shown in a header panel', () => {
    const container = dom('---\nGSYNC:\n  server:\n    type: confluence\n---\n<!-- Space: MYSPACE -->\n\n<!-- Label: docs -->\n<!-- Not-A-Key: x -->\n# Title');
    expect(container.querySelector('.gmarkdown-header pre')?.textContent).toContain('type: confluence');
    expect(Array.from(container.querySelectorAll('.gmarkdown-header th')).map(th => th.textContent)).toEqual(['Space', 'Label']);
    // Scanning stops at the first non-metadata line, which is a plain comment (hidden).
    expect(container.textContent).not.toContain('Not-A-Key');
    expect(container.querySelector('h1')?.textContent).toContain('Title');
  });

  test('page-id comments do not show', () => {
    expect(dom('## 3. My Section\n<!-- page-id: 123456789 -->').textContent).not.toContain('page-id');
  });
});

describe('gmarkdown §3 headings', () => {
  test('ids: attribute block, Hangul kept, data-heading-level; no Setext headings', () => {
    const container = dom('## 3. 제품 개요 {#overview .chapter}\n\n### 3.1. 섹션 제목\n\nSetext\n===');
    const h2 = container.querySelector('h2') as HTMLElement;
    expect(h2.id).toBe('overview');
    expect(h2.classList.contains('chapter')).toBe(true);
    expect(h2.dataset.headingLevel).toBe('2');
    expect(container.querySelector('h3')?.id).toBe('31-섹션-제목');
    expect(container.querySelector('h1')).toBeNull();
  });
});

describe('gmarkdown §4 blocks', () => {
  test('every line break inside a paragraph is <br>; a trailing {…} styles the paragraph', () => {
    const container = dom('first line\nsecond line {.lead}\n\n[link](https://a.b){.external}');
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs[0].innerHTML).toBe('first line<br>second line');
    expect(paragraphs[0].classList.contains('lead')).toBe(true);
    // After a link's `)`, the braces belong to the link.
    expect(paragraphs[1].querySelector('a')?.classList.contains('external')).toBe(true);
  });

  test('a blank line ends a quote; lazy continuation lines join it', () => {
    const container = dom('> first\nlazy\n\n> second');
    expect(container.querySelectorAll('blockquote').length).toBe(2);
    expect(container.querySelector('blockquote')?.textContent).toContain('lazy');
  });

  test('lists: markers by depth, ordered start and type, tasks, blank line ends the list, no `1)`', () => {
    const container = dom('- [x] done\n- [ ] open\n  1. nested\n    - deeper\n\n3. three\n4. four\n\n1) not a list');
    const top = container.querySelector('ul') as HTMLElement;
    expect(top.dataset.marker).toBe('disc');
    expect(top.querySelectorAll('.markedit-preview-task-checkbox').length).toBe(2);
    expect(container.querySelector('ul ol')?.getAttribute('type')).toBe('A');
    expect((container.querySelector('ul ol ul') as HTMLElement).dataset.marker).toBe('square');
    expect(container.querySelectorAll(':scope > ol')[0].getAttribute('start')).toBe('3');
    expect(container.textContent).toContain('1) not a list');
  });

  test('fenced code: title from key="value" or MPE braces, indentation of the fence removed', () => {
    const container = dom('```c title="Code 5-1: Enum"\nint x;\n```\n\n  ```js{title="Inline"}\n  let y;\n  ```');
    const titles = Array.from(container.querySelectorAll('.gmarkdown-code-title')).map(element => element.textContent);
    expect(titles).toEqual(['Code 5-1: Enum', 'Inline']);
    expect(container.querySelectorAll('.markedit-preview-code-block')[1].textContent).toContain('let y;');
    expect(container.querySelectorAll('.markedit-preview-code-block')[1].querySelector('code')?.textContent).toBe('let y;');
  });

  test('tables: alignment and a {…} line for the table', () => {
    const table = dom('| 항목 | 값 |\n|:---|---:|\n| A | 1 |\n{.compact #tbl-api}').querySelector('table') as HTMLTableElement;
    expect(table.classList.contains('compact')).toBe(true);
    expect(table.id).toBe('tbl-api');
    expect(table.querySelector('td:last-child')?.getAttribute('style')).toBe('text-align: right');
  });

  test('captions: comment title, then `Table:` line, then MPE caption row (promoting the first row)', () => {
    const comment = dom('<!-- table title="Table 5-1: API" -->\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(comment.querySelector('.gmarkdown-table-caption')?.textContent).toBe('Table 5-1: API');

    const line = dom('Table: Results\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(line.querySelector('.gmarkdown-table-caption')?.textContent).toBe('Results');

    const mpe = dom('| Table 5-1: API Files |||\n|---|---|---|\n| **항목** | **파일명** | **설명** |\n| Server | a.lib | 서버 |');
    expect(mpe.querySelector('.gmarkdown-table-caption')?.textContent).toBe('Table 5-1: API Files');
    expect(Array.from(mpe.querySelectorAll('th')).map(th => th.textContent)).toEqual(['항목', '파일명', '설명']);
    expect(mpe.querySelectorAll('tbody tr').length).toBe(1);
  });

  test('merged cells: `>` and trailing empty cells widen, `^` joins the cell above', () => {
    const table = dom('| h1 | h2 | h3 |\n|---|---|---|\n| A | > | > |\n| B | C | D |\n| ^ | E | F |\n| G |||\n| &nbsp; | x | |').querySelector('tbody') as HTMLElement;
    const rows = table.querySelectorAll('tr');
    expect(rows[0].querySelector('td')?.getAttribute('colspan')).toBe('3');
    expect(rows[1].querySelector('td')?.getAttribute('rowspan')).toBe('2');
    expect(rows[2].querySelectorAll('td').length).toBe(2);
    expect(rows[3].querySelector('td')?.getAttribute('colspan')).toBe('3');
    // `&nbsp;` keeps a cell; the last empty cell joins `x`.
    expect(rows[4].querySelectorAll('td').length).toBe(2);
  });

  test('cells: lists, separators, escapes and `!` nested tables', () => {
    const container = dom('| 항목 | 내용 |\n|---|---|\n| 설정 | - 옵션 A <br> - [x] 옵션 B <br> --- <br> \\- 그대로 |\n| Init | ! 이름 ! 타입 ! <br> ! --- ! --- ! <br> ! id ! int ! |');
    const cells = container.querySelectorAll('tbody td');
    expect(cells[1].querySelectorAll('ul li').length).toBe(2);
    expect(cells[1].querySelector('.markedit-preview-task-checkbox')).not.toBeNull();
    expect(cells[1].querySelector('hr.cell-sep')).not.toBeNull();
    expect(cells[1].textContent).toContain('- 그대로');
    expect(cells[3].querySelector('table.gmarkdown-nested-table th')?.textContent).toBe('이름');
  });

  test('containers with title and attributes, nested; code tabs', () => {
    const container = dom('::: warning 배포 전 확인 {#pre-deploy}\n본문\n::: tip\ninner\n:::\n:::\n\n::: code-tabs\n@tab C\n```c\nint x = 0;\n```\n@tab Python\n```python\nx = 0\n```\n:::');
    const warning = container.querySelector('.container-warning') as HTMLElement;
    expect(warning.id).toBe('pre-deploy');
    expect(warning.querySelector('.container-title')?.textContent).toBe('배포 전 확인');
    expect(warning.querySelector('.container-tip')?.textContent).toContain('inner');
    expect(Array.from(container.querySelectorAll('.msm-tab-button')).map(button => button.textContent)).toEqual(['C', 'Python']);
  });

  test('collapsible `???` blocks, definition lists, footnotes', () => {
    const container = dom('??? note "자세히 보기"\n    접힌 내용\n\n용어\n:   정의 내용\n\n본문[^1] 끝.\n\n[^1]: 각주 내용');
    const details = container.querySelector('details.admonition-note') as HTMLElement;
    expect(details.querySelector('summary')?.textContent).toBe('자세히 보기');
    expect(details.textContent).toContain('접힌 내용');
    expect(container.querySelector('dl dt')?.textContent).toBe('용어');
    expect(container.querySelector('dl dd')?.textContent).toBe('정의 내용');
    expect(container.querySelector('.markedit-preview-footnotes li')?.textContent).toContain('각주 내용');
  });

  test('raw HTML blocks are sanitized; comments do not show', () => {
    const container = dom('<div class="box">\n<b>bold</b><script>alert(1)</script>\n</div>\n\n<!-- hidden\ncomment -->');
    expect(container.querySelector('.box b')?.textContent).toBe('bold');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('hidden');
  });
});

describe('gmarkdown §5 inline', () => {
  test('emphasis, strikethrough, escapes and intraword underscores', () => {
    const html = render('***both*** **bold** *it* ~~del~~ snake_case_name \\*not\\*');
    expect(html).toContain('<strong><em>both</em></strong>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<del>del</del>');
    expect(html).toContain('snake_case_name');
    expect(html).toContain('*not*');
  });

  test('images with width and caption, links, wiki links, @ref', () => {
    const container = dom('## 3. 개요 {#overview}\n\n![Figure: Auth](auth.png){width=480 caption="인증 흐름"} [[guide#설치 방법|Guide]] [[toc]] @ref(overview)');
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('style')).toContain('width: 480px');
    expect(image.title).toBe('인증 흐름');
    const wiki = container.querySelector('a.wiki-link') as HTMLAnchorElement;
    expect(wiki.getAttribute('href')).toBe('guide.md#설치-방법');
    expect(wiki.textContent).toBe('Guide');
    expect(container.textContent).toContain('[[toc]]');
    const ref = container.querySelector('a.cross-ref') as HTMLAnchorElement;
    expect(ref.getAttribute('href')).toBe('#overview');
    expect(ref.textContent).toBe('3. 개요');
  });

  test('autolinks, bare URLs, e-mail, and typography outside code', () => {
    const html = render('<https://a.b> see https://example.com/x. mail user@example.com wait... a -- b --- c `--verbose`');
    expect(html).toContain('<a href="https://a.b">https://a.b</a>');
    expect(html).toContain('<a href="https://example.com/x">https://example.com/x</a>.');
    expect(html).toContain('<a href="mailto:user@example.com">');
    expect(html).toContain('wait&hellip;');
    expect(html).toContain('a &ndash; b &mdash; c');
    expect(html).toContain('<code class="markedit-preview-code">--verbose</code>');
  });

  test('unsafe links and images never reach the page', () => {
    const html = render('[x](javascript:alert(1)) ![y](javascript:alert(2)) ![ok](data:image/png;base64,AAAA)');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });
});

describe('gmarkdown §7–9', () => {
  test('math: inline, block and one-line display; `*` inside math is not emphasis', () => {
    const container = dom('에너지 $E = m*c*2$ 이다.\n\n$$\n\\int x\n$$\n\n$$ y $$');
    expect(container.querySelectorAll('math').length).toBe(3);
    expect(container.querySelector('em')).toBeNull();
  });

  test('alerts: case-insensitive marker, title text stays as the first line', () => {
    const container = dom('> [! note ] 섹션 분리 규칙\n>\n> 본문');
    const alert = container.querySelector('.gh-alert-note') as HTMLElement;
    expect(alert.querySelector('.markedit-preview-alert-title')?.textContent).toBe('NOTE');
    expect(alert.querySelector('.markedit-preview-alert-content p')?.textContent).toBe('섹션 분리 규칙');
  });

  test('abbreviations: definitions removed, words wrapped, longest first, not in code', () => {
    const html = render('*[HTML]: HyperText Markup Language\n*[HTML5]: HTML version 5\n\nHTML and HTML5, not XHTML, `HTML`.\n\n```\n*[X]: kept in code\n```');
    expect(html).toContain('<abbr title="HyperText Markup Language">HTML</abbr> and <abbr title="HTML version 5">HTML5</abbr>');
    expect(html).toContain('XHTML');
    expect(html).not.toContain('XHTML</abbr>');
    expect(html).toContain('<code class="markedit-preview-code">HTML</code>');
    expect(html).toContain('*[X]: kept in code');
  });

  test('@import: Markdown (front matter removed), CSV as a table, other files as code, failures shown', () => {
    const files: Record<string, string> = {
      'chapter2.md': '---\ntitle: x\n---\n## 2. 장 {#ch2}\n@import "nested.md"',
      'nested.md': 'nested text',
      'data.csv': 'name,value\n"a, b",1',
      'example.py': 'print(1)',
      'loop.md': '@import "loop.md"',
    };
    const options: GmarkdownOptions = { documentPath: '/docs/main.md', includeResolver: path => files[path] ?? null };
    const container = dom('@import "chapter2.md"\n\n@import "data.csv"\n\n@import "example.py"\n\n@import "missing.md"\n\n@import "loop.md"\n\n```\n@import "x.md"\n```', options);
    expect(container.querySelector('h2')?.id).toBe('ch2');
    expect(container.textContent).toContain('nested text');
    expect(container.textContent).not.toContain('title: x');
    expect(container.querySelector('td')?.textContent).toBe('a, b');
    expect(container.querySelector('[data-language="py"]')?.textContent).toContain('print(1)');
    const notices = Array.from(container.querySelectorAll('.msm-notice')).map(element => element.textContent);
    expect(notices).toEqual(['@import "missing.md": file not found', '@import "loop.md": circular import']);
    expect(container.textContent).toContain('@import "x.md"');
  });

  test('diagrams: PlantUML and Graphviz become diagrams with a caption; Mermaid stays code', () => {
    const container = dom('```plantuml title="Figure 3-1: Arch"\n@startuml\nA -> B\n@enduml\n```\n\n```dot\ndigraph { a -> b }\n```\n\n```mermaid\ngraph TD\n```');
    expect(container.querySelectorAll('.gmarkdown-diagram').length).toBe(2);
    expect(container.querySelector('.gmarkdown-figure-caption')?.textContent).toBe('Figure 3-1: Arch');
    expect(container.querySelector('[data-language="mermaid"]')).not.toBeNull();
  });
});
