# MarkEdit Windows Porting Feasibility & Architecture Analysis

- **Document ID**: `REQ-001`
- **Date**: 2026-11-08
- **Target Upstream**: [`MarkEdit-app/MarkEdit`](https://github.com/MarkEdit-app/MarkEdit) (based on `v1.37.1`)
- **Selected Tech Stack**: **Option 1 — Tauri v2 (Rust + Microsoft Edge WebView2) + `CoreEditor` Reuse**
- **Document Nature**: Analysis report written at project inception (2026-11-08). Subsequent implementation followed this direction, and the application name was updated to **SuperMark**. Current requirements and architecture are defined in `REQ-002` (Requirements), `ARCH-001` (System Architecture), `ARCH-002` (Bridge RPC), and `DES-001`–`DES-003` (Detailed Design).

---

## 1. Executive Summary

When porting MarkEdit to Windows, **a direct port by re-compiling the Swift source code on Windows is practically impossible**. The Swift layer accounts for approximately 67% of the codebase and is tightly coupled with macOS-exclusive frameworks such as `AppKit`, `NSDocument`, `WKWebView`, and `NSSpellChecker`.

However, **a hybrid porting approach has very high technical feasibility: reusing the core editor engine `CoreEditor` (TypeScript / CodeMirror 6) and the bidirectional RPC bridge contract (`ts-gyb`-based code generation structure) as-is, while implementing the native host shell in Tauri v2 (Rust + WebView2).**

---

## 2. Upstream MarkEdit Repository Structure & Code Share Analysis

Language distribution and module breakdown based on GitHub `MarkEdit-app/MarkEdit` (`main` branch):

### 2.1 Code Share by Language

| Language | Bytes | Share | File Count | Primary Role |
| :--- | ---: | ---: | ---: | :--- |
| **Swift** | 1,302,292 B | **67.1%** | 328 | macOS window/document lifecycle (`NSDocument`), native UI (`AppKit`), `WKWebView` bridge |
| **TypeScript** | 617,903 B | **31.8%** | 226 | CodeMirror 6 Markdown editor (`CoreEditor`), bridge interface, extension runtime |
| **Mustache** | 7,134 B | 0.4% | 7 | `ts-gyb` templates for TypeScript → Swift bridge automatic code generation |
| **JavaScript / CSS / HTML** | 13,385 B | 0.7% | 20+ | Bundle entry (`index.html`), stylesheets, 3rd-party renderers |

### 2.2 Core Directory Roles & Windows Reusability Evaluation

| Directory | Breakdown | Role & Dependencies | Windows Reusability |
| :--- | :--- | :--- | :---: |
| **`CoreEditor/`** | 283 items (226 files in `src/`) | CodeMirror 6 + Lezer-based Markdown parser/editor, multi-cursor, code folding, find, TOC, `MarkEdit-api` extension system. Single-file HTML bundle built via `vite-plugin-singlefile` | **90–95%** |
| **`CoreEditor/src/@codegen/`** | `config.json` + 7 Mustache templates | Parses AST of `src/config.ts`, `src/bridge/native/*.ts`, `src/bridge/web/*.ts` to generate native bindings | **100%** (with Rust template added) |
| **`MarkEditCore/`** | 41 items (Swift 6.2) | Editor settings serialization and `EditorSharedTypes.swift` shared type definitions | **1:1 Structural Port** (auto-generated as Rust `serde` structs) |
| **`MarkEditKit/`** | 71 items (Swift 6.2) | `WKWebView` message handler (`WKScriptMessageHandlerWithReply`) and generated Native/Web bridge dispatchers | **1:1 Structural Port** (replaced by Tauri IPC / WebView2 adapter) |
| **`MarkEditMac/`** | 328 items (`AppKit`) | `NSDocument`-based file I/O, menu bar, find/replace panel, settings window (`SettingsUI`), `DiffKit`, `FileVersion`, `TextBundle`, `Statistics` | **Requires Rewrite** (replaced by Tauri windows/menus + host UI) |
| **`QuickLookMac/`** | 15 items | macOS Finder QuickLook preview extension | **Excluded** (optional Windows PowerToys Peek / Explorer Preview Handler later) |
| **`UpdateInstaller/`** | 23 items | macOS bundle replacement updater | **Replaced** (using `tauri-plugin-updater`) |

---

## 3. Key Technical Finding: Excellence of Bridge Isolation Architecture

The single most critical reason why porting MarkEdit is practical is that **communication between the web editor (`CoreEditor`) and the native host is cleanly isolated through just two abstraction points**.

### 3.1 Web → Native Invocations (`CoreEditor/src/bridge/nativeModule.ts`)

All native requests inside `CoreEditor` are serialized via ES6 `Proxy` into a uniform message format (`{ moduleName, methodName, parameters }`).

```typescript
// CoreEditor/src/bridge/nativeModule.ts
export function createNativeModule<T extends NativeModule>(moduleName: string): T {
  return new Proxy({} as T, {
    get(_target, p) {
      if (typeof p !== 'string') return undefined;
      return args => new Promise((resolve, reject) => {
        const message = {
          moduleName,
          methodName: p,
          parameters: JSON.stringify(args ?? {}),
        };
        if (isReleaseMode) {
          window.webkit?.messageHandlers?.bridge?.postMessage(message).then(resolve, reject);
        }
      });
    },
  });
}
```

- **Windows Porting Solution**:
  By invoking `window.__TAURI_INTERNALS__.invoke('bridge_invoke', message)` inside `nativeModule.ts`, or injecting a `window.webkit.messageHandlers.bridge.postMessage` polyfill in the initialization script, **we can communicate with the Tauri Rust backend without breaking a single line of `CoreEditor` business logic**.

### 3.2 Native → Web Invocations (`window.webModules`)

During bootstrap, `CoreEditor/index.ts` registers 12 control modules on the global `window.webModules` object:

```typescript
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
```

- **Windows Porting Solution**:
  The Tauri Rust host calls `webview.eval("window.webModules.<module>.<method>(...)")` (via a Promise callback bridge helper when a reply is needed) to immediately control all editor capabilities: loading text, formatting markdown, searching, extracting TOC, altering configuration, and more.

---

## 4. Porting Tech Stack Comparison & Rationale for Option 1 (Tauri v2)

| Evaluation Criteria | **Option 1: Tauri v2 (Rust + WebView2)** ⭐ Selected | Option 2: WinUI 3 / WPF (.NET 8 + WebView2) | Option 3: Electron |
| :--- | :--- | :--- | :--- |
| **Installer Size** | **~3–5 MB** (comparable to upstream 4MB) | ~10–25 MB | 80–120 MB+ |
| **Memory / Launch Speed** | Shares OS-bundled WebView2 + instant launch via Rust native binary | Fast (has .NET runtime initialization overhead) | Heavy due to bundled Chromium redundancy |
| **Native Menu & Window Control** | `muda`-based native Win32 menu bar, multi-window, title bar / Mica effects out of the box | Direct use of WinUI 3 controls | Frameless web implementation or restricted menu |
| **Codegen Compatibility (`ts-gyb`)** | Easy automated conversion from TypeScript types to Rust `struct`/`enum` (`serde`) | TypeScript → C# DTO possible | Not needed (Node IPC) |
| **Future Extensibility** | Same codebase can immediately extend to **Linux (`webkit2gtk`) and macOS builds** | Windows-only lock-in | Cross-platform but resource-heavy |

---

## 5. macOS Dependencies in `CoreEditor` & Patch Targets

While `CoreEditor` is built with web standards, light patching is required for 4 areas where macOS (Safari/WKWebView) assumptions exist:

1. **`browserslist` in `package.json`**:
   - Originally fixed to `"safari >= 18"` → add `"edge >= 120"`, `"chrome >= 120"`.
2. **Shortcuts & Modifier Keys (`Mod` / `Meta` vs `Ctrl`)**:
   - CodeMirror's default keymap supports `Mod` (`Cmd` on macOS, `Ctrl` on Windows), but custom events (`cmdClickToFollow`, `cmdClickToToggleTodo`, direct `metaKey` checks) require platform-adaptive branching (`Ctrl-click`, etc.).
3. **Font Fallbacks (`WebFontFace`)**:
   - When referencing `sf-mono`, `ui-monospace`, and Apple system fonts, complement styles to gracefully fall back to Windows fonts such as `Cascadia Mono`, `Consolas`, and `Segoe UI`.
4. **macOS-Exclusive API Stubs**:
   - `foundationModels` (macOS Apple Intelligence), `writingTools` (macOS Sequoia Writing Tools), and `translation` are safely handled on Windows as no-ops or future OpenAI/Local LLM integration interfaces.
