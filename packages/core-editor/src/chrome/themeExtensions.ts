/**
 * Theme extensions (MarkEdit-theme-vscode, -one-dark, -nushu, -basic, …) share a small library,
 * `window.__markeditTheming__`: each one writes its colors into `customThemes.light/dark` and
 * the library applies whatever is there on top of the editor theme — so every enabled theme
 * extension used to override the theme picked in Settings, the last one loaded winning.
 *
 * Here the Settings choice decides instead: while extension scripts run, each one's
 * contribution is recorded; afterwards only the selected theme extension's colors are put back
 * (none when a built-in theme is selected). The library re-applies them when `config.theme` is
 * assigned (it hooks that property), which is how a change is triggered.
 */

interface ThemeContribution {
  light?: unknown;
  dark?: unknown;
}

interface ThemingLibrary {
  customThemes: ThemeContribution;
}

const contributions = new Map<string, ThemeContribution>();
let selectedExtension = '';

function themingLibrary(): ThemingLibrary | undefined {
  const library = (window as unknown as { __markeditTheming__?: unknown }).__markeditTheming__;
  if (typeof library !== 'object' || library === null) {
    return undefined;
  }
  const { customThemes } = library as { customThemes?: unknown };
  return typeof customThemes === 'object' && customThemes !== null ? library as ThemingLibrary : undefined;
}

/** Extension scripts are about to (re)run: forget what they contributed before. */
export function resetThemeContributions(): void {
  contributions.clear();
}

/** Before an extension script runs: start from no custom theme, so its own shows up. */
export function beginExtensionScript(): void {
  const library = themingLibrary();
  if (library !== undefined) {
    library.customThemes = {};
  }
}

/** After an extension script ran: remember the theme it contributed, if any. */
export function endExtensionScript(capability: string): void {
  const library = themingLibrary();
  if (library === undefined) {
    return;
  }
  const { light, dark } = library.customThemes;
  if (light !== undefined || dark !== undefined) {
    contributions.set(capability, { light, dark });
  }
}

/** Display name of a theme extension, e.g. `markedit-theme-one-dark.js` → "One Dark". */
export function themeExtensionLabel(capability: string): string {
  const name = capability.replace(/\.js$/i, '').replace(/^markedit-theme-/i, '');
  if (name.toLowerCase() === 'vscode') {
    return 'VS Code';
  }
  return name.split(/[-_ ]+/).filter(word => word.length > 0)
    .map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
}

/** Installed theme extensions that contributed a theme, in load order. */
export function listThemeExtensions(): { capability: string; label: string; light: boolean; dark: boolean }[] {
  return [...contributions.entries()].map(([capability, theme]) => ({
    capability,
    label: themeExtensionLabel(capability),
    light: theme.light !== undefined,
    dark: theme.dark !== undefined,
  }));
}

export function getThemeExtension(): string {
  return selectedExtension;
}

/** Selects a theme extension by capability (file name), or none (`''`) for the built-in theme. */
export function setThemeExtension(capability: string): void {
  selectedExtension = capability;
  applyThemeSelection();
}

/** Puts the selected theme extension's colors (or none) in place and lets the library apply them. */
export function applyThemeSelection(): void {
  const library = themingLibrary();
  if (library === undefined) {
    return;
  }

  const chosen = contributions.get(selectedExtension);
  library.customThemes = chosen === undefined ? {} : { ...chosen };

  // The library hooks `config.theme`; assigning it re-applies the custom themes.
  const config = window.config as { theme?: string } | undefined;
  if (config !== undefined && Object.getOwnPropertyDescriptor(config, 'theme')?.set !== undefined) {
    // eslint-disable-next-line no-self-assign
    config.theme = config.theme;
  }
}
