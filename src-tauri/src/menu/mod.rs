use crate::bridge::WebBridge;
use crate::create_editor_window;
use crate::document::{DocumentManager, LineEndings};
use serde_json::json;
use std::sync::atomic::{AtomicI32, Ordering};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

/// App-wide zoom percentage (100 = default). Shared by every editor window.
static ZOOM_PERCENT: AtomicI32 = AtomicI32::new(100);

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // ---- App menu (MarkEdit-Rust) ----
    let app_menu = SubmenuBuilder::new(app, "MarkEdit-Rust")
        .item(&MenuItemBuilder::with_id("app.about", "About MarkEdit-Rust").build(app)?)
        .item(
            &MenuItemBuilder::with_id("app.updates", "Check for App Updates...")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("app.settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .quit()
        .build()?;

    // ---- File ----
    let recents = app.state::<DocumentManager>().recent_paths_strings();
    let mut open_recent_submenu = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        open_recent_submenu = open_recent_submenu
            .item(&MenuItemBuilder::with_id("file.recent.none", "No Recent Files").enabled(false).build(app)?);
    } else {
        for path in recents.iter().take(10) {
            let label = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Untitled");
            open_recent_submenu = open_recent_submenu.item(
                &MenuItemBuilder::with_id(format!("file.recent.{path}"), label).build(app)?,
            );
        }
        open_recent_submenu = open_recent_submenu
            .separator()
            .item(&MenuItemBuilder::with_id("file.clear_recents", "Clear Menu").build(app)?);
    }
    let open_recent_submenu = open_recent_submenu.build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file.new", "New")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.open", "Open...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&open_recent_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.close", "Close")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .separator()
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
            &MenuItemBuilder::with_id("file.revert", "Revert to Saved")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.print", "Print...")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .build()?;

    // ---- Edit ----
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
        .item(
            &MenuItemBuilder::with_id("edit.find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("edit.replace", "Replace...")
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
        .separator()
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
        .item(
            &MenuItemBuilder::with_id("edit.select_line", "Select Line")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
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
            &MenuItemBuilder::with_id("edit.toggle_line_comment", "Toggle Line Comment")
                .accelerator("CmdOrCtrl+/")
                .build(app)?,
        )
        .build()?;

    // ---- Format ----
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
        .item(
            &MenuItemBuilder::with_id("format.inline_code", "Inline Code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.inline_math", "Inline Math")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.code_block", "Code Block")
                .accelerator("CmdOrCtrl+Shift+C")
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
        .item(&MenuItemBuilder::with_id("format.table", "Insert Table").build(app)?)
        .item(&MenuItemBuilder::with_id("format.hr", "Horizontal Rule").build(app)?)
        .build()?;

    // ---- View ----
    let line_endings_submenu = SubmenuBuilder::new(app, "Line Endings")
        .item(&MenuItemBuilder::with_id("view.le_crlf", "Windows (CRLF)").build(app)?)
        .item(&MenuItemBuilder::with_id("view.le_lf", "Unix / macOS (LF)").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("view.toc", "Table of Contents")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.stats", "Document Statistics")
                .accelerator("CmdOrCtrl+Shift+I")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("view.line_numbers", "Toggle Line Numbers").build(app)?)
        .item(&MenuItemBuilder::with_id("view.invisibles", "Toggle Invisibles").build(app)?)
        .item(&MenuItemBuilder::with_id("view.typewriter", "Toggle Typewriter Mode").build(app)?)
        .item(&MenuItemBuilder::with_id("view.focus", "Toggle Focus Mode").build(app)?)
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
            &MenuItemBuilder::with_id("view.zoom_actual", "Actual Size")
                .accelerator("CmdOrCtrl+0")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view.fullscreen", "Toggle Full Screen")
                .accelerator("F11")
                .build(app)?,
        )
        .separator()
        .item(&line_endings_submenu)
        .build()?;

    // ---- Go ----
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(
            &MenuItemBuilder::with_id("go.back", "Go Back")
                .accelerator("CmdOrCtrl+[")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go.line", "Go to Line...")
                .accelerator("CmdOrCtrl+G")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go.next_section", "Next Section")
                .accelerator("CmdOrCtrl+Shift+Down")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go.prev_section", "Previous Section")
                .accelerator("CmdOrCtrl+Shift+Up")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("go.header", "Go to Header...")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?,
        )
        .build()?;

    // ---- Extensions ----
    let extensions_menu = SubmenuBuilder::new(app, "Extensions")
        .item(&MenuItemBuilder::with_id("extensions.manage", "Manage Extensions...").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.check_updates", "Check for Updates").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.install_url", "Install Extension from URL...").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("extensions.open_folder", "Open Extensions Folder").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.reload", "Reload Extensions").build(app)?)
        .build()?;

    // ---- Window ----
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(
            &MenuItemBuilder::with_id("window.minimize", "Minimize")
                .accelerator("CmdOrCtrl+M")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("window.zoom", "Zoom").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("window.front_all", "Bring All to Front").build(app)?)
        .build()?;

    // ---- Help ----
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.repo", "MarkEdit-Rust Home Page").build(app)?)
        .item(&MenuItemBuilder::with_id("help.issues", "Report an Issue").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("help.upstream", "About MarkEdit (upstream)").build(app)?)
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
    match menu_id {
        "file.new" => Some(WebBridge::reset_editor("")),
        "file.save" => Some(
            "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });"
                .to_string(),
        ),
        "file.save_as" => Some(
            "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: true });"
                .to_string(),
        ),
        "file.print" => Some("window.print();".to_string()),
        "edit.undo" => Some(WebBridge::format_call("history", "undo", None)),
        "edit.redo" => Some(WebBridge::format_call("history", "redo", None)),
        "edit.find" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(false)))),
        "edit.replace" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(true)))),
        "edit.find_next" => Some(WebBridge::format_call("search", "findNext", None)),
        "edit.find_previous" => Some(WebBridge::format_call("search", "findPrevious", None)),
        "edit.expand_selection" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "expandSelection" })))),
        "edit.shrink_selection" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "shrinkSelection" })))),
        "edit.select_line" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "selectLine" })))),
        "edit.move_line_up" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "moveLineUp" })))),
        "edit.move_line_down" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "moveLineDown" })))),
        "edit.copy_line_up" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "copyLineUp" })))),
        "edit.copy_line_down" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "copyLineDown" })))),
        "edit.toggle_line_comment" => Some(WebBridge::format_call("format", "performEditCommand", Some(json!({ "command": "toggleLineComment" })))),
        "format.h1" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 1 })))),
        "format.h2" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 2 })))),
        "format.h3" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 3 })))),
        "format.h4" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 4 })))),
        "format.h5" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 5 })))),
        "format.h6" => Some(WebBridge::format_call("format", "toggleHeading", Some(json!({ "level": 6 })))),
        "format.bold" => Some(WebBridge::format_call("format", "toggleBold", None)),
        "format.italic" => Some(WebBridge::format_call("format", "toggleItalic", None)),
        "format.strikethrough" => {
            Some(WebBridge::format_call("format", "toggleStrikethrough", None))
        }
        "format.bullet" => Some(WebBridge::format_call("format", "toggleBullet", None)),
        "format.numbering" => Some(WebBridge::format_call("format", "toggleNumbering", None)),
        "format.todo" => Some(WebBridge::format_call("format", "toggleTodo", None)),
        "format.inline_code" => Some(WebBridge::format_call("format", "toggleInlineCode", None)),
        "format.inline_math" => Some(WebBridge::format_call("format", "toggleInlineMath", None)),
        "format.math_block" => Some(WebBridge::format_call("format", "insertMathBlock", None)),
        "format.code_block" => Some(WebBridge::format_call("format", "insertCodeBlock", None)),
        "format.blockquote" => Some(WebBridge::format_call("format", "toggleBlockquote", None)),
        "format.link" => Some(WebBridge::format_call("format", "insertHyperLink", Some(json!({ "title": "Link", " url": "https://" })))),
        "format.table" => Some(WebBridge::format_call("format", "insertTable", Some(json!({ "columnName": "Column", "ItemName": "Item" })))),
        "format.hr" => Some(WebBridge::format_call("format", "insertHorizontalRule", None)),
        "view.toc" => Some(WebBridge::format_chrome_call("toggleToc", None)),
        "view.stats" => Some(WebBridge::format_chrome_call("toggleStatistics", None)),
        "view.line_numbers" => Some(
            "window.config.showLineNumbers = !window.config.showLineNumbers; window.webModules?.config?.setShowLineNumbers?.({ enabled: window.config.showLineNumbers });".to_string()
        ),
        "view.invisibles" => Some(
            "const next = window.config.invisiblesBehavior === 'never' ? 'always' : 'never'; window.config.invisiblesBehavior = next; window.webModules?.config?.setInvisiblesBehavior?.({ behavior: next });".to_string()
        ),
        "view.typewriter" => Some(
            "window.config.typewriterMode = !window.config.typewriterMode; window.webModules?.config?.setTypewriterMode?.({ enabled: window.config.typewriterMode });".to_string()
        ),
        "view.focus" => Some(
            "window.config.focusMode = !window.config.focusMode; window.webModules?.config?.setFocusMode?.({ enabled: window.config.focusMode });".to_string()
        ),
        "view.theme" => Some(
            "const next = window.config.theme === 'github-light' ? 'github-dark' : 'github-light'; window.config.theme = next; window.webModules?.config?.setTheme?.({ name: next });".to_string()
        ),
        "view.le_crlf" => Some(WebBridge::format_call("lineEndings", "setLineEndings", Some(json!({ "lineEndings": 2 })))),
        "view.le_lf" => Some(WebBridge::format_call("lineEndings", "setLineEndings", Some(json!({ "lineEndings": 1 })))),
        "go.back" => Some(WebBridge::format_call("selection", "navigateGoBack", None)),
        "go.line" => Some(WebBridge::format_chrome_call("openGotoLine", None)),
        "go.next_section" => Some(WebBridge::format_call("selection", "selectNextSection", None)),
        "go.prev_section" => Some(WebBridge::format_call("selection", "selectPreviousSection", None)),
        "go.header" => Some(WebBridge::format_chrome_call("toggleToc", None)),
        _ => None,
    }
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    if menu_id == "file.open" {
        if let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Markdown & TextPack",
                &["md", "markdown", "mdown", "mkd", "txt", "textpack"],
            )
            .pick_file()
        {
            open_document_path(app, path);
        }
        return;
    }

    if menu_id == "file.new" {
        let doc_mgr = app.state::<DocumentManager>();
        let is_busy = doc_mgr.with_session("main", |s| {
            s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
        });

        if is_busy {
            let _ = create_editor_window(app, None);
        } else if let Some(webview) = app.get_webview_window("main") {
            let title = doc_mgr.with_session("main", |s| {
                *s = crate::document::DocumentSession::new("main");
                s.display_title()
            });
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(""));
        }
        return;
    }

    if let Some(path) = menu_id.strip_prefix("file.recent.") {
        if path != "none" {
            open_document_path(app, path.into());
        }
        return;
    }

    if menu_id == "file.clear_recents" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.clear_recents();
        return;
    }

    if menu_id == "file.revert" {
        revert_to_saved(app);
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
        doc_mgr.with_session("main", |s| s.line_endings = LineEndings::CRLF);
    } else if menu_id == "view.le_lf" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session("main", |s| s.line_endings = LineEndings::LF);
    }

    if menu_id == "view.zoom_in" || menu_id == "view.zoom_out" || menu_id == "view.zoom_actual" {
        let current = ZOOM_PERCENT.load(Ordering::Relaxed);
        let next = match menu_id {
            "view.zoom_in" => (current + 10).min(300),
            "view.zoom_out" => (current - 10).max(50),
            _ => 100,
        };
        ZOOM_PERCENT.store(next, Ordering::Relaxed);
        for (_, webview) in app.webview_windows() {
            let _ = webview.set_zoom(next as f64 / 100.0);
        }
        return;
    }

    if menu_id == "view.fullscreen" {
        if let Some(webview) = focused_webview(app) {
            let is_fullscreen = webview.is_fullscreen().unwrap_or(false);
            let _ = webview.set_fullscreen(!is_fullscreen);
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
            let is_maximized = webview.is_maximized().unwrap_or(false);
            if is_maximized {
                let _ = webview.unmaximize();
            } else {
                let _ = webview.maximize();
            }
        }
        return;
    }

    if menu_id == "window.front_all" {
        for (_, webview) in app.webview_windows() {
            let _ = webview.show();
            let _ = webview.set_focus();
        }
        return;
    }

    if menu_id == "app.about" {
        let _ = rfd::MessageDialog::new()
            .set_title("About MarkEdit-Rust")
            .set_description(format!(
                "MarkEdit-Rust v{}\n\nA cross-platform port of MarkEdit.\nTauri v2 + CodeMirror 6 CoreEditor.",
                env!("CARGO_PKG_VERSION")
            ))
            .set_buttons(rfd::MessageButtons::Ok)
            .set_level(rfd::MessageLevel::Info)
            .show();
        return;
    }

    if menu_id == "app.updates" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win/releases");
        return;
    }

    if menu_id == "app.settings" {
        let mgr = crate::settings::SettingsManager::new();
        let path = mgr.settings_file_path();
        if !path.exists() {
            let _ = mgr.save(&mgr.load_or_default());
        }
        open_in_shell(&path.to_string_lossy());
        return;
    }

    if menu_id == "help.repo" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win");
        return;
    }

    if menu_id == "help.issues" {
        open_in_shell("https://github.com/firegong/MarkEdit-Win/issues");
        return;
    }

    if menu_id == "help.upstream" {
        open_in_shell("https://github.com/MarkEdit-app/MarkEdit");
        return;
    }

    handle_extension_menu_event(app, menu_id);

    if let Some(script) = menu_id_to_web_script(menu_id) {
        if let Some(webview) = focused_webview(app) {
            let _ = webview.eval(&script);
        }
    }
}

/// Opens a document path in the main window when empty, otherwise in a new window.
fn open_document_path<R: Runtime>(app: &AppHandle<R>, path: std::path::PathBuf) {
    let doc_mgr = app.state::<DocumentManager>();
    let is_busy = doc_mgr.with_session("main", |s| {
        s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
    });

    if is_busy {
        let _ = create_editor_window(app, Some(path));
        return;
    }

    if let Some(webview) = app.get_webview_window("main") {
        let loaded = doc_mgr.with_session("main", |s| {
            let text = s.load_from_path(&path)?;
            Ok::<(String, String), String>((text, s.display_title()))
        });

        if let Ok((text, title)) = loaded {
            doc_mgr.push_recent(path);
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(&text));
        }
    }
}

fn revert_to_saved<R: Runtime>(app: &AppHandle<R>) {
    let doc_mgr = app.state::<DocumentManager>();
    let target = doc_mgr.with_session("main", |s| s.file_path.clone());
    let Some(path) = target else {
        return;
    };

    let loaded = doc_mgr.with_session("main", |s| {
        let text = s.load_from_path(&path)?;
        Ok::<(String, String), String>((text, s.display_title()))
    });

    if let Some(webview) = app.get_webview_window("main") {
        if let Ok((text, title)) = loaded {
            let _ = webview.set_title(&title);
            let _ = webview.eval(&WebBridge::reset_editor(&text));
        } else {
            let _ = rfd::MessageDialog::new()
                .set_title("MarkEdit-Rust")
                .set_description("Could not revert: the file no longer exists on disk.")
                .set_buttons(rfd::MessageButtons::Ok)
                .set_level(rfd::MessageLevel::Warning)
                .show();
        }
    }
}

fn focused_webview<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    for (_, webview) in app.webview_windows() {
        if webview.is_focused().unwrap_or(false) {
            return Some(webview);
        }
    }
    app.get_webview_window("main")
}

pub fn open_in_shell(target: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("explorer").arg(target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
}

pub fn extensions_reload_script(mgr: &crate::extensions::ExtensionManager) -> String {
    let mut script = String::from(
        "document.querySelectorAll('style[data-markedit-user-style]').forEach((el) => el.remove());",
    );
    let bootstrap = mgr.build_extension_bootstrap_js();
    if !bootstrap.is_empty() {
        script.push('\n');
        script.push_str(&bootstrap);
    }
    script
}

fn handle_extension_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    if !menu_id.starts_with("extensions.") {
        return;
    }

    let doc_mgr = app.state::<DocumentManager>();
    let mgr = doc_mgr.extensions().clone();
    let webview = focused_webview(app);

    match menu_id {
        "extensions.manage" => {
            if let Some(webview) = webview {
                let _ = webview.eval("window.chromeUI?.openExtensionsManager?.('discover');");
            }
        }
        "extensions.check_updates" => {
            check_extension_updates(app, mgr, webview);
        }
        "extensions.install_url" => {
            if let Some(webview) = webview {
                let _ = webview.eval(
                    r#"window.chromeUI?.showTextBox?.({ title: 'Install Extension from URL', placeholder: 'https://example.com/extension.js' }).then((url) => { if (url) window.__TAURI_INTERNALS__.invoke('install_extension_from_url', { url }); });"#,
                );
            }
        }
        "extensions.open_folder" => {
            let dir = mgr.scripts_dir();
            let _ = mgr.ensure_directories();
            open_in_shell(&dir.to_string_lossy());
        }
        "extensions.reload" => {
            if let Some(webview) = webview {
                let _ = webview.eval(&extensions_reload_script(&mgr));
            }
        }
        _ => {}
    }
}

fn check_extension_updates<R: Runtime>(
    app: &AppHandle<R>,
    mgr: crate::extensions::ExtensionManager,
    webview: Option<tauri::WebviewWindow<R>>,
) {
    let config = mgr.config();
    let registry = crate::extensions::ExtensionRegistry::new(
        mgr.registry_cache_dir(),
        config.read().registry_url().to_string(),
        env!("CARGO_PKG_VERSION").to_string(),
    );

    let _ = registry.refresh(true, false);
    let updates = registry.pending_updates(&config);

    let Some(webview) = webview else {
        return;
    };

    if updates.is_empty() {
        let _ = rfd::MessageDialog::new()
            .set_title("MarkEdit-Rust")
            .set_description("No updates available.")
            .set_buttons(rfd::MessageButtons::Ok)
            .set_level(rfd::MessageLevel::Info)
            .show();
        return;
    }

    let prompt = format!(
        "{} extension update(s) available. Install now?",
        updates.len()
    );
    let result = rfd::MessageDialog::new()
        .set_title("MarkEdit-Rust")
        .set_description(&prompt)
        .set_buttons(rfd::MessageButtons::OkCancel)
        .set_level(rfd::MessageLevel::Info)
        .show();

    if result != rfd::MessageDialogResult::Ok {
        registry.mark_prompted();
        return;
    }

    for (record, entry) in &updates {
        if let Err(err) = crate::extensions::downloader::download_update(
            &mgr.scripts_dir(),
            record,
            entry,
            &config,
            env!("CARGO_PKG_VERSION"),
        ) {
            eprintln!(
                "[MarkEdit-Rust] Failed to install extension update '{}': {}",
                entry.id, err
            );
        }
    }

    let _ = app;
    let reload = extensions_reload_script(&mgr);
    let encoded = serde_json::to_string(&reload).unwrap_or_else(|_| "\"\"".to_string());
    let _ = webview.eval(&format!("new Function({})();", encoded));
}
