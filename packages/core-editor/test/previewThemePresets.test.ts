import { describe, expect, test, afterEach } from '@jest/globals';
import { buildPreviewPresetCss, previewPresetVariables, previewThemePreset, previewThemePresets } from '../src/chrome/previewThemePresets';
import { applyPreviewThemeStyles, setPreviewThemeStyles } from '../src/chrome/previewThemeStyles';

const builtInThemeIds = [
  'github-light', 'github-dark', 'xcode-light', 'xcode-dark', 'dracula', 'cobalt',
  'winter-is-coming-light', 'winter-is-coming-dark', 'minimal-light', 'minimal-dark',
  'synthwave84', 'night-owl', 'rose-pine-dawn', 'rose-pine', 'solarized-light', 'solarized-dark',
];

describe('Preview theme presets', () => {
  afterEach(() => {
    setPreviewThemeStyles({});
    document.head.innerHTML = '';
  });

  test('every built-in theme has a preset with valid colors', () => {
    expect(Object.keys(previewThemePresets).sort()).toEqual([...builtInThemeIds].sort());
    for (const id of builtInThemeIds) {
      const preset = previewThemePreset(id);
      expect(preset).toBeDefined();
      for (const [name, color] of Object.entries(preset?.colors ?? {})) {
        expect(`${id}.${name}: ${color}`).toMatch(/: (#[0-9a-f]{6}|transparent)$/);
      }
      expect(preset?.sizes.h1).toBeGreaterThan(preset?.sizes.h6 ?? Infinity);
    }
  });

  test('every table header has a background that stands out from the page', () => {
    // The editor background of each theme (styling/themes), which the preview uses.
    const pageBackgrounds: Record<string, string> = {
      'github-light': '#ffffff', 'github-dark': '#0d1117', 'xcode-light': '#ffffff', 'xcode-dark': '#1f1f24',
      dracula: '#282a36', cobalt: '#193549', 'winter-is-coming-light': '#ffffff', 'winter-is-coming-dark': '#282822',
      'minimal-light': '#ffffff', 'minimal-dark': '#1e1e1e', synthwave84: '#262335', 'night-owl': '#011627',
      'rose-pine-dawn': '#faf4ed', 'rose-pine': '#191724', 'solarized-light': '#fdf6e3', 'solarized-dark': '#002b36',
    };
    const luminance = (hex: string) => {
      const channel = (offset: number) => {
        const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    };
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    for (const id of builtInThemeIds) {
      const header = previewThemePreset(id)?.colors.tableHeaderBackground ?? '';
      expect(`${id}: ${contrast(header, pageBackgrounds[id]).toFixed(2)}`).not.toMatch(/: 1\.0\d$/);
    }
  });

  test('themes keep their own character', () => {
    const variables = (id: string) => previewPresetVariables(previewThemePreset(id) ?? previewThemePresets['github-light']);
    expect(variables('dracula')['--pv-h1']).toBe('#bd93f9');
    expect(variables('github-light')['--pv-heading-rule']).toBe('1px solid #d0d7de');
    expect(variables('dracula')['--pv-heading-rule']).toBe('none');
    expect(variables('minimal-light')['--pv-font-body']).toContain('serif');
    expect(buildPreviewPresetCss(previewThemePreset('rose-pine'), '.pane')).toContain('border-left: none');
    expect(buildPreviewPresetCss(previewThemePreset('github-dark'), '.pane')).not.toContain('border-left: none');
    // GitHub tables: as wide as their content, body-size text, 6px 13px cells, tabular digits.
    expect(variables('github-light')).toMatchObject({
      '--pv-table-display': 'block',
      '--pv-table-width': 'max-content',
      '--pv-table-font-size': '1em',
      '--pv-table-cell-padding': '6px 13px',
      '--pv-table-numbers': 'tabular-nums',
    });
    expect(variables('github-dark')['--pv-table-width']).toBe('max-content');
    expect(variables('dracula')['--pv-table-width']).toBeUndefined();
    expect(previewThemePreset('toString')).toBeUndefined();
    expect(buildPreviewPresetCss(undefined, '.pane')).toBe('');
  });

  test('the active theme preset is applied along with the user styles', () => {
    const config: { theme?: string; themeExtension?: string } = { theme: 'dracula', themeExtension: '' };
    (window as unknown as { config: typeof config }).config = config;
    setPreviewThemeStyles({ dracula: { h1: { color: '#123456' } } });

    const preset = document.getElementById('markedit-preview-theme-preset');
    const user = document.getElementById('markedit-preview-theme-styles');
    expect(preset?.textContent).toContain('--pv-h1: #bd93f9;');
    expect(user?.textContent).toContain('color: #123456');

    // A theme extension brings its own colors: no preset.
    config.themeExtension = 'markedit-theme-one-dark.js';
    applyPreviewThemeStyles();
    expect(document.getElementById('markedit-preview-theme-preset')).toBeNull();
    config.themeExtension = '';
  });
});
