/**
 * Font stacks with good Korean (Hangul) glyphs on every platform.
 *
 * On Windows, Chromium (WebView2) falls back to GulimChe/Gulim for Hangul when a stack reaches a
 * generic family (`monospace`, `sans-serif`) first; those fonts draw small sizes from embedded
 * bitmaps, so text looks jagged. Every stack therefore names a Hangul font before the generic
 * family: Apple SD Gothic Neo on macOS (unchanged look there), then the bundled Pretendard
 * (dist/fonts, OFL-1.1, a macOS-like design) and Malgun Gothic as a last resort.
 */

/** Bundled with the app (copied to dist/fonts by vite.config.mts). */
export const bundledFontFamily = 'Pretendard Variable';
export const bundledFontUrl = 'fonts/PretendardVariable.woff2';

/**
 * The default editor font (bundled, OFL-1.1, by NAVER): monospace in which a Hangul syllable is
 * exactly two columns wide, so Korean text lines up in tables and aligned text.
 */
export const editorFontFamily = 'D2Coding';

export const hangulFallbacks = `'Apple SD Gothic Neo', '${bundledFontFamily}', 'Malgun Gothic'`;

/** Latin monospace fonts: SF Mono / Menlo on macOS, Cascadia Mono / Consolas on Windows. */
export const monospaceFallbacks = ["'SF Mono'", 'Menlo', "'Cascadia Mono'", 'Consolas'];

/** Monospace with Hangul; the editor's own code styling uses it too. */
export const monospaceStack = `${editorFontFamily}, ui-monospace, ${monospaceFallbacks.join(', ')}, ${hangulFallbacks}, monospace`;

/** Interface text: San Francisco on macOS, Segoe UI Variable on Windows. */
export const sansStack = `-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', ${hangulFallbacks}, system-ui, sans-serif`;

/** Adds the Hangul fallbacks to a stack, before its generic family (or at its end). */
export function withHangulFallbacks(stack: string): string {
  if (stack.includes(bundledFontFamily)) {
    return stack;
  }
  const families = stack.split(',').map(family => family.trim()).filter(family => family !== '');
  const generic = /^(monospace|sans-serif|serif|system-ui|ui-monospace|ui-sans-serif|ui-serif|cursive|fantasy)$/i;
  const index = families.findIndex(family => generic.test(family) && family.toLowerCase() !== 'ui-monospace');
  const position = index === -1 ? families.length : index;
  return [...families.slice(0, position), hangulFallbacks, ...families.slice(position)].join(', ');
}

let installed = false;

/** Registers the bundled font; it is only downloaded when text needs it (Hangul on Windows). */
export function installBundledFonts(): void {
  if (installed || typeof document === 'undefined') {
    return;
  }
  installed = true;

  const style = document.createElement('style');
  style.id = 'markedit-bundled-fonts';
  // `local()` first: an installed copy needs no loading.
  style.textContent = `@font-face {
  font-family: '${bundledFontFamily}';
  src: url('${bundledFontUrl}') format('woff2-variations'), url('${bundledFontUrl}') format('woff2');
  font-weight: 45 920;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: '${editorFontFamily}';
  src: local('D2Coding'), local('D2Coding Regular'), url('fonts/D2Coding-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: '${editorFontFamily}';
  src: local('D2Coding Bold'), url('fonts/D2Coding-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}`;
  document.head.appendChild(style);
}
