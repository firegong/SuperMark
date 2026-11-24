# SuperMark Software Requirements Specification (SRS)

- **Document ID**: `REQ-002`
- **Date**: 2026-11-08 (initial), 2026-11-21 (revised based on current implementation)
- **Status**: v2.0
- **Related Documents**: `ARCH-001`, `ARCH-002`, `DES-001`–`DES-003`

Status Legend: ✅ Implemented · ⚠️ Partially Implemented · ⛔ Not Implemented

---

## 1. Purpose & Scope

**SuperMark** (formerly MarkEdit-Win) is a desktop Markdown editor that ports the macOS editor `MarkEdit` to Windows 10/11 (with macOS build support), while adding live preview and an extended syntax (**Markdown Super Set**). This document defines the functional and non-functional requirements alongside the current implementation status for each item.

---

## 2. Functional Requirements

### FR-01: Markdown Editor Core (`CoreEditor`)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-01.1 | GFM syntax highlighting: code blocks, tables, checklists, footnotes, math, YAML front matter | ✅ | |
| FR-01.2 | Multi-cursor, folding, smart quotes, bracket matching, line ending (LF/CRLF) detection and conversion | ✅ | |
| FR-01.3 | Line numbers, active line highlight, invisible characters, typewriter/focus mode, read-only mode | ✅ | |
| FR-01.4 | Per-language syntax highlighting inside fenced code blocks (~60 languages, theme colors) | ✅ | Added. `src/codeLanguages.ts` |
| FR-01.5 | In-editor live preview (inline tables, checkboxes, etc.) | ✅ | Added, disabled by default |

### FR-02: Document & File Lifecycle (`NSDocument` Replacement, `DES-001`)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-02.1 | Open, save, save-as for `.md`, `.markdown`, `.txt`, `.textbundle`, `.textpack` | ⚠️ | Open/save implemented. TextBundle folder picker/filter in dialog not yet fully supported |
| FR-02.2 | Modified indicator in window title (`●`), prompt to save on closing dirty documents | ✅ | |
| FR-02.3 | External file change detection: reload if clean, notify/diff/merge if dirty | ⛔ | Watcher code present but unlinked |
| FR-02.4 | Auto-backup of unsaved documents and crash recovery | ✅ | Prompt on startup, preserved on decline |
| FR-02.5 | Recent documents list | ✅ | Up to 15 items |
| FR-02.6 | Encoding detection (BOM, UTF-8, heuristic), reopen with encoding, save in original format | ✅ | |
| FR-02.7 | Bring existing window to front if file already open; forward CLI file open to running instance (single instance) | ✅ | Added |
| FR-02.8 | Local version history on each save, view/restore/delete versions | ⚠️ | Auto-cleanup of aged versions pending |
| FR-02.9 | Restore previous session (configurable startup behavior) | ✅ | |

### FR-03: Shell & UI

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-03.1 | Native menu bar and Windows standard keyboard shortcuts | ✅ | |
| FR-03.2 | Find & Replace: case sensitivity, whole word, regex, replace all within selection | ✅ | |
| FR-03.3 | Table of contents navigation; character, word, paragraph, reading time statistics | ✅ | |
| FR-03.4 | Settings saved in `settings.json` with real-time sync across all windows | ✅ | 5-tab settings modal, one-time schema migration (`DES-003`) |
| FR-03.5 | Status bar (line / column) | ⛔ | |
| FR-03.6 | Print and PDF export | ⚠️ | Print implemented. PDF/DOCX export pending |
| FR-03.7 | Self-updater: check for updates menu, auto-check at startup (toggleable), skip version, signature verification before install/restart, abort if unsaved documents. Portable single-executable fallback links to release page | ✅ | Public repository `firegong/SuperMark-releases`. Live validation on first signed release (`ARCH-001` §8) |

### FR-04: Extension System (`markedit-api` Compatible)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-04.1 | Load user scripts and styles, global `MarkEdit` API | ✅ | |
| FR-04.2 | Native APIs for extensions: context menu, alerts, text prompts, open/save panels, clipboard, files | ⚠️ | Alerts limited to standard buttons, text prompt returns early, open/save panels pending (`ARCH-002`) |
| FR-04.3 | Extensions manager: discover, install, update, remove, disable, sha256 checksums, update behavior selection | ✅ | Added |
| FR-04.4 | Theme extensions selectable in settings (only chosen theme applies) | ✅ | Added |
| FR-04.5 | Secret storage for extensions | ⚠️ | Plaintext file; Windows Credential Manager integration pending |

### FR-05: Markdown Preview & Parsers (`DES-002`)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-05.1 | Split / Markdown view preview, auto-refresh on edit | ✅ | |
| FR-05.2 | Pluggable parsers: CommonMark, GFM, Extended (default), Markdown Super Set, micromark, gsync Markdown, markdown-it (extension) | ✅ | Each format has its own module folder (parser + preview); shared features centralized. Parser contract test suite |
| FR-05.3 | Markdown Super Set syntax (`MarkdownSuperSetGrammar.md` §0–30) | ⚠️ | Code execution chunks (§13), chunk cache, PNG diagrams, note embeds pending |
| FR-05.4 | Diagrams (Mermaid, PlantUML, D2, Graphviz, draw.io): local tools with Kroki server fallback | ✅ | |
| FR-05.5 | Math rendering (LaTeX → MathML, offline) | ✅ | |
| FR-05.6 | Syntax highlighting in preview code blocks (theme colors), code copy button | ✅ | |
| FR-05.7 | Editor ⇄ Preview bidirectional scroll sync (paused during edit/selection), double-click block to source line, checkbox toggle | ✅ | |
| FR-05.8 | Link clicks: web links open in browser, document links open in app, other files show in explorer | ✅ | Matches Ctrl+click behavior in editor |

### FR-06: Themes & Appearance (`DES-003`)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-06.1 | 16 built-in themes with color swatch picker, light/dark paired switching | ✅ | |
| FR-06.2 | Per-theme preview default styles (font, size, colors, table appearance) | ✅ | Mapped from official palettes |
| FR-06.3 | Per-theme preview custom styling (body, H1–H6, links, code, blockquotes) | ✅ | |

### FR-07: Windows Display Quality (`DES-003` §6–7)

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| FR-07.1 | Crisp font rendering without aliasing or stepping | ✅ | Pretendard and D2Coding bundled; Korean font stacks prioritized |
| FR-07.2 | Fixed-width editor font aligning Korean characters to exactly 2 columns | ✅ | D2Coding |
| FR-07.3 | Default opaque panels (preserves ClearType subpixel antialiasing) | ✅ | |
| FR-07.4 | DPI-aware initial window sizing, Windows-native scrollbars | ✅ | |

---

## 3. Platform Feature Mapping

| Upstream macOS Feature | Porting Policy | Priority | Status |
| --- | --- | :---: | :---: |
| `WKWebView` + message handlers | WebView2 + Tauri IPC polyfill | P0 | ✅ |
| `NSDocument` lifecycle | Rust `DocumentManager` | P0 | ⚠️ (external watcher pending) |
| AppKit menu / context menu | Tauri menu (`muda`) / app UI context menu | P0 | ✅ |
| Keychain (`secretStorage`) | Windows Credential Manager | P1 | ⚠️ (plaintext file) |
| TextBundle | Rust folder/zip reader and writer | P1 | ⚠️ |
| `NSSpellChecker` (word suggestions) | ISpellChecker or built-in tokenizer | P2 | ⛔ (tokenizer only) |
| FileVersion | Local snapshot version history | P2 | ✅ |
| Quick Look | Excluded | — | — |
| FoundationModels / WritingTools | Excluded (no-ops) | — | — |

---

## 4. Non-Functional Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| NFR-01 | Installer Size | **Target Re-evaluation**: Initial target < 10 MB. Bundled assets alone total ~11 MB (Mermaid 5.5 MB, fonts 5.1 MB, editor 1.2 MB). Installer size unmeasured |
| NFR-02 | Cold start to editable within 300ms | Unmeasured |
| NFR-03 | No UI freezing while typing or scrolling 10 MB Markdown documents | Unmeasured. Preview renderers tested for linear time complexity and stack safety on long/deep content |
| NFR-04 | Upstream traceability: minimize `CoreEditor` modifications | ⚠️ App chrome and preview split into `chrome/` and `modules/markdown-renderer/`, but some shared styles and config touched |
| NFR-05 | Security: no script execution in preview, dangerous links blocked, executable files not launched via links, extension integrity verified | ✅ (`ARCH-001` §6) |
| NFR-06 | Robustness: zero unhandled crashes on malformed, hostile, or randomized input; resilient to corrupted config | ✅ (`test/robustness.test.ts`, `docs/05-testing/samples/malformed/`) |
| NFR-07 | Korean language support: Hangul metadata keys, Hangul file link resolution, high-quality Korean typography | ✅ |
| NFR-08 | User data backward compatibility: preserve settings, backups, versions across app renames; one-time settings migration | ✅ |
| NFR-09 | Maintainability: add or replace Markdown formats (parser + preview) without side effects on others; shared features centralized | ✅ (`DES-002` §2, §3.3) |
| NFR-10 | Distribution: signed releases, self-updating app, documented release workflow | ✅ (`ARCH-001` §8.1, `docs/06-release/01-release-procedure.md`) |
