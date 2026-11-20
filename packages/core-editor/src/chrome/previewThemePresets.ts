/**
 * Default look of the Markdown preview for each built-in theme: fonts, sizes, heading, link, code,
 * blockquote and table colors taken from the theme's own palette, so the preview matches the editor.
 *
 * Presets are written as `--pv-*` custom properties on the preview pane (see the preview rules in
 * index.css); the user's own overrides (previewThemeStyles.ts) apply on top of them.
 */

export interface PreviewThemePreset {
  fonts: {
    body: string;
    code: string;
    heading?: string;
  };
  /** Pixels. */
  sizes: {
    body: number;
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    h5: number;
    h6: number;
  };
  headingWeight: number;
  /** A rule under h1 and h2 (GitHub style). */
  headingRule: boolean;
  /** `grid`: every cell bordered; `lines`: horizontal rules only. */
  tableStyle: 'grid' | 'lines';
  /** Table layout; omitted: full width, 14px text, 8px 12px cells. */
  tableLayout?: {
    /** `content`: as wide as the content (scrolls when wider than the column), `full`: full width. */
    width: 'content' | 'full';
    /** Pixels; omitted: the body text size. */
    fontSize?: number;
    cellPadding: string;
    /** Tabular (same-width) digits, so numbers line up in columns. */
    tabularNumbers?: boolean;
  };
  colors: {
    text: string;
    secondaryText: string;
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
    link: string;
    strong: string;
    em: string;
    codeText: string;
    codeBackground: string;
    codeBlockBackground: string;
    blockquoteText: string;
    blockquoteBorder: string;
    blockquoteBackground: string;
    tableBorder: string;
    tableHeaderBackground: string;
    tableHeaderText: string;
    tableStripe: string;
    hr: string;
    mark: string;
  };
}

// Font stacks: the theme's own font first, then Windows equivalents.
const githubSans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
const githubMono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const appleSans = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', sans-serif";
const appleMono = "'SF Mono', ui-monospace, Menlo, 'Cascadia Mono', Consolas, monospace";
const uiSans = "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', Arial, sans-serif";
const codingMono = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', ui-monospace, Consolas, monospace";
const italicMono = "'Operator Mono', 'Dank Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace";
const readingSerif = "Charter, 'Iowan Old Style', 'Sitka Text', Georgia, Cambria, 'Times New Roman', serif";
const minimalMono = "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace";

/** GitHub's Markdown sizes (2em, 1.5em, 1.25em, 1em, 0.875em, 0.85em of 16px). */
const githubSizes = { body: 16, h1: 32, h2: 24, h3: 20, h4: 16, h5: 14, h6: 13.6 };
const balancedSizes = { body: 15, h1: 28, h2: 23, h3: 19, h4: 16, h5: 15, h6: 14 };
const readingSizes = { body: 17, h1: 30, h2: 24, h3: 20, h4: 17, h5: 16, h6: 15 };

/** github-markdown-css: content-width tables at body size, 6px 13px cells, tabular digits. */
const githubTableLayout: PreviewThemePreset['tableLayout'] = {
  width: 'content',
  cellPadding: '6px 13px',
  tabularNumbers: true,
};

/**
 * Ids match the built-in themes. Colors come from each theme's palette: MarkEdit's theme files
 * (styling/themes) for text, accent, link, bold, italic, quote and code, and the themes' upstream
 * Markdown token colors for headings (GitHub Primer / github-markdown-css, Dracula spec, Cobalt2,
 * Winter is Coming, SynthWave '84, Night Owl, Rosé Pine, Solarized). Table, code block and
 * highlight colors, fonts and sizes are chosen to suit each theme.
 */
export const previewThemePresets: Record<string, PreviewThemePreset> = {
  'github-light': {
    fonts: {
      body: githubSans,
      code: githubMono,
    },
    sizes: githubSizes,
    headingWeight: 600,
    headingRule: true,
    tableStyle: 'grid',
    tableLayout: githubTableLayout,
    colors: {
      text: '#1f2328',
      secondaryText: '#656d76',
      h1: '#1f2328',
      h2: '#1f2328',
      h3: '#1f2328',
      h4: '#1f2328',
      h5: '#1f2328',
      h6: '#656d76',
      link: '#0969da',
      strong: '#1f2328',
      em: '#1f2328',
      codeText: '#1f2328',
      codeBackground: '#eff1f3',
      codeBlockBackground: '#f6f8fa',
      blockquoteText: '#656d76',
      blockquoteBorder: '#d0d7de',
      blockquoteBackground: 'transparent',
      tableBorder: '#d0d7de',
      tableHeaderBackground: '#ffffff',
      tableHeaderText: '#1f2328',
      tableStripe: '#f6f8fa',
      hr: '#d0d7de',
      mark: '#fff8c5',
    },
  },
  'github-dark': {
    fonts: {
      body: githubSans,
      code: githubMono,
    },
    sizes: githubSizes,
    headingWeight: 600,
    headingRule: true,
    tableStyle: 'grid',
    tableLayout: githubTableLayout,
    colors: {
      text: '#e6edf3',
      secondaryText: '#848d97',
      h1: '#e6edf3',
      h2: '#e6edf3',
      h3: '#e6edf3',
      h4: '#e6edf3',
      h5: '#e6edf3',
      h6: '#848d97',
      link: '#2f81f7',
      strong: '#e6edf3',
      em: '#e6edf3',
      codeText: '#e6edf3',
      codeBackground: '#343941',
      codeBlockBackground: '#161b22',
      blockquoteText: '#848d97',
      blockquoteBorder: '#30363d',
      blockquoteBackground: 'transparent',
      tableBorder: '#30363d',
      tableHeaderBackground: '#0d1117',
      tableHeaderText: '#e6edf3',
      tableStripe: '#161b22',
      hr: '#30363d',
      mark: '#272215',
    },
  },
  'xcode-light': {
    fonts: {
      body: appleSans,
      code: appleMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#000000',
      secondaryText: '#5d6c79',
      h1: '#000000',
      h2: '#000000',
      h3: '#000000',
      h4: '#000000',
      h5: '#000000',
      h6: '#000000',
      link: '#0f68a0',
      strong: '#3900a0',
      em: '#815f03',
      codeText: '#000000',
      codeBackground: '#f0f0f0',
      codeBlockBackground: '#f5f5f7',
      blockquoteText: '#4a5560',
      blockquoteBorder: '#d1d1d6',
      blockquoteBackground: 'transparent',
      tableBorder: '#d1d1d6',
      tableHeaderBackground: '#f2f2f7',
      tableHeaderText: '#000000',
      tableStripe: '#fafafa',
      hr: '#d1d1d6',
      mark: '#fff3b0',
    },
  },
  'xcode-dark': {
    fonts: {
      body: appleSans,
      code: appleMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#dedede',
      secondaryText: '#9a9a9c',
      h1: '#dedede',
      h2: '#dedede',
      h3: '#dedede',
      h4: '#dedede',
      h5: '#dedede',
      h6: '#dedede',
      link: '#41a1c0',
      strong: '#d0a8ff',
      em: '#bf8555',
      codeText: '#dedede',
      codeBackground: '#39393d',
      codeBlockBackground: '#292a30',
      blockquoteText: '#92a1b1',
      blockquoteBorder: '#48484a',
      blockquoteBackground: 'transparent',
      tableBorder: '#48484a',
      tableHeaderBackground: '#2c2c2e',
      tableHeaderText: '#dedede',
      tableStripe: '#252529',
      hr: '#48484a',
      mark: '#545558',
    },
  },
  'dracula': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#f8f8f2',
      secondaryText: '#6272a4',
      h1: '#bd93f9',
      h2: '#bd93f9',
      h3: '#bd93f9',
      h4: '#bd93f9',
      h5: '#bd93f9',
      h6: '#bd93f9',
      link: '#ff79c6',
      strong: '#ffb86c',
      em: '#f1fa8c',
      codeText: '#50fa7b',
      codeBackground: '#44475a',
      codeBlockBackground: '#21222c',
      blockquoteText: '#f1fa8c',
      blockquoteBorder: '#6272a4',
      blockquoteBackground: 'transparent',
      tableBorder: '#44475a',
      tableHeaderBackground: '#21222c',
      tableHeaderText: '#bd93f9',
      tableStripe: '#2e303e',
      hr: '#6272a4',
      mark: '#6272a4',
    },
  },
  'cobalt': {
    fonts: {
      body: uiSans,
      code: italicMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#e1efff',
      secondaryText: '#aaaaaa',
      h1: '#ffc600',
      h2: '#ffc600',
      h3: '#ffc600',
      h4: '#ffc600',
      h5: '#ffc600',
      h6: '#ffc600',
      link: '#a5ff90',
      strong: '#9effff',
      em: '#9effff',
      codeText: '#9effff',
      codeBackground: '#304a5c',
      codeBlockBackground: '#122738',
      blockquoteText: '#9effff',
      blockquoteBorder: '#0088ff',
      blockquoteBackground: 'transparent',
      tableBorder: '#234e6d',
      tableHeaderBackground: '#122738',
      tableHeaderText: '#ffc600',
      tableStripe: '#1d3c52',
      hr: '#ffc600',
      mark: '#754d2c',
    },
  },
  'winter-is-coming-light': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#3e3e3e',
      secondaryText: '#828282',
      h1: '#034c7c',
      h2: '#034c7c',
      h3: '#034c7c',
      h4: '#034c7c',
      h5: '#034c7c',
      h6: '#034c7c',
      link: '#a44185',
      strong: '#4e76b5',
      em: '#c792ea',
      codeText: '#0460b1',
      codeBackground: '#f3f3f5',
      codeBlockBackground: '#f3f3f3',
      blockquoteText: '#003494',
      blockquoteBorder: '#49a7cf',
      blockquoteBackground: 'transparent',
      tableBorder: '#c4c5cd',
      tableHeaderBackground: '#f3f3f3',
      tableHeaderText: '#034c7c',
      tableStripe: '#f9f9f9',
      hr: '#236ebf',
      mark: '#cee1f0',
    },
  },
  'winter-is-coming-dark': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#ffffff',
      secondaryText: '#999999',
      h1: '#5abeb0',
      h2: '#5abeb0',
      h3: '#5abeb0',
      h4: '#5abeb0',
      h5: '#5abeb0',
      h6: '#5abeb0',
      link: '#bcf0c0',
      strong: '#57cdff',
      em: '#c792ea',
      codeText: '#f7ecb5',
      codeBackground: '#3a3931',
      codeBlockBackground: '#1f1f1a',
      blockquoteText: '#82aaff',
      blockquoteBorder: '#219fd5',
      blockquoteBackground: 'transparent',
      tableBorder: '#264852',
      tableHeaderBackground: '#1f1f1a',
      tableHeaderText: '#5abeb0',
      tableStripe: '#2e2e27',
      hr: '#a7dbf7',
      mark: '#103362',
    },
  },
  'minimal-light': {
    fonts: {
      body: readingSerif,
      code: minimalMono,
      heading: uiSans,
    },
    sizes: readingSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#3a3a3c',
      secondaryText: '#8e8e93',
      h1: '#000000',
      h2: '#000000',
      h3: '#000000',
      h4: '#000000',
      h5: '#000000',
      h6: '#000000',
      link: '#000000',
      strong: '#000000',
      em: '#000000',
      codeText: '#000000',
      codeBackground: '#f2f2f7',
      codeBlockBackground: '#f2f2f7',
      blockquoteText: '#8e8e93',
      blockquoteBorder: '#d1d1d6',
      blockquoteBackground: 'transparent',
      tableBorder: '#e5e5ea',
      tableHeaderBackground: '#ffffff',
      tableHeaderText: '#000000',
      tableStripe: '#ffffff',
      hr: '#e5e5ea',
      mark: '#fcf0be',
    },
  },
  'minimal-dark': {
    fonts: {
      body: readingSerif,
      code: minimalMono,
      heading: uiSans,
    },
    sizes: readingSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#d1d1d6',
      secondaryText: '#8e8e93',
      h1: '#ffffff',
      h2: '#ffffff',
      h3: '#ffffff',
      h4: '#ffffff',
      h5: '#ffffff',
      h6: '#ffffff',
      link: '#ffffff',
      strong: '#ffffff',
      em: '#ffffff',
      codeText: '#ffffff',
      codeBackground: '#2c2c2e',
      codeBlockBackground: '#2c2c2e',
      blockquoteText: '#8e8e93',
      blockquoteBorder: '#48484a',
      blockquoteBackground: 'transparent',
      tableBorder: '#3a3a3c',
      tableHeaderBackground: '#1e1e1e',
      tableHeaderText: '#ffffff',
      tableStripe: '#1e1e1e',
      hr: '#3a3a3c',
      mark: '#5e5428',
    },
  },
  'synthwave84': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#f0eff1',
      secondaryText: '#848bbd',
      h1: '#ff7edb',
      h2: '#ff7edb',
      h3: '#ff7edb',
      h4: '#ff7edb',
      h5: '#ff7edb',
      h6: '#ff7edb',
      link: '#f97e72',
      strong: '#2ee2fa',
      em: '#2ee2fa',
      codeText: '#72f1b8',
      codeBackground: '#323040',
      codeBlockBackground: '#241b2f',
      blockquoteText: '#72f1b8',
      blockquoteBorder: '#495495',
      blockquoteBackground: 'transparent',
      tableBorder: '#495495',
      tableHeaderBackground: '#241b2f',
      tableHeaderText: '#ff7edb',
      tableStripe: '#2a2139',
      hr: '#443964',
      mark: '#a36c1e',
    },
  },
  'night-owl': {
    fonts: {
      body: uiSans,
      code: italicMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#d6deeb',
      secondaryText: '#637777',
      h1: '#82b1ff',
      h2: '#82b1ff',
      h3: '#82b1ff',
      h4: '#82b1ff',
      h5: '#82b1ff',
      h6: '#82b1ff',
      link: '#ff869a',
      strong: '#c5e478',
      em: '#c792ea',
      codeText: '#c5e478',
      codeBackground: '#0b253a',
      codeBlockBackground: '#021320',
      blockquoteText: '#697098',
      blockquoteBorder: '#5f7e97',
      blockquoteBackground: 'transparent',
      tableBorder: '#1d3b53',
      tableHeaderBackground: '#0b253a',
      tableHeaderText: '#82b1ff',
      tableStripe: '#021320',
      hr: '#5f7e97',
      mark: '#2e475c',
    },
  },
  'rose-pine-dawn': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#575279',
      secondaryText: '#797593',
      h1: '#907aa9',
      h2: '#56949f',
      h3: '#d7827e',
      h4: '#ea9d34',
      h5: '#286983',
      h6: '#56949f',
      link: '#907aa9',
      strong: '#575279',
      em: '#575279',
      codeText: '#ea9d34',
      codeBackground: '#f2e9e1',
      codeBlockBackground: '#fffaf3',
      blockquoteText: '#797593',
      blockquoteBorder: '#dfdad9',
      blockquoteBackground: 'transparent',
      tableBorder: '#dfdad9',
      tableHeaderBackground: '#fffaf3',
      tableHeaderText: '#575279',
      tableStripe: '#f4ede8',
      hr: '#dfdad9',
      mark: '#cecacd',
    },
  },
  'rose-pine': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'lines',
    colors: {
      text: '#e0def4',
      secondaryText: '#908caa',
      h1: '#c4a7e7',
      h2: '#9ccfd8',
      h3: '#ebbcba',
      h4: '#f6c177',
      h5: '#31748f',
      h6: '#9ccfd8',
      link: '#c4a7e7',
      strong: '#e0def4',
      em: '#e0def4',
      codeText: '#f6c177',
      codeBackground: '#26233a',
      codeBlockBackground: '#1f1d2e',
      blockquoteText: '#908caa',
      blockquoteBorder: '#403d52',
      blockquoteBackground: 'transparent',
      tableBorder: '#403d52',
      tableHeaderBackground: '#1f1d2e',
      tableHeaderText: '#e0def4',
      tableStripe: '#21202e',
      hr: '#403d52',
      mark: '#524f67',
    },
  },
  'solarized-light': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#586e75',
      secondaryText: '#93a1a1',
      h1: '#268bd2',
      h2: '#268bd2',
      h3: '#268bd2',
      h4: '#268bd2',
      h5: '#268bd2',
      h6: '#268bd2',
      link: '#2aa198',
      strong: '#d33682',
      em: '#d33682',
      codeText: '#2aa198',
      codeBackground: '#eee8d5',
      codeBlockBackground: '#eee8d5',
      blockquoteText: '#859900',
      blockquoteBorder: '#93a1a1',
      blockquoteBackground: 'transparent',
      tableBorder: '#e4ddc8',
      tableHeaderBackground: '#eee8d5',
      tableHeaderText: '#586e75',
      tableStripe: '#f7f0dc',
      hr: '#93a1a1',
      mark: '#f4c09d',
    },
  },
  'solarized-dark': {
    fonts: {
      body: uiSans,
      code: codingMono,
    },
    sizes: balancedSizes,
    headingWeight: 700,
    headingRule: false,
    tableStyle: 'grid',
    colors: {
      text: '#93a1a1',
      secondaryText: '#657b83',
      h1: '#268bd2',
      h2: '#268bd2',
      h3: '#268bd2',
      h4: '#268bd2',
      h5: '#268bd2',
      h6: '#268bd2',
      link: '#2aa198',
      strong: '#d33682',
      em: '#d33682',
      codeText: '#2aa198',
      codeBackground: '#073642',
      codeBlockBackground: '#073642',
      blockquoteText: '#859900',
      blockquoteBorder: '#586e75',
      blockquoteBackground: 'transparent',
      tableBorder: '#0f4b59',
      tableHeaderBackground: '#073642',
      tableHeaderText: '#93a1a1',
      tableStripe: '#01313d',
      hr: '#586e75',
      mark: '#584032',
    },
  },
};

export function previewThemePreset(themeKey: string): PreviewThemePreset | undefined {
  return Object.prototype.hasOwnProperty.call(previewThemePresets, themeKey) ? previewThemePresets[themeKey] : undefined;
}

/** The `--pv-*` custom properties for a preset. */
export function previewPresetVariables(preset: PreviewThemePreset): Record<string, string> {
  const { colors, fonts, sizes } = preset;
  const variables: Record<string, string> = {
    '--pv-font-body': fonts.body,
    '--pv-font-code': fonts.code,
    '--pv-font-heading': fonts.heading ?? fonts.body,
    '--pv-heading-weight': String(preset.headingWeight),
    '--pv-heading-rule': preset.headingRule ? `1px solid ${colors.hr}` : 'none',
    '--pv-heading-rule-gap': preset.headingRule ? '0.3em' : '0',
    '--pv-text': colors.text,
    '--pv-secondary': colors.secondaryText,
    '--pv-link': colors.link,
    '--pv-strong': colors.strong,
    '--pv-em': colors.em,
    '--pv-code-text': colors.codeText,
    '--pv-code-bg': colors.codeBackground,
    '--pv-pre-bg': colors.codeBlockBackground,
    '--pv-quote-text': colors.blockquoteText,
    '--pv-quote-border': colors.blockquoteBorder,
    '--pv-quote-bg': colors.blockquoteBackground,
    '--pv-table-border': colors.tableBorder,
    '--pv-table-header-bg': colors.tableHeaderBackground,
    '--pv-table-header-text': colors.tableHeaderText,
    '--pv-table-stripe': colors.tableStripe,
    '--pv-hr': colors.hr,
    '--pv-mark-bg': colors.mark,
  };
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    variables[`--pv-${level}`] = colors[level];
    variables[`--pv-size-${level}`] = `${sizes[level]}px`;
  }
  variables['--pv-size-body'] = `${sizes.body}px`;

  const layout = preset.tableLayout;
  if (layout !== undefined) {
    variables['--pv-table-display'] = layout.width === 'content' ? 'block' : 'table';
    variables['--pv-table-width'] = layout.width === 'content' ? 'max-content' : '100%';
    // Not `inherit`: as a custom property value it makes the variable itself inherit.
    variables['--pv-table-font-size'] = layout.fontSize !== undefined ? `${layout.fontSize}px` : '1em';
    variables['--pv-table-cell-padding'] = layout.cellPadding;
    variables['--pv-table-numbers'] = layout.tabularNumbers === true ? 'tabular-nums' : 'normal';
  }
  return variables;
}

/** CSS for a preset, scoped to `scope` (the preview pane, or the sample in Settings). */
export function buildPreviewPresetCss(preset: PreviewThemePreset | undefined, scope: string): string {
  if (preset === undefined) {
    return '';
  }

  const declarations = Object.entries(previewPresetVariables(preset))
    .map(([name, value]) => `${name}: ${value};`)
    .join(' ');
  const rules = [`${scope} { ${declarations} }`];
  if (preset.tableStyle === 'lines') {
    rules.push(
      `${scope} .markedit-preview-table th, ${scope} .markedit-preview-table td { border-left: none; border-right: none; }`,
      `${scope} .markedit-preview-table th { border-top: none; border-bottom-width: 2px; }`,
    );
  }
  return rules.join('\n');
}
