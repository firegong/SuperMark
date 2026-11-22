import { Config, Host, IndentBehavior, InvisiblesBehavior } from './src/config';
import { isReleaseMode } from './src/common/utils';

import { WebModuleConfigImpl } from './src/bridge/web/config';
import { WebModuleCoreImpl } from './src/bridge/web/core';
import { WebModuleCompletionImpl } from './src/bridge/web/completion';
import { WebModuleHistoryImpl } from './src/bridge/web/history';
import { WebModuleLineEndingsImpl } from './src/bridge/web/lineEndings';
import { WebModuleSelectionImpl } from './src/bridge/web/selection';
import { WebModuleFormatImpl } from './src/bridge/web/format';
import { WebModuleSearchImpl } from './src/bridge/web/search';
import { WebModuleTableOfContentsImpl } from './src/bridge/web/toc';
import { WebModuleAPIImpl } from './src/bridge/web/api';
import { WebModuleWritingToolsImpl } from './src/bridge/web/writingTools';
import { WebModuleFoundationModelsImpl } from './src/bridge/web/foundationModels';

import { pseudoDocument } from './test/utils/mock';
import { createNativeModule } from './src/bridge/nativeModule';
import { NativeModuleCore } from './src/bridge/native/core';
import { NativeModuleCompletion } from './src/bridge/native/completion';
import { NativeModuleTokenizer } from './src/bridge/native/tokenizer';
import { NativeModuleAPI } from './src/bridge/native/api';
import { NativeModuleFoundationModels } from './src/bridge/native/foundationModels';
import { NativeModuleTranslation } from './src/bridge/native/translation';
import { NativeModuleSecretStorage } from './src/bridge/native/secretStorage';

import { resetEditor } from './src/core';
import { loadHostDocument, reloadDocumentFromHost, reloadExtensionsFromHost } from './src/hostDocument';
import { initThemeExtractors, initMarkEditModules } from './src/api/modules';
import { setUp, applyReducedMotion } from './src/styling/config';
import { installBundledFonts } from './src/styling/fonts';
import { loadTheme } from './src/styling/themes';
import { startObserving } from './src/modules/events';
import { createScriptRunner } from './src/scriptContext';
import { setUpQuickLook } from './src/@quicklook';
import { initChromeUI } from './src/chrome';
import { initSidebar } from './src/chrome/sidebar';

// In release mode, window.config = "{{EDITOR_CONFIG}}" is replaced with a JSON literal
// by the build (vite transformIndexHtml) and further extended by the native host bootstrap.
// Merge robustly so that an unsubstituted placeholder (a string) or a partial
// host-provided config still yields a mountable editor.
const defaultConfig = {
  host: Host.mainApp,
  text: pseudoDocument,
  theme: 'github-light',
  fontFace: { family: 'D2Coding' },
  fontSize: 17,
  showLineNumbers: true,
  showActiveLineIndicator: true,
  invisiblesBehavior: InvisiblesBehavior.always,
  readOnlyMode: false,
  typewriterMode: false,
  focusMode: false,
  lineWrapping: true,
  lineHeight: 1.5,
  suggestWhileTyping: false,
  smartQuotesEnabled: true,
  autoCharacterPairs: true,
  indentBehavior: IndentBehavior.paragraph,
  standardDirectories: {},
  localizable: {
    previewButtonTitle: 'Preview',
    closeButtonTitle: 'Close',
    cmdClickToFollow: '⌘-click to follow',
    cmdClickToToggleTodo: '⌘-click to toggle todo',
  },
} as Config;

const hostCandidate: unknown = window.config;
const hostProvidedConfig = import.meta.env.PROD && typeof hostCandidate === 'object' && hostCandidate !== null
  ? (hostCandidate as Partial<Config>)
  : {};

const config = { ...defaultConfig, ...hostProvidedConfig } as Config;

// Shared by both hosts, messages are no-ops when there's no native bridge
window.nativeModules = {
  core: createNativeModule<NativeModuleCore>('core'),
  completion: createNativeModule<NativeModuleCompletion>('completion'),
  tokenizer: createNativeModule<NativeModuleTokenizer>('tokenizer'),
  api: createNativeModule<NativeModuleAPI>('api'),
  foundationModels: createNativeModule<NativeModuleFoundationModels>('foundationModels'),
  translation: createNativeModule<NativeModuleTranslation>('translation'),
  secretStorage: createNativeModule<NativeModuleSecretStorage>('secretStorage'),
};

// The native host re-runs the extension bootstrap after installing, removing, or reloading
// extensions. Both globals are defined once (non-writable, non-configurable) and delegate to the
// runner of the latest bootstrap; redefining them would throw "Cannot redefine property".
let currentScriptRunner: ReturnType<typeof createScriptRunner> | undefined;
Object.defineProperty(window, '__prepareScriptContexts__', {
  value: (scripts: Parameters<typeof createScriptRunner>[0]) => {
    currentScriptRunner = createScriptRunner(scripts);
  },
});
Object.defineProperty(window, '__runScriptWithContext__', {
  value: (...args: Parameters<ReturnType<typeof createScriptRunner>>) => {
    if (currentScriptRunner === undefined) {
      throw new Error('Script contexts have not been prepared.');
    }
    currentScriptRunner(...args);
  },
});

switch (config.host) {
  case Host.mainApp: setUpMainApp(config); break;
  case Host.quicklook: setUpQuickLook(config); break;
  default: throw new Error(`Unknown host: ${config.host}`);
}

function setUpMainApp(config: Config) {
  // Initialize and inject modules to the global MarkEdit object
  initMarkEditModules();
  initThemeExtractors();

  window.webModules = {
    config: new WebModuleConfigImpl(),
    core: new WebModuleCoreImpl(),
    completion: new WebModuleCompletionImpl(),
    history: new WebModuleHistoryImpl(),
    lineEndings: new WebModuleLineEndingsImpl(),
    selection: new WebModuleSelectionImpl(),
    format: new WebModuleFormatImpl(),
    search: new WebModuleSearchImpl(),
    toc: new WebModuleTableOfContentsImpl(),
    api: new WebModuleAPIImpl(),
    writingTools: new WebModuleWritingToolsImpl(),
    foundationModels: new WebModuleFoundationModelsImpl(),
  };

  // In release mode, override window APIs to bridge to native
  if (isReleaseMode) {
    window.resizeTo = (width: number, height: number) => {
      window.nativeModules.core.notifyWindowResize({ method: 'to', width, height });
    };

    window.resizeBy = (x: number, y: number) => {
      window.nativeModules.core.notifyWindowResize({ method: 'by', width: x, height: y });
    };

    window.moveTo = (x: number, y: number) => {
      window.nativeModules.core.notifyWindowMove({ method: 'to', x, y });
    };

    window.moveBy = (x: number, y: number) => {
      window.nativeModules.core.notifyWindowMove({ method: 'by', x, y });
    };

    window.close = () => {
      window.nativeModules.core.notifyWindowClose();
    };

    window.print = () => {
      throw new Error('Window.print() is not implemented in this context.');
    };
  }

  window.onload = () => {
    if (!isReleaseMode) {
      window.nativeModules.core.notifyWindowDidLoad();
      window.config = config;
      void resetEditor(config.text);
      return;
    }

    // The desktop host replies with the document and installed extensions (see hostDocument.ts).
    void (async () => {
      try {
        const reply = await (window.nativeModules.core.notifyWindowDidLoad as unknown as () => Promise<unknown>)();
        await loadHostDocument(reply);
      } catch (error) {
        console.error('[MarkEdit] Loading the document failed:', error);
      }
    })();
  };

  Object.defineProperty(window, '__markeditReloadDocument__', { value: reloadDocumentFromHost });
  Object.defineProperty(window, '__markeditReloadExtensions__', { value: reloadExtensionsFromHost });

  installBundledFonts();
  setUp(config, loadTheme(config.theme).colors);
  startObserving();
  initChromeUI();
  initSidebar();

  // Respond to reduced motion preference changes
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionQuery.addEventListener('change', event => applyReducedMotion(event.matches));
}

