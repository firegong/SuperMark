# Markdown Parsers and Preview Detailed Design

- **Document ID**: `DES-002`
- **Date**: 2026-11-21
- **Status**: v1.1 (revised for the format-module structure, 2026-11-21)
- **Related documents**: `ARCH-001` System Architecture, `DES-003` Settings, Themes and Fonts

---

## 1. Purpose and Scope

Defines the structure of the part that renders Markdown to HTML in the preview (split / markdown view) beside the editor. Each Markdown format is a **format module** (one folder) that owns both the parser (Markdown → HTML) and the preview. The key principle: adding, updating, or replacing a format touches only that folder and one line in the format list, with no impact on other formats. Shared functionality (block engine, mdast renderer, HTML filter, plugins, base previews) is not duplicated but placed in shared modules.

- Parser: Markdown text → HTML (implemented in TypeScript, built into the app)
- Preview: how the parser output is shown in the preview window (HTML fragment insertion, isolated frame, etc.)
- Shared functionality: scroll sync, checkbox toggle, code copy, link handling, diagrams, math, code highlighting

---

## 2. Directory Layout

```text
packages/core-editor/src/
├─ modules/markdown-renderer/
│  ├─ index.ts                 format registration, active parser switch, per-format preview (previewFor), render entry point
│  ├─ types.ts                 MarkdownRendererEngine, MarkdownFormat, PreviewRenderer, PreviewHost
│  ├─ utils.ts                 escapeHtml, isUnsafeUrl, slugify …
│  ├─ previewMarkup.ts         preview markup contract helpers (data-line, checkboxes, code blocks, tables)
│  ├─ formats/                 format modules: one folder per format (parser + preview)
│  │  ├─ index.ts              built-in format list (menu order), default format, default preview selection
│  │  ├─ commonmark/           CommonMark (strict)            — shared block engine + HTML preview
│  │  ├─ gfm/                  GitHub Flavored Markdown     — same
│  │  ├─ extended/             Extended (default)            — same
│  │  ├─ markdownSuperSet/     Markdown Super Set — own engine (engine·blocks·inline·attributes·context) + preview.ts (@include, tab sets)
│  │  ├─ micromark/            micromark — parser.ts (micromark → mdast → shared mdast renderer) + HTML preview
│  │  ├─ gsync/                gsync Markdown — engine.ts (preprocess·blocks·tables·inline·context) + preview.ts (@import, code tabs)
│  │  └─ markdownIt/           markdown-it (provided only when the MarkEdit Preview extension is installed) + frame preview
│  ├─ preview/                 preview parts shared by formats
│  │  ├─ htmlPreview.ts        HTML fragment insertion
│  │  ├─ framePreview.ts       show a complete HTML document in an isolated frame
│  │  ├─ tabSets.ts            tab set click handling (Super Set, gsync)
│  │  └─ includeLoader.ts      pre-read and cache @include / @import files
│  ├─ core/blockEngine.ts      block/inline engine shared by CommonMark·GFM·Extended
│  ├─ core/htmlSanitizer.ts    raw HTML filter (shared by Markdown Super Set and gsync)
│  ├─ core/mdastRenderer.ts    mdast syntax tree → preview HTML (shared by tree-based parsers)
│  └─ plugins/                 diagram, math, code highlighting renderers
└─ chrome/
   ├─ markdownPreview.ts       preview window: layout, refresh, scroll sync, shared interactions (provides PreviewHost)
   ├─ scrollSync.ts            editor ⇄ preview scroll position calculation
   ├─ previewThemePresets.ts   per-theme default preview styles (DES-003)
   └─ previewThemeStyles.ts    user preview styles (DES-003)
```

---

## 3. Parsers

### 3.1 Interface

A format module (`formats/<name>/index.ts`) exports a `MarkdownFormat`.

| Member | Description |
| --- | --- |
| `engine` | The parser. `MarkdownRendererEngine` (below) |
| `preview` | A `PreviewRenderer` that shows this format's output. Most reuse a shared preview (`htmlPreview`, `framePreview`); format-specific behavior goes in `preview.ts` inside the folder |

Every parser implements `MarkdownRendererEngine` (`types.ts`).

| Member | Description |
| --- | --- |
| `id` | Identifier stored in settings (`commonmark`, `gfm`, `extended`, `super`, `markdown-it`). **Must be kept when replacing a format** (settings compatibility). |
| `name` | Name shown in View → Markdown Parser menu and settings |
| `standard` | Syntax standard identifier |
| `render(markdown, options?)` | Synchronous render → HTML fragment |
| `renderAsync?(markdown)` | Asynchronous render (extension-provided renderers) |
| `renderDocument?(markdown)` | A **complete HTML document** with its own styles. Shown in the frame preview when present |
| `renderInline?`, `renderMath?`, `renderMermaid?` | Auxiliary rendering |

### 3.2 Built-in Parsers

| Format (id) | Folder | Engine | Syntax |
| --- | --- | --- | --- |
| CommonMark (`commonmark`) | `formats/commonmark/` | `core/blockEngine.ts` | Core syntax only. No tables, task lists, strikethrough, footnotes, math, diagrams, code highlighting |
| GitHub Flavored Markdown (`gfm`) | `formats/gfm/` | same | CommonMark + tables, task lists, strikethrough, autolinks, footnotes, code highlighting |
| Extended Markdown (`extended`, default) | `formats/extended/` | same | GFM + front matter, math, diagrams such as Mermaid, callouts |
| Markdown Super Set (`super`) | `formats/markdownSuperSet/` | own engine | MultiMarkdown 6 + Pandoc·GFM·Obsidian syntax, cell merging, cross-references, execution/render chunks, file inclusion, etc. (`docs/05-testing/samples/MarkdownSuperSetGrammar.md`) |
| gsync Markdown (`gsync`) | `formats/gsync/` | own engine | gsync (Markdown → Confluence tool) syntax (`docs/reference/GMARKDOWN-SYNTAX.md`): line break inside a paragraph = `<br>`, blockquote ending in a blank line, lists without blank lines with depth markers, MPE tables (3 caption types, `>` and trailing empty cells, `^` merging, lists and `!` nested tables inside cells), `:::` containers, code tabs, `???` foldables, attribute blocks `{…}`, `@ref`, wikilinks, abbreviations, `@import` (md·csv·html·code), typography, alerts, PlantUML·Graphviz diagrams |
| micromark (`micromark`) | `formats/micromark/` | micromark → mdast → `core/mdastRenderer.ts` | Strict CommonMark + GFM (tables, task lists, strikethrough, autolinks, footnotes) + math. Diagrams and code highlighting via shared plugins. No front matter or callouts |
| markdown-it (`markdown-it`) | `formats/markdownIt/` | MarkEdit Preview extension | Added to the list only when the extension is installed. Returns a complete document via `renderDocument` |

- CommonMark·GFM·Extended are instances of the same engine (`DefaultMarkdownEngine`), each file defining its own **syntax feature set (`SyntaxFeatures`)**.
- micromark is a **tree-based parser**: syntax analysis (micromark → mdast) and HTML generation (`core/mdastRenderer.ts`) are separated (§3.6).
- `formats/index.ts`'s `builtInFormats` defines menu order (`builtInParsers` is the parser list). Adding a format means creating a folder and adding one line to that list. Extension parsers register via `registerMarkdownRenderer(engine)` (default preview) or `registerMarkdownFormat({ engine, preview })`.
- The built-in extension (Markdown Super Set) can be turned off in Extensions → Installed. A disabled parser disappears from the list; if it was active, another parser is chosen (`setMarkdownRendererAvailable`).

### 3.3 Replace and Update Rules

1. Modify only that format's folder. The parser and preview can be changed together.
2. The folder's `index.ts` must export the same name as `MarkdownFormat` (and the engine) and **keep the `id`** (settings compatibility).
3. When formats need the same feature, do not copy it; place it in a shared module (`core/`, `plugins/`, `preview/`, `previewMarkup.ts`) and import it.
4. Output HTML must follow the **preview markup contract**. Helpers live in `previewMarkup.ts` (shared by all engines); `test/parserContract.test.ts` checks every registered parser.

| Contract | Helper | Used for |
| --- | --- | --- |
| Block's `markedit-preview-block` + `data-line` (0-based source line) | `blockAttributes(line)` | Scroll sync, double-click jump to source |
| Checkbox `markedit-preview-task-checkbox` + `data-line` | `taskCheckboxHtml(line, checked)` | Click toggles `[ ]`/`[x]` in source |
| Code block (language label, Copy button) | `codeBlockHtml(code, lang)` | Code copy |
| Table `markedit-preview-table` | `tableOpenTag()` | Table styling |

### 3.4 gsync Format Design (`formats/gsync/`)

| File | Role |
| --- | --- |
| `preprocess.ts` | Document head (front matter, inline metadata comments), `@import` expansion (depth 20, cycle detection, md·csv·html·others as code), abbreviation definition extraction |
| `blocks.ts` | Block decision order (reference doc §4): comment → fence → math → `:::`/`???` → heading → horizontal rule → quote (alert) → list → `Table:` → table → raw HTML → footnote·definition list → paragraph. First pass collects headings (for `@ref`) and footnote definitions |
| `inline.ts` | Protects code, math, images, links, autolinks as placeholders, then applies emphasis, strikethrough, typography, abbreviations. Limits the search range for closing markers so pathological input stays linear |
| `tables.ts` | Tables, caption priority (comment > `Table:` line > MPE caption row), cell merging, inline syntax inside cells |

Differences from gsync output (preview purpose):

| Item | gsync | This parser |
| --- | --- | --- |
| Math and abbreviation definitions inside code | Converted (gsync bug) | Left untouched |
| `[[page]]` | `page.html` | `page.md` — so the document opens in the app |
| Front matter / metadata comments | Removed from output | Shown in a panel at the top of the preview (for inspection) |
| Mermaid | Left as code block | Same (matches gsync) |

### 3.5 Shared Engine (`core/blockEngine.ts`) Processing Order

Line classification → (front matter) → block loop: horizontal rule → heading → fenced code (including diagram plugins) → table → callout (`> [!note]`) → list → quote → math block → user block plugins → paragraph. Inline syntax inside paragraphs (code span, links/images, emphasis, math, footnotes, etc.) is handled by `parseInline`.

- Fence: 3+ backticks/tildes; closing fence must be the same character, at least as long, followed only by whitespace (CommonMark rule).
- Nesting limit: quotes/lists recurse, so beyond **64 levels** the rest is shown as plain text (stack overflow prevention). The Markdown Super Set engine does the same.

### 3.6 Tree-Based Parser (mdast)

External parser libraries produce an **mdast syntax tree** (with position info), and `core/mdastRenderer.ts`'s `renderMdast(tree, hooks)` turns it into HTML. The renderer honors the markup contract, so the parser side only owns the tree. The existing engines (shared engine, Markdown Super Set) still build HTML directly and are used alongside.

- `hooks`: connects code highlighting (`highlightCode`), math (`renderMath`), and diagrams (`renderDiagram`) to the shared plugins.
- Raw HTML is shown as text; links/images with dangerous URLs keep only their text. 64-level nesting limit; deep trees are extracted as text without recursion.
- Heading ids allow all characters (including Korean) and are made unique within the document.
- `tamePathologicalInput` for slow micromark input: when a paragraph has more than 3,000 `*`/`_` (emphasis parsing is quadratic in paragraph length), that paragraph's text is escaped; indentation is limited to 128 columns (hundreds of nested lists). Line numbers are unchanged; fenced code is untouched.
- ESM-only packages are transformed by jest via `transformIgnorePatterns` in `jest.config.js` (only those packages).

---

## 4. Preview

### 4.1 Structure

```text
Editor change ─(MutationObserver, 50ms delay)─▶ markdownPreview.updateContent()
   └─ engine = active parser
   └─ previewFor(engine).render(body, text, engine, previewHost)
         ├─ htmlPreview      : body.innerHTML = engine.render(text) → host.didRenderHtml()
         ├─ superSetPreview  : engine.render(text, includeOptions) + tab sets → host.didRenderHtml()
         ├─ gsyncPreview     : engine.render(text, includeOptions) + code tabs → host.didRenderHtml()
         └─ framePreview     : engine.renderDocument(text) → <iframe sandbox="allow-same-origin"> → host.didLoadFrame()
```

| Interface | Role |
| --- | --- |
| `PreviewRenderer` | `render(body, text, engine, host)` — one kind of preview |
| `PreviewHost` (provided by `markdownPreview.ts`) | `rerender()`, `didRenderHtml(body)` (attach shared interactions, re-align scroll, hydrate diagrams), `didLoadFrame(doc)`, `didChangeLayout()` |

- Parser → preview: no separate mapping table; **each format module owns its preview** (`previewFor(engine)` = the registered format's `preview`). A parser registered without a preview gets `framePreview` if it has `renderDocument`, otherwise `htmlPreview` (`defaultPreviewFor`).
- When switching away from the frame preview, an in-progress render is discarded (`removePreviewFrame` increments the token).
- When the theme changes (`editor-colors-changed`) the preview is re-rendered (code highlighting classes depend on the theme).

### 4.2 Shared Interactions (`markdownPreview.ts`)

| Feature | Behavior |
| --- | --- |
| Task list checkboxes | Clicking toggles `[ ]`/`[x]` (and `[/]`, `[-]`) in the source line |
| Block double-click | Moves the cursor to that source line |
| Code copy | Code block Copy button |
| Mermaid source view | Toggle between diagram and source |
| Links | Navigation is blocked. `#anchor` scrolls inside the preview; anything else is forwarded to the host's `open_link` (ARCH-001 §6 security) |
| Scroll sync | Linear interpolation between `data-line` anchors, so both sides reach top/bottom together. Paused while editing or when there is a selection. Frame previews match by heading text |

### 4.3 Format-Specific Previews (`formats/markdownSuperSet/preview.ts`, `formats/gsync/preview.ts`)

- `@include path` (Super Set), `@import "path"` (gsync): rendering is synchronous, so included files are pre-read and cached (shared `preview/includeLoader.ts`); on first encounter a "loading" line is shown until the host read arrives, then re-rendered. The cache is cleared when the document changes or the window regains focus.
- Tab sets (Super Set §26, gsync code tabs, shared `preview/tabSets.ts`): clicking a tab switches the panel and invalidates scroll anchors.

---

## 5. Renderer Plugins (`modules/markdown-renderer/plugins/`)

| Plugin | File | Description |
| --- | --- | --- |
| Diagram registry | `registry.ts`, `builtin.ts` | ` ```mermaid`, `plantuml`, `d2`, `dot`/`graphviz`, `drawio`, etc. Extensions add more via `MarkEdit.registerDiagramPlugin`. Synchronous render finishes with `hydrate` |
| Rendering strategy | `strategy.ts`, `local.ts`, `kroki.ts` | `auto` (local → server), `local`, `server`. Local: PlantUML·D2·Graphviz(`dot`) run as host commands (`diagram_render_local`); Mermaid uses the bundled `dist/vendor/mermaid.min.js`. Server: Kroki-compatible server's SVG shown as `<img>` (script cannot run). Results are cached by source |
| Math | `mathPlugin.ts` | LaTeX → MathML (offline, rendered directly by Chromium). Unknown commands are shown as errors |
| Code highlighting | `codeHighlightPlugin.ts`, `syntaxHighlight.ts` | Tokenizes per language and applies **the current editor theme's highlighting classes**. Language list (~60, `@codemirror/legacy-modes`) is shared by editor, preview, and Quick Look (`src/codeLanguages.ts`). MarkEdit-language-data extension parsers take priority. Unknown languages use the generic tokenizer |

---

## 6. Safety

| Threat | Mitigation |
| --- | --- |
| Script in raw HTML | Shared engine escapes HTML. Markdown Super Set and gsync use the tag-level filter in `core/htmlSanitizer.ts` (blocks script/style/iframe/form/etc., removes event attributes) |
| Dangerous URLs | `isUnsafeUrl`: control characters stripped, then `javascript:`, `vbscript:`, `data:` blocked |
| Extension renderer documents | Isolated in `sandbox="allow-same-origin"` frame (no scripts), separated from app CSS |
| Link clicks | Host `open_link`: only http(s)/mailto leave the app; documents open in the app; other files are only revealed in the file manager (never executed) |
| Diagram server output | Shown only as `<img>` |
| Pathological input | 64-level nesting limit, linear processing of long paragraphs. `test/robustness.test.ts` checks samples in `docs/05-testing/samples/malformed/` and generated input |

---

## 7. Tests

| Test | Scope |
| --- | --- |
| `test/parsersAndPreviews.test.ts` | Format modules (parser/preview pairing), parser list/ids, per-parser syntax differences, per-format preview, format registration/replacement, frame render cancellation |
| `test/parserContract.test.ts` | Preview markup contract for every built-in parser (block/checkbox line numbers, code blocks, tables) |
| `test/gsyncParser.test.ts` | gsync syntax checked section by section (§2–9), full reference document render |
| `test/micromarkParser.test.ts` | micromark syntax accuracy, safety, Korean heading ids, pathological-input handling |
| `test/superMarkdown.test.ts`, `superMarkdownMetadata.test.ts` | Markdown Super Set syntax overall, Korean metadata keys |
| `test/syntaxHighlight.test.ts` | Per-language tokenization, theme classes, 4+ backtick fences |
| `test/robustness.test.ts` | Broken/adversarial/random input: no exceptions, no delays, no script |
| `test/previewLinks.test.ts` | Link click handling |
| `test/rendererPlugins.test.ts`, `markdownItParser.test.ts`, `includeLoader.test.ts`, `scrollSync.test.ts` | Plugins, markdown-it, file inclusion, scroll sync |

EOF