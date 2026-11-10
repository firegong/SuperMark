import { createButton, createElement, setupModalTitleBar } from './utils';
import { InvisiblesBehavior } from '../config';
import { TabKeyBehavior } from '../modules/indentation';

export type SettingsTab = 'editor' | 'assistant' | 'general' | 'window';

export interface UserSettings {
  theme: string;
  fontFamily: string;
  fontSize: number;
  showLineNumbers: boolean;
  showActiveLineIndicator: boolean;
  invisiblesBehavior: 'never' | 'selection' | 'trailing' | 'always';
  typewriterMode: boolean;
  focusMode: boolean;
  lineWrapping: boolean;
  lineHeight: number;
  tabKeyBehavior: number;
  indentUnit: string;
  suggestWhileTyping: boolean;
  autoCharacterPairs: boolean;
  smartQuotesEnabled: boolean;
  insertFinalNewline: boolean;
  trimTrailingWhitespace: boolean;
  appearance: 'system' | 'light' | 'dark';
  newFilenameExtension: string;
  defaultTextEncoding: string;
  defaultLineBreak: string;
  reduceTransparency: boolean;
}

interface SettingsModalController {
  readonly element: HTMLElement;
  focus(): void;
}

const defaultSettings = (config: typeof window.config): UserSettings => {
  const overrides = config as unknown as Partial<UserSettings>;
  return {
    theme: overrides.theme ?? 'github-light',
    fontFamily: overrides.fontFamily ?? 'ui-monospace',
    fontSize: overrides.fontSize ?? 16,
    showLineNumbers: overrides.showLineNumbers ?? true,
    showActiveLineIndicator: overrides.showActiveLineIndicator ?? true,
    invisiblesBehavior: overrides.invisiblesBehavior ?? 'selection',
    typewriterMode: overrides.typewriterMode ?? false,
    focusMode: overrides.focusMode ?? false,
    lineWrapping: overrides.lineWrapping ?? true,
    lineHeight: overrides.lineHeight ?? 1.5,
    tabKeyBehavior: overrides.tabKeyBehavior ?? 2,
    indentUnit: overrides.indentUnit ?? '    ',
    suggestWhileTyping: overrides.suggestWhileTyping ?? true,
    autoCharacterPairs: overrides.autoCharacterPairs ?? true,
    smartQuotesEnabled: overrides.smartQuotesEnabled ?? true,
    insertFinalNewline: overrides.insertFinalNewline ?? true,
    trimTrailingWhitespace: overrides.trimTrailingWhitespace ?? false,
    appearance: overrides.appearance ?? 'system',
    newFilenameExtension: overrides.newFilenameExtension ?? 'md',
    defaultTextEncoding: overrides.defaultTextEncoding ?? 'UTF-8',
    defaultLineBreak: overrides.defaultLineBreak ?? '\n',
    reduceTransparency: overrides.reduceTransparency ?? false,
  };
};

const builtInThemes: { id: string; label: string; colors: string }[] = [
  { id: 'github-light', label: 'GitHub (Light)', colors: '#ffffff,#24292e,#f2f8fa,#d73a49,#005cc5,#6f42c1' },
  { id: 'github-dark', label: 'GitHub (Dark)', colors: '#0d1117,#c9d1d9,#131d2e,#ff7b72,#79c0ff,#d2a8ff' },
  { id: 'xcode-light', label: 'Xcode (Light)', colors: '#ffffff,#262626,#e4f0ff,#aa0d91,#1c00cf,#3f6e74' },
  { id: 'xcode-dark', label: 'Xcode (Dark)', colors: '#1f1f24,#ffffff,#1d293b,#ff7ab2,#d9c97c,#dabaff' },
  { id: 'dracula', label: 'Dracula', colors: '#282a36,#f8f8f2,#353746,#ff79c6,#bd93f9,#50fa7b' },
  { id: 'cobalt', label: 'Cobalt', colors: '#00254b,#ffffff,#001933,#ff9d00,#ff628c,#ffdd00' },
  { id: 'winter-is-coming-light', label: 'Winter is Coming (Light)', colors: '#ffffff,#2c2255,#f4f8fc,#a44185,#0657a8,#b26700' },
  { id: 'winter-is-coming-dark', label: 'Winter is Coming (Dark)', colors: '#011627,#d6deeb,#0b253a,#c792ea,#82aaff,#addb67' },
  { id: 'minimal-light', label: 'Minimal (Light)', colors: '#ffffff,#000000,#f5f5f5,#555555,#777777,#333333' },
  { id: 'minimal-dark', label: 'Minimal (Dark)', colors: '#1e1e1e,#ffffff,#2a2a2a,#aaaaaa,#888888,#cccccc' },
  { id: 'synthwave84', label: "SynthWave '84", colors: '#251b2f,#f3eff5,#1c1524,#f4d35e,#ff7edb,#36f9f6' },
  { id: 'night-owl', label: 'Night Owl', colors: '#011627,#d6deeb,#0b253a,#c792ea,#f78c6c,#82aaff' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', colors: '#faf4ed,#575279,#f2e9e1,#b4637a,#286983,#d7827e' },
  { id: 'rose-pine', label: 'Rosé Pine', colors: '#191724,#e0def4,#211f2d,#eb6f92,#31748f,#ebbcba' },
  { id: 'solarized-light', label: 'Solarized (Light)', colors: '#fdf6e3,#657b83,#f5eed9,#859900,#d33682,#268bd2' },
  { id: 'solarized-dark', label: 'Solarized (Dark)', colors: '#002b36,#839496,#053542,#859900,#d33682,#268bd2' },
];

const fontFamilies: { value: string; label: string }[] = [
  { value: 'ui-monospace', label: 'System Mono' },
  { value: 'system-ui', label: 'System UI' },
  { value: "'Cascadia Code', monospace", label: 'Cascadia Code' },
  { value: "'Consolas', monospace", label: 'Consolas' },
  { value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
  { value: "'Fira Code', monospace", label: 'Fira Code' },
  { value: "'SF Mono', Menlo, monospace", label: 'SF Mono' },
];

const lineHeightOptions: { value: number; label: string }[] = [
  { value: 1.2, label: 'Tight' },
  { value: 1.5, label: 'Normal' },
  { value: 1.8, label: 'Relaxed' },
];

const tabKeyBehaviorOptions: { value: number; label: string }[] = [
  { value: 0, label: 'Insert Tab' },
  { value: 1, label: 'Insert 2 Spaces' },
  { value: 2, label: 'Insert 4 Spaces' },
  { value: 3, label: 'Indent More' },
];

const indentUnitOptions: { value: string; label: string }[] = [
  { value: '  ', label: '2 Spaces' },
  { value: '    ', label: '4 Spaces' },
  { value: '\t', label: '1 Tab' },
  { value: '\t\t', label: '2 Tabs' },
];

const appearanceOptions: { value: UserSettings['appearance']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const extensionOptions: { value: string; label: string }[] = [
  { value: 'md', label: '.md' },
  { value: 'markdown', label: '.markdown' },
  { value: 'mdown', label: '.mdown' },
  { value: 'txt', label: '.txt' },
];

const encodingOptions: { value: string; label: string }[] = [
  { value: 'UTF-8', label: 'UTF-8' },
  { value: 'UTF-8-BOM', label: 'UTF-8 with BOM' },
  { value: 'UTF-16LE', label: 'UTF-16 LE' },
  { value: 'UTF-16BE', label: 'UTF-16 BE' },
  { value: 'EUC-KR', label: 'EUC-KR' },
];

const lineBreakOptions: { value: string; label: string }[] = [
  { value: '\r\n', label: 'Windows (CRLF)' },
  { value: '\n', label: 'Unix / macOS (LF)' },
  { value: '\r', label: 'Classic Mac (CR)' },
];

const invisiblesOptions: { value: UserSettings['invisiblesBehavior']; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'selection', label: 'Selection' },
  { value: 'trailing', label: 'Trailing' },
  { value: 'always', label: 'Always' },
];

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (invoke === undefined) {
    return undefined as T;
  }

  return await invoke(cmd, args) as T;
}

function createThemeSwatch(colors: string): HTMLElement {
  const palette = colors.split(',').map(color => color.trim());
  const container = createElement('div', 'markedit-settings-theme-swatch');
  container.style.backgroundColor = palette[0] ?? '#ffffff';

  const rows = [[2, 3], [4, 1], [3, 5], [5], [2, 1]];
  const content = createElement('div', 'markedit-settings-theme-swatch-content', container);
  for (const columns of rows) {
    const row = createElement('div', 'markedit-settings-theme-swatch-row', content);
    for (const index of columns) {
      const token = createElement('span', 'markedit-settings-theme-swatch-token', row);
      token.style.backgroundColor = palette[index] ?? '#000000';
    }
  }

  return container;
}

function createToggle(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
  disabled = false,
): HTMLElement {
  const wrapper = createElement('label', 'markedit-settings-toggle');
  const input = createElement('input', '') as HTMLInputElement;
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.appendChild(input);
  createElement('span', 'markedit-settings-toggle-slider', wrapper);
  createElement('span', 'markedit-settings-toggle-label', wrapper, label);
  return wrapper;
}

function createSelect<T extends string | number>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
): HTMLElement {
  const wrapper = createElement('div', 'markedit-settings-field');
  createElement('label', 'markedit-settings-field-label', wrapper, label);
  const select = createElement('select', 'markedit-chrome-input markedit-settings-select') as HTMLSelectElement;
  for (const option of options) {
    const opt = createElement('option', '', select, option.label);
    opt.value = String(option.value);
  }
  select.value = String(value);
  select.addEventListener('change', () => {
    const raw = select.value;
    const parsed = typeof value === 'number' ? (Number(raw) as T) : (raw as T);
    onChange(parsed);
  });
  wrapper.appendChild(select);
  return wrapper;
}

function createNumberStepper(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => void,
): HTMLElement {
  const wrapper = createElement('div', 'markedit-settings-field');
  createElement('label', 'markedit-settings-field-label', wrapper, label);
  const input = createElement('input', 'markedit-chrome-input markedit-settings-number') as HTMLInputElement;
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const parsed = parseInt(input.value, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(parsed, max));
      input.value = String(clamped);
      onChange(clamped);
    }
  });
  wrapper.appendChild(input);
  return wrapper;
}

export function createSettingsModal(
  initialTab: SettingsTab = 'editor',
  onClose: () => void,
): SettingsModalController {
  let settings = defaultSettings(window.config);
  let activeTab: SettingsTab = initialTab;
  let inFlight = false;

  const core = window.webModules.core as unknown as { restoreFocus: () => void } | undefined;
  const configModule = window.webModules.config as unknown as {
    setTheme?: (args: { name: string }) => void;
    setFontFace?: (args: { fontFace: { family: string } }) => void;
    setFontSize?: (args: { fontSize: number }) => void;
    setShowLineNumbers?: (args: { enabled: boolean }) => void;
    setShowActiveLineIndicator?: (args: { enabled: boolean }) => void;
    setInvisiblesBehavior?: (args: { behavior: InvisiblesBehavior }) => void;
    setTypewriterMode?: (args: { enabled: boolean }) => void;
    setFocusMode?: (args: { enabled: boolean }) => void;
    setLineWrapping?: (args: { enabled: boolean }) => void;
    setLineHeight?: (args: { lineHeight: number }) => void;
    setTabKeyBehavior?: (args: { behavior: TabKeyBehavior }) => void;
    setIndentUnit?: (args: { unit: string }) => void;
    setSuggestWhileTyping?: (args: { enabled: boolean }) => void;
    setSmartQuotesEnabled?: (args: { enabled: boolean }) => void;
    setDefaultLineBreak?: (args: { lineBreak?: string }) => void;
  } | undefined;

  const backdrop = createElement('div', 'markedit-chrome-modal-backdrop markedit-chrome-settings-backdrop');
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop) {
      close();
    }
  });

  const dialog = createElement('div', 'markedit-chrome-panel markedit-chrome-settings-modal', backdrop);

  const header = createElement('div', 'markedit-chrome-settings-header', dialog);
  const titleRow = createElement('div', 'markedit-chrome-settings-title-row', header);
  const titleEl = createElement('div', 'markedit-chrome-settings-title', titleRow, 'Settings');
  setupModalTitleBar(titleRow, titleEl, close, { centeredTitle: true });

  const tabsRow = createElement('div', 'markedit-chrome-settings-tabs', header);
  const tabs: Record<SettingsTab, string> = {
    editor: 'Editor',
    assistant: 'Assistant',
    general: 'General',
    window: 'Window',
  };
  const tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  for (const key of Object.keys(tabs) as SettingsTab[]) {
    const button = createElement('button', 'markedit-chrome-settings-tab');
    button.type = 'button';
    button.textContent = tabs[key];
    button.addEventListener('click', () => {
      activeTab = key;
      render();
    });
    tabButtons.set(key, button);
    tabsRow.appendChild(button);
  }

  const body = createElement('div', 'markedit-chrome-settings-body', dialog);

  async function refreshState(): Promise<void> {
    const result = await invokeTauri<UserSettings | undefined>('settings_get_state');
    if (result !== undefined) {
      settings = result;
    }
    render();
  }

  async function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): Promise<void> {
    if (inFlight) {
      return;
    }

    inFlight = true;
    settings = { ...settings, [key]: value };
    applyLocalChange(key, value);
    render();

    try {
      const result = await invokeTauri<UserSettings | undefined>('settings_update', { patch: { [key]: value } });
      if (result !== undefined) {
        settings = result;
      }
    } finally {
      inFlight = false;
      render();
    }
  }

  async function resetSettings(): Promise<void> {
    const result = await invokeTauri<UserSettings | undefined>('settings_reset');
    if (result !== undefined) {
      settings = result;
      applyAllLocal(settings);
    }
    render();
  }

  async function openSettingsFile(): Promise<void> {
    await invokeTauri<void>('settings_open_file');
  }

  function applyLocalChange<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
    window.config = { ...window.config, [key]: value } as typeof window.config;

    switch (key) {
      case 'theme':
        configModule?.setTheme?.({ name: value as string });
        break;
      case 'fontSize':
        configModule?.setFontSize?.({ fontSize: value as number });
        break;
      case 'showLineNumbers':
        configModule?.setShowLineNumbers?.({ enabled: value as boolean });
        break;
      case 'showActiveLineIndicator':
        configModule?.setShowActiveLineIndicator?.({ enabled: value as boolean });
        break;
      case 'invisiblesBehavior':
        configModule?.setInvisiblesBehavior?.({ behavior: value as InvisiblesBehavior });
        break;
      case 'typewriterMode':
        configModule?.setTypewriterMode?.({ enabled: value as boolean });
        break;
      case 'focusMode':
        configModule?.setFocusMode?.({ enabled: value as boolean });
        break;
      case 'lineWrapping':
        configModule?.setLineWrapping?.({ enabled: value as boolean });
        break;
      case 'lineHeight':
        configModule?.setLineHeight?.({ lineHeight: value as number });
        break;
      case 'tabKeyBehavior':
        configModule?.setTabKeyBehavior?.({ behavior: value as TabKeyBehavior });
        break;
      case 'indentUnit':
        configModule?.setIndentUnit?.({ unit: value as string });
        break;
      case 'suggestWhileTyping':
        configModule?.setSuggestWhileTyping?.({ enabled: value as boolean });
        break;
      case 'smartQuotesEnabled':
        configModule?.setSmartQuotesEnabled?.({ enabled: value as boolean });
        break;
      case 'defaultLineBreak':
        configModule?.setDefaultLineBreak?.({ lineBreak: value as string });
        break;
      case 'fontFamily':
        window.config.fontFace = { ...window.config.fontFace, family: value as string };
        configModule?.setFontFace?.({ fontFace: { family: value as string } });
        break;
      case 'appearance':
      case 'autoCharacterPairs':
      case 'defaultTextEncoding':
      case 'insertFinalNewline':
      case 'newFilenameExtension':
      case 'reduceTransparency':
      case 'trimTrailingWhitespace':
        break;
    }
  }

  function applyAllLocal(next: UserSettings): void {
    applyLocalChange('theme', next.theme);
    applyLocalChange('fontFamily', next.fontFamily);
    applyLocalChange('fontSize', next.fontSize);
    applyLocalChange('showLineNumbers', next.showLineNumbers);
    applyLocalChange('showActiveLineIndicator', next.showActiveLineIndicator);
    applyLocalChange('invisiblesBehavior', next.invisiblesBehavior);
    applyLocalChange('typewriterMode', next.typewriterMode);
    applyLocalChange('focusMode', next.focusMode);
    applyLocalChange('lineWrapping', next.lineWrapping);
    applyLocalChange('lineHeight', next.lineHeight);
    applyLocalChange('tabKeyBehavior', next.tabKeyBehavior);
    applyLocalChange('indentUnit', next.indentUnit);
    applyLocalChange('suggestWhileTyping', next.suggestWhileTyping);
    applyLocalChange('smartQuotesEnabled', next.smartQuotesEnabled);
    applyLocalChange('defaultLineBreak', next.defaultLineBreak);
  }

  function close(): void {
    backdrop.remove();
    onClose();
    core?.restoreFocus();
  }

  function createSection(title: string): HTMLElement {
    const section = createElement('div', 'markedit-settings-section', body);
    createElement('div', 'markedit-settings-section-title', section, title);
    return section;
  }

  function renderEditorTab(): void {
    const fontSection = createSection('Font');
    const fontFamilyField = createSelect('Font Family', fontFamilies, settings.fontFamily, value => {
      void updateSetting('fontFamily', value);
    });
    fontSection.appendChild(fontFamilyField);
    const fontSizeField = createNumberStepper('Font Size', settings.fontSize, 10, 36, value => {
      void updateSetting('fontSize', value);
    });
    fontSection.appendChild(fontSizeField);

    const themeSection = createSection('Theme');
    const themeGrid = createElement('div', 'markedit-settings-theme-grid', themeSection);
    for (const theme of builtInThemes) {
      const card = createElement('button', 'markedit-settings-theme-card');
      card.type = 'button';
      card.classList.toggle('is-selected', settings.theme === theme.id);
      card.appendChild(createThemeSwatch(theme.colors));
      createElement('div', 'markedit-settings-theme-label', card, theme.label);
      card.addEventListener('click', () => {
        void updateSetting('theme', theme.id);
      });
      themeGrid.appendChild(card);
    }

    const moreThemesButton = createButton('Get More Themes...', () => {
      window.chromeUI?.openExtensionsManager('discover');
    }, 'markedit-chrome-button markedit-settings-more-themes');
    themeSection.appendChild(moreThemesButton);

    const displaySection = createSection('Display');
    displaySection.appendChild(createToggle('Line Numbers', settings.showLineNumbers, value => {
      void updateSetting('showLineNumbers', value);
    }));
    displaySection.appendChild(createToggle('Active Line Indicator', settings.showActiveLineIndicator, value => {
      void updateSetting('showActiveLineIndicator', value);
    }));
    const invisiblesField = createSelect('Invisible Characters', invisiblesOptions, settings.invisiblesBehavior, value => {
      void updateSetting('invisiblesBehavior', value);
    });
    displaySection.appendChild(invisiblesField);

    const editSection = createSection('Edit Behavior');
    editSection.appendChild(createToggle('Line Wrapping', settings.lineWrapping, value => {
      void updateSetting('lineWrapping', value);
    }));
    editSection.appendChild(createToggle('Typewriter Mode', settings.typewriterMode, value => {
      void updateSetting('typewriterMode', value);
    }));
    editSection.appendChild(createToggle('Focus Mode', settings.focusMode, value => {
      void updateSetting('focusMode', value);
    }));
    const lineHeightField = createSelect('Line Height', lineHeightOptions, settings.lineHeight, value => {
      void updateSetting('lineHeight', value);
    });
    editSection.appendChild(lineHeightField);

    const indentSection = createSection('Indentation');
    const tabBehaviorField = createSelect('Tab Key Behavior', tabKeyBehaviorOptions, settings.tabKeyBehavior, value => {
      void updateSetting('tabKeyBehavior', value);
    });
    indentSection.appendChild(tabBehaviorField);
    const indentUnitField = createSelect('Indent Unit', indentUnitOptions, settings.indentUnit, value => {
      void updateSetting('indentUnit', value);
    });
    indentSection.appendChild(indentUnitField);
  }

  function renderAssistantTab(): void {
    const formatSection = createSection('Format Files');
    formatSection.appendChild(createToggle('Insert Final Newline', settings.insertFinalNewline, value => {
      void updateSetting('insertFinalNewline', value);
    }));
    formatSection.appendChild(createToggle('Trim Trailing Whitespace', settings.trimTrailingWhitespace, value => {
      void updateSetting('trimTrailingWhitespace', value);
    }));

    const wordsSection = createSection('Words & Characters');
    wordsSection.appendChild(createToggle('Suggest While Typing', settings.suggestWhileTyping, value => {
      void updateSetting('suggestWhileTyping', value);
    }));
    wordsSection.appendChild(createToggle('Auto Character Pairs', settings.autoCharacterPairs, value => {
      void updateSetting('autoCharacterPairs', value);
    }));
    wordsSection.appendChild(createToggle('Smart Quotes', settings.smartQuotesEnabled, value => {
      void updateSetting('smartQuotesEnabled', value);
    }));
  }

  function renderGeneralTab(): void {
    const section = createSection('General');
    section.appendChild(createSelect('Appearance', appearanceOptions, settings.appearance, value => {
      void updateSetting('appearance', value);
    }));
    section.appendChild(createSelect('New Filename Extension', extensionOptions, settings.newFilenameExtension, value => {
      void updateSetting('newFilenameExtension', value);
    }));
    section.appendChild(createSelect('Default Text Encoding', encodingOptions, settings.defaultTextEncoding, value => {
      void updateSetting('defaultTextEncoding', value);
    }));
    section.appendChild(createSelect('Default Line Endings', lineBreakOptions, settings.defaultLineBreak, value => {
      void updateSetting('defaultLineBreak', value);
    }));

    const actions = createElement('div', 'markedit-settings-actions', section);
    actions.appendChild(createButton('Open settings.json', () => { void openSettingsFile(); }, 'markedit-chrome-button'));
    actions.appendChild(createButton('Reset to Defaults', () => { void resetSettings(); }, 'markedit-chrome-button markedit-chrome-action-button'));
  }

  function renderWindowTab(): void {
    const section = createSection('Window');
    section.appendChild(createToggle('Reduce Transparency', settings.reduceTransparency, value => {
      void updateSetting('reduceTransparency', value);
    }));
  }

  function renderTabs(): void {
    for (const key of Object.keys(tabs) as SettingsTab[]) {
      const button = tabButtons.get(key);
      if (button !== undefined) {
        button.classList.toggle('markedit-chrome-active', activeTab === key);
      }
    }
  }

  function render(): void {
    renderTabs();
    body.innerHTML = '';

    switch (activeTab) {
      case 'editor':
        renderEditorTab();
        break;
      case 'assistant':
        renderAssistantTab();
        break;
      case 'general':
        renderGeneralTab();
        break;
      case 'window':
        renderWindowTab();
        break;
    }
  }

  const focus = () => {
    tabButtons.get(activeTab)?.focus();
  };

  void refreshState();

  return { element: backdrop, focus };
}
