use crate::bridge::generated::MenuItem as UserMenuItemSpec;
use crate::bridge::WebBridge;
use crate::create_editor_window;
use crate::document::{DocumentManager, LineEndings};
use crate::extensions::{downloader, ExtensionManager, ExtensionRegistry};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, MenuItemKind, Submenu, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

static ZOOM_PERCENT: AtomicI32 = AtomicI32::new(100);

/// Editor view state shown as checkmarks in the View menu (Editor / Split / Markdown View,
/// Markdown Parser, Sync Preview Scroll). The editor reports it whenever it changes and when a
/// window gains focus, so the app-wide menu reflects the focused window.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewState {
    pub mode: String,
    pub renderer: String,
    pub sync_scroll: bool,
    /// Elements rendered inside the editor (tables, math, diagrams…).
    pub live_preview: bool,
}

static VIEW_STATE: Mutex<Option<ViewState>> = Mutex::new(None);

/// Markdown parsers offered in View → Markdown Parser (id, label).
pub const MARKDOWN_PARSERS: &[(&str, &str)] = &[
    ("extended", "Extended (GFM + Math + Diagrams)"),
    ("super", "Markdown Super Set"),
    ("gfm", "GitHub Flavored Markdown (GFM)"),
    ("commonmark", "CommonMark (Strict)"),
    ("micromark", "micromark (CommonMark + GFM)"),
    ("gsync", "gsync Markdown"),
    ("markdown-it", "markdown-it (MarkEdit Preview)"),
];

/// Parsers provided by an installed extension: (parser id, extension id).
const EXTENSION_PARSERS: &[(&str, &str)] = &[("markdown-it", "markedit-preview")];

/// Whether View → Markdown Parser offers `parser_id` right now.
fn parser_available(parser_id: &str, extensions: Option<&ExtensionManager>) -> bool {
    if let Some(builtin) = crate::extensions::builtin_for_parser(parser_id) {
        return extensions.is_none_or(|mgr| mgr.is_builtin_enabled(builtin));
    }
    if let Some((_, extension_id)) = EXTENSION_PARSERS.iter().find(|(id, _)| *id == parser_id) {
        return extensions.is_some_and(|mgr| {
            mgr.config()
                .read()
                .installed
                .iter()
                .any(|record| record.id == *extension_id && record.is_enabled())
        });
    }
    true
}

pub const VIEW_MODES: &[&str] = &["editor", "split", "preview"];

pub fn current_view_state() -> ViewState {
    VIEW_STATE
        .lock()
        .ok()
        .and_then(|state| state.clone())
        .unwrap_or_else(|| {
            let settings = crate::settings::SettingsManager::new().load_user_settings();
            ViewState {
                mode: "editor".to_string(),
                renderer: settings.markdown_renderer,
                sync_scroll: true,
                live_preview: settings.live_preview,
            }
        })
}

fn find_menu_item<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<MenuItemKind<R>> {
    for item in items {
        if item.id() == id {
            return Some(item);
        }
        if let MenuItemKind::Submenu(submenu) = &item {
            if let Some(found) = submenu.items().ok().and_then(|children| find_menu_item(children, id)) {
                return Some(found);
            }
        }
    }
    None
}

fn set_menu_checked<R: Runtime>(app: &AppHandle<R>, id: &str, checked: bool) {
    let Some(menu) = app.menu() else {
        return;
    };
    if let Some(item) = menu.items().ok().and_then(|items| find_menu_item(items, id)) {
        if let Some(check) = item.as_check_menuitem() {
            let _ = check.set_checked(checked);
        }
    }
}

/// Updates the stored view state and the View menu checkmarks.
pub fn apply_view_state<R: Runtime>(app: &AppHandle<R>, state: ViewState) {
    for mode in VIEW_MODES {
        set_menu_checked(app, &format!("view.mode.{mode}"), state.mode == *mode);
    }
    for (id, _) in MARKDOWN_PARSERS {
        set_menu_checked(app, &format!("view.parser.{id}"), state.renderer == *id);
    }
    set_menu_checked(app, "view.preview_sync", state.sync_scroll);
    set_menu_checked(app, "view.live_preview", state.live_preview);
    if let Ok(mut stored) = VIEW_STATE.lock() {
        *stored = Some(state);
    }
}
static FLOAT_ON_TOP: AtomicBool = AtomicBool::new(false);

pub const REOPEN_ENCODINGS: &[(&str, &str)] = &[
    ("UTF-8", "UTF-8"),
    ("UTF-8-BOM", "UTF-8 with BOM"),
    ("UTF-16LE", "UTF-16 LE"),
    ("UTF-16BE", "UTF-16 BE"),
    ("EUC-KR", "Korean (EUC-KR / CP949)"),
    ("Shift_JIS", "Japanese (Shift_JIS)"),
    ("GB18030", "Chinese Simplified (GB18030)"),
    ("windows-1252", "Western (Windows-1252)"),
];

pub const PANDOC_FORMATS: &[(&str, &str)] = &[
    ("html", "HTML"),
    ("pdf", "PDF"),
    ("docx", "Word (DOCX)"),
    ("rtf", "RTF"),
    ("epub", "EPUB"),
];

pub fn build_pandoc_command(path: &Path, format: &str) -> String {
    let input_path = path.to_string_lossy();
    let out_path = path.with_extension(format);
    let output_str = out_path.to_string_lossy();
    if format == "pdf" {
        // Pandoc rejects `-t pdf`; PDF output is selected by the `.pdf` extension of `-o`.
        return format!("pandoc \"{input_path}\" -o \"{output_str}\"");
    }
    format!("pandoc \"{input_path}\" -t {format} -o \"{output_str}\"")
}

fn build_user_submenu<R: Runtime>(
    app: &AppHandle<R>,
    spec: &UserMenuItemSpec,
    idx_prefix: &str,
) -> tauri::Result<Submenu<R>> {
    let title = spec.title.as_deref().unwrap_or("Extension Menu");
    let mut sub = SubmenuBuilder::new(app, title);
    if let Some(children) = &spec.children {
        for (i, child) in children.iter().enumerate() {
            let child_prefix = format!("{idx_prefix}_{i}");
            if child.separator.unwrap_or(false) {
                sub = sub.separator();
            } else if child.children.as_ref().is_some_and(|c| !c.is_empty()) {
                let nested = build_user_submenu(app, child, &child_prefix)?;
                sub = sub.item(&nested);
            } else {
                let item_title = child.title.as_deref().unwrap_or("Action");
                let id = if let Some(action_id) = &child.action_id {
                    format!("user_ext_action.{action_id}")
                } else {
                    format!("user_ext_noop.{child_prefix}")
                };
                let mut builder = MenuItemBuilder::with_id(id, item_title);
                if let Some(accel) = format_user_accelerator(child) {
                    builder = builder.accelerator(accel);
                }
                sub = sub.item(&builder.build(app)?);
            }
        }
    }
    sub.build()
}

/// Shortcuts an extension menu item may not take: standard editing keys (an extension's
/// "Command+V" would become Ctrl+V on Windows and replace Paste) and the app's own accelerators.
fn is_reserved_accelerator(accelerator: &str) -> bool {
    const EDITING: &[&str] = &[
        "CmdOrCtrl+C", "CmdOrCtrl+V", "CmdOrCtrl+X", "CmdOrCtrl+A", "CmdOrCtrl+Z", "CmdOrCtrl+Y",
        "CmdOrCtrl+Shift+Z", "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+A", "Ctrl+Z", "Ctrl+Y",
    ];
    let normalized = accelerator.to_ascii_lowercase();
    if EDITING.iter().any(|reserved| reserved.to_ascii_lowercase() == normalized) {
        return true;
    }
    app_accelerators().iter().any(|own| own.to_ascii_lowercase() == normalized)
}

/// Accelerators registered by the built-in menu (read from this file's builder calls).
fn app_accelerators() -> &'static [String] {
    static CACHE: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| {
        let source = include_str!("mod.rs");
        let needle = concat!(".accel", "erator(\"");
        source
            .match_indices(needle)
            .filter_map(|(start, _)| {
                let rest = &source[start + needle.len()..];
                rest.find('"').map(|end| rest[..end].to_string())
            })
            .collect()
    })
}

fn format_user_accelerator(spec: &UserMenuItemSpec) -> Option<String> {
    let key = spec.key.as_ref()?.trim();
    if key.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = Vec::new();
    if let Some(mods) = &spec.modifiers {
        for m in mods {
            match m.to_ascii_lowercase().as_str() {
                "command" | "cmd" | "meta" | "mod" => parts.push("CmdOrCtrl".to_string()),
                "control" | "ctrl" => parts.push("Ctrl".to_string()),
                "shift" => parts.push("Shift".to_string()),
                "option" | "alt" => parts.push("Alt".to_string()),
                _ => {}
            }
        }
    }
    parts.push(key.to_string());
    let accelerator = parts.join("+");
    if is_reserved_accelerator(&accelerator) {
        crate::diagnostics::log(&format!(
            "extension menu item {:?}: shortcut {accelerator} conflicts with a built-in shortcut and was not registered",
            spec.title
        ));
        return None;
    }
    Some(accelerator)
}

pub fn refresh_app_menu<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(menu) = build_app_menu(app) {
        let _ = app.set_menu(menu);
        apply_view_state(app, current_view_state());
    }
}

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "SuperMark")
        .item(&MenuItemBuilder::with_id("app.about", "About SuperMark").build(app)?)
        .item(&MenuItemBuilder::with_id("app.updates", "Check for Updates...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("app.settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("app.open_settings_file", "Open settings.json...")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("app.quit", "Quit MarkEdit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    let mut recent_builder = SubmenuBuilder::new(app, "Open Recent");
    let recent_paths = app
        .try_state::<DocumentManager>()
        .map(|mgr| mgr.recent_paths_strings())
        .unwrap_or_default();

    if recent_paths.is_empty() {
        recent_builder = recent_builder.item(
            &MenuItemBuilder::with_id("file.recent_empty", "No Recent Documents")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for (idx, path_str) in recent_paths.iter().take(10).enumerate() {
            let label = Path::new(path_str)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|name| format!("{}. {} — {}", idx + 1, name, path_str))
                .unwrap_or_else(|| format!("{}. {}", idx + 1, path_str));
            recent_builder = recent_builder.item(
                &MenuItemBuilder::with_id(format!("file.recent.{path_str}"), label).build(app)?,
            );
        }
    }
    let recent_submenu = recent_builder
        .separator()
        .item(&MenuItemBuilder::with_id("file.clear_recents", "Clear Menu").build(app)?)
        .build()?;

    let mut reopen_enc_builder = SubmenuBuilder::new(app, "Reopen with Encoding");
    for (enc_id, enc_label) in REOPEN_ENCODINGS {
        reopen_enc_builder = reopen_enc_builder.item(
            &MenuItemBuilder::with_id(format!("file.reopen_encoding.{enc_id}"), *enc_label)
                .build(app)?,
        );
    }
    let reopen_encoding_submenu = reopen_enc_builder.build()?;

    let versions_submenu = SubmenuBuilder::new(app, "Version History")
        .item(
            &MenuItemBuilder::with_id("file.versions.browse", "Browse Local Versions...")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.versions.delete", "Delete Local Versions...")
                .build(app)?,
        )
        .build()?;

    let copy_path_submenu = SubmenuBuilder::new(app, "Copy Path")
        .item(&MenuItemBuilder::with_id("file.copy_file_path", "Copy File Path").build(app)?)
        .item(&MenuItemBuilder::with_id("file.copy_folder_path", "Copy Folder Path").build(app)?)
        .build()?;

    let mut pandoc_builder = SubmenuBuilder::new(app, "Copy Pandoc Command");
    for (fmt_id, fmt_label) in PANDOC_FORMATS {
        pandoc_builder = pandoc_builder.item(
            &MenuItemBuilder::with_id(format!("file.pandoc.{fmt_id}"), *fmt_label).build(app)?,
        );
    }
    let pandoc_submenu = pandoc_builder
        .separator()
        // (MarkEdit wiki link removed)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file.new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.new_from_clipboard", "New File from Clipboard")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.open_folder", "Open Folder...")
                .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id(
                "file.autosave",
                "Auto Save",
            )
            .checked(crate::settings::SettingsManager::new().load_user_settings().autosave)
            .build(app)?,
        )
        .item(&recent_submenu)
        .item(&reopen_encoding_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.close", "Close")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.save_as", "Save As...")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.save_all", "Save All")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("file.revert", "Revert to Saved").build(app)?)
        .item(&versions_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.reveal_in_folder", "Reveal in File Manager")
                .build(app)?,
        )
        .item(&copy_path_submenu)
        .item(&pandoc_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.print", "Print...")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("file.exit", "Exit").build(app)?)
        .build()?;

    let find_submenu = SubmenuBuilder::new(app, "Find")
        .item(
            &MenuItemBuilder::with_id("edit.find", shortcut_hint("Find...", "Ctrl+F"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.replace", shortcut_hint("Find and Replace...", "Ctrl+H"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.find_next", "Find Next")
                .accelerator("F3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.find_previous", "Find Previous")
                .accelerator("Shift+F3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.find_selection", "Use Selection for Find")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.select_next_occurrence", "Select Next Occurrence")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.select_all_occurrences", "Select All Occurrences")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.scroll_to_selection", "Scroll to Selection")
                .accelerator("CmdOrCtrl+J")
                .build(app)?,
        )
        .build()?;

    let selection_lines_submenu = SubmenuBuilder::new(app, "Selection & Lines")
        .item(
            &MenuItemBuilder::with_id("edit.expand_selection", "Expand Selection")
                .accelerator("CmdOrCtrl+Shift+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.shrink_selection", "Shrink Selection")
                .accelerator("CmdOrCtrl+Shift+Down")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("edit.select_line", "Select Line").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.move_line_up", shortcut_hint("Move Line Up", "Alt+Up"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.move_line_down", shortcut_hint("Move Line Down", "Alt+Down"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.copy_line_up", shortcut_hint("Copy Line Up", "Shift+Alt+Up"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.copy_line_down", shortcut_hint("Copy Line Down", "Shift+Alt+Down"))
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.indent_more", shortcut_hint("Indent More", "Ctrl+]"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.indent_less", shortcut_hint("Indent Less", "Ctrl+["))
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.toggle_comment", shortcut_hint("Toggle Line Comment", "Ctrl+/"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.toggle_block_comment", shortcut_hint("Toggle Block Comment", "Shift+Alt+A"))
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.format_document", "Format Document")
                .accelerator("Shift+Alt+F")
                .build(app)?,
        )
        .build()?;

    let font_submenu = SubmenuBuilder::new(app, "Font")
        .item(&MenuItemBuilder::with_id("edit.font.customize", "Customize Font...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.font.bigger", "Bigger")
                .accelerator("CmdOrCtrl+Shift+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.font.smaller", "Smaller")
                .accelerator("CmdOrCtrl+Shift+-")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("edit.font.reset", "Reset Font Size").build(app)?)
        .build()?;

    let toc_submenu = SubmenuBuilder::new(app, "Table of Contents")
        .item(
            &MenuItemBuilder::with_id("view.toc", shortcut_hint("Show Table of Contents", "Ctrl+Shift+O"))
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go.prev_section", shortcut_hint("Select Previous Section", "Ctrl+Up"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go.next_section", shortcut_hint("Select Next Section", "Ctrl+Down"))
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("edit.undo", shortcut_hint("Undo", "Ctrl+Z"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.redo", shortcut_hint("Redo", "Ctrl+Y"))
                .build(app)?,
        )
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find_submenu)
        .item(&selection_lines_submenu)
        .item(&font_submenu)
        .item(&toc_submenu)
        .separator()
        .item(&MenuItemBuilder::with_id("edit.read_only", "Toggle Read Only Mode").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.stats", shortcut_hint("Statistics...", "Ctrl+Shift+I"))
                .build(app)?,
        )
        .build()?;

    let headers_submenu = SubmenuBuilder::new(app, "Headings")
        .item(
            &MenuItemBuilder::with_id("format.h1", "Heading 1")
                .accelerator("CmdOrCtrl+1")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.h2", "Heading 2")
                .accelerator("CmdOrCtrl+2")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.h3", "Heading 3")
                .accelerator("CmdOrCtrl+3")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.h4", "Heading 4")
                .accelerator("CmdOrCtrl+4")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.h5", "Heading 5")
                .accelerator("CmdOrCtrl+5")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.h6", "Heading 6")
                .accelerator("CmdOrCtrl+6")
                .build(app)?,
        )
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&headers_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("format.bold", "Bold")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.italic", "Italic")
                .accelerator("CmdOrCtrl+I")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.strikethrough", "Strikethrough")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("format.bullet", "Bullet List")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.numbering", "Numbered List")
                .accelerator("CmdOrCtrl+Shift+L")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.todo", "Todo List")
                .accelerator("CmdOrCtrl+Shift+T")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("format.inline_code", "Inline Code").build(app)?)
        .item(
            &MenuItemBuilder::with_id("format.code_block", "Code Block")
                .accelerator("CmdOrCtrl+Shift+C")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.inline_math", "Inline Math")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.math_block", "Math Block")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.blockquote", "Blockquote")
                .accelerator("CmdOrCtrl+Shift+Q")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("format.link", "Insert Hyperlink")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.image", "Insert Image")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("format.table", "Insert Table").build(app)?)
        .item(&MenuItemBuilder::with_id("format.hr", "Horizontal Rule").build(app)?)
        .build()?;

    let line_endings_submenu = SubmenuBuilder::new(app, "Line Endings")
        .item(&MenuItemBuilder::with_id("view.le_crlf", "Windows (CRLF)").build(app)?)
        .item(&MenuItemBuilder::with_id("view.le_lf", "Unix / macOS (LF)").build(app)?)
        .item(&MenuItemBuilder::with_id("view.le_cr", "Classic Mac (CR)").build(app)?)
        .build()?;

    // View controls that used to be floating buttons in the page live here as native check
    // items, so the window shows only the editor and preview.
    let view_state = current_view_state();
    let mut parser_builder = SubmenuBuilder::new(app, "Markdown Parser");
    let extensions = app.try_state::<DocumentManager>().map(|mgr| mgr.extensions().clone());
    for (id, label) in MARKDOWN_PARSERS {
        // Parsers from built-in or installed extensions are listed only while those are enabled.
        if !parser_available(id, extensions.as_ref()) {
            continue;
        }
        parser_builder = parser_builder.item(
            &CheckMenuItemBuilder::with_id(format!("view.parser.{id}"), *label)
                .checked(view_state.renderer == *id)
                .build(app)?,
        );
    }
    let parser_submenu = parser_builder.build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &CheckMenuItemBuilder::with_id("view.mode.editor", "Editor")
                .checked(view_state.mode == "editor")
                .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id("view.mode.split", shortcut_hint("Split Preview", "Ctrl+Shift+P"))
                .checked(view_state.mode == "split")
                .build(app)?,
        )
        .item(
            &CheckMenuItemBuilder::with_id("view.mode.preview", shortcut_hint("Markdown View", "Ctrl+Shift+V"))
                .checked(view_state.mode == "preview")
                .build(app)?,
        )
        .separator()
        .item(&parser_submenu)
        .item(
            &CheckMenuItemBuilder::with_id("view.preview_sync", "Sync Preview Scroll")
                .checked(view_state.sync_scroll)
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("view.preview_copy_html", "Copy Preview HTML").build(app)?)
        .item(
            &CheckMenuItemBuilder::with_id("view.live_preview", "Live Preview in Editor")
                .checked(view_state.live_preview)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("view.toc", "Table of Contents").build(app)?)
        .item(&MenuItemBuilder::with_id("view.stats", "Document Statistics").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.line_numbers", "Toggle Line Numbers").build(app)?)
        .item(
            &MenuItemBuilder::with_id("view.active_line", "Toggle Active Line Indicator")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("view.line_wrapping", "Toggle Line Wrapping").build(app)?)
        .item(&MenuItemBuilder::with_id("view.invisibles", "Toggle Invisible Characters").build(app)?)
        .item(&MenuItemBuilder::with_id("view.typewriter", "Toggle Typewriter Mode").build(app)?)
        .item(&MenuItemBuilder::with_id("view.focus", "Toggle Focus Mode").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("view.theme", "Toggle Dark / Light Theme").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.zoom_in", "Zoom In")
                .accelerator("CmdOrCtrl+=")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoom_out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.zoom_reset", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.fullscreen", "Toggle Full Screen")
                .accelerator("F11")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("view.toggle_sidebar", "Toggle Sidebar").build(app)?)
        .separator()
        .item(&line_endings_submenu)
        .build()?;

    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::with_id("go.back", "Go Back").build(app)?)
        .item(
            &MenuItemBuilder::with_id("edit.goto_line", shortcut_hint("Go to Line...", "Ctrl+G"))
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go.header", "Go to Header...")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("go.prev_section", "Previous Section").build(app)?)
        .item(&MenuItemBuilder::with_id("go.next_section", "Next Section").build(app)?)
        .build()?;

    let mut extensions_builder = SubmenuBuilder::new(app, "Extensions")
        .item(
            &MenuItemBuilder::with_id("extensions.manage", "Manage Extensions...").build(app)?,
        )
        .item(&MenuItemBuilder::with_id("extensions.check_updates", "Check for Updates...").build(app)?)
        .item(
            &MenuItemBuilder::with_id("extensions.install_url", "Install Extension from URL...")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("extensions.open_folder", "Open Extensions Folder")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("extensions.reload", "Reload Extensions").build(app)?);

    let user_items = app
        .try_state::<DocumentManager>()
        .map(|mgr| mgr.user_menu_items())
        .unwrap_or_default();
    if !user_items.is_empty() {
        extensions_builder = extensions_builder.separator();
        for (idx, spec) in user_items.iter().enumerate() {
            let prefix = format!("u_{idx}");
            if spec.separator.unwrap_or(false) {
                extensions_builder = extensions_builder.separator();
            } else if spec.children.as_ref().is_some_and(|c| !c.is_empty()) {
                let sub = build_user_submenu(app, spec, &prefix)?;
                extensions_builder = extensions_builder.item(&sub);
            } else {
                let title = spec.title.as_deref().unwrap_or("Extension Action");
                let id = if let Some(action_id) = &spec.action_id {
                    format!("user_ext_action.{action_id}")
                } else {
                    format!("user_ext_noop.{prefix}")
                };
                let mut builder = MenuItemBuilder::with_id(id, title);
                if let Some(accel) = format_user_accelerator(spec) {
                    builder = builder.accelerator(accel);
                }
                extensions_builder = extensions_builder.item(&builder.build(app)?);
            }
        }
    }
    let extensions_menu = extensions_builder.build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(
            &MenuItemBuilder::with_id("window.minimize", "Minimize")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("window.zoom", "Zoom").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.float_on_top", "Toggle Float on Top").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.front", "Bring All to Front").build(app)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.homepage", "SuperMark Home Page").build(app)?)
        .item(&MenuItemBuilder::with_id("help.releases", "Version History & Releases").build(app)?)
        .item(&MenuItemBuilder::with_id("help.issue", "Report an Issue...").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &go_menu,
            &extensions_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}

pub fn menu_id_to_web_script(menu_id: &str) -> Option<String> {
    if let Some(action_id) = menu_id.strip_prefix("user_ext_action.") {
        return Some(WebBridge::format_call(
            "api",
            "handleMainMenuAction",
            Some(json!({ "id": action_id })),
        ));
    }

    match menu_id {
        "app.settings" | "edit.font.customize" => Some(WebBridge::format_chrome_call(
            "openSettings",
            Some(json!("editor")),
        )),
        "file.new" => Some(WebBridge::reset_editor("")),
        "file.save" => Some(
            "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });"
                .to_string(),
        ),
        "file.save_as" => Some(
            "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: true });"
                .to_string(),
        ),
        "file.versions.browse" => Some(WebBridge::format_chrome_call("openVersionHistory", None)),
        "edit.undo" => Some(WebBridge::format_call("history", "undo", None)),
        "edit.redo" => Some(WebBridge::format_call("history", "redo", None)),
        "edit.find" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(false)))),
        "edit.replace" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(true)))),
        "edit.find_next" => Some(
            "(function(){ const input = document.querySelector('.markedit-chrome-findbar-input'); const q = (input && input.value) || window.webModules?.selection?.getText?.() || ''; if (q) { window.webModules?.search?.findNext?.({ search: q }); } else { window.chromeUI?.openFindBar?.(false); } })();".to_string(),
        ),
        "edit.find_previous" => Some(
            "(function(){ const input = document.querySelector('.markedit-chrome-findbar-input'); const q = (input && input.value) || window.webModules?.selection?.getText?.() || ''; if (q) { window.webModules?.search?.findPrevious?.({ search: q }); } else { window.chromeUI?.openFindBar?.(false); } })();".to_string(),
        ),
        "edit.find_selection" => Some(
            "(function(){ const sel = window.webModules?.selection?.getText?.() || ''; window.chromeUI?.openFindBar?.(false); const input = document.querySelector('.markedit-chrome-findbar-input'); if (input && sel) { input.value = sel; input.dispatchEvent(new Event('input', { bubbles: true })); } })();".to_string(),
        ),
        "edit.select_next_occurrence" => {
            Some(WebBridge::format_call("search", "selectNextOccurrence", None))
        }
        "edit.select_all_occurrences" => {
            Some(WebBridge::format_call("search", "selectAllOccurrences", None))
        }
        "edit.scroll_to_selection" => {
            Some(WebBridge::format_call("selection", "scrollToSelection", None))
        }
        "edit.goto_line" => Some(WebBridge::format_chrome_call("openGotoLine", None)),
        "edit.expand_selection" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "expandSelection" })),
        )),
        "edit.shrink_selection" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "shrinkSelection" })),
        )),
        "edit.select_line" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "selectLine" })),
        )),
        "edit.move_line_up" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "moveLineUp" })),
        )),
        "edit.move_line_down" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "moveLineDown" })),
        )),
        "edit.copy_line_up" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "copyLineUp" })),
        )),
        "edit.copy_line_down" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "copyLineDown" })),
        )),
        "edit.indent_more" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "indentMore" })),
        )),
        "edit.indent_less" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "indentLess" })),
        )),
        "edit.toggle_comment" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "toggleLineComment" })),
        )),
        "edit.toggle_block_comment" => Some(WebBridge::format_call(
            "format",
            "performEditCommand",
            Some(json!({ "command": "toggleBlockComment" })),
        )),
        "edit.format_document" => Some(WebBridge::format_call(
            "format",
            "formatContent",
            Some(json!({
                "insertFinalNewline": true,
                "trimTrailingWhitespace": true,
                "userInitiated": true
            })),
        )),
        "edit.font.bigger" => Some(
            "window.config.fontSize = Math.min(72, (window.config.fontSize || 15) + 1); window.webModules?.config?.setFontSize?.({ fontSize: window.config.fontSize }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { 'editor.fontSize': window.config.fontSize } });"
                .to_string(),
        ),
        "edit.font.smaller" => Some(
            "window.config.fontSize = Math.max(9, (window.config.fontSize || 15) - 1); window.webModules?.config?.setFontSize?.({ fontSize: window.config.fontSize }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { 'editor.fontSize': window.config.fontSize } });"
                .to_string(),
        ),
        "edit.font.reset" => Some(
            "window.config.fontSize = 15; window.webModules?.config?.setFontSize?.({ fontSize: 15 }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { 'editor.fontSize': 15 } });"
                .to_string(),
        ),
        "edit.read_only" => Some(
            "window.config.readOnlyMode = !window.config.readOnlyMode; window.webModules?.config?.setReadOnlyMode?.({ enabled: window.config.readOnlyMode });"
                .to_string(),
        ),
        "format.h1" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 1 })),
        )),
        "format.h2" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 2 })),
        )),
        "format.h3" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 3 })),
        )),
        "format.h4" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 4 })),
        )),
        "format.h5" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 5 })),
        )),
        "format.h6" => Some(WebBridge::format_call(
            "format",
            "toggleHeading",
            Some(json!({ "level": 6 })),
        )),
        "format.bold" => Some(WebBridge::format_call("format", "toggleBold", None)),
        "format.italic" => Some(WebBridge::format_call("format", "toggleItalic", None)),
        "format.strikethrough" => {
            Some(WebBridge::format_call("format", "toggleStrikethrough", None))
        }
        "format.bullet" => Some(WebBridge::format_call("format", "toggleBullet", None)),
        "format.numbering" => Some(WebBridge::format_call("format", "toggleNumbering", None)),
        "format.todo" => Some(WebBridge::format_call("format", "toggleTodo", None)),
        "format.inline_code" => Some(WebBridge::format_call("format", "toggleInlineCode", None)),
        "format.code_block" => Some(WebBridge::format_call("format", "insertCodeBlock", None)),
        "format.inline_math" => Some(WebBridge::format_call("format", "toggleInlineMath", None)),
        "format.math_block" => Some(WebBridge::format_call("format", "insertMathBlock", None)),
        "format.blockquote" => Some(WebBridge::format_call("format", "toggleBlockquote", None)),
        "format.link" => Some(WebBridge::format_call(
            "format",
            "insertHyperLink",
            Some(json!({ "title": "Link", "url": "https://" })),
        )),
        "format.image" => Some(WebBridge::format_call(
            "format",
            "insertHyperLink",
            Some(json!({ "title": "Image", "url": "https://", "prefix": "!" })),
        )),
        "format.table" => Some(WebBridge::format_call(
            "format",
            "insertTable",
            Some(json!({ "columnName": "Column", "itemName": "Item" })),
        )),
        "format.hr" => Some(WebBridge::format_call("format", "insertHorizontalRule", None)),
        "view.mode.editor" => Some(WebBridge::format_chrome_call("setMarkdownPreviewMode", Some(json!("editor")))),
        "view.mode.split" => Some(WebBridge::format_chrome_call("setMarkdownPreviewMode", Some(json!("split")))),
        "view.mode.preview" => Some(WebBridge::format_chrome_call("setMarkdownPreviewMode", Some(json!("preview")))),
        "view.preview_sync" => Some(WebBridge::format_chrome_call("togglePreviewSyncScroll", None)),
        "view.preview_copy_html" => Some(WebBridge::format_chrome_call("copyPreviewHtml", None)),
        "view.live_preview" => Some(WebBridge::format_chrome_call("toggleEditorLivePreview", None)),
        "view.toc" | "go.header" => Some(WebBridge::format_chrome_call("toggleToc", None)),
        "view.stats" => Some(WebBridge::format_chrome_call("toggleStatistics", None)),
        "view.line_numbers" => Some(
            "window.config.showLineNumbers = !window.config.showLineNumbers; window.webModules?.config?.setShowLineNumbers?.({ enabled: window.config.showLineNumbers }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { showLineNumbers: window.config.showLineNumbers } });"
                .to_string(),
        ),
        "view.active_line" => Some(
            "window.config.showActiveLineIndicator = !window.config.showActiveLineIndicator; window.webModules?.config?.setShowActiveLineIndicator?.({ enabled: window.config.showActiveLineIndicator }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { showActiveLineIndicator: window.config.showActiveLineIndicator } });"
                .to_string(),
        ),
        "view.line_wrapping" => Some(
            "window.config.lineWrapping = !window.config.lineWrapping; window.webModules?.config?.setLineWrapping?.({ enabled: window.config.lineWrapping }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { lineWrapping: window.config.lineWrapping } });"
                .to_string(),
        ),
        "view.invisibles" => Some(
            "window.config.invisiblesBehavior = window.config.invisiblesBehavior === 'never' ? 'always' : 'never'; window.webModules?.config?.setInvisiblesBehavior?.({ behavior: window.config.invisiblesBehavior }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { invisiblesBehavior: window.config.invisiblesBehavior } });"
                .to_string(),
        ),
        "view.typewriter" => Some(
            "window.config.typewriterMode = !window.config.typewriterMode; window.webModules?.config?.setTypewriterMode?.({ enabled: window.config.typewriterMode }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { typewriterMode: window.config.typewriterMode } });"
                .to_string(),
        ),
        "view.focus" => Some(
            "window.config.focusMode = !window.config.focusMode; window.webModules?.config?.setFocusMode?.({ enabled: window.config.focusMode }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { focusMode: window.config.focusMode } });"
                .to_string(),
        ),
        "view.theme" => Some(
            "window.config.theme = /-dark$/.test(window.config.theme) ? window.config.theme.replace(/-dark$/, '-light') : (/-light$/.test(window.config.theme) ? window.config.theme.replace(/-light$/, '-dark') : 'github-dark'); window.webModules?.config?.setTheme?.({ name: window.config.theme }); window.__TAURI_INTERNALS__?.invoke('settings_update', { patch: { theme: window.config.theme } });"
                .to_string(),
        ),
        "view.le_crlf" => Some(WebBridge::format_call(
            "lineEndings",
            "setLineEndings",
            Some(json!({ "lineEndings": 2 })),
        )),
        "view.le_lf" => Some(WebBridge::format_call(
            "lineEndings",
            "setLineEndings",
            Some(json!({ "lineEndings": 1 })),
        )),
        "view.le_cr" => Some(WebBridge::format_call(
            "lineEndings",
            "setLineEndings",
            Some(json!({ "lineEndings": 3 })),
        )),
        "go.back" => Some(WebBridge::format_call("selection", "navigateGoBack", None)),
        "go.next_section" => Some(WebBridge::format_call("toc", "selectNextSection", None)),
        "go.prev_section" => Some(WebBridge::format_call("toc", "selectPreviousSection", None)),
        _ => None,
    }
}

/// Script for View → Markdown Parser items; the choice is saved and synced to every window.
fn parser_menu_script(menu_id: &str) -> Option<String> {
    let id = menu_id.strip_prefix("view.parser.")?;
    MARKDOWN_PARSERS.iter().find(|(known, _)| *known == id)?;
    let id_json = serde_json::to_string(id).ok()?;
    Some(format!(
        "window.chromeUI?.setMarkdownRenderer?.({id_json}); window.__TAURI_INTERNALS__?.invoke('settings_update', {{ patch: {{ markdownRenderer: {id_json} }} }});"
    ))
}

/// Check items toggle themselves when clicked; show the state the click asks for right away
/// (the editor then reports its actual state).
fn apply_expected_view_state<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    let mut state = current_view_state();
    if let Some(mode) = menu_id.strip_prefix("view.mode.") {
        state.mode = mode.to_string();
    } else if let Some(id) = menu_id.strip_prefix("view.parser.") {
        state.renderer = id.to_string();
    } else if menu_id == "view.preview_sync" {
        state.sync_scroll = !state.sync_scroll;
    } else if menu_id == "view.live_preview" {
        state.live_preview = !state.live_preview;
    } else {
        return;
    }
    apply_view_state(app, state);
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    apply_expected_view_state(app, menu_id);
    if let Some(script) = parser_menu_script(menu_id) {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.eval(&script);
        }
        return;
    }

    let active_label = focused_webview(app)
        .map(|w| w.label().to_string())
        .unwrap_or_else(|| "main".to_string());

    if menu_id == "app.quit" || menu_id == "file.exit" {
        // Close windows one by one so each unsaved document gets its save prompt;
        // the app exits once the last window is gone.
        for (_, window) in app.webview_windows() {
            let _ = window.close();
        }
        return;
    }

    if menu_id == "file.print" {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.print();
        }
        return;
    }

    if menu_id == "file.open" {
        // Capture the window that had focus before the modal dialog steals it,
        // so the chosen file opens in the window the user is actually working in.
        let target = focused_webview(app);
        if let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Markdown & TextPack",
                &["md", "markdown", "mdown", "mkd", "txt", "textpack", "textbundle"],
            )
            .pick_file()
        {
            // Open directly into the captured window instead of creating a new one.
            if let Some(w) = target {
                let label = w.label().to_string();
                let doc_mgr = app.state::<DocumentManager>();
                let is_dirty = doc_mgr.with_session(&label, |s| s.is_dirty);
                if is_dirty {
                    let result = rfd::MessageDialog::new()
                        .set_title("SuperMark")
                        .set_description("The current document has unsaved changes. Discard them and open the selected file?")
                        .set_level(rfd::MessageLevel::Warning)
                        .set_buttons(rfd::MessageButtons::OkCancel)
                        .show();
                    if result != rfd::MessageDialogResult::Ok {
                        return;
                    }
                }
                let loaded = doc_mgr.with_session(&label, |s| {
                    let text = s.load_from_path(&path)?;
                    Ok::<(String, String), String>((text, s.display_title()))
                });
                if let Ok((text, title)) = loaded {
                    doc_mgr.push_recent(path.clone());
                    if let Some(watcher) = app.try_state::<crate::document::watcher::ExternalFileWatcher>() {
                        let _ = watcher.watch(&path);
                    }
                    let _ = w.set_title(&title);
                    let _ = w.set_focus();
                    let _ = w.eval(&crate::bridge::WebBridge::set_document_path(Some(&path)));
                    let _ = w.eval(&crate::bridge::WebBridge::reset_editor(&text));
                    let _ = w.eval(&crate::bridge::WebBridge::reload_document());
                    crate::persist_last_session(app, None);
                }
            } else {
                open_document_path(app, path);
            }
        }
        return;
    }

    if menu_id == "file.open_folder" {
        if let Some(path) = rfd::FileDialog::new().pick_folder() {
            // Notify the focused window's frontend to show the folder in the sidebar.
            let doc_mgr = app.state::<DocumentManager>();
            let target_label = focused_webview(app)
                .map(|w| w.label().to_string())
                .unwrap_or_else(|| "main".to_string());
            if let Some(webview) = app.get_webview_window(&target_label) {
                let path_json = serde_json::to_string(&path.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "null".to_string());
                let _ = webview.eval(&format!("window.__markeditOpenFolder?.({path_json});"));
            }
            let _ = doc_mgr; // keep
        }
        return;
    }

    if menu_id == "file.autosave" {
        let mgr = crate::settings::SettingsManager::new();
        let mut settings = mgr.load_user_settings();
        settings.autosave = !settings.autosave;
        let _ = mgr.save_user_settings(&settings);
        // Update checkmark
        if let Some(item) = app.menu().and_then(|m| m.get("file.autosave")) {
            if let Some(check) = item.as_check_menuitem() {
                let _ = check.set_checked(settings.autosave);
            }
        }
        // Notify frontend
        let script = format!(
            "if (window.MarkEdit?.userSettings) {{ window.MarkEdit.userSettings.autosave = {}; }}",
            settings.autosave
        );
        if let Some(webview) = focused_webview(app) {
            let _ = webview.eval(&script);
        }
        return;
    }

    if menu_id == "file.new" {
        let doc_mgr = app.state::<DocumentManager>();
        let is_busy = doc_mgr.with_session(&active_label, |s| {
            s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
        });

        if is_busy {
            let _ = create_editor_window(app, None);
        } else if let Some(webview) = focused_webview(app) {
            let title = doc_mgr.with_session(&active_label, |s| {
                *s = crate::document::DocumentSession::new(&active_label);
                s.display_title()
            });
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(""));
        }
        return;
    }

    if menu_id == "file.new_from_clipboard" {
        let clip_text = arboard::Clipboard::new()
            .ok()
            .and_then(|mut cb| cb.get_text().ok())
            .unwrap_or_default();
        let doc_mgr = app.state::<DocumentManager>();
        let is_busy = doc_mgr.with_session(&active_label, |s| {
            s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
        });

        if is_busy {
            if let Ok(win) = create_editor_window(app, None) {
                let new_label = win.label().to_string();
                let title = doc_mgr.with_session(&new_label, |s| {
                    s.content_cache = clip_text.clone();
                    s.is_dirty = !clip_text.is_empty();
                    s.display_title()
                });
                let _ = win.set_title(&title);
                let _ = win.eval(&WebBridge::reset_editor(&clip_text));
            }
        } else if let Some(webview) = focused_webview(app) {
            let title = doc_mgr.with_session(&active_label, |s| {
                *s = crate::document::DocumentSession::new(&active_label);
                s.content_cache = clip_text.clone();
                s.is_dirty = !clip_text.is_empty();
                s.display_title()
            });
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(&clip_text));
        }
        return;
    }

    if let Some(recent_path) = menu_id.strip_prefix("file.recent.") {
        open_document_path(app, PathBuf::from(recent_path));
        return;
    }

    if menu_id == "file.clear_recents" {
        app.state::<DocumentManager>().clear_recents();
        refresh_app_menu(app);
        return;
    }

    if let Some(enc_label) = menu_id.strip_prefix("file.reopen_encoding.") {
        let doc_mgr = app.state::<DocumentManager>();
        let current_path = doc_mgr.with_session(&active_label, |s| s.file_path.clone());
        if current_path.is_some() && !confirm_discard_changes(app, &active_label) {
            return;
        }
        let Some(path) = current_path else {
            let _ = MessageDialog::new()
                .set_title("SuperMark")
                .set_description("Save or open a file on disk before reopening with a specific encoding.")
                .set_level(MessageLevel::Info)
                .set_buttons(MessageButtons::Ok)
                .show();
            return;
        };
        let loaded = doc_mgr.with_session(&active_label, |s| {
            let text = s.load_from_path_with_encoding(&path, enc_label)?;
            Ok::<(String, String), String>((text, s.display_title()))
        });
        match loaded {
            Ok((_text, title)) => {
                if let Some(webview) = focused_webview(app) {
                    let _ = webview.set_title(&title);
                    let _ = webview.eval(&WebBridge::reload_document());
                }
            }
            Err(error) => crate::report_open_failure(&path, &error),
        }
        return;
    }

    if menu_id == "file.save_all" {
        // Only documents with unsaved changes; clean or empty untitled windows would otherwise
        // each open a Save As dialog at the same time.
        let script = "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });";
        let doc_mgr = app.state::<DocumentManager>();
        for (label, webview) in app.webview_windows() {
            if doc_mgr.with_session(&label, |s| s.is_dirty) {
                let _ = webview.eval(script);
            }
        }
        return;
    }

    if menu_id == "file.revert" {
        let has_path = app
            .state::<DocumentManager>()
            .with_session(&active_label, |s| s.file_path.is_some());
        if !has_path {
            show_info("This document has not been saved to disk yet, so there is nothing to revert to.");
            return;
        }
        if confirm_discard_changes(app, &active_label) {
            revert_to_saved(app, &active_label);
        }
        return;
    }

    if menu_id == "file.versions.delete" {
        let doc_mgr = app.state::<DocumentManager>();
        let current_path = doc_mgr.with_session(&active_label, |s| s.file_path.clone());
        if let Some(path) = current_path {
            let count = doc_mgr.versions().list_versions(&path).len();
            if count == 0 {
                let _ = MessageDialog::new()
                    .set_title("SuperMark")
                    .set_description("No local versions exist for this document.")
                    .set_level(MessageLevel::Info)
                    .set_buttons(MessageButtons::Ok)
                    .show();
                return;
            }
            let choice = MessageDialog::new()
                .set_title("SuperMark")
                .set_description(format!(
                    "Delete all {count} local version snapshot(s) for this document?"
                ))
                .set_level(MessageLevel::Warning)
                .set_buttons(MessageButtons::OkCancel)
                .show();
            if matches!(choice, MessageDialogResult::Ok | MessageDialogResult::Yes) {
                let _ = doc_mgr.versions().delete_local_versions(&path);
            }
        }
        return;
    }

    if menu_id == "file.reveal_in_folder" {
        let doc_mgr = app.state::<DocumentManager>();
        if let Some(path) = doc_mgr.with_session(&active_label, |s| s.file_path.clone()) {
            reveal_in_file_manager(&path);
        } else {
            let _ = MessageDialog::new()
                .set_title("SuperMark")
                .set_description("This document has not been saved to disk yet.")
                .set_level(MessageLevel::Info)
                .set_buttons(MessageButtons::Ok)
                .show();
        }
        return;
    }

    if menu_id == "file.copy_file_path" {
        let doc_mgr = app.state::<DocumentManager>();
        if let Some(path) = doc_mgr.with_session(&active_label, |s| s.file_path.clone()) {
            copy_to_clipboard(&path.to_string_lossy());
        } else {
            show_info("This document has not been saved to disk yet.");
        }
        return;
    }

    if menu_id == "file.copy_folder_path" {
        let doc_mgr = app.state::<DocumentManager>();
        if let Some(folder) = doc_mgr.with_session(&active_label, |s| {
            s.file_path
                .as_ref()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        }) {
            copy_to_clipboard(&folder.to_string_lossy());
        } else {
            show_info("This document has not been saved to disk yet.");
        }
        return;
    }

    if let Some(pandoc_fmt) = menu_id.strip_prefix("file.pandoc.") {
        let doc_mgr = app.state::<DocumentManager>();
        if let Some(path) = doc_mgr.with_session(&active_label, |s| s.file_path.clone()) {
            let cmd = build_pandoc_command(&path, pandoc_fmt);
            copy_to_clipboard(&cmd);
        } else {
            let _ = MessageDialog::new()
                .set_title("SuperMark")
                .set_description("Please save the document first before generating a Pandoc command.")
                .set_level(MessageLevel::Info)
                .set_buttons(MessageButtons::Ok)
                .show();
        }
        return;
    }

    if menu_id == "file.close" {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.close();
        }
        return;
    }

    if menu_id == "view.le_crlf" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session(&active_label, |s| s.line_endings = LineEndings::CRLF);
    } else if menu_id == "view.le_lf" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session(&active_label, |s| s.line_endings = LineEndings::LF);
    } else if menu_id == "view.le_cr" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session(&active_label, |s| s.line_endings = LineEndings::CR);
    }

    if matches!(menu_id, "view.zoom_in" | "view.zoom_out" | "view.zoom_reset") {
        let next = match menu_id {
            "view.zoom_in" => (ZOOM_PERCENT.load(Ordering::Relaxed) + 10).min(300),
            "view.zoom_out" => (ZOOM_PERCENT.load(Ordering::Relaxed) - 10).max(50),
            _ => 100,
        };
        ZOOM_PERCENT.store(next, Ordering::Relaxed);
        let factor = f64::from(next) / 100.0;
        for (_, webview) in app.webview_windows() {
            let _ = webview.set_zoom(factor);
        }
        return;
    }

    if menu_id == "view.fullscreen" {
        if let Some(webview) = focused_webview(app) {
            let current = webview.is_fullscreen().unwrap_or(false);
            let _ = webview.set_fullscreen(!current);
        }
        return;
    }

    if menu_id == "window.minimize" {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.minimize();
        }
        return;
    }

    if menu_id == "window.zoom" {
        if let Some(webview) = focused_webview(app) {
            if webview.is_maximized().unwrap_or(false) {
                let _ = webview.unmaximize();
            } else {
                let _ = webview.maximize();
            }
        }
        return;
    }

    if menu_id == "window.float_on_top" {
        if let Some(webview) = focused_webview(app) {
            let next = !FLOAT_ON_TOP.load(Ordering::Relaxed);
            FLOAT_ON_TOP.store(next, Ordering::Relaxed);
            let _ = webview.set_always_on_top(next);
        }
        return;
    }

    if menu_id == "window.front" {
        for (_, webview) in app.webview_windows() {
            let _ = webview.show();
            let _ = webview.set_focus();
        }
        return;
    }

    if menu_id == "app.about" {
        let _ = MessageDialog::new()
            .set_title("About SuperMark")
            .set_description(format!(
                "SuperMark v{}\n\n{}\n\n{}",
                env!("CARGO_PKG_VERSION"),
                "Fast, lightweight Markdown editor powered by Tauri v2 (Rust) and CodeMirror 6 CoreEditor.",
                crate::licenses::third_party_licenses_text()
            ))
            .set_level(MessageLevel::Info)
            .set_buttons(MessageButtons::Ok)
            .show();
        return;
    }

    if menu_id == "app.updates" {
        crate::updates::check_for_updates(app.clone(), true);
        return;
    }

    if menu_id == "help.releases" {
        open_in_shell(crate::updates::RELEASES_PAGE);
        return;
    }

    if menu_id == "app.open_settings_file" {
        let mgr = crate::settings::SettingsManager::new();
        let path = mgr.settings_file_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if !path.exists() {
            let _ = mgr.save(&mgr.load_or_default());
        }
        open_in_shell(&path.to_string_lossy());
        return;
    }

    if menu_id == "help.homepage" {
        open_in_shell("https://github.com/firegong/SuperMark");
        return;
    }

    if menu_id == "help.issue" {
        open_in_shell("https://github.com/firegong/SuperMark/issues");
        return;
    }

    if menu_id == "view.toggle_sidebar" {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.eval("window.__markeditToggleSidebar?.();");
        }
        return;
    }

    if handle_extension_menu_event(app, menu_id) {
        return;
    }

    if let Some(script) = menu_id_to_web_script(menu_id) {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.eval(&script);
        }
    }
}

fn copy_to_clipboard(text: &str) {
    if let Ok(mut cb) = arboard::Clipboard::new() {
        let _ = cb.set_text(text.to_string());
    }
}

pub fn reveal_in_file_manager(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
}

/// Menu label that shows a keyboard shortcut handled by the editor page itself.
///
/// These keys are not registered as menu accelerators: the page already handles them, and an
/// accelerator as well could run the action twice. On Windows, text after a tab is drawn as the
/// item's shortcut column, like a real accelerator.
fn shortcut_hint(label: &str, shortcut: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{label}\t{shortcut}")
    } else {
        format!("{label} ({shortcut})")
    }
}

fn show_info(message: &str) {
    let _ = MessageDialog::new()
        .set_title("SuperMark")
        .set_description(message)
        .set_level(MessageLevel::Info)
        .set_buttons(MessageButtons::Ok)
        .show();
}

/// Asks before an action replaces the editor content with the file on disk.
/// Returns `true` when there are no unsaved changes or the user agreed to discard them.
fn confirm_discard_changes<R: Runtime>(app: &AppHandle<R>, label: &str) -> bool {
    let is_dirty = app.state::<DocumentManager>().with_session(label, |s| s.is_dirty);
    if !is_dirty {
        return true;
    }

    let choice = MessageDialog::new()
        .set_title("SuperMark")
        .set_description("This document has unsaved changes. Discard them and reload the file?")
        .set_level(MessageLevel::Warning)
        .set_buttons(MessageButtons::OkCancel)
        .show();
    matches!(choice, MessageDialogResult::Ok | MessageDialogResult::Yes)
}

fn focused_webview<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"))
}

pub fn open_in_shell(target: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(target).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(target).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    }
}

pub fn open_document_path<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    // Already open: bring that window forward instead of opening the file twice.
    let doc_mgr = app.state::<DocumentManager>();
    if let Some(window) = doc_mgr
        .windows_for_path(&path)
        .into_iter()
        .find_map(|label| app.get_webview_window(&label))
    {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }

    if !path.exists() {
        let _ = MessageDialog::new()
            .set_title("SuperMark")
            .set_description(format!("File not found:\n{}", path.display()))
            .set_level(MessageLevel::Warning)
            .set_buttons(MessageButtons::Ok)
            .show();
        return;
    }

    let doc_mgr = app.state::<DocumentManager>();
    let target = focused_webview(app);
    let target_label = target
        .as_ref()
        .map(|w| w.label().to_string())
        .unwrap_or_else(|| "main".to_string());
    let is_busy = doc_mgr.with_session(&target_label, |s| {
        s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
    });

    if target.is_none() {
        // macOS hands the document over via `RunEvent::Opened` before the main window
        // is built (see `setup`); queue it instead of creating a second window.
        doc_mgr.push_pending_open(path);
        return;
    }

    // Reuse the focused window only while it is still an empty, untouched document;
    // otherwise open the file in a new window.
    if is_busy {
        let _ = create_editor_window(app, Some(path));
        refresh_app_menu(app);
    } else if let Some(webview) = target {
        let loaded = doc_mgr.with_session(&target_label, |s| {
            let text = s.load_from_path(&path)?;
            Ok::<(String, String), String>((text, s.display_title()))
        });

        match loaded {
            Ok((text, title)) => {
                crate::diagnostics::log(&format!("opened {} in window {target_label} ({} chars)", path.display(), text.chars().count()));
                let _ = webview.eval(&WebBridge::set_document_path(Some(&path)));
                doc_mgr.push_recent(path.clone());
                if let Some(watcher) = app.try_state::<crate::document::watcher::ExternalFileWatcher>() {
                    let _ = watcher.watch(&path);
                }
                refresh_app_menu(app);
                let _ = webview.set_title(&title);
                let _ = webview.set_focus();
                let _ = webview.eval(&WebBridge::reset_editor(&text));
                let _ = webview.eval(&WebBridge::reload_document());
                crate::persist_last_session(app, None);
            }
            Err(error) => crate::report_open_failure(&path, &error),
        }
    }
}

fn revert_to_saved<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let doc_mgr = app.state::<DocumentManager>();
    let existing = doc_mgr.with_session(label, |s| s.file_path.clone());
    let Some(path) = existing else {
        return;
    };
    let loaded = doc_mgr.with_session(label, |s| {
        let text = s.load_from_path(&path)?;
        Ok::<(String, String), String>((text, s.display_title()))
    });
    if let Ok((text, title)) = loaded {
        if let Some(webview) = app.get_webview_window(label) {
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(&text));
        }
    }
}

/// Asks the editor to fetch (`extensions_bootstrap`) and re-apply the installed extensions.
pub fn extensions_reload_script(_mgr: &ExtensionManager) -> String {
    "window.__markeditReloadExtensions__?.();".to_string()
}

fn handle_extension_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) -> bool {
    if !menu_id.starts_with("extensions.") {
        return false;
    }

    let doc_mgr = app.state::<DocumentManager>();
    let mgr = doc_mgr.extensions().clone();
    let webview = focused_webview(app);

    match menu_id {
        "extensions.manage" => {
            if let Some(w) = webview {
                let _ = w.eval("window.chromeUI?.openExtensionsManager?.('discover');");
            }
            true
        }
        "extensions.check_updates" => {
            // Registry refresh and downloads are network calls; keep them off the UI thread.
            let app = app.clone();
            std::thread::spawn(move || check_extension_updates(&app, mgr, webview));
            true
        }
        "extensions.install_url" => {
            if let Some(w) = webview {
                let script = r#"window.chromeUI?.showTextBox?.({
                    title: 'Install Extension from URL',
                    placeholder: 'https://example.com/extension.js'
                }).then((url) => {
                    if (url) {
                        window.__TAURI_INTERNALS__?.invoke('install_extension_from_url', { url });
                    }
                });"#;
                let _ = w.eval(script);
            }
            true
        }
        "extensions.open_folder" => {
            let _ = mgr.ensure_directories();
            let dir = mgr.scripts_dir();
            open_in_shell(&dir.to_string_lossy());
            true
        }
        "extensions.reload" => {
            if let Some(w) = webview {
                let script = extensions_reload_script(&mgr);
                let _ = w.eval(&script);
            }
            true
        }
        _ => false,
    }
}

fn check_extension_updates<R: Runtime>(
    _app: &AppHandle<R>,
    mgr: ExtensionManager,
    webview: Option<tauri::WebviewWindow<R>>,
) {
    let config = mgr.config();
    let registry_url = config.read().registry_url().to_string();
    let registry = ExtensionRegistry::new(
        mgr.registry_cache_dir(),
        registry_url,
        env!("CARGO_PKG_VERSION").to_string(),
    );

    let _ = registry.refresh(true, false);
    let updates = registry.pending_updates(&config);

    if updates.is_empty() {
        let _ = MessageDialog::new()
            .set_title("SuperMark")
            .set_description("All installed extensions are up to date.")
            .set_level(MessageLevel::Info)
            .set_buttons(MessageButtons::Ok)
            .show();
        return;
    }

    let names: Vec<String> = updates
        .iter()
        .map(|(rec, entry)| {
            let from = rec.version.as_deref().unwrap_or("unversioned");
            format!("• {} ({} → {})", entry.name, from, entry.latest.version)
        })
        .collect();

    let confirm = MessageDialog::new()
        .set_title("SuperMark")
        .set_description(format!(
            "{} extension update(s) available:\n\n{}\n\nInstall updates now?",
            updates.len(),
            names.join("\n")
        ))
        .set_level(MessageLevel::Info)
        .set_buttons(MessageButtons::OkCancel)
        .show();

    registry.mark_prompted();

    if !matches!(confirm, MessageDialogResult::Ok | MessageDialogResult::Yes) {
        return;
    }

    let scripts_dir = mgr.scripts_dir();
    let app_version = env!("CARGO_PKG_VERSION");
    for (record, entry) in &updates {
        if let Err(err) =
            downloader::download_update(&scripts_dir, record, entry, &config, app_version)
        {
            eprintln!(
                "[SuperMark] Failed to install extension update '{}': {}",
                entry.id, err
            );
        }
    }

    if let Some(w) = webview {
        let reload = extensions_reload_script(&mgr);
        let _ = w.eval(&reload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_menu_ids_to_expected_web_bridge_scripts() {
        let toc_next = menu_id_to_web_script("go.next_section").expect("go.next_section");
        assert!(toc_next.contains("window.webModules?.toc?.selectNextSection"));

        let toc_prev = menu_id_to_web_script("go.prev_section").expect("go.prev_section");
        assert!(toc_prev.contains("window.webModules?.toc?.selectPreviousSection"));

        let link = menu_id_to_web_script("format.link").expect("format.link");
        assert!(link.contains("\"url\":\"https://\""));

        let img = menu_id_to_web_script("format.image").expect("format.image");
        assert!(img.contains("\"prefix\":\"!\""));

        let table = menu_id_to_web_script("format.table").expect("format.table");
        assert!(table.contains("\"itemName\":\"Item\""));

        let fmt_doc = menu_id_to_web_script("edit.format_document").expect("edit.format_document");
        assert!(fmt_doc.contains("formatContent"));

        let settings = menu_id_to_web_script("app.settings").expect("app.settings");
        assert!(settings.contains("openSettings"));

        // View mode items set the mode (radio-like check items), not toggle it.
        for mode in VIEW_MODES {
            let script = menu_id_to_web_script(&format!("view.mode.{mode}")).expect("view mode");
            assert!(script.contains("setMarkdownPreviewMode"));
            assert!(script.contains(&format!("\"{mode}\"")));
        }
        assert!(menu_id_to_web_script("view.preview_sync").expect("sync").contains("togglePreviewSyncScroll"));
        assert!(menu_id_to_web_script("view.preview_copy_html").expect("copy").contains("copyPreviewHtml"));
        assert!(menu_id_to_web_script("view.live_preview").expect("live").contains("toggleEditorLivePreview"));

        // Parser items switch the renderer and persist the choice.
        let parser = parser_menu_script("view.parser.super").expect("parser");
        assert!(parser.contains("setMarkdownRenderer?.(\"super\")"));
        assert!(parser.contains("settings_update"));
        assert!(parser_menu_script("view.parser.unknown").is_none());

        let user_ext =
            menu_id_to_web_script("user_ext_action.custom_1").expect("user_ext_action");
        assert!(user_ext.contains("handleMainMenuAction"));
        assert!(user_ext.contains("custom_1"));
    }

    #[test]
    fn generates_valid_pandoc_command_for_document_path() {
        let p = Path::new("/tmp/notes/sample.md");
        // Pandoc rejects `-t pdf`; the `.pdf` output extension selects PDF output.
        let cmd = build_pandoc_command(p, "pdf");
        assert_eq!(
            cmd,
            "pandoc \"/tmp/notes/sample.md\" -o \"/tmp/notes/sample.pdf\""
        );
        assert_eq!(
            build_pandoc_command(p, "docx"),
            "pandoc \"/tmp/notes/sample.md\" -t docx -o \"/tmp/notes/sample.docx\""
        );
    }

    /// Accelerators registered in this file (the menu itself needs an AppHandle to build).
    fn registered_accelerators() -> Vec<String> {
        let source = include_str!("mod.rs");
        let needle = concat!(".accel", "erator(\"");
        source
            .match_indices(needle)
            .filter_map(|(start, _)| {
                let rest = &source[start + needle.len()..];
                rest.find('"').map(|end| rest[..end].to_string())
            })
            .collect()
    }

    #[test]
    fn menu_accelerators_are_unique_altgr_safe_and_not_owned_by_the_editor() {
        let accelerators = registered_accelerators();
        assert!(accelerators.len() > 30, "parsed {accelerators:?}");

        let mut seen = std::collections::HashSet::new();
        for acc in &accelerators {
            assert!(seen.insert(acc.to_lowercase()), "duplicate accelerator {acc}");

            // Ctrl+Alt+<character> is AltGr on many keyboard layouts (e.g. AltGr+S types "ś").
            let parts: Vec<&str> = acc.split('+').collect();
            let key = parts.last().copied().unwrap_or_default();
            let has_ctrl = parts.iter().any(|p| *p == "CmdOrCtrl" || *p == "Ctrl");
            let has_alt = parts.contains(&"Alt");
            assert!(
                !(has_ctrl && has_alt && key.chars().count() == 1),
                "AltGr-unsafe accelerator {acc}"
            );
        }

        // Keys the editor page handles itself (CodeMirror keymaps, chrome keydown handler).
        for page_key in [
            "CmdOrCtrl+Z", "CmdOrCtrl+Y", "CmdOrCtrl+F", "CmdOrCtrl+H", "CmdOrCtrl+G",
            "Alt+Up", "Alt+Down", "Shift+Alt+Up", "Shift+Alt+Down", "CmdOrCtrl+]", "CmdOrCtrl+[",
            "CmdOrCtrl+/", "Shift+Alt+A", "CmdOrCtrl+Shift+O", "CmdOrCtrl+Shift+I",
            "CmdOrCtrl+Shift+P", "CmdOrCtrl+Shift+V", "CmdOrCtrl+Shift+K", "CmdOrCtrl+M",
            "Ctrl+Alt+Up", "Ctrl+Alt+Down",
        ] {
            assert!(!accelerators.iter().any(|acc| acc == page_key), "{page_key} is owned by the editor");
        }
    }

    #[test]
    fn extension_parsers_are_offered_only_while_their_extension_is_enabled() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("dirs");

        assert!(parser_available("extended", Some(&mgr)));
        assert!(parser_available("super", Some(&mgr)));
        assert!(!parser_available("markdown-it", Some(&mgr)), "extension not installed");

        std::fs::write(mgr.scripts_dir().join("markedit-preview.js"), "// preview").expect("write");
        mgr.config().reconcile_installed(&mgr.scripts_dir()).expect("reconcile");
        assert!(parser_available("markdown-it", Some(&mgr)));

        mgr.set_extension_enabled("markedit-preview", false, "1.0.0").expect("disable");
        assert!(!parser_available("markdown-it", Some(&mgr)));

        mgr.set_extension_enabled("supermarkdown", false, "1.0.0").expect("disable builtin");
        assert!(!parser_available("super", Some(&mgr)));
        assert!(parser_menu_script("view.parser.markdown-it").is_some());
    }

    #[test]
    fn extension_shortcuts_cannot_take_editing_or_app_keys() {
        let spec = |key: &str, modifiers: &[&str]| -> UserMenuItemSpec {
            serde_json::from_value(json!({
                "title": "Change Mode",
                "key": key,
                "modifiers": modifiers,
            }))
            .expect("menu item")
        };
        // markedit-preview registers "Change Mode" as Command+V: on Windows that is Paste.
        assert_eq!(format_user_accelerator(&spec("V", &["Command"])), None);
        assert_eq!(format_user_accelerator(&spec("z", &["Command"])), None);
        // Keys the app already uses stay with the app (Ctrl+B is Format › Bold).
        assert_eq!(format_user_accelerator(&spec("B", &["Command"])), None);
        // Free combinations still work.
        assert_eq!(
            format_user_accelerator(&spec("V", &["Command", "Option"])),
            Some("CmdOrCtrl+Alt+V".to_string())
        );
    }

    #[test]
    fn find_menu_items_use_existing_find_bar_and_selection_apis() {
        for id in ["edit.find_next", "edit.find_previous", "edit.find_selection"] {
            let script = menu_id_to_web_script(id).expect(id);
            assert!(script.contains(".markedit-chrome-findbar-input"), "{id}");
            assert!(script.contains("selection?.getText"), "{id}");
            assert!(!script.contains("search?.selectedText"), "{id}");
        }
        // Print is handled natively (window.print is stubbed in release builds).
        assert!(menu_id_to_web_script("file.print").is_none());
        // View toggles are persisted.
        assert!(menu_id_to_web_script("view.line_numbers")
            .expect("line numbers")
            .contains("settings_update"));
    }
}
