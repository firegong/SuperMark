# System Architecture Specification (Tauri v2 + WebView2 + CoreEditor)

- **Document ID**: `ARCH-001`
- **Date**: 2026-11-08 (initial), 2026-11-21 (revised based on current implementation)
- **Status**: v2.0
- **Related Documents**: `ARCH-002` Bridge Specification, `DES-001` Document Lifecycle, `DES-002` Parsers & Preview, `DES-003` Settings, Themes & Fonts

---

## 1. Overview

**SuperMark** (formerly SuperMarkdownEdit, MarkEdit-Win) is a desktop application that ports and extends the macOS Markdown editor [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) for Windows.

- **Native Host**: Tauri v2 (Rust, `src-tauri/`, crate `supermark`)
- **Renderer**: Microsoft Edge WebView2 (macOS builds use WKWebView)
- **Editor**: Single-file bundle based on upstream MarkEdit's `CoreEditor` (CodeMirror 6 + Lezer, `packages/core-editor/`) + custom application chrome UI and live preview

```text
+-----------------------------------------------------------------------------------+
|                         SuperMark (Native Process, Rust)                          |
|                                                                                   |
|  lib.rs  ── Startup, Window Creation, Tauri Commands (27), Close Guard, Single Inst|
|   ├─ menu/          Native Menu (muda) config, state, actions → Web eval          |
|   ├─ document/      DocumentManager: Sessions, encoding, save, backup, TextBundle |
|   ├─ bridge/        Web bridge dispatcher (core, api, tokenizer, secretStorage...) |
|   ├─ settings/      settings.json, migrations, multi-window live synchronization  |
|   ├─ extensions/    Extension registry, sha256 download verification, settings    |
|   ├─ diagrams/      Local PlantUML, D2, Graphviz subprocess execution             |
|   ├─ links.rs       Link target classification (external / doc / reveal / ignore) |
|   ├─ updates.rs     Self-updater (tauri-plugin-updater, public release repo)      |
|   └─ diagnostics.rs File logging (logs/markedit.log)                              |
|                                                                                   |
|        ▲ invoke('handle_bridge_message', etc.)     │ window.eval(script)          |
+--------|-------------------------------------------|------------------------------+
         |                                           ▼
+-----------------------------------------------------------------------------------+
|                         WebView2 (Renderer, TypeScript)                           |
|                                                                                   |
|  Bootstrap: window.config, MarkEdit.userSettings, runtimeInfo, bridge polyfill    |
|  ├─ CoreEditor (src/core.ts, modules/*, styling/*)   CodeMirror 6 Editor          |
|  │    window.webModules (12)  ◀── Host calls                                      |
|  │    window.nativeModules (7) ──▶ Host calls                                     |
|  ├─ chrome/  App UI: Find Bar, TOC/Stats popovers, Settings, Extension Manager,   |
|  │          Version History, Context Menu, Preview Pane   window.chromeUI         |
|  ├─ modules/markdown-renderer/  Format modules (formats/: parser + preview),      |
|  │                               shared preview (preview/), blockEngine, plugins  |
|  └─ Extension Runtime (markedit-api)  User extension scripts, styles, theme ext   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Repository Layout

| Path | Contents |
| --- | --- |
| `src-tauri/` | Rust host (`Cargo.toml`, `tauri.conf.json`, `src/`) |
| `packages/core-editor/` | Editor, UI chrome, and preview (TypeScript, Vite singlefile build → `dist/`) |
| `docs/` | Requirements, architecture, design specs, roadmap, test plans and samples, release procedures |
| `scripts/` | `build-app.sh` / `build-app.ps1` (Editor build + release compilation, macOS `.app` packaging) |
| `.github/workflows/` | CI and release workflows (publishes signed installers and updater artifacts to `firegong/SuperMark-releases`) |

---

## 3. Processes & Inter-Process Communication (IPC)

| Direction | Mechanism | Purpose |
| --- | --- | --- |
| Web → Native | `__TAURI_INTERNALS__.invoke('handle_bridge_message', { message })` | `window.nativeModules.*` invocations. Seamlessly bridges upstream CoreEditor via `window.webkit.messageHandlers.bridge.postMessage` polyfill (`ARCH-002`) |
| Web → Native | `invoke('<command>', args)` | Tauri commands invoked directly by app chrome: file save, settings, extensions, version history, links, diagrams (`ARCH-002` §4) |
| Native → Web | `webview.eval(script)` | Invocations of `window.webModules.*`, `window.chromeUI.*`, and live settings synchronization |
| Native → Web (Data) | Command return values | Large payloads (document contents, extension scripts) transferred as structured data rather than massive `eval` strings — avoiding WebView2 multi-megabyte `eval` parsing failures |

---

## 4. Startup Sequence

1. **`run()`** (`src-tauri/src/lib.rs`)
   1. Generates bootstrap script (`build_bootstrap_script`).
   2. Single-instance plugin setup: forwards CLI file arguments from secondary launches to the active instance (relative paths resolved against that process's CWD). Focuses existing window if no file arguments provided.
   3. Initializes `DocumentManager` and builds native menu bar (`muda`).
   4. Explicitly creates the main window (`create: false` in `tauri.conf.json`) — injects bootstrap as an initialization script to execute prior to HTML parsing. Sizes window to screen dimensions on Windows.
   5. CLI file arguments: first file loads into main window, subsequent files open in new windows. Crash recovery prompt shown thereafter if unrecovered drafts exist.
   6. No CLI file arguments: restores previous session if configured to `lastSession`, otherwise prompts for crash draft recovery.
   7. Spawns extension update check background thread (policy: Never / Quiet [default] / Notify / Automatic).
   8. Checks for app self-updates in release builds (single check 5 seconds after startup if `general.checkForUpdates` enabled, §8.1).
2. **Bootstrap Script** (initialization script injected into every window): sets `window.config` (EditorConfig), `window.config.runtimeInfo`, `window.MarkEdit.userSettings`, sets `<html data-appearance data-reduce-transparency>`, and installs WebKit bridge polyfills.
3. **Editor Loading**: CoreEditor invokes `core.notifyWindowDidLoad` → host responds with `{ text, restoreText, extensions }` → `hostDocument.ts` sets document content, applies draft recovery edits (undoable, marks modified), and executes extensions individually (isolated so a failing extension cannot block document loading).
4. **Editor & Chrome UI Initialization**: `index.ts` registers bundled `@font-face` fonts and instantiates CodeMirror; `initChromeUI()` initializes `window.chromeUI`, restores saved parser / diagram / preview styles, and sets `<html data-platform>`.

---

## 5. UI Architecture

| Area | Implementation |
| --- | --- |
| Menu Bar | Native Win32 / macOS menu (`muda`): SuperMark, File, Edit, Format, View, Go, Extensions, Window, Help. Dispatches actions as web scripts to focused window. Dynamically updates on extension additions and window focus |
| Find/Replace, TOC, Statistics, Go to Line | In-WebView panels and popovers (`chrome/`). Directly calls `webModules.search`, `webModules.toc` in the same JS execution context |
| Settings, Extension Manager, Version History | In-WebView modal dialogs (`DES-003`) |
| Live Preview | Split / Markdown preview panes; format-specific previews (`DES-002`) |
| Sidebar | VS Code-style Activity Bar and Side Bar panels (Explorer, Outline), with persistent toggle state and resizable panel (`sidebar.ts`, `sidebar.css`) |
| Alert & Save Prompts | Native dialogs via `rfd` |

---

## 6. Security Boundaries

| Item | Design & Enforcement |
| --- | --- |
| Raw HTML in Preview | Common block engine escapes HTML; Markdown Super Set enforces strict tag filtering. Hostile URI schemes (`javascript:`, `vbscript:`, `data:`) blocked |
| Extension Renderers | Rendered in sandboxed iframe (`sandbox="allow-scripts"`) without parent access |
| Links | In-page navigation prevented. `links.rs`: `http(s)` and `mailto` open in system browser; Markdown files open in app; other local files are revealed in file manager (never executed directly); unsafe schemes ignored |
| Extension Installation | Restricted to HTTPS; enforces fixed SHA-256 checksums; extension homepages must use HTTPS |
| Version History IDs | Strictly validated to `v-<ms>-<seq>` format (prevents directory traversal attacks); only targeted IDs deleted |
| Diagram Server Rendering | Rendered strictly as `<img>` tags (prevents inline script execution) |
| App Self-Updates | Downloads verified via Minisign cryptographic signatures against public key embedded in `tauri.conf.json` (`plugins.updater.pubkey`). Private signing key stored solely in GitHub Secrets |
| Secret Storage | Currently plaintext `secrets.json`; planned migration to Windows Credential Manager / macOS Keychain |

---

## 7. User Data Storage (`<config_dir>/MarkEdit/`)

Windows `%APPDATA%\MarkEdit`, macOS `~/Library/Application Support/MarkEdit`. Directory name and bundle identifier (`app.markedit.rust`) are preserved for seamless compatibility across application renames.

| Path | Purpose |
| --- | --- |
| `settings.json` | User configuration (`DES-003`) |
| `recent.json` | Recent documents list (up to 15 items) |
| `last-session.json` | Open windows from previous session |
| `Backups/` | Auto-backups of unsaved content (`<label>.md` + `.json`), moved to `Backups/Discarded/<timestamp>/` if rejected |
| `Versions/<path_hash>/` | Local revision history created on each document save |
| `extensions.json`, `scripts/`, `styles/`, `cache/` | Extension metadata, scripts, styles, registry caches |
| `secrets.json` | Secret storage for extension credentials |
| `logs/markedit.log` | Diagnostic log file (rotates to `.log.1` at 1 MB) |

---

## 8. Build & Distribution

| Stage | Implementation |
| --- | --- |
| Editor | In `packages/core-editor`, run `yarn build` = lint + typecheck + Vite. Bundled into `dist/index.html` via `vite-plugin-singlefile`. Heavy assets copied adjacent: `dist/vendor/mermaid.min.js`, `dist/fonts/` (D2Coding, Pretendard, licenses) |
| Host | `cargo build --release --features tauri/custom-protocol` → `target/release/supermark` (embeds `frontendDist` assets directly into binary) |
| Installer | Automated in release workflow via `tauri build`. Executable named `SuperMark.exe` (`mainBinaryName`), NSIS per-user installer, WebView2 bootstrapper |
| Portable Executable | Windows `SuperMark_<version>_x64_portable.exe`: single standalone executable embedding all web assets; built with `portable` feature flag, updater directs to download page |
| Single Instance | Enforced via `tauri-plugin-single-instance` |

### 8.1 Release & Self-Updater Workflow

The source repository (`firegong/SuperMark`) is private; installers and update bundles are published as releases in the public repository **`firegong/SuperMark-releases`**. The application queries updates without requiring authentication.

| Component | Description |
| --- | --- |
| Release Workflow | `.github/workflows/release.yml`: triggered on `v*` tag push or manual dispatch. Builds on Windows, macOS Apple Silicon, and macOS Intel (cross-compiled) via `tauri-action`, publishing a **draft** release in public repository |
| Updater Artifacts | `bundle.createUpdaterArtifacts: true` produces Windows NSIS updates, macOS `.app.tar.gz` and respective `.sig` signatures. `includeUpdaterJson: true` compiles manifest `latest.json` covering `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` |
| Update Endpoint | `https://github.com/firegong/SuperMark-releases/releases/latest/download/latest.json` |
| Secrets | `RELEASES_TOKEN` (public repo Contents read/write token), `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Client Behavior (`updates.rs`) | Menu *Check for Updates…* always shows outcome alert. Automatic check on startup ignores skipped versions (`general.skippedUpdateVersion`). Prompts: Yes = Install, No = Later, Cancel = Skip Version. Warns if unsaved documents present |
| Versioning | Version incremented simultaneously in `tauri.conf.json` and `Cargo.toml`. App only prompts updates for strictly higher semver |
| Detailed Guide | Refer to `docs/06-release/01-release-procedure.md` |

---

## 9. Code Generation (`ts-gyb`)

`packages/core-editor/src/@codegen/config.json` currently renders **Swift targets only** (retained from upstream MarkEditCore/MarkEditKit). The Rust bridge dispatcher `src-tauri/src/bridge/generated/mod.rs` was authored manually. Adding a Rust target (via `rust-*.mustache` templates) to automate synchronization between TypeScript interfaces and Rust structs is tracked in `ARCH-002` §5 and roadmap item `M6.6`.
