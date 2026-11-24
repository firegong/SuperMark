import type { MenuItem } from 'markedit-api';
const contextFactories = new WeakMap<object, (filePath: string, capability?: string) => object>();
const reflectGet = Reflect.get;
const reflectApply = Reflect.apply;

interface ContextualScript {
  path: string;
  capability?: string;
}

/** The MarkEdit Preview extension, whose markdown-it renderer is offered as a parser. */
const previewExtensionCapability = 'markedit-preview.js';

/**
 * The preview has a single UI (View → Split Preview / Markdown View) and the extension's
 * markdown-it is chosen in View → Markdown Parser, so its own view-mode items are dropped:
 * "Change Mode" (which also claimed Ctrl+V) and the four mode items (those with a `state`).
 * Its HTML export items stay. The extension is put back into source mode once the app is ready,
 * so a mode it remembered cannot open a second preview.
 */
function previewExtensionMenuFilter(api: typeof MarkEdit) {
  return (spec: MenuItem | MenuItem[]) => {
    const items = Array.isArray(spec) ? spec : [spec];
    const filtered = items.map(item => {
      const children = item.children ?? [];
      if (!children.some(child => child.state !== undefined)) {
        return item;
      }

      const sourceMode = children.find(child => child.state !== undefined)?.action;
      if (sourceMode !== undefined) {
        api.onAppReady(() => {
          try {
            sourceMode();
          } catch (error) {
            console.error('[MarkEdit] Could not reset the preview extension mode:', error);
          }
        });
      }

      // The first child is "Change Mode" (it has a shortcut); the mode items have a `state`.
      const kept = children.filter((child, index) => child.state === undefined && !(index === 0 && child.key !== undefined));
      // Drop leading, trailing and doubled separators left by the removed items.
      const cleaned = kept.filter((child, index) => child.separator !== true || (index > 0 && index < kept.length - 1 && kept[index - 1].separator !== true));
      return { ...item, title: 'MarkEdit Preview', children: cleaned };
    });

    api.addMainMenuItem(filtered);
  };
}

/**
 * Create script-local MarkEdit and require bindings, scoping opted-in APIs to filePath.
 */
export function createScriptContext(filePath: string, capability?: string) {
  const boundValues = new Map<PropertyKey, object>();
  for (const property of Object.keys(MarkEdit)) {
    const value: unknown = reflectGet(MarkEdit, property);
    const factory = typeof value === 'function' ? contextFactories.get(value) : undefined;
    if (factory !== undefined) {
      boundValues.set(property, factory(filePath, capability));
    }
  }

  if (capability === previewExtensionCapability) {
    boundValues.set('addMainMenuItem', previewExtensionMenuFilter(MarkEdit));
  }

  const getBound = boundValues.get.bind(boundValues);
  const api = new Proxy(MarkEdit, {
    get(target, property) {
      return getBound(property) ?? reflectGet(target, property);
    },
  });

  const apiModule = { MarkEdit: api };
  const require = typeof window.require === 'function' ? new Proxy(window.require, {
    apply(target, thisArg, args) {
      return args[0] === 'markedit-api' ? apiModule : reflectApply(target, thisArg, args);
    },
  }) : undefined;

  return { MarkEdit: api, require };
}

/**
 * Register a factory for a script-local API function or object.
 */
export function withScriptContext<API extends object>(factory: (filePath: string, capability?: string) => API): API {
  const unbound = () => {
    throw new Error('This API requires a script-local MarkEdit instance.');
  };

  // Reject both calls and property access until a script-local lookup resolves the factory.
  const placeholder: object = new Proxy(unbound, { get: unbound });
  contextFactories.set(placeholder, factory);
  return placeholder as API;
}

/**
 * Prepare bindings up front; each separately injected script can claim its context once.
 */
export function createScriptRunner(scripts: ContextualScript[]) {
  const contexts = new Map(scripts.map(script => [
    script.capability ?? script.path,
    createScriptContext(script.path, script.capability),
  ]));

  const getContext = contexts.get.bind(contexts);
  const deleteContext = contexts.delete.bind(contexts);

  return (key: string, execute: (api: typeof MarkEdit, require: typeof window.require | undefined) => void) => {
    const context = getContext(key);
    if (context === undefined) {
      throw new Error('Script context is unavailable.');
    }

    deleteContext(key);
    execute(context.MarkEdit, context.require);
  };
}
