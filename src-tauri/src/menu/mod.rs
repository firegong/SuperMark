use crate::bridge::WebBridge;
use crate::document::DocumentManager;
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
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
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
            &MenuItemBuilder::with_id("format.inline_code", "Inline Code")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("format.code_block", "Code Block").build(app)?)
        .item(&MenuItemBuilder::with_id("format.blockquote", "Blockquote").build(app)?)
        .item(
            &MenuItemBuilder::with_id("format.todo", "Toggle Todo")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("view.typewriter", "Toggle Typewriter Mode").build(app)?)
        .item(&MenuItemBuilder::with_id("view.focus", "Toggle Focus Mode").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&file_menu, &edit_menu, &format_menu, &view_menu])
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
        "format.bold" => Some(WebBridge::format_call("format", "toggleBold", None)),
        "format.italic" => Some(WebBridge::format_call("format", "toggleItalic", None)),
        "format.strikethrough" => {
            Some(WebBridge::format_call("format", "toggleStrikethrough", None))
        }
        "format.inline_code" => Some(WebBridge::format_call("format", "toggleInlineCode", None)),
        "format.code_block" => Some(WebBridge::format_call("format", "insertCodeBlock", None)),
        "format.blockquote" => Some(WebBridge::format_call("format", "toggleBlockquote", None)),
        "format.todo" => Some(WebBridge::format_call("format", "toggleTodo", None)),
        "view.typewriter" => Some(WebBridge::format_call(
            "config",
            "setTypewriterMode",
            Some(json!({ "enabled": true })),
        )),
        "view.focus" => Some(WebBridge::format_call(
            "config",
            "setFocusMode",
            Some(json!({ "enabled": true })),
        )),
        _ => None,
    }
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, menu_id: &str) {
    if menu_id == "file.open" {
        if let Some(webview) = app.get_webview_window("main") {
            if let Some(path) = rfd::FileDialog::new()
                .add_filter("Markdown", &["md", "markdown", "txt"])
                .pick_file()
            {
                let doc_mgr = app.state::<DocumentManager>();
                let label = webview.label().to_string();
                let load_res = doc_mgr.with_session(&label, |s| {
                    let text = s.load_from_path(&path)?;
                    Ok::<(String, String), String>((text, s.display_title()))
                });
                if let Ok((text, title)) = load_res {
                    doc_mgr.push_recent(path);
                    let _ = webview.set_title(&title);
                    let _ = webview.eval(&WebBridge::reset_editor(&text));
                }
            }
        }
        return;
    }

    if menu_id == "file.new" {
        if let Some(webview) = app.get_webview_window("main") {
            let doc_mgr = app.state::<DocumentManager>();
            let label = webview.label().to_string();
            let title = doc_mgr.with_session(&label, |s| {
                s.file_path = None;
                s.is_dirty = false;
                s.content_cache.clear();
                s.display_title()
            });
            let _ = webview.set_title(&title);
        }
    }

    if let Some(script) = menu_id_to_web_script(menu_id) {
        if let Some(webview) = app.get_webview_window("main") {
            let _ = webview.eval(&script);
        }
    }
}
