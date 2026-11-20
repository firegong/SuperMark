import { describe, expect, test } from '@jest/globals';
import { micromarkEngine, tamePathologicalInput } from '../src/modules/markdown-renderer/parsers/micromark';

describe('micromark parser', () => {
  test('renders CommonMark and GFM correctly where the line-based engine is lenient', () => {
    const html = micromarkEngine.render('- a\n\n1. one\n\n<http://auto.link>\n\nText[^n]\n\n[^n]: Note\n');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('<a href="http://auto.link">http://auto.link</a>');
    expect(html).toContain('<section class="markedit-preview-footnotes">');
  });

  test('raw HTML and unsafe links never reach the page', () => {
    const html = micromarkEngine.render('<script>alert(1)</script>\n\n[x](javascript:alert(1)) ![y](javascript:alert(2))');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
  });

  test('Korean heading ids', () => {
    expect(micromarkEngine.render('## 설계 문서')).toContain('id="설계-문서"');
  });

  test('a paragraph with a huge run of emphasis markers is rendered as text, in time', () => {
    const pathological = '*a_'.repeat(10000);
    const start = Date.now();
    const html = micromarkEngine.render(`# Title\n\n${pathological}\n\n**bold** stays bold\n\n\`\`\`\n*${'_'.repeat(4000)}\n\`\`\``);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(html).toContain('<strong>bold</strong>');
    // Code is never escaped.
    expect(html).toContain('_'.repeat(4000));
    expect(tamePathologicalInput('**a** _b_\n  - nested')).toBe('**a** _b_\n  - nested');
  });

  test('very deep nesting parses in time and keeps line numbers', () => {
    const deep = Array.from({ length: 400 }, (_, level) => `${'  '.repeat(level)}- item ${level}`).join('\n');
    const start = Date.now();
    const html = micromarkEngine.render(`${deep}\n\nafter`);
    expect(Date.now() - start).toBeLessThan(1500);
    expect(html).toContain('data-line="401"');
  });
});
