import { Config, Dynamics } from '../config';
import { WebModule } from '../bridge/webModule';
import { NativeModuleCore } from '../bridge/native/core';
import { NativeModuleCompletion } from '../bridge/native/completion';
import { NativeModuleTokenizer } from '../bridge/native/tokenizer';
import { NativeModuleAPI } from '../bridge/native/api';
import { NativeModuleFoundationModels } from '../bridge/native/foundationModels';
import { NativeModuleTranslation } from '../bridge/native/translation';
import { NativeModuleSecretStorage } from '../bridge/native/secretStorage';
import { WebMenuItem } from './WebMenuItem';
import { WebPoint } from './WebPoint';

import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { TagStyle } from '@codemirror/language';
import type { MarkdownRendererEngine } from '../modules/markdown-renderer/types';
import type { MarkEdit } from 'markedit-api';

declare global {
  type CodeGen_Int = number & { _brand: never };
  type CodeGen_UInt64 = number & { _brand: never };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CodeGen_Self = any & { _brand: never };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type CodeGen_Dict = any & { _brand: never };
}

interface WebKit {
  messageHandlers?: {
    bridge?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postMessage: (object: any) => Promise<any>;
    };
  };
}

interface TauriInternals {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
}

declare global {
  // https://github.com/MarkEdit-app/MarkEdit-api
  const MarkEdit: MarkEdit;

  interface Window {
    webkit?: WebKit;
    __TAURI_INTERNALS__?: TauriInternals;
    editor: EditorView;
    config: Config;
    dynamics: Dynamics;
    webModules: Record<string, WebModule>;
    nativeModules: {
      core: NativeModuleCore;
      completion: NativeModuleCompletion;
      tokenizer: NativeModuleTokenizer;
      api: NativeModuleAPI;
      foundationModels: NativeModuleFoundationModels;
      translation: NativeModuleTranslation;
      secretStorage: NativeModuleSecretStorage;
    };
    __extractStyleRules__: (theme: Extension) => string[] | undefined;
    __extractHighlightSpecs__: (theme: Extension) => TagStyle[] | undefined;
    __flattenThemeExtensions__: (theme: Extension) => Extension[];

    chromeUI?: ChromeUI;
  }

  interface ChromeUI {
    openFindBar(withReplace?: boolean): void;
    closeFindBar(): void;
    toggleToc(): void;
    toggleStatistics(): void;
    openGotoLine(): void;
    showTextBox(options?: { title?: string; defaultValue?: string; placeholder?: string }): Promise<string | undefined>;
    showContextMenu(options: { items: WebMenuItem[]; location?: WebPoint }): void;
    openExtensionsManager(initialTab?: 'discover' | 'installed' | 'updates'): void;
    openSettings(initialTab?: 'editor' | 'assistant' | 'general' | 'window'): void;
    openVersionHistory(): void;
    toggleMarkdownPreview(preferredMode?: 'split' | 'preview'): void;
    setMarkdownPreviewMode(mode: 'editor' | 'split' | 'preview'): void;
    getMarkdownPreviewMode(): 'editor' | 'split' | 'preview';
    setMarkdownStandard(standard: string): void;
    getMarkdownStandard(): string;
    registerMarkdownRenderer(engine: MarkdownRendererEngine): void;
    setMarkdownRenderer(id: string): void;
    setDiagramServer(url: string): void;
    setDiagramRendering(mode: string): void;
    closeAll(): void;
  }
}

export {};
