# Document Lifecycle (`NSDocument` Replacement) & Multi-Window Detailed Design

- **Document ID**: `DES-001`
- **Date**: 2026-11-08 (initial), 2026-11-21 (revised based on current implementation)
- **Status**: v2.0
- **Related Documents**: `ARCH-001` System Architecture, `ARCH-002` Bridge Specification

---

## 1. Background

macOS MarkEdit relies on `NSDocument` and `NSDocumentController` to handle multi-window management, dirty state tracking, auto-save, and text encodings. Because Windows lacks an equivalent native framework, Rust's **`DocumentManager`** (`src-tauri/src/document/mod.rs`) serves as the central document controller. Each window represents a single document, distinguished by unique window labels (`main`, `doc-2`, `doc-3`, etc.).

---

## 2. Data Structures

```rust
pub struct DocumentManager {
    sessions: Mutex<HashMap<String, DocumentSession>>, // window_label → session
    recent_files: ...,                                  // recent.json (max 15)
    user_menu_items: ...,                               // menu items contributed by extensions
    app_data_dir: PathBuf,                              // <config_dir>/MarkEdit
    versions: VersionManager,                           // Versions/
    extensions: ExtensionManager,
    secrets: SecretStorageManager,
}

pub struct DocumentSession {
    pub window_label: String,
    pub file_path: Option<PathBuf>,        // None for unsaved new documents
    pub bom: BomKind,                      // None / UTF-8 / UTF-16LE / UTF-16BE
    pub encoding_name: String,             // Default "UTF-8"
    pub line_endings: LineEndings,         // LF / CRLF / CR (new documents default to CRLF on Windows)
    pub is_dirty: bool,
    pub content_cache: String,             // Last read or saved content
    pub last_modified_secs: Option<u64>,
    pub pending_restore_text: Option<String>, // Draft text to restore (consumed once)
}
```

---

## 3. Scenarios & Workflows

### 3.1 Opening Documents

1. **Entry Points**: Menu (Ctrl+O, Recent Files), Explorer double-click (CLI arguments forwarded via single instance), extension `MarkEdit.openDocument`, or document links clicked in preview/editor — all route through `open_document_path` (`menu/mod.rs`).
2. **Already Open**: If the file is already open in a window (path normalized, case-insensitive on Windows), that window is brought to the foreground.
3. **File Not Found**: An alert dialog is presented to the user.
4. **Window Allocation**: If the currently focused window is an **unmodified blank document** (clean state, no path, empty content), the file loads into that window; otherwise, a new window is spawned (`create_editor_window`, label `doc-N`).
5. **Reading (`load_from_path`)**: BOM check (UTF-8/16LE/16BE) → Valid UTF-8 validation → `chardetng` encoding detection + `encoding_rs` decoding. Line endings are detected and stored, while content is passed to the editor normalized as `\n`. Users can reload with an explicit encoding via *File → Reopen with Encoding*.
6. Content delivery to the web editor occurs via `notifyWindowDidLoad` reply or `document_content` command.
7. **TextBundle Support**: Supports `.textbundle` folders (`text.md`/`text.markdown`/`text.txt`, preserving `assets/` and `info.json`) as well as `.textpack` (compressed zip archive).

### 3.2 Editing & Dirty State

1. On text input, CoreEditor sends `core.notifyViewDidUpdate({ isDirty, ... })`. The host updates `is_dirty` and adjusts the window title: `README.md — SuperMark` vs `● README.md — SuperMark`.
2. When typing pauses, `core.notifyEditorDidBecomeIdle` fires. If dirty, the editor invokes `save_idle_backup` to record a snapshot in `Backups/<label>.md` with metadata `<label>.json` (`window_label`, `original_path`, `timestamp_secs`).

### 3.3 Saving (Save / Save As)

1. If no path is assigned or Save As is selected, an attached native save file dialog opens (defaulting to `Untitled.<extension>`).
2. Cleans trailing whitespace or ensures a trailing newline based on configuration.
3. Encodes using the document's original encoding, BOM, and line endings, writing **atomically** (writes to `*.markedit.tmp` then renames).
4. **Post-save**: Records revision in version history, updates recent files, deletes idle backup, updates menu state and window title, and persists sessions. `history.markContentClean()` is called only if the editor text remained unchanged during the save operation.

### 3.4 Version History

- Every save writes a snapshot to `Versions/<path_hash>/v-<ms>-<seq>.md`.
- Accessed via *File → Version History* dialog (`versions_*` commands) and extension APIs (`getFileVersions`, etc.) for inspection, restoration, and deletion. Restorations preserve the document's original file encoding and formatting.
- Version IDs strictly conform to `v-<ms>-<seq>`, and deletions only touch explicitly targeted IDs. Configurable retention windows / automatic pruning are planned.

### 3.5 External File Change Detection

- `document/watcher.rs` contains a `notify`-based `ExternalFileWatcher`, which is currently unlinked. Automatic reloading of clean files and 3-way merge conflict prompts for dirty files are tracked for Phase 5.

### 3.6 Window Closing & Termination

- `CloseRequested`: Clean windows close immediately. Modified windows prompt with Save / Don't Save / Cancel dialog: Save saves and closes, Don't Save purges backups and closes, Cancel halts closure.
- Application exit (Menu Quit/Exit) evaluates each open window sequentially, ensuring no unsaved data is inadvertently discarded.
- When a window is destroyed, the session list is persisted to disk.

### 3.7 Session Restoration & Crash Recovery

| Condition | Behavior |
| --- | --- |
| Startup behavior `lastSession` | Reopens windows recorded in `last-session.json`, restoring unsaved drafts from backups if present |
| Default (`newDocument`) or CLI launch | Lingering backups indicate abnormal termination. Prompts "Do you want to restore unsaved documents?": Yes = restores into windows (creates new window if launched with a file), No = archives drafts to `Backups/Discarded/<timestamp>/` |

- Restored text is provided via `pending_restore_text` once and applied as a document edit (marked dirty, allowing undo back to disk version).
- Backups are renamed to the new window's label so future saves clean up the correct draft files.

### 3.8 Window Dimensions

Default window size is 960×680 (minimum 420×300). On Windows, new windows open sized to 60%×80% of the active display work area (clamped between 800–1400 × 600–1000 logical pixels), with the initial window centered on screen.
