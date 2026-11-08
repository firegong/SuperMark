pub mod bridge;
pub mod document;
pub mod menu;
pub mod settings;

use bridge::{dispatch_bridge_message, BridgeMessage, WebBridge};
use document::DocumentManager;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::Value;
use settings::SettingsManager;
use tauri::{Manager, State, WebviewWindow, WindowEvent};

#[tauri::command]
async fn handle_bridge_message(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    message: BridgeMessage,
) -> Result<Value, String> {
    let label = window.label().to_string();
    let (response, followup_js) = dispatch_bridge_message(&label, &message, &doc_mgr)?;

    if message.module_name == "core" && message.method_name == "notifyViewDidUpdate" {
        let new_title = doc_mgr.with_session(&label, |s| s.display_title());
        let _ = window.set_title(&new_title);
    }

    if let Some(script) = followup_js {
        let _ = window.eval(&script);
    }

    Ok(response)
}

#[tauri::command]
async fn save_document_content(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    text: String,
    save_as: bool,
) -> Result<bool, String> {
    let label = window.label().to_string();
    let existing_path = doc_mgr.with_session(&label, |s| s.file_path.clone());

    let target_path = if save_as || existing_path.is_none() {
        rfd::FileDialog::new()
            .add_filter("Markdown", &["md", "markdown", "txt"])
            .set_file_name("Untitled.md")
            .save_file()
    } else {
        existing_path
    };

    let Some(path) = target_path else {
        return Ok(false);
    };

    let new_title = doc_mgr.with_session(&label, |s| {
        s.save_as(&path, &text)?;
        Ok::<String, String>(s.display_title())
    })?;

    doc_mgr.push_recent(path);
    doc_mgr.clear_backup_snapshot(&label);
    let _ = window.set_title(&new_title);
    let _ = window.eval(&WebBridge::mark_content_clean());
    Ok(true)
}

#[tauri::command]
async fn save_idle_backup(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    text: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let is_dirty = doc_mgr.with_session(&label, |s| {
        s.content_cache = text.clone();
        s.is_dirty
    });
    if is_dirty {
        doc_mgr.save_backup_snapshot(&label, &text)?;
    }
    Ok(())
}

pub fn build_bootstrap_script() -> String {
    let settings = SettingsManager::new().load_or_default();
    let config_json = serde_json::to_string(&settings).unwrap_or_else(|_| "{}".to_string());

    format!(
        r#"
        window.config = {config_json};
        window.MarkEdit = window.MarkEdit || {{
            editorConfig: window.config,
            userSettings: {{}}
        }};
        if (!window.webkit) {{
            window.webkit = {{
                messageHandlers: {{
                    bridge: {{
                        postMessage: function(message) {{
                            return window.__TAURI_INTERNALS__.invoke('handle_bridge_message', {{ message: message }});
                        }}
                    }}
                }}
            }};
        }}
        "#
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let init_script = build_bootstrap_script();

    tauri::Builder::default()
        .manage(DocumentManager::new())
        .setup(move |app| {
            let app_handle = app.handle();
            let app_menu = menu::build_app_menu(app_handle)?;
            app.set_menu(app_menu)?;

            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.eval(&init_script);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let doc_mgr = window.state::<DocumentManager>();
                let label = window.label().to_string();
                let is_dirty = doc_mgr.with_session(&label, |s| s.is_dirty);

                if is_dirty {
                    api.prevent_close();
                    let result = MessageDialog::new()
                        .set_title("MarkEdit")
                        .set_description("Do you want to save the changes made to this document?")
                        .set_level(MessageLevel::Warning)
                        .set_buttons(MessageButtons::YesNoCancel)
                        .show();

                    match result {
                        MessageDialogResult::Yes => {
                            if let Some(webview) = window.app_handle().get_webview_window(&label) {
                                let _ = webview.eval(
                                    "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false }).then((saved) => { if (saved) window.close(); });",
                                );
                            }
                        }
                        MessageDialogResult::No => {
                            doc_mgr.with_session(&label, |s| s.is_dirty = false);
                            doc_mgr.clear_backup_snapshot(&label);
                            let _ = window.close();
                        }
                        _ => {}
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            handle_bridge_message,
            save_document_content,
            save_idle_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkEdit-Win Tauri application");
}
