# Implementation Roadmap

- **Document ID**: `PLAN-001`
- **Date**: 2026-11-08 (initial), 2026-11-21 (revised based on current implementation)
- **Status**: v2.0 — Phases 1–4 completed (with amendments), Phase 5+ planned
- **Related Documents**: `REQ-002` Requirements (implementation status), `ARCH-002` Bridge Specification (method status)

Scale: **S** < 1 day · **M** a few days · **L** > 1 week

---

## 1. Overview Summary

| Phase | Period | Objective | Status |
| :--- | :--- | :--- | :---: |
| Phase 1 | 2026-11-08 | Core Port & PoC | Completed |
| Phase 2 | 2026-11-08 | Native Shell & Core Features | Completed (2 items amended → Phase 5) |
| Phase 3 | 2026-11-08 | Extension Compatibility & Packaging | Completed (1 item partially completed) |
| Phase 4 | 2026-11-09 ~ 11-21 | Preview/Parsers, Themes/Settings, Windows Quality, Robustness, Rebranding | Completed |
| Phase 5 | Next | Data Integrity, Real Windows Device Verification, Security Finalization | Planned (P0) |
| Phase 6 | Next | Extension APIs, Export & Convenience Features | Planned (P1) |
| Phase 7 | Later | Markdown Super Set Advanced Features, Word Suggestions, Performance | Planned (P2) |

---

## 2. Completed Phases

### Phase 1: Core Port & PoC
- [x] **M1.1**: Imported upstream `CoreEditor` into `packages/core-editor`, passed builds and tests
- [x] **M1.2**: Tauri v2 / WebView2 IPC bridge polyfill
- [x] **M1.3**: macOS-exclusive shortcuts and modifier keys (`Cmd` → `Ctrl`) branching
- [x] **M1.4**: `src-tauri` bootstrap, local `.md` file open, edit, and save

### Phase 2: Native Shell & Core Features
- [ ] ~~**M2.1**: ts-gyb Rust templates and shared DTOs~~ → **Amended: Incomplete**. Codegen currently only renders Swift; the Rust bridge was written manually → Phase 6 `M6.6`
- [x] **M2.2**: Native menu bar and accelerators (`muda`)
- [x] **M2.3**: `DocumentManager` — encoding detection, line ending preservation, modified indicator, save prompt before close. ~~External file watcher~~ → **Amended: Unlinked** → Phase 5 `M5.1`
- [x] **M2.4**: Find/Replace bar, Table of Contents popover, word count statistics
- [x] **M2.5**: `settings.json` and real-time settings live sync

### Phase 3: Extension Compatibility & Packaging
- [x] **M3.1**: `scripts/`, `styles/` extension loaders
- [~] **M3.2**: Extension Native APIs → **Amended: Partially Complete**. Open/save panels, terminate/relaunch absent; text prompt returns prior to input; secret storage uses plaintext → `M5.3`, `M6.3`
- [x] **M3.3**: Auto-backup, multi-window support, `.textbundle`/`.textpack` support
- [x] **M3.4**: File associations, CLI file arguments, NSIS installer, GitHub Actions CI build

### Phase 4: Preview, Themes, Windows Quality (2026-11-09 ~ 11-21)
- [x] **M4.1 App Chrome & Extension Manager**: Settings, version history, extension manager (discover, install, update, sha256 checksums, update behavior) modals, platform-adaptive window controls
- [x] **M4.2 Preview**: Split / Markdown preview views, bidirectional interpolated scroll sync (paused during edit/selection), checkboxes, code copy, secure link routing
- [x] **M4.3 Parsers**: CommonMark, GFM, Extended, Markdown Super Set, micromark (via mdast), gsync Markdown (`docs/reference/GMARKDOWN-SYNTAX.md`), markdown-it — modular architecture where each format has its own folder (`formats/`) containing parser + preview, shared preview components and engines, preview markup contract helpers, and parser contract tests (`DES-002`)
- [x] **M4.4 Renderer Plugins**: Mermaid (bundled), PlantUML, D2, Graphviz (local) + Kroki server fallback; LaTeX → MathML; ~60 language code syntax highlighting (shared between editor and preview, theme colors)
- [x] **M4.5 Themes & Settings**: Theme picker with swatches, 16 per-theme preview default and custom styles, theme extension selection, settings migration (`DES-003`)
- [x] **M4.6 Windows Quality**: Opaque panels by default, Korean font stacks (Pretendard & D2Coding bundled), DPI-aware window sizing, Windows-native scrollbars
- [x] **M4.7 Reliability**: Crash recovery enabled by default, single instance enforcement, bring existing window to front on open, version history deletion and ID validation
- [x] **M4.8 Robustness**: Malformed, hostile, and randomized input test suite, nesting depth limits, linear-time paragraphs, corrupted config fault tolerance
- [x] **M4.9 Rebranding**: App name SuperMark, syntax Markdown Super Set, executable `SuperMark.exe`, repository `firegong/SuperMark`
- [x] **M4.10 Self-Updater**: `tauri-plugin-updater`, public release repository `firegong/SuperMark-releases`, signed update files with `latest.json`, menu and startup check, skip version (`ARCH-001` §8.1, release procedure `docs/06-release/01-release-procedure.md`)

---

## 3. Remaining Work

### Phase 5 (P0): Data Integrity & Release Readiness

| ID | Task | Basis | Scale |
| --- | --- | --- | :---: |
| M5.1 | External file change detection: reload if clean (preserve cursor), notify/diff/merge if dirty (3-way merge on common ancestor, chunk selection), delete/rename notifications, ignore self-saves | FR-02.3 | L |
| M5.2 | Real Windows device validation: font rendering, opaque panels, window sizing, single instance, file associations, `SuperMark.exe` install/update overwrite | FR-07, M4.9 | S |
| M5.3 | Migrate secret storage to Windows Credential Manager (`keyring` or DPAPI) and migrate existing `secrets.json` | FR-04.5 | M |
| M5.4 | Measure installer size and re-evaluate NFR-01 target (e.g. on-demand Mermaid download, font subsetting) | NFR-01 | S |
| M5.5 | Configure update signing keys/tokens in GitHub Secrets, insert public key in `tauri.conf.json`, release two sequential test versions to verify live updater on Windows and macOS | FR-03.7 | S |

### Phase 6 (P1): Feature Polish

| ID | Task | Basis | Scale |
| --- | --- | --- | :---: |
| M6.1 | Status bar (line/col, selection length, encoding, line ending) | FR-03.5 | M |
| M6.2 | PDF export (WebView2 `PrintToPdf`), print options, page break §22 and format condition §24 support | FR-03.6 | M |
| M6.3 | Extension API completion: `showTextBox` input waiting, `showOpenPanel`/`showSavePanel`, `terminateApp`/`relaunchApp`/`playSystemBeep`, `saveDocument` awaitable return, extension menu `stateGetterID` | FR-04.2 | M |
| M6.4 | TextBundle UI: open folder picker, save dialog filter, file associations | FR-02.1 | S–M |
| M6.5 | Version history retention limits, count caps, and automatic cleanup | FR-02.8 | S |
| M6.6 | Add Rust target to `ts-gyb` to auto-generate bridge definitions and prevent type drift | ARCH-002 §5 | M |
| M6.7 | `showAlert` custom button labels (`rfd` with `common-controls-v6`) | FR-04.2 | S |

### Phase 7 (P2): Advanced Features & Performance

| ID | Task | Basis | Scale |
| --- | --- | --- | :---: |
| M7.1 | Markdown Super Set execution chunks (§13): interpreter execution (timeouts, permission settings), output rendering — requires security review before implementation | FR-05.3 | L |
| M7.2 | Chunk result caching `.cache/<label>` (§13.5, §14.4) | FR-05.3 | M |
| M7.3 | Diagram `format: png` support (§14.2) | FR-05.3 | S–M |
| M7.4 | Note embeds `![[note]]` (reuse @include loader) | FR-05.3 | M |
| M7.5 | Word suggestions and completions while typing | REQ-002 §3 | M–L |
| M7.6 | Performance benchmarking and optimization: 300ms cold start, 10MB document handling | NFR-02, NFR-03 | M |

### Items to Verify (Investigate and Classify After Reproduction)

- Relative image paths in preview (`![](assets/x.png)`, TextBundle assets) resolution
- Editor-mode printing truncating long documents (only renders visible lines)
- Direct manual editing of `settings.json` requiring app restart to reflect
