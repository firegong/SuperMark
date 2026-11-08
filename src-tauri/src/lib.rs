pub mod bridge;
pub mod document;
pub mod extensions;
pub mod menu;
pub mod settings;

use bridge::{dispatch_bridge_message, BridgeMessage, WebBridge};
use document::DocumentManager;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::Value;
use settings::SettingsManager;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

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
            .add_filter(
                "Markdown & TextPack",
                &["md", "markdown", "mdown", "mkd", "txt", "textpack"],
            )
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

    let _ = doc_mgr.versions().record_version(&path, &text);
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
        // Always route the bridge through Tauri IPC: on Windows WebView2 there is no
        // native window.webkit, and on macOS WKWebView Tauri does not register a
        // messageHandlers.bridge handler, so the polyfill must take over in both hosts.
        window.webkit = {{
            messageHandlers: {{
                bridge: {{
                    postMessage: function(message) {{
                        return window.__TAURI_INTERNALS__.invoke('handle_bridge_message', {{ message: message }});
                    }}
                }}
            }}
        }};
        "#
    )
}

/// Spawns a new document window with its own `DocumentSession` and bootstrap script.
pub fn create_editor_window<R: Runtime>(
    app: &AppHandle<R>,
    initial_path: Option<PathBuf>,
) -> tauri::Result<WebviewWindow<R>> {
    let doc_mgr = app.state::<DocumentManager>();
    let label = doc_mgr.next_window_label();
    let init_script = build_bootstrap_script();

    let title = doc_mgr.with_session(&label, |session| {
        if let Some(ref p) = initial_path {
            let _ = session.load_from_path(p);
        }
        session.display_title()
    });

    if let Some(p) = initial_path {
        doc_mgr.push_recent(p);
    }

    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(960.0, 680.0)
        .min_inner_size(420.0, 300.0)
        .initialization_script(&init_script)
        .build()
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

            let doc_mgr = app.state::<DocumentManager>();
            let _ = doc_mgr.extensions().ensure_directories();

            // Check CLI arguments for initial file paths (e.g. double-click in Windows Explorer)
            let cli_paths: Vec<PathBuf> = std::env::args()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .map(PathBuf::from)
                .filter(|p| p.exists())
                .collect();

            if let Some(first_path) = cli_paths.first() {
                let title = doc_mgr.with_session("main", |s| {
                    let _ = s.load_from_path(first_path);
                    s.display_title()
                });
                doc_mgr.push_recent(first_path.clone());
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_title(&title);
                }
                for extra_path in cli_paths.iter().skip(1) {
                    let _ = create_editor_window(app_handle, Some(extra_path.clone()));
                }
            } else if let Some((meta, text)) = doc_mgr.load_backup_snapshot("main") {
                // Hot-Exit backup restoration when launched without explicit file args
                let title = doc_mgr.with_session("main", |s| {
                    s.file_path = meta.original_path;
                    s.content_cache = text;
                    s.is_dirty = true;
                    s.display_title()
                });
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_title(&title);
                }
            }

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
