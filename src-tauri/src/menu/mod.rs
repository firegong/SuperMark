use crate::bridge::WebBridge;
use crate::create_editor_window;
use crate::document::{DocumentManager, LineEndings};
use serde_json::json;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Manager, Runtime,
};

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
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
        .separator()
        .quit()
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
            &MenuItemBuilder::with_id("edit.goto_line", "Go to Line...")
                .accelerator("CmdOrCtrl+G")
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
        .item(
            &MenuItemBuilder::with_id("format.inline_code", "Inline Code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("format.code_block", "Code Block")
                .accelerator("CmdOrCtrl+Shift+C")
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
        .item(&MenuItemBuilder::with_id("view.typewriter", "Toggle Typewriter Mode").build(app)?)
        .item(&MenuItemBuilder::with_id("view.focus", "Toggle Focus Mode").build(app)?)
        .separator()
        .item(&line_endings_submenu)
        .build()?;

    let extensions_menu = SubmenuBuilder::new(app, "Extensions")
        .item(&MenuItemBuilder::with_id("extensions.manage", "Browse Extensions...").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.check_updates", "Check for Updates").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.install_url", "Install Extension from URL...").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("extensions.open_folder", "Open Extensions Folder").build(app)?)
        .item(&MenuItemBuilder::with_id("extensions.reload", "Reload Extensions").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &format_menu, &view_menu, &extensions_menu])
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
        "edit.undo" => Some(WebBridge::format_call("history", "undo", None)),
        "edit.redo" => Some(WebBridge::format_call("history", "redo", None)),
        "edit.find" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(false)))),
        "edit.replace" => Some(WebBridge::format_chrome_call("openFindBar", Some(json!(true)))),
        "edit.goto_line" => Some(WebBridge::format_chrome_call("openGotoLine", None)),
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
        "view.typewriter" => Some(
            "window.config.typewriterMode = !window.config.typewriterMode; window.webModules?.config?.setTypewriterMode?.({ enabled: window.config.typewriterMode });".to_string()
        ),
        "view.focus" => Some(
            "window.config.focusMode = !window.config.focusMode; window.webModules?.config?.setFocusMode?.({ enabled: window.config.focusMode });".to_string()
        ),
        "view.le_crlf" => Some(WebBridge::format_call("lineEndings", "setLineEndings", Some(json!({ "lineEndings": 2 })))),
        "view.le_lf" => Some(WebBridge::format_call("lineEndings", "setLineEndings", Some(json!({ "lineEndings": 1 })))),
        _ => None,
    }
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    if menu_id == "file.open" {
        if let Some(webview) = app.get_webview_window("main") {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter(
                    "Markdown & TextPack",
                    &["md", "markdown", "mdown", "mkd", "txt", "textpack"],
                )
                .pick_file()
            {
                let doc_mgr = app.state::<DocumentManager>();
                let is_busy = doc_mgr.with_session("main", |s| {
                    s.is_dirty || s.file_path.is_some() || !s.content_cache.is_empty()
                });

                if is_busy {
                    let _ = create_editor_window(app, Some(path));
                } else {
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

    if menu_id == "view.le_crlf" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session("main", |s| s.line_endings = LineEndings::CRLF);
    } else if menu_id == "view.le_lf" {
        let doc_mgr = app.state::<DocumentManager>();
        doc_mgr.with_session("main", |s| s.line_endings = LineEndings::LF);
    }

    handle_extension_menu_event(app, menu_id);

    if let Some(script) = menu_id_to_web_script(menu_id) {
        if let Some(webview) = app.get_webview_window("main") {
            let _ = webview.eval(&script);
        }
    }
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
    let webview = app.get_webview_window("main");

    match menu_id {
        "extensions.manage" => {
            if let Some(webview) = webview {
                let _ = webview.eval("window.open('https://github.com/MarkEdit-app/extensions');");
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
            #[cfg(target_os = "macos")]
            let _ = std::process::Command::new("open").arg(&dir).spawn();
            #[cfg(target_os = "windows")]
            let _ = std::process::Command::new("explorer").arg(&dir).spawn();
            #[cfg(all(unix, not(target_os = "macos")))]
            let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
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
