# Settings, Themes, Fonts and Windows Display Detailed Design

- **Document ID**: `DES-003`
- **Date**: 2026-11-21
- **Status**: v1.0 (based on current implementation)
- **Related documents**: `ARCH-001` System Architecture, `DES-002` Markdown Parsers and Preview

---

## 1. Purpose and Scope

Defines user settings storage, migration, and application flow, the settings UI, editor/preview themes, bundled fonts, and Windows display adaptation.

---

## 2. Settings Store

### 2.1 Location and Format

| Item | Content |
| --- | --- |
| File | `<config_dir>/MarkEdit/settings.json` — Windows `%APPDATA%\MarkEdit\settings.json`, macOS `~/Library/Application Support/MarkEdit/settings.json` (folder name kept as-is after app rename to preserve existing user data) |
| Manager | Rust `SettingsManager` (`src-tauri/src/settings/mod.rs`) |
| Format | Flat JSON with dot-notation keys. All fields are written on save |

| Category | Keys |
| --- | --- |
| `editor.*` | `fontFamily`, `fontSize`, `lightTheme`, `darkTheme`, `themeExtension`, `showLineNumbers`, `showActiveLineIndicator`, `invisiblesBehavior`, `typewriterMode`, `focusMode`, `livePreview`, `lineWrapping`, `lineHeight`, `tabKeyBehavior`, `indentUnit` |
| `assistant.*` | `insertFinalNewline`, `trimTrailingWhitespace`, `wordsInDocument`, `autoCharacterPairs`, `smartQuotes` |
| `general.*` | `appearance`, `newFilenameExtension`, `defaultTextEncoding`, `defaultLineBreak`, `startupBehavior`, `checkForUpdates` (on by default), `skippedUpdateVersion` (version skipped in the update dialog) |
| `window.*` | `reduceTransparency` |
| `preview.*` | `markdownRenderer`, `diagramServer`, `diagramRendering`, `plantumlCommand`, `d2Command`, `themeStyles` |
| `meta.*` | `settingsRevision` |

### 2.2 Read and Migration

1. File keys overwrite `UserSettings::default()`. Frontend-style names (`fontSize`, `theme`, etc.) are accepted and canonicalized (`canonical_setting_key`).
2. `migrate_settings` changes values once based on `meta.settingsRevision`. All fields are saved, so changing a default alone would not reach existing files.

| Revision | Change |
| --- | --- |
| 2 | `window.reduceTransparency` defaults to on. One-time `false` → `true` |
| 3 | Editor default font D2Coding. Only the old default (never offered in Settings, so never chosen by hand) changes; user-chosen fonts are kept |

3. The frontend re-validates received values (`normalizeUserSettings`): enums allow only permitted values, numbers stay in range (font size 8–72, line height 1–3), preview styles via `normalizePreviewThemeStyles`.

### 2.3 Change Application Flow

```text
Settings UI ──applyLocalChange──▶ applied to current window immediately
      └──invoke('settings_update', { patch })──▶ Rust: save
                                                   └─ build_live_sync_js ──eval──▶ all windows
                                                        (config setters, theme, parser, diagrams, preview styles …)
```

---

## 3. Settings UI (`chrome/settingsModal.ts`)

| Tab | Sections | Items |
| --- | --- | --- |
| Editor | Font / Theme / Display / Edit Behavior / Indentation | Font (default D2Coding), size, **theme dropdown (color swatches)**, Get More Themes, line numbers, active line indicator, invisibles, live preview in editor, line wrapping, typewriter mode, focus mode, line height, tab key behavior, indent unit |
| Preview | Theme / Typography | Preview style edit target per theme, sample, per-element font/size/weight/color |
| Assistant | Format Files / Words & Characters | Insert final newline, trim trailing whitespace, word suggestions while typing, auto character pairs, smart quotes |
| General | General / Diagrams | Startup behavior, auto update check, appearance (system/light/dark), new file extension, default encoding, default line break, markdown parser, diagram rendering/server/PlantUML/D2 commands |
| Window | Window | Reduce transparency (on by default) |

- The theme dropdown is a custom listbox showing color swatches per theme; supports keyboard (↑↓, Home/End, Enter/Space, Esc) and screen readers. Esc closes only the list.
- Dialog window buttons (macOS style) match native macOS 26 dimensions: 14×14px, 23px center spacing.

---

## 4. Editor Themes

| Item | Content |
| --- | --- |
| Built-in themes | 16 (`src/styling/themes/`): GitHub, Xcode, Winter is Coming, Minimal, Solarized, Rosé Pine (Dawn) in light/dark, Dracula, Cobalt, SynthWave '84, Night Owl |
| Composition | Theme = editor colors (`EditorColors`) + syntax highlighting style (`HighlightStyle`) |
| Appearance switch | Switching appearance dark/light swaps the `-light` ↔ `-dark` paired theme |
| Theme extensions | MarkEdit theme extensions (`window.__markeditTheming__`) record contributions during script execution; only the selected extension's colors are applied (`chrome/themeExtensions.ts`). Selecting a built-in theme removes extension colors |
| Code highlighting | Both editor and preview code blocks use the current theme's highlighting classes (DES-002 §5) |

---

## 5. Preview Themes

Two layers; user settings take precedence.

| Layer | File | Content |
| --- | --- | --- |
| Theme defaults | `chrome/previewThemePresets.ts` | Per built-in theme: officially surveyed palette for fonts, sizes, heading/link/bold/italic/code/quote colors, tables (borders, header background, striping, `grid`/`lines`), highlights. GitHub follows github-markdown-css table layout (content width, body size, `6px 13px`, numeric alignment) |
| User styles | `chrome/previewThemeStyles.ts` | `preview.themeStyles`: per theme (or `extension:<script>`) body/H1–H6/link/code/quote font, size, weight, color |

- Defaults are written as `--pv-*` CSS variables in the preview window; user styles are separate `<style>` rules with more specific selectors. Recomputed on theme change (`editor-colors-changed`).
- All themes give table headers a background distinct from the page background (dark themes use one step lighter surface). Tests verify contrast.
- User values are normalized: colors as `#rrggbb`, sizes 8–96px, weights 100–900, font names with `; : { } < > \` removed.

---

## 6. Fonts

### 6.1 Problem and Principle

Windows Chromium (WebView2) reaches generic families (`monospace`, `sans-serif`) first and then uses GulimChe/Gulim for Hangul, which renders small sizes as bitmaps and looks jagged. Therefore **every font list puts Hangul fonts before generic families** (`src/styling/fonts.ts`).

### 6.2 Font Lists

| Purpose | List (front to back) |
| --- | --- |
| Editor | Configured font (default `D2Coding`) → SF Mono, Menlo, Cascadia Mono, Consolas → Apple SD Gothic Neo, Pretendard Variable, Malgun Gothic → generic families |
| UI | -apple-system, Segoe UI Variable Text, Segoe UI → Hangul fonts → system-ui, sans-serif |
| Code (editor/preview default) | D2Coding → ui-monospace … → Hangul fonts → monospace |
| Preview theme | Each theme font + `withHangulFallbacks()` inserts Hangul fonts |

- macOS keeps Apple SD Gothic Neo first, preserving the existing look.
- Hangul fonts (Pretendard) also contain Latin glyphs, so Latin monospace fonts are placed before them in monospace lists.

### 6.3 Bundled Fonts

| Font | Purpose | File (`dist/fonts/`) | Source & License |
| --- | --- | --- | --- |
| D2Coding | Editor default. Hangul exactly 2 columns wide | `D2Coding-Regular.woff2`(1.5MB), `D2Coding-Bold.woff2`(1.6MB) | npm `d2coding`, OFL-1.1 (NAVER), `D2Coding-LICENSE.txt` |
| Pretendard Variable | Hangul fallback (UI/preview/editor) | `PretendardVariable.woff2`(2.0MB, weights 45–920) | npm `pretendard`, OFL-1.1, `Pretendard-LICENSE.txt` |

- The vite plugin `vendorFonts` (`packages/core-editor/vite.config.mts`) copies them from `node_modules` at build time (not inlined into the single-file bundle). The dev server serves the same paths.
- `installBundledFonts()` registers `@font-face` at startup. Installed D2Coding takes priority via `local()`. The browser only reads a file when its glyphs are needed.

---

## 7. Windows Display Adaptation

| Item | Design |
| --- | --- |
| Transparency | Translucent blurred panels (search bar, popovers, dialogs) disable ClearType on Windows. `window.reduceTransparency` defaults to on → opaque |
| Window size | Windows opens new windows at 60%×80% of the monitor work area (800–1400 × 600–1000 logical pixels), first window centered. macOS uses 960×680 |
| Scrollbars | Windows 11-style thin rounded scrollbars when `<html data-platform="windows">` |
| Window buttons | Dialogs use macOS traffic-light buttons or Windows close button per platform |

EOF