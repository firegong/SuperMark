/**
 * Per-theme typography of the Markdown preview: font, size, weight and color of the body text,
 * headings and a few other elements, saved as `preview.themeStyles` and keyed by theme.
 *
 * The overrides are written to one style sheet, rebuilt whenever the styles or the theme change,
 * on top of the theme's own preview defaults (previewThemePresets.ts).
 */

import { buildPreviewPresetCss, previewThemePreset } from './previewThemePresets';

export const previewStyleElements = [
  { id: 'body', label: 'Body Text', selector: '' },
  { id: 'h1', label: 'Heading 1', selector: 'h1' },
  { id: 'h2', label: 'Heading 2', selector: 'h2' },
  { id: 'h3', label: 'Heading 3', selector: 'h3' },
  { id: 'h4', label: 'Heading 4', selector: 'h4' },
  { id: 'h5', label: 'Heading 5', selector: 'h5' },
  { id: 'h6', label: 'Heading 6', selector: 'h6' },
  { id: 'link', label: 'Link', selector: 'a' },
  { id: 'code', label: 'Code', selector: 'code' },
  { id: 'blockquote', label: 'Blockquote', selector: 'blockquote' },
] as const;

export type PreviewStyleElement = typeof previewStyleElements[number]['id'];

export interface PreviewElementStyle {
  fontFamily?: string;
  /** In pixels. */
  fontSize?: number;
  fontWeight?: number;
  /** `#rrggbb`. */
  color?: string;
}

export type PreviewThemeStyle = Partial<Record<PreviewStyleElement, PreviewElementStyle>>;

/** Keyed by {@link previewThemeKey}. */
export type PreviewThemeStyles = Record<string, PreviewThemeStyle>;

export const minPreviewFontSize = 8;
export const maxPreviewFontSize = 96;

const extensionPrefix = 'extension:';
const styleElementId = 'markedit-preview-theme-styles';
const presetElementId = 'markedit-preview-theme-preset';
const paneScope = '.markedit-markdown-preview-pane';
const scope = '.markedit-markdown-preview-pane .markedit-preview-body';

let currentStyles: PreviewThemeStyles = {};
let listening = false;

/** The key styles are saved under: the theme extension when one is applied, else the theme. */
export function previewThemeKey(theme: string, themeExtension: string): string {
  return themeExtension !== '' ? `${extensionPrefix}${themeExtension}` : theme;
}

export function activePreviewThemeKey(): string {
  const config = window.config as { theme?: string; themeExtension?: string } | undefined;
  return previewThemeKey(config?.theme ?? '', config?.themeExtension ?? '');
}

/** Font family names only: nothing that could end the declaration or the style sheet. */
function sanitizeFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  // Nothing that can end the value, the rule or the style sheet; font names have no colons.
  const cleaned = value.replace(/[;:{}<>\\]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : undefined;
}

function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : undefined;
}

function sanitizeFontSize(value: unknown): number | undefined {
  const size = typeof value === 'string' ? Number(value) : value;
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    return undefined;
  }
  return Math.min(maxPreviewFontSize, Math.max(minPreviewFontSize, Math.round(size)));
}

function sanitizeFontWeight(value: unknown): number | undefined {
  const weight = typeof value === 'string' ? Number(value) : value;
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 100 || weight > 900 || weight % 100 !== 0) {
    return undefined;
  }
  return weight;
}

export function normalizeElementStyle(raw: unknown): PreviewElementStyle | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const style: PreviewElementStyle = {};
  const fontFamily = sanitizeFontFamily(source.fontFamily);
  const fontSize = sanitizeFontSize(source.fontSize);
  const fontWeight = sanitizeFontWeight(source.fontWeight);
  const color = sanitizeColor(source.color);
  if (fontFamily !== undefined) {
    style.fontFamily = fontFamily;
  }
  if (fontSize !== undefined) {
    style.fontSize = fontSize;
  }
  if (fontWeight !== undefined) {
    style.fontWeight = fontWeight;
  }
  if (color !== undefined) {
    style.color = color;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/** Drops unknown elements, invalid values and empty entries. */
export function normalizePreviewThemeStyles(raw: unknown): PreviewThemeStyles {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }

  const result: PreviewThemeStyles = {};
  for (const [themeKey, themeRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (themeKey === '' || typeof themeRaw !== 'object' || themeRaw === null) {
      continue;
    }
    const themeStyle: PreviewThemeStyle = {};
    for (const { id } of previewStyleElements) {
      const style = normalizeElementStyle((themeRaw as Record<string, unknown>)[id]);
      if (style !== undefined) {
        themeStyle[id] = style;
      }
    }
    if (Object.keys(themeStyle).length > 0) {
      result[themeKey] = themeStyle;
    }
  }
  return result;
}

/** CSS for one theme's overrides, scoped to the preview body. */
export function buildPreviewThemeCss(style: PreviewThemeStyle | undefined): string {
  if (style === undefined) {
    return '';
  }

  const rules: string[] = [];
  for (const { id, selector } of previewStyleElements) {
    const element = style[id];
    if (element === undefined) {
      continue;
    }
    const declarations: string[] = [];
    if (element.fontFamily !== undefined) {
      declarations.push(`font-family: ${element.fontFamily}`);
    }
    if (element.fontSize !== undefined) {
      declarations.push(`font-size: ${element.fontSize}px`);
    }
    if (element.fontWeight !== undefined) {
      declarations.push(`font-weight: ${element.fontWeight}`);
    }
    if (element.color !== undefined) {
      declarations.push(`color: ${element.color}`);
    }
    if (declarations.length === 0) {
      continue;
    }
    const target = selector === '' ? scope : `${scope} ${selector}`;
    rules.push(`${target} { ${declarations.join('; ')}; }`);
    // Code inside blocks keeps the block's size unless code itself was set.
    if (id === 'code' && element.fontSize !== undefined) {
      rules.push(`${scope} pre code { font-size: ${element.fontSize}px; }`);
    }
  }
  return rules.join('\n');
}

export function getPreviewThemeStyles(): PreviewThemeStyles {
  return currentStyles;
}

export function setPreviewThemeStyles(styles: unknown): void {
  currentStyles = normalizePreviewThemeStyles(styles);
  applyPreviewThemeStyles();
}

function writeStyleSheet(id: string, css: string): void {
  let element = document.getElementById(id) as HTMLStyleElement | null;
  if (css === '') {
    element?.remove();
    return;
  }
  if (element === null) {
    element = document.createElement('style');
    element.id = id;
    document.head.appendChild(element);
  }
  if (element.textContent !== css) {
    element.textContent = css;
  }
}

/** Rebuilds the style sheets for the active theme (call after a theme change). */
export function applyPreviewThemeStyles(): void {
  const themeKey = activePreviewThemeKey();
  // Presets are for built-in themes; a theme extension brings its own colors.
  writeStyleSheet(presetElementId, buildPreviewPresetCss(previewThemePreset(themeKey), paneScope));
  writeStyleSheet(styleElementId, buildPreviewThemeCss(currentStyles[themeKey]));
}

/** Restores the saved styles and follows theme changes. Safe to call more than once. */
export function initPreviewThemeStyles(saved: unknown): void {
  if (!listening) {
    listening = true;
    // Fired after every theme change (built-in theme, appearance switch or theme extension).
    window.addEventListener('editor-colors-changed', applyPreviewThemeStyles);
  }
  setPreviewThemeStyles(saved);
}
