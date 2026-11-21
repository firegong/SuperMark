pub mod bridge;
pub mod diagnostics;
pub mod diagrams;
pub mod document;
pub mod extensions;
pub mod licenses;
pub mod menu;
pub mod links;
pub mod settings;
pub mod updates;

use bridge::{dispatch_bridge_message, BridgeMessage, WebBridge};
use document::DocumentManager;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::{json, Value};
use settings::SettingsManager;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

/// Opens a clicked link safely (see links.rs): web and mail links in the system, documents in the
/// app (or the window that already has them), other files only revealed, unsafe links ignored.
/// Async: dialogs are shown with rfd's async API, which is safe off the main thread on macOS.
async fn follow_link<R: Runtime>(window: &WebviewWindow<R>, href: &str) {
    let app = window.app_handle();
    let doc_mgr = app.state::<DocumentManager>();
    let base_dir = doc_mgr.with_session(window.label(), |s| {
        s.file_path.as_ref().and_then(|path| path.parent().map(PathBuf::from))
    });
    match links::resolve_link(href, base_dir.as_deref()) {
        links::LinkTarget::External(url) => menu::open_in_shell(&url),
        links::LinkTarget::Document(path) => menu::open_document_path(app, path),
        links::LinkTarget::Reveal(path) => links::reveal_in_file_manager(&path),
        links::LinkTarget::NotFound(path) => {
            let message = if base_dir.is_none() && path.is_relative() {
                format!("Save this document first to follow relative links:\n{}", path.display())
            } else {
                format!("The linked file was not found:\n{}", path.display())
            };
            rfd::AsyncMessageDialog::new()
                .set_title("SuperMark")
                .set_description(message)
                .set_level(MessageLevel::Warning)
                .set_buttons(MessageButtons::Ok)
                .show()
                .await;
        }
        links::LinkTarget::Ignored => {}
    }
}

/// Standard buttons for `count` requested buttons (custom labels need a Windows feature rfd does
/// not enable here): 1 → OK, 2 → OK/Cancel, 3+ → Yes/No/Cancel. The result is the index of the
/// clicked button in the requested order.
fn alert_buttons(count: usize) -> MessageButtons {
    match count {
        0 | 1 => MessageButtons::Ok,
        2 => MessageButtons::OkCancel,
        _ => MessageButtons::YesNoCancel,
    }
}

fn alert_result_index(result: &MessageDialogResult) -> i64 {
    match result {
        MessageDialogResult::Ok | MessageDialogResult::Yes => 0,
        MessageDialogResult::No => 1,
        MessageDialogResult::Cancel => 1,
        MessageDialogResult::Custom(_) => 0,
    }
}

async fn show_alert(params: &Value) -> i64 {
    let text = |key: &str| params.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    let buttons = params.get("buttons").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    let title = text("title");
    let result = rfd::AsyncMessageDialog::new()
        .set_title(if title.is_empty() { "SuperMark" } else { title.as_str() })
        .set_description(text("message"))
        .set_level(MessageLevel::Info)
        .set_buttons(alert_buttons(buttons))
        .show()
        .await;
    // Yes/No/Cancel: Cancel is the third button.
    if buttons >= 3 && result == MessageDialogResult::Cancel {
        return 2;
    }
    alert_result_index(&result)
}

/// A link clicked in the preview.
#[tauri::command]
async fn open_link(window: WebviewWindow, href: String) -> Result<(), String> {
    follow_link(&window, &href).await;
    Ok(())
}

#[tauri::command]
async fn handle_bridge_message(
    window: WebviewWindow,
    doc_mgr: State<'_, DocumentManager>,
    message: BridgeMessage,
) -> Result<Value, String> {
    let label = window.label().to_string();

    // MarkEdit.openDocument (extensions): like File > Open — a new window, or the one that
    // already shows the file — never replacing this window's (possibly unsaved) document.
    if message.module_name == "api" && message.method_name == "openDocument" {
        let path = serde_json::from_str::<Value>(&message.parameters)
            .ok()
            .and_then(|params| params.get("path").and_then(Value::as_str).map(PathBuf::from));
        let Some(path) = path.filter(|path| path.exists()) else {
            return Ok(json!(false));
        };
        menu::open_document_path(window.app_handle(), path);
        menu::refresh_app_menu(window.app_handle());
        return Ok(json!(true));
    }

    // MarkEdit.showAlert (extensions): a real dialog; returns the index of the clicked button.
    if message.module_name == "api" && message.method_name == "showAlert" {
        let params = serde_json::from_str::<Value>(&message.parameters).unwrap_or(Value::Null);
        return Ok(json!(show_alert(&params).await));
    }

    let (response, followup_js) = dispatch_bridge_message(&label, &message, &doc_mgr)?;

    // Ctrl+click on a link in the editor.
    if message.module_name == "core" && message.method_name == "notifyLinkClicked" {
        let link = serde_json::from_str::<Value>(&message.parameters)
            .ok()
            .and_then(|params| params.get("link").and_then(Value::as_str).map(str::to_string));
        if let Some(link) = link {
            follow_link(&window, &link).await;
        }
    }

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

/// The editor reports its view mode, Markdown parser and preview scroll sync so the View
/// menu can show them as checkmarks. Only the focused window's state is shown.
#[tauri::command]
async fn view_state_changed(
    window: WebviewWindow,
    mode: String,
    renderer: String,
    sync_scroll: bool,
    live_preview: Option<bool>,
) -> Result<(), String> {
    let others_focused = window
        .app_handle()
        .webview_windows()
        .values()
        .any(|other| other.label() != window.label() && other.is_focused().unwrap_or(false));
    if !others_focused {
        menu::apply_view_state(
            window.app_handle(),
            menu::ViewState {
                mode,
                renderer,
                sync_scroll,
                live_preview: live_preview.unwrap_or(false),
            },
        );
    }
    Ok(())
}

/// Renders a PlantUML / D2 / Graphviz diagram with the locally installed tool (see `diagrams`).
/// Errors start with `not-installed:` (try another renderer) or `failed:` (diagram error).
#[tauri::command]
async fn diagram_render_local(lang: String, source: String) -> Result<String, String> {
    let settings = SettingsManager::new().load_user_settings();
    tauri::async_runtime::spawn_blocking(move || {
        diagrams::render_local(&lang, &source, |tool| match tool {
            "plantuml" => settings.plantuml_command.clone(),
            "d2" => settings.d2_command.clone(),
            // Graphviz is the `dot` command on PATH.
            "graphviz" => "dot".to_string(),
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
            diagrams::tool_status("graphviz", "dot"),
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

    reload_extensions_everywhere(&window, mgr);
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

    reload_extensions_everywhere(&window, doc_mgr.extensions());
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

    reload_extensions_everywhere(&window, doc_mgr.extensions());
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
    reload_extensions_everywhere(&window, mgr);
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
    reload_extensions_everywhere(&window, mgr);
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

    reload_extensions_everywhere(&window, doc_mgr.extensions());
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
    let runtime_info_json = json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "appBuild": env!("CARGO_PKG_VERSION"),
        "osVersion": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "webkitVersion": "",
    })
    .to_string();
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
        // MarkEdit.runtimeInfo(); webkitVersion is read from the WebView (api/methods.ts).
        window.config.runtimeInfo = {runtime_info_json};
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

/// Re-applies extensions in every window and rebuilds the menu: extensions (and built-in
/// extensions) decide which Markdown parsers View → Markdown Parser offers.
fn reload_extensions_everywhere(window: &WebviewWindow, mgr: &extensions::ExtensionManager) {
    for webview in window.app_handle().webview_windows().values() {
        let _ = webview.eval(&menu::extensions_reload_script(mgr));
    }
    menu::refresh_app_menu(window.app_handle());
}

/// Logs a document that could not be read and tells the user (instead of an empty window).
pub fn report_open_failure(path: &std::path::Path, error: &str) {
    diagnostics::log(&format!("failed to open {}: {error}", path.display()));
    let _ = MessageDialog::new()
        .set_title("SuperMark")
        .set_description(format!("The document could not be opened:\n{}\n\n{error}", path.display()))
        .set_level(MessageLevel::Error)
        .set_buttons(MessageButtons::Ok)
        .show();
}

/// The window's current document text, pulled by the editor after File > Open and similar
/// (`window.__markeditReloadDocument__`), so large files are not pushed through `eval`.
#[tauri::command]
async fn document_content(window: WebviewWindow, doc_mgr: State<'_, DocumentManager>) -> Result<Value, String> {
    let label = window.label().to_string();
    let text = doc_mgr.with_session(&label, |s| s.content_cache.clone());
    Ok(serde_json::json!({ "text": text }))
}

/// Installed extensions as data, for reloading them (`window.__markeditReloadExtensions__`).
#[tauri::command]
async fn extensions_bootstrap(
    doc_mgr: State<'_, DocumentManager>,
) -> Result<extensions::ExtensionBootstrap, String> {
    Ok(doc_mgr.extensions().extension_bootstrap())
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

/// Offers to restore unsaved changes left by a crash (with the default `newDocument` startup,
/// which does not reopen the last session). `main_is_free`: the main window has no document yet,
/// so the first recovered document can go there. Declining keeps the text in an archive folder.
fn recover_unsaved_work<R: Runtime>(app: &AppHandle<R>, main_is_free: bool) {
    let doc_mgr = app.state::<DocumentManager>();
    let plan = doc_mgr.plan_unsaved_recovery();
    if plan.is_empty() {
        return;
    }

    let names: Vec<String> = plan
        .iter()
        .map(|item| {
            item.path
                .as_ref()
                .and_then(|path| path.file_name())
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Untitled".to_string())
        })
        .collect();
    let answer = MessageDialog::new()
        .set_title("SuperMark")
        .set_description(format!(
            "SuperMark did not close normally. Restore unsaved changes in {} document(s)?\n\n{}",
            plan.len(),
            names.join("\n")
        ))
        .set_level(MessageLevel::Warning)
        .set_buttons(MessageButtons::YesNo)
        .show();

    if answer != MessageDialogResult::Yes {
        let labels: Vec<String> = plan.iter().map(|item| item.previous_label.clone()).collect();
        match doc_mgr.archive_backups(&labels) {
            Ok(folder) => diagnostics::log(&format!("kept declined backups in {}", folder.display())),
            Err(error) => diagnostics::log(&format!("could not archive backups: {error}")),
        }
        return;
    }

    for (index, item) in plan.iter().enumerate() {
        if index == 0 && main_is_free {
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
            Err(err) => eprintln!("[SuperMark] Failed to restore a document: {err}"),
        }
    }
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
            Err(err) => eprintln!("[SuperMark] Failed to reopen window: {err}"),
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

    let (title, load_error) = doc_mgr.with_session(&label, |session| {
        let error = initial_path
            .as_ref()
            .and_then(|p| session.load_from_path(p).err().map(|e| (p.clone(), e)));
        (session.display_title(), error)
    });
    if let Some((path, error)) = load_error {
        report_open_failure(&path, &error);
    }

    if let Some(p) = initial_path {
        doc_mgr.push_recent(p);
    }

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(960.0, 680.0)
        .min_inner_size(420.0, 300.0)
        .initialization_script(&init_script)
        .build()?;
    fit_window_to_screen(&window, false);
    persist_last_session(app, None);
    Ok(window)
}

/// Initial window size for a screen: a share of its work area (taskbar excluded), within bounds
/// that keep the editor comfortable. Logical pixels, so it is the same on any DPI scale.
fn window_size_for_work_area(work_width: f64, work_height: f64) -> (f64, f64) {
    let width = (work_width * 0.6).clamp(800.0, 1400.0).min(work_width);
    let height = (work_height * 0.8).clamp(600.0, 1000.0).min(work_height);
    (width.round(), height.round())
}

/// Windows: size new windows to the monitor instead of a fixed 960×680 (too small on large
/// screens, too big on small ones at 150% scale); the first window is centered, later ones keep
/// the position Windows gives them (cascading). macOS keeps the configured size.
fn fit_window_to_screen<R: Runtime>(window: &WebviewWindow<R>, center: bool) {
    if !cfg!(target_os = "windows") {
        return;
    }
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area().size.to_logical::<f64>(scale);
    let (width, height) = window_size_for_work_area(area.width, area.height);
    let _ = window.set_size(tauri::LogicalSize::new(width, height));
    if center {
        let _ = window.center();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let init_script = build_bootstrap_script();

    tauri::Builder::default()
        // Must be the first plugin. Launching the app again (e.g. double-clicking a document in
        // Explorer while it runs) hands the files to this process instead of starting a second
        // one that would share the backup and session files.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            // Relative paths are relative to the second launch's working directory.
            let paths: Vec<PathBuf> = args
                .iter()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .map(|arg| {
                    let path = PathBuf::from(arg);
                    if path.is_relative() { PathBuf::from(&cwd).join(path) } else { path }
                })
                .filter(|path| path.exists())
                .collect();
            if paths.is_empty() {
                // Just bring the app forward.
                let window = app
                    .webview_windows()
                    .into_values()
                    .find(|window| window.is_focused().unwrap_or(false))
                    .or_else(|| app.webview_windows().into_values().next());
                if let Some(window) = window {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            for path in paths {
                menu::open_document_path(app, path);
            }
        }))
        // In-app updates from the public releases repository (updates.rs).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DocumentManager::new())
        .setup(move |app| {
            let app_handle = app.handle();
            let app_menu = menu::build_app_menu(app_handle)?;
            app.set_menu(app_menu)?;

            // The main window is created here (tauri.conf.json has `"create": false`) so the
            // bridge bootstrap runs as an initialization script before the page's own scripts,
            // exactly like document windows. Injecting it later with `eval` raced the page load:
            // the polyfill was lost or `notifyWindowDidLoad` was missed, so opened files never
            // reached the editor.
            let main_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no \"main\" window")?;
            let main_window = WebviewWindowBuilder::from_config(app_handle, &main_config)?
                .initialization_script(&init_script)
                .build()?;
            fit_window_to_screen(&main_window, true);

            let doc_mgr = app.state::<DocumentManager>();
            let _ = doc_mgr.extensions().ensure_directories();

            // Check CLI arguments for initial file paths (e.g. double-click in Windows Explorer)
            let cli_paths: Vec<PathBuf> = std::env::args()
                .skip(1)
                .filter(|arg| !arg.starts_with('-'))
                .map(PathBuf::from)
                .filter(|p| p.exists())
                .collect();

            diagnostics::log(&format!(
                "startup: args {:?}, files to open {:?}",
                std::env::args().skip(1).collect::<Vec<_>>(),
                cli_paths
            ));

            if let Some(first_path) = cli_paths.first() {
                let (title, load_error) = doc_mgr.with_session("main", |s| {
                    let error = s.load_from_path(first_path).err();
                    (s.display_title(), error)
                });
                match load_error {
                    Some(error) => report_open_failure(first_path, &error),
                    None => diagnostics::log(&format!("opened {}", first_path.display())),
                }
                doc_mgr.push_recent(first_path.clone());
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_title(&title);
                }
                for extra_path in cli_paths.iter().skip(1) {
                    let _ = create_editor_window(app_handle, Some(extra_path.clone()));
                }
                // Unsaved work from a crash goes into windows of its own.
                recover_unsaved_work(app_handle, false);
            } else if SettingsManager::new().load_user_settings().startup_behavior == "lastSession" {
                // Reopen the previous windows, including unsaved changes kept as backups.
                restore_last_session(app_handle);
            } else {
                // `newDocument` (the default): an empty document, unless a crash left unsaved work.
                recover_unsaved_work(app_handle, true);
            }
            persist_last_session(app_handle, None);

            // Look for a new release a little after startup (release builds; Settings → General).
            if !cfg!(debug_assertions) && SettingsManager::new().load_user_settings().check_for_updates {
                let app_for_updates = app_handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    updates::check_for_updates(app_for_updates, false);
                });
            }

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
                                .set_title("SuperMark")
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
                                            "[SuperMark] Failed to install extension update '{}': {}",
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
                                        "[SuperMark] Failed to install extension update '{}': {}",
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
                        .set_title("SuperMark")
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
            view_state_changed,
            document_content,
            extensions_bootstrap,
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
            versions_delete_all,
            open_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running SuperMark");
}

#[cfg(test)]
mod tests {

    #[test]
    fn window_size_follows_the_screen_work_area() {
        use super::window_size_for_work_area;
        // 1920x1080 at 100% (taskbar excluded): 60% x 80%.
        assert_eq!(window_size_for_work_area(1920.0, 1032.0), (1152.0, 826.0));
        // 1920x1080 at 150% is 1280x720 logical: within the minimums.
        assert_eq!(window_size_for_work_area(1280.0, 688.0), (800.0, 600.0));
        // 4K at 100%: capped.
        assert_eq!(window_size_for_work_area(3840.0, 2112.0), (1400.0, 1000.0));
        // A screen smaller than the minimum: never larger than the screen.
        assert_eq!(window_size_for_work_area(700.0, 500.0), (700.0, 500.0));
    }

    /// The main window must be created in `setup` (with the bridge bootstrap as an
    /// initialization script), not automatically from tauri.conf.json: injecting the bootstrap
    /// later with `eval` raced the page load and opened files never reached the editor.
    #[test]
    fn main_window_is_created_by_setup_with_the_bootstrap() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let main = conf["app"]["windows"]
            .as_array()
            .and_then(|windows| windows.iter().find(|w| w["label"] == "main"))
            .expect("main window config");
        assert_eq!(main["create"], serde_json::json!(false));

        let source = include_str!("lib.rs");
        assert!(source.contains(".initialization_script(&init_script)"));
        assert!(!source.contains(concat!("main_win.eval(", "&init_script)")));
    }

    #[test]
    fn index_html_merges_host_config_instead_of_overwriting_it() {
        let html = include_str!("../../packages/core-editor/index.html");
        assert!(html.contains("Object.assign({}, typeof hostConfig === 'object' ? hostConfig : {}, injected)"));
        assert!(!html.contains(concat!("window.config = ", "\"{{EDITOR_CONFIG}}\";")));
    }
}
