pub mod bridge;
pub mod diagrams;
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

    if message.module_name == "api"
        && (message.method_name == "addMainMenuItems" || message.method_name == "openDocument")
    {
        menu::refresh_app_menu(window.app_handle());
    }

    if let Some(script) = followup_js {
        let _ = window.eval(&script);
    }

    // `window.close()` in the editor is bridged to `core.notifyWindowClose` (index.ts). Close
    // the window for real; CloseRequested still prompts if the document has unsaved changes.
    // This is also what closes the window after "Yes" (save) in the close prompt.
    if message.module_name == "core" && message.method_name == "notifyWindowClose" {
        let _ = window.close();
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
    let user_settings = SettingsManager::new().load_user_settings();

    let target_path = if save_as || existing_path.is_none() {
        let ext = user_settings
            .new_filename_extension
            .trim()
            .trim_start_matches('.');
        let ext = if ext.is_empty() { "md" } else { ext };
        // Parent the dialog to the window so it is modal and the editor cannot change underneath it.
        rfd::FileDialog::new()
            .set_parent(&window)
            .add_filter(
                "Markdown & TextPack",
                &["md", "markdown", "mdown", "mkd", "txt", "textpack"],
            )
            .set_file_name(format!("Untitled.{ext}"))
            .save_file()
    } else {
        existing_path
    };

    let Some(path) = target_path else {
        return Ok(false);
    };

    let saved_editor_text = text.clone();
    let mut formatted_text = text;
    if user_settings.trim_trailing_whitespace {
        formatted_text = formatted_text
            .split('\n')
            .map(|line| line.trim_end_matches([' ', '\t', '\r']))
            .collect::<Vec<_>>()
            .join("\n");
    }
    if user_settings.insert_final_newline && !formatted_text.is_empty() && !formatted_text.ends_with('\n') {
        formatted_text.push('\n');
    }

    let new_title = doc_mgr.with_session(&label, |s| {
        s.save_as(&path, &formatted_text)?;
        Ok::<String, String>(s.display_title())
    })?;

    let _ = doc_mgr.versions().record_version(&path, &formatted_text);
    doc_mgr.push_recent(path);
    doc_mgr.clear_backup_snapshot(&label);
    menu::refresh_app_menu(window.app_handle());
    let _ = window.set_title(&new_title);
    persist_last_session(window.app_handle(), None);
    // Only mark the buffer clean if it still holds exactly what was saved; edits made while the
    // save was in progress must keep the document dirty so closing still prompts.
    let saved_json = serde_json::to_string(&saved_editor_text).unwrap_or_else(|_| "null".to_string());
    let _ = window.eval(&format!(
        "(function() {{ const saved = {saved_json}; const current = window.webModules?.core?.getEditorText?.(); if (current === undefined || current === saved) {{ {} }} }})();",
        WebBridge::mark_content_clean()
    ));
    Ok(true)
}

/// Renders a PlantUML / D2 diagram with the locally installed tool (see `diagrams`).
/// Errors start with `not-installed:` (try another renderer) or `failed:` (diagram error).
#[tauri::command]
async fn diagram_render_local(lang: String, source: String) -> Result<String, String> {
    let settings = SettingsManager::new().load_user_settings();
    tauri::async_runtime::spawn_blocking(move || {
        diagrams::render_local(&lang, &source, |tool| match tool {
            "plantuml" => settings.plantuml_command.clone(),
            "d2" => settings.d2_command.clone(),
            other => other.to_string(),
        })
        .map_err(|err| err.to_bridge_string())
    })
    .await
    .map_err(|err| format!("failed: {err}"))?
}

/// Reports which local diagram tools are installed (Settings → Check Local Tools).
#[tauri::command]
async fn diagram_tools_status() -> Result<Vec<diagrams::ToolStatus>, String> {
    let settings = SettingsManager::new().load_user_settings();
    tauri::async_runtime::spawn_blocking(move || {
        vec![
            diagrams::tool_status("plantuml", &settings.plantuml_command),
            diagrams::tool_status("d2", &settings.d2_command),
        ]
    })
    .await
    .map_err(|err| err.to_string())
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
        persist_last_session(window.app_handle(), None);
    }
    Ok(())
}

#[tauri::command]
async fn install_extension_from_url(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    url: String,
) -> Result<bool, String> {
    let mgr = doc_mgr.extensions();
    let _ = mgr.ensure_directories();

    let app_version = env!("CARGO_PKG_VERSION").to_string();
    crate::extensions::downloader::install_url(
        url.trim(),
        &mgr.config(),
        &mgr.scripts_dir(),
        &app_version,
    )?;

    let _ = window.eval(&menu::extensions_reload_script(mgr));
    Ok(true)
}

#[tauri::command]
async fn extensions_get_state(
    doc_mgr: State<'_, DocumentManager>,
    force_refresh: Option<bool>,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions().clone();
    let force = force_refresh.unwrap_or(false);
    let state = std::thread::spawn(move || {
        mgr.get_manager_state(force, env!("CARGO_PKG_VERSION"))
    })
    .join()
    .map_err(|_| "Failed to join extension state worker".to_string())?;
    Ok(state)
}

#[tauri::command]
async fn extensions_install(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    id: String,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions().clone();
    let state = std::thread::spawn(move || {
        mgr.install_catalog_entry(&id, env!("CARGO_PKG_VERSION"))
    })
    .join()
    .map_err(|_| "Failed to join extension install worker".to_string())??;

    let _ = window.eval(&menu::extensions_reload_script(doc_mgr.extensions()));
    Ok(state)
}

#[tauri::command]
async fn extensions_install_url(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    url: String,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions().clone();
    let state = std::thread::spawn(move || {
        mgr.install_from_url_state(&url, env!("CARGO_PKG_VERSION"))
    })
    .join()
    .map_err(|_| "Failed to join extension URL install worker".to_string())??;

    let _ = window.eval(&menu::extensions_reload_script(doc_mgr.extensions()));
    Ok(state)
}

#[tauri::command]
async fn extensions_uninstall(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    id: String,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions();
    let state = mgr.uninstall_extension(&id, env!("CARGO_PKG_VERSION"))?;
    let _ = window.eval(&menu::extensions_reload_script(mgr));
    Ok(state)
}

#[tauri::command]
async fn extensions_set_enabled(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    id: String,
    enabled: bool,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions();
    let state = mgr.set_extension_enabled(&id, enabled, env!("CARGO_PKG_VERSION"))?;
    let _ = window.eval(&menu::extensions_reload_script(mgr));
    Ok(state)
}

#[tauri::command]
async fn extensions_update(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    id: Option<String>,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions().clone();
    let state = std::thread::spawn(move || {
        mgr.update_extensions(id.as_deref(), env!("CARGO_PKG_VERSION"))
    })
    .join()
    .map_err(|_| "Failed to join extension update worker".to_string())??;

    let _ = window.eval(&menu::extensions_reload_script(doc_mgr.extensions()));
    Ok(state)
}

#[tauri::command]
async fn extensions_set_update_behavior(
    doc_mgr: State<'_, DocumentManager>,
    behavior: crate::extensions::UpdateBehavior,
) -> Result<crate::extensions::ExtensionsManagerState, String> {
    let mgr = doc_mgr.extensions();
    mgr.set_update_behavior(behavior, env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
async fn extensions_open_folder(
    doc_mgr: State<'_, DocumentManager>,
) -> Result<(), String> {
    let mgr = doc_mgr.extensions();
    let _ = mgr.ensure_directories();
    menu::open_in_shell(&mgr.scripts_dir().to_string_lossy());
    Ok(())
}

#[tauri::command]
async fn extensions_open_homepage(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
        menu::open_in_shell(trimmed);
    }
    Ok(())
}

#[tauri::command]
async fn settings_get_state() -> Result<Value, String> {
    Ok(SettingsManager::new().load_user_settings().to_frontend_value())
}

#[tauri::command]
async fn settings_update(
    app: AppHandle,
    patch: Value,
) -> Result<Value, String> {
    let mgr = SettingsManager::new();
    let updated = mgr.update_user_settings(&patch)?;
    let sync_js = mgr.build_live_sync_js(&updated);
    for (_, webview) in app.webview_windows() {
        let _ = webview.eval(&sync_js);
    }
    Ok(updated.to_frontend_value())
}

#[tauri::command]
async fn settings_reset(app: AppHandle) -> Result<Value, String> {
    let mgr = SettingsManager::new();
    let defaults = mgr.reset_user_settings()?;
    let sync_js = mgr.build_live_sync_js(&defaults);
    for (_, webview) in app.webview_windows() {
        let _ = webview.eval(&sync_js);
    }
    Ok(defaults.to_frontend_value())
}

#[tauri::command]
async fn settings_open_file() -> Result<(), String> {
    let mgr = SettingsManager::new();
    let path = mgr.settings_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if !path.exists() {
        let _ = mgr.save(&mgr.load_or_default());
    }
    menu::open_in_shell(&path.to_string_lossy());
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionsListResponse {
    path: Option<String>,
    versions: Vec<String>,
}

#[tauri::command]
async fn versions_list(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
) -> Result<VersionsListResponse, String> {
    let label = window.label().to_string();
    let current_path = doc_mgr.with_session(&label, |s| s.file_path.clone());
    let versions = current_path
        .as_deref()
        .map(|p| doc_mgr.versions().list_versions(p))
        .unwrap_or_default();
    Ok(VersionsListResponse {
        path: current_path.map(|p| p.to_string_lossy().into_owned()),
        versions,
    })
}

#[tauri::command]
async fn versions_get_content(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    version: String,
) -> Result<Option<String>, String> {
    let label = window.label().to_string();
    let current_path = doc_mgr.with_session(&label, |s| s.file_path.clone());
    Ok(current_path
        .as_deref()
        .and_then(|p| doc_mgr.versions().get_version_content(p, &version)))
}

#[tauri::command]
async fn versions_restore(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    version: String,
) -> Result<bool, String> {
    let label = window.label().to_string();
    let Some(path) = doc_mgr.with_session(&label, |s| s.file_path.clone()) else {
        return Ok(false);
    };
    let restored = doc_mgr.restore_version(&label, &path, &version)?;
    let new_title = doc_mgr.with_session(&label, |s| s.display_title());
    let _ = window.set_title(&new_title);
    let _ = window.eval(&WebBridge::reset_editor(&restored));
    Ok(true)
}

#[tauri::command]
async fn versions_delete_all(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
) -> Result<bool, String> {
    let label = window.label().to_string();
    let Some(path) = doc_mgr.with_session(&label, |s| s.file_path.clone()) else {
        return Ok(false);
    };
    doc_mgr.versions().delete_local_versions(&path)
}

pub fn build_bootstrap_script() -> String {
    let mgr = SettingsManager::new();
    let settings = mgr.load_or_default();
    let user_settings = mgr.load_user_settings();
    let config_json = serde_json::to_string(&settings).unwrap_or_else(|_| "{}".to_string());
    let user_settings_json =
        serde_json::to_string(&user_settings.to_frontend_value()).unwrap_or_else(|_| "{}".to_string());
    let appearance_json =
        serde_json::to_string(&user_settings.appearance).unwrap_or_else(|_| "\"system\"".to_string());
    let reduce_trans_str = if user_settings.reduce_transparency {
        "true"
    } else {
        "false"
    };

    format!(
        r#"
        // Settings JSON merged over whatever the page provided; host is required
        // by the editor entrypoint and defaults are merged there for any gaps.
        window.config = Object.assign({{}}, window.config, (function() {{ try {{ return {config_json}; }} catch (_) {{ return {{}}; }} }})());
        if (typeof window.config !== 'object' || window.config === null) {{ window.config = {{}}; }}
        if (!window.config.host) {{ window.config.host = 'mainApp'; }}
        window.MarkEdit = window.MarkEdit || {{
            editorConfig: window.config,
            userSettings: {user_settings_json}
        }};
        window.MarkEdit.userSettings = {user_settings_json};
        if (typeof document !== 'undefined' && document.documentElement) {{
            document.documentElement.dataset.appearance = {appearance_json};
            document.documentElement.dataset.reduceTransparency = "{reduce_trans_str}";
        }}
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

/// Saves which documents are open (`last-session.json`) for the `lastSession` startup behavior.
///
/// `closing` is a window that is going away. When it is the last window the snapshot is kept
/// as it was, so quitting the app by closing its final window still reopens that window.
pub fn persist_last_session<R: Runtime>(app: &AppHandle<R>, closing: Option<&str>) {
    let mut labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|label| Some(label.as_str()) != closing)
        .cloned()
        .collect();
    if labels.is_empty() {
        return;
    }

    labels.sort_by_key(|label| {
        if label == "main" {
            (0, 0)
        } else {
            (1, label.trim_start_matches("doc-").parse::<u32>().unwrap_or(u32::MAX))
        }
    });
    let _ = app.state::<DocumentManager>().write_last_session(&labels);
}

/// Reopens the documents of the previous session. The first one goes into the main window.
fn restore_last_session<R: Runtime>(app: &AppHandle<R>) {
    let doc_mgr = app.state::<DocumentManager>();
    let plan = doc_mgr.plan_session_restore();

    for (index, item) in plan.iter().enumerate() {
        if index == 0 {
            let title = doc_mgr.apply_restore_item("main", item);
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_title(&title);
            }
            continue;
        }

        match create_editor_window(app, None) {
            Ok(window) => {
                let title = doc_mgr.apply_restore_item(window.label(), item);
                let _ = window.set_title(&title);
            }
            Err(err) => eprintln!("[MarkEdit-Rust] Failed to reopen window: {err}"),
        }
    }
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

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(960.0, 680.0)
        .min_inner_size(420.0, 300.0)
        .initialization_script(&init_script)
        .build()?;
    persist_last_session(app, None);
    Ok(window)
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
            } else if SettingsManager::new().load_user_settings().startup_behavior == "lastSession" {
                // Reopen the previous windows, including unsaved changes kept as backups.
                restore_last_session(app_handle);
            }
            // Otherwise (`newDocument`, the default) the main window starts with an empty document.
            persist_last_session(app_handle, None);

            // Background extension update check (upstream ExtensionRegistry semantics).
            // Quiet (default): refresh + cache only. Notify: prompt once/day.
            // Automatic: install silently. Never: skip.
            let app_handle_ext = app_handle.clone();
            std::thread::spawn(move || {
                let base = dirs::config_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join("MarkEdit");
                let mgr = crate::extensions::ExtensionManager::new(base);
                let config = mgr.config();
                let behavior = config.read().update_behavior();
                if behavior == crate::extensions::UpdateBehavior::Never {
                    return;
                }

                let registry = crate::extensions::ExtensionRegistry::new(
                    mgr.registry_cache_dir(),
                    config.read().registry_url().to_string(),
                    env!("CARGO_PKG_VERSION").to_string(),
                );
                let _ = registry.refresh(false, false);
                let updates = registry.pending_updates(&config);
                if updates.is_empty() {
                    return;
                }

                match behavior {
                    crate::extensions::UpdateBehavior::Notify => {
                        if !registry.should_prompt_updates(behavior, updates.len()) {
                            return;
                        }
                        let thread_mgr = mgr.clone();
                        let thread_config = config.clone();
                        let thread_handle = app_handle_ext.clone();
                        let _ = app_handle_ext.run_on_main_thread(move || {
                            let prompt = format!(
                                "{} extension update(s) available. Install now?",
                                updates.len()
                            );
                            let result = MessageDialog::new()
                                .set_title("MarkEdit-Rust")
                                .set_description(&prompt)
                                .set_level(MessageLevel::Info)
                                .set_buttons(MessageButtons::OkCancel)
                                .show();

                            if result == MessageDialogResult::Ok {
                                // Downloads are network calls: run them off the UI thread.
                                let thread_mgr = thread_mgr.clone();
                                let thread_config = thread_config.clone();
                                let thread_handle = thread_handle.clone();
                                std::thread::spawn(move || {
                                for (record, entry) in &updates {
                                    if let Err(err) = crate::extensions::downloader::download_update(
                                        &thread_mgr.scripts_dir(),
                                        record,
                                        entry,
                                        &thread_config,
                                        env!("CARGO_PKG_VERSION"),
                                    ) {
                                        eprintln!(
                                            "[MarkEdit-Rust] Failed to install extension update '{}': {}",
                                            entry.id, err
                                        );
                                    }
                                }
                                if let Some(webview) = thread_handle.get_webview_window("main") {
                                    let _ =
                                        webview.eval(&menu::extensions_reload_script(&thread_mgr));
                                }
                                });
                            }

                            let update_registry = crate::extensions::ExtensionRegistry::new(
                                thread_mgr.registry_cache_dir(),
                                thread_config.read().registry_url().to_string(),
                                env!("CARGO_PKG_VERSION").to_string(),
                            );
                            update_registry.mark_prompted();
                        });
                    }
                    crate::extensions::UpdateBehavior::Automatic => {
                        // Already on a background thread: install without blocking the UI.
                        let thread_mgr = mgr.clone();
                        let thread_config = config.clone();
                        let thread_handle = app_handle_ext.clone();
                        (move || {
                            for (record, entry) in &updates {
                                if let Err(err) = crate::extensions::downloader::download_update(
                                    &thread_mgr.scripts_dir(),
                                    record,
                                    entry,
                                    &thread_config,
                                    env!("CARGO_PKG_VERSION"),
                                ) {
                                    eprintln!(
                                        "[MarkEdit-Rust] Failed to install extension update '{}': {}",
                                        entry.id, err
                                    );
                                }
                            }

                            if let Some(webview) = thread_handle.get_webview_window("main") {
                                let _ = webview.eval(&menu::extensions_reload_script(&thread_mgr));
                            }

                            let update_registry = crate::extensions::ExtensionRegistry::new(
                                thread_mgr.registry_cache_dir(),
                                thread_config.read().registry_url().to_string(),
                                env!("CARGO_PKG_VERSION").to_string(),
                            );
                            update_registry.mark_prompted();
                        })();
                    }
                    _ => {}
                }
            });

            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.eval(&init_script);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                persist_last_session(window.app_handle(), Some(window.label()));
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let doc_mgr = window.state::<DocumentManager>();
                let label = window.label().to_string();
                let is_dirty = doc_mgr.with_session(&label, |s| s.is_dirty);

                if is_dirty {
                    api.prevent_close();
                    let result = MessageDialog::new()
                        .set_title("MarkEdit-Rust")
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
            save_idle_backup,
            diagram_render_local,
            diagram_tools_status,
            install_extension_from_url,
            extensions_get_state,
            extensions_install,
            extensions_install_url,
            extensions_uninstall,
            extensions_set_enabled,
            extensions_update,
            extensions_set_update_behavior,
            extensions_open_folder,
            extensions_open_homepage,
            settings_get_state,
            settings_update,
            settings_reset,
            settings_open_file,
            versions_list,
            versions_get_content,
            versions_restore,
            versions_delete_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running MarkEdit-Win Tauri application");
}
