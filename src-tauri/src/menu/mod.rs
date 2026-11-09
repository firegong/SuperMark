use crate::bridge::generated::MenuItem as UserMenuItemSpec;
use crate::bridge::WebBridge;
use crate::create_editor_window;
use crate::document::{DocumentManager, LineEndings};
use crate::extensions::{downloader, ExtensionManager, ExtensionRegistry};
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

static ZOOM_PERCENT: AtomicI32 = AtomicI32::new(100);
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
    Some(parts.join("+"))
}

pub fn refresh_app_menu<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(menu) = build_app_menu(app) {
        let _ = app.set_menu(menu);
    }
}

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "MarkEdit-Rust")
        .item(&MenuItemBuilder::with_id("app.about", "About MarkEdit-Rust").build(app)?)
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
        .quit()
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
        .item(&MenuItemBuilder::with_id("file.pandoc.learn", "Learn More...").build(app)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file.new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.new_from_clipboard", "New File from Clipboard")
                .accelerator("CmdOrCtrl+Alt+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.open", "Open...")
                .accelerator("CmdOrCtrl+O")
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
                .accelerator("CmdOrCtrl+Alt+S")
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
        .quit()
        .build()?;

    let find_submenu = SubmenuBuilder::new(app, "Find")
        .item(
            &MenuItemBuilder::with_id("edit.find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.replace", "Find and Replace...")
                .accelerator("CmdOrCtrl+H")
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
            &MenuItemBuilder::with_id("edit.move_line_up", "Move Line Up")
                .accelerator("Alt+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.move_line_down", "Move Line Down")
                .accelerator("Alt+Down")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.copy_line_up", "Copy Line Up")
                .accelerator("Shift+Alt+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.copy_line_down", "Copy Line Down")
                .accelerator("Shift+Alt+Down")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.indent_more", "Indent More")
                .accelerator("CmdOrCtrl+]")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.indent_less", "Indent Less")
                .accelerator("CmdOrCtrl+[")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("edit.toggle_comment", "Toggle Line Comment")
                .accelerator("CmdOrCtrl+/")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.toggle_block_comment", "Toggle Block Comment")
                .accelerator("Shift+Alt+A")
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
                .accelerator("CmdOrCtrl+Alt+-")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("edit.font.reset", "Reset Font Size").build(app)?)
        .build()?;

    let toc_submenu = SubmenuBuilder::new(app, "Table of Contents")
        .item(
            &MenuItemBuilder::with_id("view.toc", "Show Table of Contents")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go.prev_section", "Select Previous Section")
                .accelerator("Ctrl+Alt+Up")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go.next_section", "Select Next Section")
                .accelerator("Ctrl+Alt+Down")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(
            &MenuItemBuilder::with_id("edit.undo", "Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.redo", "Redo")
                .accelerator("CmdOrCtrl+Y")
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
            &MenuItemBuilder::with_id("view.stats", "Statistics...")
                .accelerator("CmdOrCtrl+Shift+I")
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
                .accelerator("CmdOrCtrl+Shift+K")
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

    let view_menu = SubmenuBuilder::new(app, "View")
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
        .item(&line_endings_submenu)
        .build()?;

    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(&MenuItemBuilder::with_id("go.back", "Go Back").build(app)?)
        .item(
            &MenuItemBuilder::with_id("edit.goto_line", "Go to Line...")
                .accelerator("CmdOrCtrl+G")
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
            &MenuItemBuilder::with_id("extensions.manage", "Manage Extensions...")
                .accelerator("CmdOrCtrl+Shift+X")
                .build(app)?,
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
                .accelerator("CmdOrCtrl+M")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("window.zoom", "Zoom").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.float_on_top", "Toggle Float on Top").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.front", "Bring All to Front").build(app)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.wiki", "MarkEdit Wiki & User Manual").build(app)?)
        .item(&MenuItemBuilder::with_id("help.customization", "Customization Guide").build(app)?)
        .item(
            &MenuItemBuilder::with_id("help.development", "Extension Development Guide")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("help.homepage", "MarkEdit-Rust Home Page").build(app)?)
        .item(&MenuItemBuilder::with_id("help.releases", "Version History & Releases").build(app)?)
        .item(&MenuItemBuilder::with_id("help.issue", "Report an Issue...").build(app)?)
        .item(&MenuItemBuilder::with_id("help.upstream", "About Upstream MarkEdit").build(app)?)
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
        "file.print" => Some("window.print();".to_string()),
        "edit.undo" => Some(WebBridge::format_call("history", "undo", None)),
        "edit.redo" => Some(WebBridge::format_call("history", "redo", None)),
        "edit.find" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(false)))),
        "edit.replace" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(true)))),
        "edit.find_next" => Some(
            "(function(){ const q = document.querySelector('.markedit-find-input')?.value || window.webModules?.search?.selectedText?.() || ''; if (q) { window.webModules?.search?.findNext?.({ search: q }); } else { window.chromeUI?.openFindBar?.(false); } })();".to_string(),
        ),
        "edit.find_previous" => Some(
            "(function(){ const q = document.querySelector('.markedit-find-input')?.value || window.webModules?.search?.selectedText?.() || ''; if (q) { window.webModules?.search?.findPrevious?.({ search: q }); } else { window.chromeUI?.openFindBar?.(false); } })();".to_string(),
        ),
        "edit.find_selection" => Some(
            "(function(){ const sel = window.webModules?.search?.selectedText?.() || ''; window.chromeUI?.openFindBar?.(false); const input = document.querySelector('.markedit-find-input'); if (input && sel) { input.value = sel; input.dispatchEvent(new Event('input', { bubbles: true })); } })();".to_string(),
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
        "view.toc" | "go.header" => Some(WebBridge::format_chrome_call("toggleToc", None)),
        "view.stats" => Some(WebBridge::format_chrome_call("toggleStatistics", None)),
        "view.line_numbers" => Some(
            "window.config.showLineNumbers = !window.config.showLineNumbers; window.webModules?.config?.setShowLineNumbers?.({ enabled: window.config.showLineNumbers });"
                .to_string(),
        ),
        "view.active_line" => Some(
            "window.config.showActiveLineIndicator = !window.config.showActiveLineIndicator; window.webModules?.config?.setShowActiveLineIndicator?.({ enabled: window.config.showActiveLineIndicator });"
                .to_string(),
        ),
        "view.line_wrapping" => Some(
            "window.config.lineWrapping = !window.config.lineWrapping; window.webModules?.config?.setLineWrapping?.({ enabled: window.config.lineWrapping });"
                .to_string(),
        ),
        "view.invisibles" => Some(
            "window.config.invisiblesBehavior = window.config.invisiblesBehavior === 'never' ? 'always' : 'never'; window.webModules?.config?.setInvisiblesBehavior?.({ behavior: window.config.invisiblesBehavior });"
                .to_string(),
        ),
        "view.typewriter" => Some(
            "window.config.typewriterMode = !window.config.typewriterMode; window.webModules?.config?.setTypewriterMode?.({ enabled: window.config.typewriterMode });"
                .to_string(),
        ),
        "view.focus" => Some(
            "window.config.focusMode = !window.config.focusMode; window.webModules?.config?.setFocusMode?.({ enabled: window.config.focusMode });"
                .to_string(),
        ),
        "view.theme" => Some(
            "window.config.theme = window.config.theme === 'github-dark' ? 'github-light' : 'github-dark'; window.webModules?.config?.setTheme?.({ name: window.config.theme });"
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

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    let active_label = focused_webview(app)
        .map(|w| w.label().to_string())
        .unwrap_or_else(|| "main".to_string());

    if menu_id == "file.open" {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Markdown & TextPack",
                &["md", "markdown", "mdown", "mkd", "txt", "textpack", "textbundle"],
            )
            .pick_file()
        {
            open_document_path(app, path);
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
        let Some(path) = current_path else {
            let _ = MessageDialog::new()
                .set_title("MarkEdit-Rust")
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
        if let Ok((text, title)) = loaded {
            if let Some(webview) = focused_webview(app) {
                let _ = webview.set_title(&title);
                let _ = webview.eval(&WebBridge::reset_editor(&text));
            }
        }
        return;
    }

    if menu_id == "file.save_all" {
        let script = "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });";
        for (_, webview) in app.webview_windows() {
            let _ = webview.eval(script);
        }
        return;
    }

    if menu_id == "file.revert" {
        revert_to_saved(app, &active_label);
        return;
    }

    if menu_id == "file.versions.delete" {
        let doc_mgr = app.state::<DocumentManager>();
        let current_path = doc_mgr.with_session(&active_label, |s| s.file_path.clone());
        if let Some(path) = current_path {
            let count = doc_mgr.versions().list_versions(&path).len();
            if count == 0 {
                let _ = MessageDialog::new()
                    .set_title("MarkEdit-Rust")
                    .set_description("No local versions exist for this document.")
                    .set_level(MessageLevel::Info)
                    .set_buttons(MessageButtons::Ok)
                    .show();
                return;
            }
            let choice = MessageDialog::new()
                .set_title("MarkEdit-Rust")
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
                .set_title("MarkEdit-Rust")
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
        }
        return;
    }

    if let Some(pandoc_fmt) = menu_id.strip_prefix("file.pandoc.") {
        if pandoc_fmt == "learn" {
            open_in_shell("https://github.com/MarkEdit-app/MarkEdit/wiki/Manual#copy-pandoc-command");
            return;
        }
        let doc_mgr = app.state::<DocumentManager>();
        if let Some(path) = doc_mgr.with_session(&active_label, |s| s.file_path.clone()) {
            let cmd = build_pandoc_command(&path, pandoc_fmt);
            copy_to_clipboard(&cmd);
        } else {
            let _ = MessageDialog::new()
                .set_title("MarkEdit-Rust")
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
            .set_title("About MarkEdit-Rust")
            .set_description(format!(
                "MarkEdit-Rust v{}\n\nFast, lightweight Markdown editor powered by Tauri v2 (Rust) and CodeMirror 6 CoreEditor.",
                env!("CARGO_PKG_VERSION")
            ))
            .set_level(MessageLevel::Info)
            .set_buttons(MessageButtons::Ok)
            .show();
        return;
    }

    if menu_id == "app.updates" || menu_id == "help.releases" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win/releases");
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

    if menu_id == "help.wiki" {
        open_in_shell("https://github.com/MarkEdit-app/MarkEdit/wiki");
        return;
    }

    if menu_id == "help.customization" {
        open_in_shell("https://github.com/MarkEdit-app/MarkEdit/wiki/Customization");
        return;
    }

    if menu_id == "help.development" {
        open_in_shell("https://github.com/MarkEdit-app/MarkEdit-api");
        return;
    }

    if menu_id == "help.homepage" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win");
        return;
    }

    if menu_id == "help.issue" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win/issues");
        return;
    }

    if menu_id == "help.upstream" {
        open_in_shell("https://github.com/MarkEdit-app/MarkEdit");
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
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
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

fn open_document_path<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    if !path.exists() {
        let _ = MessageDialog::new()
            .set_title("MarkEdit-Rust")
            .set_description(format!("File not found:\n{}", path.display()))
            .set_level(MessageLevel::Warning)
            .set_buttons(MessageButtons::Ok)
            .show();
        return;
    }

    let doc_mgr = app.state::<DocumentManager>();
    let is_busy = doc_mgr.with_session("main", |s| {
        s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
    });

    if is_busy {
        let _ = create_editor_window(app, Some(path));
        refresh_app_menu(app);
    } else if let Some(webview) = app.get_webview_window("main") {
        let loaded = doc_mgr.with_session("main", |s| {
            let text = s.load_from_path(&path)?;
            Ok::<(String, String), String>((text, s.display_title()))
        });

        if let Ok((text, title)) = loaded {
            doc_mgr.push_recent(path);
            refresh_app_menu(app);
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(&text));
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

pub fn extensions_reload_script(mgr: &ExtensionManager) -> String {
    let bootstrap = mgr.build_extension_bootstrap_js();
    let cleanup =
        "document.querySelectorAll('style[data-markedit-user-style]').forEach((el) => el.remove());";
    if bootstrap.is_empty() {
        cleanup.to_string()
    } else {
        format!("{cleanup}\n{bootstrap}")
    }
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
            check_extension_updates(app, mgr, webview);
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
            .set_title("MarkEdit-Rust")
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
        .set_title("MarkEdit-Rust")
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
                "[MarkEdit-Rust] Failed to install extension update '{}': {}",
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

        let user_ext =
            menu_id_to_web_script("user_ext_action.custom_1").expect("user_ext_action");
        assert!(user_ext.contains("handleMainMenuAction"));
        assert!(user_ext.contains("custom_1"));
    }

    #[test]
    fn generates_valid_pandoc_command_for_document_path() {
        let p = Path::new("/tmp/notes/sample.md");
        let cmd = build_pandoc_command(p, "pdf");
        assert_eq!(
            cmd,
            "pandoc \"/tmp/notes/sample.md\" -t pdf -o \"/tmp/notes/sample.pdf\""
        );
    }
}
