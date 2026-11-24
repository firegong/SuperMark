# Bidirectional Bridge (Native ↔ Web) RPC Specification

- **Document ID**: `ARCH-002`
- **Date**: 2026-11-08 (initial), 2026-11-21 (revised based on current implementation)
- **Status**: v2.0
- **Source Files**: `packages/core-editor/src/bridge/native/*.ts` (7 modules), `bridge/web/*.ts` (12 modules), `src-tauri/src/bridge/mod.rs`, `src-tauri/src/lib.rs`

Status Legend: ✅ Implemented · ⚠️ Partially Implemented · ⛔ Not Implemented (no-op or returns `null`)

---

## 1. Communication Protocols

### 1.1 Web → Native (`NativeModule`)

Messages constructed by `bridge/nativeModule.ts`:

```json
{
  "moduleName": "core",
  "methodName": "notifyViewDidUpdate",
  "parameters": "{\"contentEdited\":true,\"isDirty\":true,\"selectedLineColumn\":{…}}"
}
```

The bootstrap initialization script installs a WebKit polyfill redirecting upstream CoreEditor calls to Tauri:

```javascript
window.webkit = {
  messageHandlers: {
    bridge: {
      postMessage: message => window.__TAURI_INTERNALS__.invoke('handle_bridge_message', { message })
    }
  }
};
```

Host Dispatching Flow (`lib.rs` `handle_bridge_message` → `bridge/mod.rs` `dispatch_bridge_message`):

1. **Window-context commands intercepted first**: `api.openDocument` (file opening workflow), `api.showAlert` (asynchronous native modal dialogs).
2. **Remaining calls processed by pure dispatcher**: `dispatch_bridge_message(window_label, message, DocumentManager)` returns `(ReturnValue, Option<FollowUpScript>)`. Because this is a pure function, it is unit-tested without a live webview.
3. **Post-processing**: `core.notifyLinkClicked` → link resolution (`follow_link`), `core.notifyViewDidUpdate` → window title update, `api.addMainMenuItems`/`openDocument` → menu rebuild, `core.notifyWindowClose` → window close with dirty check. Follow-up scripts are executed via `window.eval`.

### 1.2 Native → Web (`WebModule`)

The Rust `WebBridge` helper formats invocations and executes them via `webview.eval`.

| Helper | Generated Script |
| --- | --- |
| `format_call` | `window.webModules?.<module>?.<method>?.(<json>)` |
| `format_chrome_call` | `window.chromeUI?.<method>?.(…)` |
| `reset_editor`, `reload_document`, `notify_app_ready`, `mark_content_clean` | Common high-frequency calls |

When return values are required, the web frontend invokes dedicated Tauri commands (e.g. Save menu triggers `invoke('save_document_content', { text: getEditorText() })`). Large payloads like file contents and extensions are passed through command return values rather than inline `eval` scripts.

---

## 2. Web → Native Modules (7 Modules)

### 2.1 `core`

| Method | Status | Host Action |
| --- | --- | --- |
| `notifyWindowDidLoad` | ✅ | Returns `{ text, restoreText, extensions }` (restore text cleared on first retrieval), diagnostic log |
| `notifyViewDidUpdate` | ⚠️ | Updates `is_dirty` state → updates window title `●`. Status bar line/column not yet implemented |
| `notifyEditorDidBecomeIdle` | ✅ | If dirty, returns follow-up script invoking `save_idle_backup` to record auto-backup |
| `notifyLinkClicked` | ✅ | Resolves Ctrl+clicked links using `links.rs` rules (http(s)/mailto → browser, markdown → app, other local files → file manager, unsafe schemes ignored) |
| `notifyWindowClose` | ✅ | Closes window (prompts to save if document is modified) |
| `notifyBackgroundColorDidChange`, `notifyViewportScaleDidChange`, `notifyContentHeightDidChange`, `notifyContentOffsetDidChange`, `notifyCompositionEnded`, `notifyLightWarning`, `notifyWindowResize`, `notifyWindowMove` | ⛔ | No-ops |

### 2.2 `api`

| Method | Status | Host Action |
| --- | --- | --- |
| `openDocument` | ✅ | `open_document_path`: focuses existing window if already open, or creates a new window. Does not overwrite active document |
| `saveDocument` / `closeDocument` | ⚠️ | Dispatches save/close scripts. Note: `saveDocument` returns `true` before disk I/O completes |
| `recentDocumentPaths` | ✅ | Retrieves recent list from `recent.json` |
| `addMainMenuItems` | ✅ | Adds custom items to Extensions menu; dispatches `webModules.api.handleMainMenuAction` on selection. `stateGetterID` not yet supported |
| `showContextMenu` | ✅ | Displays application context menu (`chromeUI`) |
| `showAlert` | ⚠️ | Native dialog via `rfd`, returns pressed button index. Custom button labels mapped to standard buttons (OK/Cancel/Yes/No) |
| `showTextBox` | ⚠️ | Displays modal prompt, but currently returns default value prior to user submission |
| `showPrintPanel` | ⚠️ | Invokes `window.print()`. Print options and PDF export not yet implemented |
| `showOpenPanel` / `showSavePanel` | ⛔ | Returns `null` |
| `openFile` / `revealFile` | ✅ | Opens in default application / reveals file in Explorer or Finder |
| `createFile` / `deleteFile` / `moveFile` / `listFiles` / `getFileContent` / `getFileObject` (base64) / `getFileInfo` | ✅ | Standard filesystem operations via `std::fs`. Defaults to current document folder if path omitted |
| `getFileVersions` | ✅ | Returns JSON string `[{ id, modificationDate(seconds), isLocal }]` |
| `getFileVersionContent` / `restoreFileVersion` | ✅ | Resolves by `id` (legacy `version` parameter accepted for compatibility). Strict ID validation |
| `deleteLocalFileVersions` | ✅ | Deletes **only explicitly specified `ids`**. Deletes nothing if `ids` is empty or omitted |
| `getPasteboardItems` / `getPasteboardString` | ⚠️ | Text-only clipboard access via `arboard` |
| `terminateApp` / `relaunchApp` / `playSystemBeep` / `runService` | ⛔ | Returns `null` |

### 2.3 Other Modules

| Module | Status | Implementation |
| --- | --- | --- |
| `tokenizer` | ✅ | `tokenize`, `moveWordBackward/Forward` via `unicode-segmentation` (UAX #29), UTF-16 code unit position translation |
| `secretStorage` | ⚠️ | `has/get/set/delete` operational. Stored in **plaintext** `secrets.json` (Windows Credential Manager integration planned) |
| `completion` | ⛔ | Returns `null` (word suggestion disabled) |
| `translation` | ⛔ | Returns JSON error `{"error": "Translation is not available on this platform."}` |
| `foundationModels` | ⛔ | `availability` = unavailable, `isResponding` = false (macOS Apple Intelligence exclusive) |

### 2.4 Runtime Information

`MarkEdit.runtimeInfo()`: Bootstrap populates `window.config.runtimeInfo = { appVersion, appBuild, osVersion }`. The frontend populates `webkitVersion` via user agent detection (Chrome / AppleWebKit version).

---

## 3. Native → Web Modules (12 Modules)

| Module | Key Methods | Invocation Triggers |
| --- | --- | --- |
| `core` | `resetEditor`, `getEditorText`, `insertText`, `replaceText`, `handleFocusLost`, `restoreFocus` … | Document open/save, window focus |
| `config` | `setTheme`, `setFontFace`, `setFontSize`, `setShowLineNumbers`, `setInvisiblesBehavior`, `setLineWrapping`, `setLineHeight`, `setTabKeyBehavior`, `setIndentUnit`, `setSmartQuotesEnabled` … | Settings adjustments, multi-window live synchronization |
| `format` | `toggleBold`, `toggleHeading`, `insertCodeBlock`, `insertTable`, `formatContent` … | Format menu items, keyboard shortcuts |
| `history` | `undo`, `redo`, `markContentClean` | Edit menu, save confirmation |
| `lineEndings` | `getLineEndings`, `setLineEndings` | View → Line Endings menu |
| `search` | `updateQuery`, `findNext`, `replaceAll`, `performOperation` (replace within selection) | Find Bar |
| `selection` | `gotoLine`, `scrollToSelection`, `selectWholeDocument` … | Go menu, navigation actions |
| `toc` | `getTableOfContents`, `gotoHeader`, `selectPrevious/NextSection` | Table of Contents popover, Go menu |
| `api` | `notifyAppReady`, `handleMainMenuAction`, `handleContextMenuAction`, `getMenuItemState` | Extension menu dispatch |
| `completion` | `startCompletion`, `setState` | (Word suggestion not yet implemented) |
| `writingTools`, `foundationModels` | — | macOS exclusive, not invoked |

Additionally, the native shell invokes `window.chromeUI` methods (Find Bar, Settings, Extension Manager, Preview Mode, Markdown Parsers, Scroll Sync, Theme Extensions, Preview Styles) to manage user interface state.

---

## 4. Tauri Commands (App Chrome ↔ Host)

27 direct commands exposed across the application via `generate_handler!` in `lib.rs`:

| Category | Commands |
| --- | --- |
| Bridge | `handle_bridge_message` |
| Documents | `save_document_content`, `save_idle_backup`, `document_content`, `view_state_changed` |
| Links | `open_link` |
| Diagrams | `diagram_render_local`, `diagram_tools_status` |
| Settings | `settings_get_state`, `settings_update`, `settings_reset`, `settings_open_file` |
| Versions | `versions_list`, `versions_get_content`, `versions_restore`, `versions_delete_all` |
| Extensions | `extensions_bootstrap`, `extensions_get_state`, `extensions_install`, `extensions_install_url`, `install_extension_from_url`, `extensions_uninstall`, `extensions_set_enabled`, `extensions_update`, `extensions_set_update_behavior`, `extensions_open_folder`, `extensions_open_homepage` |

---

## 5. Code Generation & Roadmap

- `src-tauri/src/bridge/generated/mod.rs` was written manually because `@codegen/config.json` currently targets Swift exclusively. Automating Rust code generation via Mustache templates is planned to eliminate interface drift.
- Incomplete (⚠️) and unimplemented (⛔) items are tracked and prioritized in `docs/04-roadmap/01-implementation-roadmap.md`.
