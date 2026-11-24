import { describe, expect, test } from '@jest/globals';
import { hangulFallbacks, installBundledFonts, monospaceStack, sansStack, withHangulFallbacks } from '../src/styling/fonts';
import { previewThemePresets } from '../src/chrome/previewThemePresets';

const families = (stack: string) => stack.split(',').map(family => family.trim().replace(/^['"]|['"]$/g, ''));
const generics = new Set(['monospace', 'sans-serif', 'serif', 'system-ui']);

/** Hangul fonts must come before any generic family: Windows falls back to bitmap Gulim fonts. */
function expectHangulBeforeGenerics(stack: string) {
  const list = families(stack);
  const hangul = list.indexOf('Pretendard Variable');
  const generic = list.findIndex(family => generics.has(family));
  expect(hangul).toBeGreaterThan(-1);
  if (generic !== -1) {
    expect(hangul).toBeLessThan(generic);
  }
}

describe('Font stacks', () => {
  test('every stack names a Hangul font before generic families', () => {
    expectHangulBeforeGenerics(monospaceStack);
    expectHangulBeforeGenerics(sansStack);
    for (const [id, preset] of Object.entries(previewThemePresets)) {
      for (const stack of [preset.fonts.body, preset.fonts.code, preset.fonts.heading ?? preset.fonts.body]) {
        expect(`${id}: ${stack}`).toContain('Pretendard Variable');
        expectHangulBeforeGenerics(stack);
      }
    }
  });

  test('monospace stacks keep a Latin monospace font before the Hangul fonts', () => {
    // The Hangul fonts also have Latin letters; they must not replace the monospace ones.
    const list = families(monospaceStack);
    expect(list.indexOf('Consolas')).toBeLessThan(list.indexOf('Pretendard Variable'));
    expect(list.indexOf('Cascadia Mono')).toBeLessThan(list.indexOf('Pretendard Variable'));
  });

  test('withHangulFallbacks inserts before the generic family, once', () => {
    expect(withHangulFallbacks('Georgia, serif')).toBe(`Georgia, ${hangulFallbacks}, serif`);
    expect(withHangulFallbacks("'Fira Code'")).toBe(`'Fira Code', ${hangulFallbacks}`);
    expect(withHangulFallbacks('ui-monospace, Consolas, monospace')).toBe(`ui-monospace, Consolas, ${hangulFallbacks}, monospace`);
    const once = withHangulFallbacks('Arial, sans-serif');
    expect(withHangulFallbacks(once)).toBe(once);
  });

  test('the bundled font is registered once, from the fonts folder next to index.html', () => {
    installBundledFonts();
    installBundledFonts();
    const styles = document.querySelectorAll('#markedit-bundled-fonts');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain("font-family: 'Pretendard Variable'");
    expect(styles[0].textContent).toContain("url('fonts/PretendardVariable.woff2')");
  });
});
