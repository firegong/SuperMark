import { describe, expect, test } from '@jest/globals';
import { superMarkdownEngine } from '../src/modules/markdown-renderer/formats';

describe('SuperMarkdown metadata keys in any script', () => {
  test('YAML front matter with Korean keys is shown and its variables are substituted', () => {
    const html = superMarkdownEngine.render('---\n제목: 설계서\nversion: 2\n---\n\n문서: {{제목}} v{{version}} {{없음}}');
    expect(html).toContain('<th>제목</th><td>설계서</td>');
    expect(html).toContain('문서: 설계서 v2');
    expect(html).toContain('title="Undefined variable: 없음"');
  });

  test('MultiMarkdown metadata with Korean keys', () => {
    const html = superMarkdownEngine.render('제목: 메모\n작성자: 홍길동\n\n{{작성자}}의 {{제목}}');
    expect(html).toContain('홍길동의 메모');
  });
});
