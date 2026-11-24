# SuperMark

**SuperMark** is a cross-platform (macOS + Windows) markdown editor ported and extended from **[MarkEdit](https://github.com/MarkEdit-app/MarkEdit)** using **Tauri v2 (Rust + WebView2 / WKWebView)**.

SuperMark was created to showcase and test **Markdown Super Set Format** — a unified markdown dialect that collects the best syntax from MultiMarkdown 6, Pandoc, markdown-it, and Obsidian. See the [Markdown Super Set Format repository](https://github.com/firegong/Markdown-Super-Set-Format) for the full specification.

## Core Highlights

- **Lightweight native shell**: combines macOS `WKWebView` / Windows `WebView2` with a Rust (`Tauri v2`) native host instead of Electron.
- **Proven editor engine (`CoreEditor`)**: runs the CodeMirror 6 + Lezer based GitHub Flavored Markdown editor core and the `markedit-api` extension runtime as-is.
- **Cross-platform Fluent Chrome UI**:
  - Find and replace bar (`Cmd/Ctrl+F`, `Cmd/Ctrl+H` — regex, case sensitivity, whole word, match counter)
  - Real-time filtering table of contents popover (`Cmd/Ctrl+Shift+O`) and document/selection statistics popover with CJK word count (`Cmd/Ctrl+Shift+I`)
  - Go to line (`Cmd/Ctrl+G`), extension prompt modal (`showTextBox`), and floating context menu (`showContextMenu`)
- **Folder sidebar**: recursively scans a folder and shows only markdown files in a tree, with an outline tab for the current document's headings.
- **Complete document lifecycle (`DocumentManager`)**:
  - Multi-encoding auto-detection and preservation (`UTF-8`, `UTF-8 BOM`, `UTF-16LE`, `UTF-16BE`, `EUC-KR/CP949`) and line-ending (`CRLF`/`LF`) preservation
  - Direct open/save of `.textbundle` directories and `.textpack` archives
  - Real-time external file change watching (`notify`), auto-save, hot-exit backup, local file version history (`Versions/`), save confirmation guard before close
- **Local image rendering**: renders relative-path images in the markdown preview relative to the document folder.
- **Extension ecosystem compatibility (`%APPDATA%/SuperMark/` or `~/Library/Application Support/SuperMark/`)**:
  - Auto-injection of `scripts/*.js` and `styles/*.css` (`__prepareScriptContexts__` / `__runScriptWithContext__`)
  - Persistent `MarkEdit.secretStorage` and system clipboard (`arboard`) integration
- **Extensions system (upstream compatible)**:
  - `Extensions` menu: browse (GitHub registry), check for updates, install from URL, open extensions folder, reload extensions
  - `extensions.json` configuration (`$schema`, `registry.url`, `registry.updateBehavior`: quiet/notify/automatic/never)
  - Conditional GET for registry index (`If-None-Match` ETag, 1-hour TTL), sha256 integrity check, `minAppVersion` compatibility check
  - `Notify`: once-a-day update prompt / `Automatic`: silent install then re-inject

---

## Repository Structure

```text
SuperMark/
├── README.md                                 # Project overview and build guide (English)
├── README.ko.md                              # Korean version
├── LICENSE                                    # MIT License
├── .github/workflows/                        # CI build and test pipelines
├── docs/                                     # SDLC artifacts
│   ├── 01-requirements/                      # Feasibility analysis and SRS
│   ├── 02-architecture/                      # System architecture and Native↔Web RPC spec
│   ├── 03-design/                            # Document lifecycle detailed design
│   ├── 04-roadmap/                           # Phase 1~3 implementation roadmap
│   └── 05-testing/                           # Test and verification plans
├── packages/
│   └── core-editor/                          # MarkEdit CoreEditor (CodeMirror 6 + Fluent Chrome UI)
├── src-tauri/                                # Native host (Rust / Tauri v2)
│   ├── src/bridge/                           # Bidirectional bridge dispatcher, shared DTOs, SecretStorage
│   ├── src/document/                         # Document session, encoding, TextBundle/TextPack, version history, file watcher
│   ├── src/extensions/                       # User script (.js) and style (.css) loader
│   ├── src/menu/                             # Native menu bar and shortcut router
│   └── src/settings/                         # EditorConfig and settings.json manager
└── scripts/                                  # Code generation and build automation
```

---

## Build & Verification

### 1. `CoreEditor` frontend bundle build and test
```bash
cd packages/core-editor
yarn install
yarn test        # Run Jest suites
yarn build       # ESLint + TypeScript check + single HTML bundle (dist/index.html)
```

### 2. Tauri v2 (Rust) native host test and build
```bash
cd src-tauri
cargo test       # Encoding, TextBundle/TextPack, bridge, version history, extension loader unit tests
cargo build --release
```

---

## License & Credits

- Original project: [MarkEdit-app/MarkEdit](https://github.com/MarkEdit-app/MarkEdit) (MIT License, Copyright (c) cyanzhong and contributors)
- SuperMark is a Tauri v2 port and extension of MarkEdit.
- See `LICENSE` for the full license and third-party notices.

EOF