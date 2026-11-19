import { createButton, createElement, setupModalTitleBar } from './utils';
import { InvisiblesBehavior } from '../config';
import { TabKeyBehavior } from '../modules/indentation';
import { listMarkdownRenderers, setDiagramServer, setDiagramRendering, clearDiagramCache } from '../modules/markdown-renderer';

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
  livePreview: boolean;
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
  startupBehavior: 'newDocument' | 'lastSession';
  reduceTransparency: boolean;
  markdownRenderer: string;
  diagramServer: string;
  diagramRendering: 'auto' | 'local' | 'server';
  plantumlCommand: string;
  d2Command: string;
}

interface SettingsModalController {
  readonly element: HTMLElement;
  focus(): void;
}

function pickValue<T>(raw: Record<string, unknown>, keys: string[], fallback: T): T {
  for (const key of keys) {
    const val = raw[key];
    if (val !== undefined && val !== null) {
      return val as T;
    }
  }
  return fallback;
}

function normalizeDiagramRendering(value: unknown): UserSettings['diagramRendering'] {
  return value === 'local' || value === 'server' ? value : 'auto';
}

export function normalizeUserSettings(
  source: unknown,
  fallback?: UserSettings,
): UserSettings {
  const raw = (typeof source === 'object' && source !== null ? source : {}) as Record<string, unknown>;
  const fontFace = (typeof raw.fontFace === 'object' && raw.fontFace !== null ? raw.fontFace : {}) as Record<string, unknown>;

  const base: UserSettings = fallback ?? {
    theme: 'github-light',
    fontFamily: 'ui-monospace',
    fontSize: 16,
    showLineNumbers: true,
    showActiveLineIndicator: true,
    invisiblesBehavior: 'selection',
    typewriterMode: false,
    focusMode: false,
    livePreview: false,
    lineWrapping: true,
    lineHeight: 1.5,
    tabKeyBehavior: 2,
    indentUnit: '    ',
    suggestWhileTyping: true,
    autoCharacterPairs: true,
    smartQuotesEnabled: true,
    insertFinalNewline: true,
    trimTrailingWhitespace: false,
    appearance: 'system',
    newFilenameExtension: 'md',
    defaultTextEncoding: 'UTF-8',
    defaultLineBreak: '\n',
    startupBehavior: 'newDocument',
    reduceTransparency: false,
    markdownRenderer: 'extended',
    diagramServer: 'https://kroki.io',
    diagramRendering: 'auto',
    plantumlCommand: 'plantuml',
    d2Command: 'd2',
  };

  const rawFontFamily = pickValue<string>(
    raw,
    ['fontFamily', 'editor.fontFamily'],
    typeof fontFace.family === 'string' ? fontFace.family : base.fontFamily,
  );
  const normalizedFontFamily = rawFontFamily.startsWith('ui-monospace,')
    ? 'ui-monospace'
    : rawFontFamily;

  return {
    theme: String(pickValue(raw, ['theme', 'lightTheme', 'editor.lightTheme'], base.theme)),
    fontFamily: normalizedFontFamily,
    fontSize: Number(pickValue(raw, ['fontSize', 'editor.fontSize'], base.fontSize)),
    showLineNumbers: Boolean(pickValue(raw, ['showLineNumbers', 'editor.showLineNumbers'], base.showLineNumbers)),
    showActiveLineIndicator: Boolean(
      pickValue(raw, ['showActiveLineIndicator', 'editor.showActiveLineIndicator'], base.showActiveLineIndicator),
    ),
    invisiblesBehavior: pickValue(
      raw,
      ['invisiblesBehavior', 'editor.invisiblesBehavior'],
      base.invisiblesBehavior,
    ),
    typewriterMode: Boolean(pickValue(raw, ['typewriterMode', 'editor.typewriterMode'], base.typewriterMode)),
    focusMode: Boolean(pickValue(raw, ['focusMode', 'editor.focusMode'], base.focusMode)),
    livePreview: Boolean(pickValue(raw, ['livePreview', 'editor.livePreview'], base.livePreview)),
    lineWrapping: Boolean(pickValue(raw, ['lineWrapping', 'editor.lineWrapping'], base.lineWrapping)),
    lineHeight: Number(pickValue(raw, ['lineHeight', 'editor.lineHeight'], base.lineHeight)),
    tabKeyBehavior: Number(pickValue(raw, ['tabKeyBehavior', 'editor.tabKeyBehavior'], base.tabKeyBehavior)),
    indentUnit: String(pickValue(raw, ['indentUnit', 'editor.indentUnit'], base.indentUnit)),
    suggestWhileTyping: Boolean(
      pickValue(raw, ['suggestWhileTyping', 'assistant.wordsInDocument'], base.suggestWhileTyping),
    ),
    autoCharacterPairs: Boolean(
      pickValue(raw, ['autoCharacterPairs', 'assistant.autoCharacterPairs'], base.autoCharacterPairs),
    ),
    smartQuotesEnabled: Boolean(
      pickValue(raw, ['smartQuotesEnabled', 'assistant.smartQuotes'], base.smartQuotesEnabled),
    ),
    insertFinalNewline: Boolean(
      pickValue(raw, ['insertFinalNewline', 'assistant.insertFinalNewline'], base.insertFinalNewline),
    ),
    trimTrailingWhitespace: Boolean(
      pickValue(raw, ['trimTrailingWhitespace', 'assistant.trimTrailingWhitespace'], base.trimTrailingWhitespace),
    ),
    appearance: pickValue(raw, ['appearance', 'general.appearance'], base.appearance),
    newFilenameExtension: String(
      pickValue(raw, ['newFilenameExtension', 'general.newFilenameExtension'], base.newFilenameExtension),
    ),
    defaultTextEncoding: String(
      pickValue(raw, ['defaultTextEncoding', 'general.defaultTextEncoding'], base.defaultTextEncoding),
    ),
    defaultLineBreak: String(
      pickValue(raw, ['defaultLineBreak', 'general.defaultLineBreak'], base.defaultLineBreak),
    ),
    startupBehavior: pickValue(raw, ['startupBehavior', 'general.startupBehavior'], base.startupBehavior) === 'lastSession'
      ? 'lastSession'
      : 'newDocument',
    reduceTransparency: Boolean(
      pickValue(raw, ['reduceTransparency', 'window.reduceTransparency'], base.reduceTransparency),
    ),
    markdownRenderer: String(
      pickValue(raw, ['markdownRenderer', 'preview.markdownRenderer'], base.markdownRenderer),
    ),
    diagramServer: String(
      pickValue(raw, ['diagramServer', 'preview.diagramServer'], base.diagramServer),
    ),
    diagramRendering: normalizeDiagramRendering(pickValue(raw, ['diagramRendering', 'preview.diagramRendering'], base.diagramRendering)),
    plantumlCommand: String(pickValue(raw, ['plantumlCommand', 'preview.plantumlCommand'], base.plantumlCommand)),
    d2Command: String(pickValue(raw, ['d2Command', 'preview.d2Command'], base.d2Command)),
  };
}

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

const diagramRenderingOptions: { value: UserSettings['diagramRendering']; label: string }[] = [
  { value: 'auto', label: 'Local tools, then server' },
  { value: 'local', label: 'Local tools only' },
  { value: 'server', label: 'Diagram server only' },
];

const diagramServerOptions: { value: string; label: string }[] = [
  { value: 'https://kroki.io', label: 'kroki.io (online)' },
  { value: '', label: 'Off (offline diagrams only)' },
];

const startupOptions: { value: UserSettings['startupBehavior']; label: string }[] = [
  { value: 'newDocument', label: 'Open a new document' },
  { value: 'lastSession', label: 'Reopen last session' },
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

function createTextField(label: string, value: string, placeholder: string, onCommit: (value: string) => void): HTMLElement {
  const wrapper = createElement('div', 'markedit-settings-field');
  createElement('label', 'markedit-settings-field-label', wrapper, label);
  const input = createElement('input', 'markedit-chrome-input markedit-settings-text') as HTMLInputElement;
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  // Commit on blur / Enter rather than on every keystroke.
  input.addEventListener('change', () => {
    const next = input.value.trim();
    if (next !== value) {
      onCommit(next);
    }
  });
  wrapper.appendChild(input);
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

  const hasCurrent = options.some(opt => String(opt.value) === String(value));
  const effectiveOptions = hasCurrent
    ? options
    : [{ value, label: String(value) }, ...options];

  for (const option of effectiveOptions) {
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

  const controls = createElement('div', 'markedit-settings-stepper', wrapper);
  const decBtn = createButton('−', () => {
    const current = parseInt(input.value, 10) || value;
    const next = Math.max(min, Math.min(current - 1, max));
    if (next !== current) {
      input.value = String(next);
      onChange(next);
    }
  }, 'markedit-chrome-button markedit-settings-stepper-btn');
  decBtn.title = `Decrease ${label}`;
  controls.appendChild(decBtn);

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
  controls.appendChild(input);

  const incBtn = createButton('+', () => {
    const current = parseInt(input.value, 10) || value;
    const next = Math.max(min, Math.min(current + 1, max));
    if (next !== current) {
      input.value = String(next);
      onChange(next);
    }
  }, 'markedit-chrome-button markedit-settings-stepper-btn');
  incBtn.title = `Increase ${label}`;
  controls.appendChild(incBtn);

  return wrapper;
}

export function createSettingsModal(
  initialTab: SettingsTab = 'editor',
  onClose: () => void,
): SettingsModalController {
  let settings = normalizeUserSettings(window.config);
  let activeTab: SettingsTab = initialTab;
  let mutationVersion = 0;

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
    setAutoCharacterPairs?: (args: { enabled: boolean }) => void;
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
    const versionAtStart = mutationVersion;
    try {
      const result = await invokeTauri<unknown>('settings_get_state');
      if (result !== undefined && mutationVersion === versionAtStart) {
        settings = normalizeUserSettings(result, settings);
        applyAllLocal(settings);
      }
    } catch (error) {
      console.error('Failed to load settings state:', error);
    }
    if (mutationVersion === versionAtStart) {
      render();
    }
  }

  async function updateSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): Promise<void> {
    const currentVersion = ++mutationVersion;
    settings = { ...settings, [key]: value };
    applyLocalChange(key, value);
    render();

    try {
      const result = await invokeTauri<unknown>('settings_update', { patch: { [key]: value } });
      if (result !== undefined && mutationVersion === currentVersion) {
        settings = normalizeUserSettings(result, settings);
        render();
      }
    } catch (error) {
      console.error(`Failed to update setting ${String(key)}:`, error);
    }
  }

  async function resetSettings(): Promise<void> {
    const currentVersion = ++mutationVersion;
    try {
      const result = await invokeTauri<unknown>('settings_reset');
      if (result !== undefined && mutationVersion === currentVersion) {
        settings = normalizeUserSettings(result);
      } else if (result === undefined) {
        settings = normalizeUserSettings({});
      }
      applyAllLocal(settings);
    } catch (error) {
      console.error('Failed to reset settings:', error);
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
        configModule?.setFontSize?.({ fontSize: Number(value) });
        break;
      case 'showLineNumbers':
        configModule?.setShowLineNumbers?.({ enabled: Boolean(value) });
        break;
      case 'showActiveLineIndicator':
        configModule?.setShowActiveLineIndicator?.({ enabled: Boolean(value) });
        break;
      case 'invisiblesBehavior':
        configModule?.setInvisiblesBehavior?.({ behavior: value as InvisiblesBehavior });
        break;
      case 'typewriterMode':
        configModule?.setTypewriterMode?.({ enabled: Boolean(value) });
        break;
      case 'focusMode':
        configModule?.setFocusMode?.({ enabled: Boolean(value) });
        break;
      case 'livePreview':
        window.chromeUI?.setEditorLivePreview(Boolean(value));
        break;
      case 'lineWrapping':
        configModule?.setLineWrapping?.({ enabled: Boolean(value) });
        break;
      case 'lineHeight':
        configModule?.setLineHeight?.({ lineHeight: Number(value) });
        break;
      case 'tabKeyBehavior':
        configModule?.setTabKeyBehavior?.({ behavior: Number(value) as TabKeyBehavior });
        break;
      case 'indentUnit':
        configModule?.setIndentUnit?.({ unit: String(value) });
        break;
      case 'suggestWhileTyping':
        configModule?.setSuggestWhileTyping?.({ enabled: Boolean(value) });
        break;
      case 'autoCharacterPairs':
        configModule?.setAutoCharacterPairs?.({ enabled: Boolean(value) });
        break;
      case 'smartQuotesEnabled':
        configModule?.setSmartQuotesEnabled?.({ enabled: Boolean(value) });
        break;
      case 'defaultLineBreak':
        configModule?.setDefaultLineBreak?.({ lineBreak: String(value) });
        break;
      case 'fontFamily':
        window.config.fontFace = { ...window.config.fontFace, family: value as string };
        configModule?.setFontFace?.({ fontFace: { family: value as string } });
        break;
      case 'appearance': {
        const appearance = value as UserSettings['appearance'];
        document.documentElement.dataset.appearance = appearance;
        if (appearance === 'dark' && settings.theme.endsWith('-light')) {
          const darkCounterpart = settings.theme.replace(/-light$/, '-dark');
          settings = { ...settings, theme: darkCounterpart };
          window.config.theme = darkCounterpart;
          configModule?.setTheme?.({ name: darkCounterpart });
        } else if (appearance === 'light' && settings.theme.endsWith('-dark')) {
          const lightCounterpart = settings.theme.replace(/-dark$/, '-light');
          settings = { ...settings, theme: lightCounterpart };
          window.config.theme = lightCounterpart;
          configModule?.setTheme?.({ name: lightCounterpart });
        }
        break;
      }
      case 'reduceTransparency': {
        const reduced = Boolean(value);
        document.documentElement.dataset.reduceTransparency = String(reduced);
        document.body.classList.toggle('markedit-reduce-transparency', reduced);
        break;
      }
      case 'markdownRenderer':
        window.chromeUI?.setMarkdownRenderer(String(value));
        break;
      case 'diagramServer':
        if (window.chromeUI === undefined) {
          setDiagramServer(String(value));
        } else {
          window.chromeUI.setDiagramServer(String(value));
        }
        break;
      case 'diagramRendering':
        if (window.chromeUI === undefined) {
          setDiagramRendering(String(value));
        } else {
          window.chromeUI.setDiagramRendering(String(value));
        }
        break;
      case 'plantumlCommand':
      case 'd2Command':
        // Rendered results are cached by source; re-render with the new tool.
        clearDiagramCache();
        window.chromeUI?.setDiagramRendering(settings.diagramRendering);
        break;
      case 'startupBehavior':
      case 'defaultTextEncoding':
      case 'insertFinalNewline':
      case 'newFilenameExtension':
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
    applyLocalChange('livePreview', next.livePreview);
    applyLocalChange('lineWrapping', next.lineWrapping);
    applyLocalChange('lineHeight', next.lineHeight);
    applyLocalChange('tabKeyBehavior', next.tabKeyBehavior);
    applyLocalChange('indentUnit', next.indentUnit);
    applyLocalChange('suggestWhileTyping', next.suggestWhileTyping);
    applyLocalChange('autoCharacterPairs', next.autoCharacterPairs);
    applyLocalChange('smartQuotesEnabled', next.smartQuotesEnabled);
    applyLocalChange('defaultLineBreak', next.defaultLineBreak);
    applyLocalChange('reduceTransparency', next.reduceTransparency);
    applyLocalChange('markdownRenderer', next.markdownRenderer);
    applyLocalChange('diagramServer', next.diagramServer);
    applyLocalChange('diagramRendering', next.diagramRendering);
    document.documentElement.dataset.appearance = next.appearance;
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
    displaySection.appendChild(createToggle('Live Preview in Editor', settings.livePreview, value => {
      void updateSetting('livePreview', value);
    }));

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
    section.appendChild(createSelect('On Startup', startupOptions, settings.startupBehavior, value => {
      void updateSetting('startupBehavior', value);
    }));
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
    const rendererOptions = listMarkdownRenderers().map(engine => ({ value: engine.id, label: engine.name }));
    section.appendChild(createSelect('Markdown Parser', rendererOptions, settings.markdownRenderer, value => {
      void updateSetting('markdownRenderer', value);
    }));
    // PlantUML, D2 and advanced Mermaid diagrams are rendered by a Kroki server; their source
    // text is sent there. A self-hosted server can be set in settings.json.
    renderDiagramSection();

    const actions = createElement('div', 'markedit-settings-actions', section);
    actions.appendChild(createButton('Open settings.json', () => { void openSettingsFile(); }, 'markedit-chrome-button'));
    actions.appendChild(createButton('Reset to Defaults', () => { void resetSettings(); }, 'markedit-chrome-button markedit-chrome-action-button'));
  }

  function renderDiagramSection(): void {
    // PlantUML, D2 and Mermaid render locally (installed tools, bundled mermaid.js) and/or on a
    // Kroki server. With the server in use, diagram sources are sent there.
    const section = createSection('Diagrams');
    section.appendChild(createSelect('Diagram Rendering', diagramRenderingOptions, settings.diagramRendering, value => {
      void updateSetting('diagramRendering', value);
    }));
    section.appendChild(createSelect('Diagram Server', diagramServerOptions, settings.diagramServer, value => {
      void updateSetting('diagramServer', value);
    }));
    section.appendChild(createTextField('PlantUML Command', settings.plantumlCommand, 'plantuml or C:\\tools\\plantuml.jar', value => {
      void updateSetting('plantumlCommand', value);
    }));
    section.appendChild(createTextField('D2 Command', settings.d2Command, 'd2', value => {
      void updateSetting('d2Command', value);
    }));

    const status = createElement('div', 'markedit-settings-tool-status');
    const actions = createElement('div', 'markedit-settings-actions', section);
    actions.appendChild(createButton('Check Local Tools', () => { void checkLocalTools(status); }, 'markedit-chrome-button'));
    section.appendChild(status);
  }

  async function checkLocalTools(status: HTMLElement): Promise<void> {
    status.textContent = 'Checking…';
    try {
      const result = await invokeTauri<{ tool: string; available: boolean; version?: string | null; error?: string | null }[] | undefined>('diagram_tools_status');
      status.replaceChildren();
      for (const tool of result ?? []) {
        const row = createElement('div', tool.available ? 'is-available' : 'is-missing', status);
        const name = tool.tool === 'plantuml' ? 'PlantUML' : tool.tool === 'd2' ? 'D2' : tool.tool;
        row.textContent = tool.available
          ? `✓ ${name}: ${tool.version ?? 'installed'}`
          : `✗ ${name}: ${(tool.error ?? 'not found').replace(/^(not-installed|failed):\s*/, '')}`;
      }
      createElement('div', 'is-available', status, '✓ Mermaid: bundled mermaid.js');
      if ((result ?? []).length === 0) {
        status.textContent = 'Local tools can only be checked in the desktop app.';
      }
    } catch (error) {
      status.textContent = `Could not check local tools: ${String(error)}`;
    }
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

  render();
  void refreshState();

  return { element: backdrop, focus };
}
