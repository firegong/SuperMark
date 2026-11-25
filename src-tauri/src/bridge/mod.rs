pub mod generated;
pub mod secret_storage;

use crate::document::DocumentManager;
use crate::document::versions::VersionManager;
use generated::{AlertConfiguration, FileInfo, LineColumnInfo, MenuItem};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use unicode_segmentation::UnicodeSegmentation;

/// Message format sent by `CoreEditor/src/bridge/nativeModule.ts`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMessage {
    pub module_name: String,
    pub method_name: String,
    pub parameters: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewDidUpdateParams {
    pub content_edited: bool,
    pub composition_ended: bool,
    pub is_dirty: bool,
    pub selected_line_column: LineColumnInfo,
}

/// Generates JavaScript expressions to invoke `window.webModules.<module>.<method>(...)`
/// and `window.chromeUI.<method>(...)`.
pub struct WebBridge;

impl WebBridge {
    pub fn format_call(module: &str, method: &str, args: Option<Value>) -> String {
        match args {
            Some(val) => {
                let serialized = serde_json::to_string(&val).unwrap_or_else(|_| "{}".to_string());
                format!("window.webModules?.{module}?.{method}?.({serialized});")
            }
            None => format!("window.webModules?.{module}?.{method}?.();"),
        }
    }

    pub fn format_chrome_call(method: &str, args: Option<Value>) -> String {
        match args {
            Some(val) => {
                let serialized =
                    serde_json::to_string(&val).unwrap_or_else(|_| "false".to_string());
                format!("window.chromeUI?.{method}?.({serialized});")
            }
            None => format!("window.chromeUI?.{method}?.();"),
        }
    }

    pub fn reset_editor(text: &str) -> String {
        Self::format_call(
            "core",
            "resetEditor",
            Some(json!({
                "text": text,
                "revision": Value::Null,
            })),
        )
    }

    /// Makes the editor fetch its document again (`document_content`) and reset to it.
    pub fn reload_document() -> String {
        "window.__markeditReloadDocument__?.();".to_string()
    }

    pub fn set_document_path(path: Option<&std::path::Path>) -> String {
        let serialized = match path {
            Some(p) => serde_json::to_string(&p.to_string_lossy().into_owned()).unwrap_or_else(|_| "null".to_string()),
            None => "null".to_string(),
        };
        format!("window.__markeditSetDocumentPath?.({serialized});")
    }

    pub fn notify_app_ready() -> String {
        Self::format_call("api", "notifyAppReady", None)
    }

    pub fn mark_content_clean() -> String {
        Self::format_call("history", "markContentClean", None)
    }
}

/// Core pure dispatcher logic (testable without an active WebView instance).
pub fn dispatch_bridge_message(
    window_label: &str,
    msg: &BridgeMessage,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    let params: Value = if msg.parameters.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&msg.parameters).unwrap_or_else(|_| json!({}))
    };

    match msg.module_name.as_str() {
        "core" => handle_core_module(window_label, &msg.method_name, &params, doc_mgr),
        "api" => handle_api_module(window_label, &msg.method_name, &params, doc_mgr),
        "tokenizer" => handle_tokenizer_module(&msg.method_name, &params),
        "completion" => Ok((Value::Null, None)),
        "secretStorage" => handle_secret_storage_module(&msg.method_name, &params, doc_mgr),
        // The editor parses this as JSON text (api/translation.ts); there is no system translator.
        "translation" => Ok((
            json!(json!({ "error": "Translation is not available on this platform." }).to_string()),
            None,
        )),
        "foundationModels" => handle_foundation_models_module(&msg.method_name),
        other => Err(format!("Unknown native module: {other}")),
    }
}

fn handle_core_module(
    window_label: &str,
    method: &str,
    params: &Value,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    match method {
        "notifyWindowDidLoad" => {
            // macOS double-click: if the OS handed over a document before this
            // window loaded, open it into this session now so its content is
            // returned to the frontend instead of an empty document.
            if let Some(path) = doc_mgr.take_one_pending_open() {
                let _ = doc_mgr.with_session(window_label, |s| {
                    let _ = s.load_from_path(&path);
                    Ok::<(), String>(())
                });
            }
            let (initial_text, pending_restore, path) = doc_mgr.with_session(window_label, |s| {
                (s.content_cache.clone(), s.pending_restore_text.take(), s.file_path.clone())
            });
            let extensions = doc_mgr.extensions().extension_bootstrap();
            crate::diagnostics::log(&format!(
                "window {window_label} loaded: document {:?} ({} chars), {} extension script(s), {} style(s)",
                path,
                initial_text.chars().count(),
                extensions.scripts.len(),
                extensions.styles.len()
            ));

            // The editor loads the document from this reply (src/hostDocument.ts). Nothing is
            // injected with eval, so the size of installed extensions cannot get in the way.
            Ok((
                json!({
                    "text": initial_text,
                    "restoreText": pending_restore,
                    "extensions": extensions,
                    "filePath": path.map(|p| p.to_string_lossy().into_owned()),
                }),
                None,
            ))
        }
        "notifyViewDidUpdate" => {
            if let Ok(update) = serde_json::from_value::<ViewDidUpdateParams>(params.clone()) {
                doc_mgr.with_session(window_label, |session| {
                    session.is_dirty = update.is_dirty;
                });
            }
            Ok((Value::Null, None))
        }
        "notifyEditorDidBecomeIdle" => {
            let (is_dirty, has_path) = doc_mgr.with_session(window_label, |s| (s.is_dirty, s.file_path.is_some()));
            let autosave = crate::settings::SettingsManager::new().load_user_settings().autosave;
            if is_dirty && has_path && autosave {
                // Auto-save to disk when the document already has a file path.
                let script = "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });".to_string();
                Ok((Value::Null, Some(script)))
            } else if is_dirty {
                let script = "window.__TAURI_INTERNALS__?.invoke('save_idle_backup', { text: window.webModules?.core?.getEditorText?.() ?? '' });".to_string();
                Ok((Value::Null, Some(script)))
            } else {
                Ok((Value::Null, None))
            }
        }
        "notifyBackgroundColorDidChange"
        | "notifyViewportScaleDidChange"
        | "notifyContentHeightDidChange"
        | "notifyContentOffsetDidChange"
        | "notifyCompositionEnded"
        | "notifyLinkClicked"
        | "notifyLightWarning"
        | "notifyWindowResize"
        | "notifyWindowMove"
        | "notifyWindowClose" => Ok((Value::Null, None)),
        other => Err(format!("Unknown core method: {other}")),
    }
}

/// A version ID from the editor API (`id`), or `version` as older callers send it.
fn version_id_param(params: &Value) -> Option<&str> {
    params
        .get("id")
        .or_else(|| params.get("version"))
        .and_then(Value::as_str)
}

fn handle_api_module(
    window_label: &str,
    method: &str,
    params: &Value,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    match method {
        "openDocument" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                return Ok((json!(false), None));
            };
            let path = PathBuf::from(path_str);
            let loaded = doc_mgr.with_session(window_label, |s| s.load_from_path(&path));
            match loaded {
                Ok(text) => {
                    doc_mgr.push_recent(path);
                    Ok((json!(true), Some(WebBridge::reset_editor(&text))))
                }
                Err(_) => Ok((json!(false), None)),
            }
        }
        "saveDocument" => {
            let script = "window.__TAURI_INTERNALS__?.invoke('save_document_content', { text: window.webModules?.core?.getEditorText?.() ?? '', saveAs: false });".to_string();
            Ok((json!(true), Some(script)))
        }
        "closeDocument" => {
            let script = "window.close();".to_string();
            Ok((json!(true), Some(script)))
        }
        "recentDocumentPaths" => Ok((json!(doc_mgr.recent_paths_strings()), None)),
        "getFileVersions" => {
            let target = params
                .get("path")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .or_else(|| doc_mgr.with_session(window_label, |s| s.file_path.clone()));
            let versions = target
                .as_deref()
                .map(|p| doc_mgr.versions().list_versions(p))
                .unwrap_or_default();
            // The editor expects JSON text of [{ id, modificationDate (seconds), isLocal }].
            let entries: Vec<Value> = versions
                .iter()
                .map(|id| {
                    json!({
                        "id": id,
                        "modificationDate": VersionManager::version_timestamp(id).unwrap_or(0.0),
                        "isLocal": true,
                    })
                })
                .collect();
            Ok((json!(Value::Array(entries).to_string()), None))
        }
        "getFileVersionContent" => {
            let Some(version) = version_id_param(params) else {
                return Ok((Value::Null, None));
            };
            let target = params
                .get("path")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .or_else(|| doc_mgr.with_session(window_label, |s| s.file_path.clone()));
            let content = target
                .as_deref()
                .and_then(|p| doc_mgr.versions().get_version_content(p, version));
            Ok((json!(content), None))
        }
        "restoreFileVersion" => {
            let Some(version) = version_id_param(params) else {
                return Ok((json!(false), None));
            };
            let target = params
                .get("path")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .or_else(|| doc_mgr.with_session(window_label, |s| s.file_path.clone()));
            let Some(path) = target else {
                return Ok((json!(false), None));
            };
            let is_current = doc_mgr.with_session(window_label, |s| s.file_path.as_deref() == Some(path.as_path()));
            match doc_mgr.restore_version(window_label, &path, version) {
                // Only reload the editor when the restored file is the one it shows.
                Ok(restored) if is_current => Ok((json!(true), Some(WebBridge::reset_editor(&restored)))),
                Ok(_) => Ok((json!(true), None)),
                Err(_) => Ok((json!(false), None)),
            }
        }
        "deleteLocalFileVersions" => {
            let target = params
                .get("path")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .or_else(|| doc_mgr.with_session(window_label, |s| s.file_path.clone()));
            // Only the versions asked for; without IDs nothing is deleted (it used to delete all).
            let ids: Vec<String> = params
                .get("ids")
                .and_then(Value::as_array)
                .map(|ids| ids.iter().filter_map(|id| id.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            let ok = !ids.is_empty()
                && target
                    .as_deref()
                    .and_then(|p| doc_mgr.versions().delete_versions(p, &ids).ok())
                    .is_some_and(|removed| removed > 0);
            Ok((json!(ok), None))
        }
        "getPasteboardString" => {
            let text = arboard::Clipboard::new()
                .ok()
                .and_then(|mut cb| cb.get_text().ok());
            Ok((json!(text), None))
        }
        "getPasteboardItems" => {
            let items = arboard::Clipboard::new()
                .ok()
                .and_then(|mut cb| cb.get_text().ok())
                .map(|t| {
                    serde_json::to_string(&vec![json!({
                        "types": ["public.utf8-plain-text"],
                        "string": t
                    })])
                    .unwrap_or_else(|_| "[]".to_string())
                });
            Ok((json!(items), None))
        }
        "createFile" => {
            let Some(options) = params.get("options") else {
                return Ok((json!(false), None));
            };
            let Some(path_str) = options.get("path").and_then(|v| v.as_str()) else {
                return Ok((json!(false), None));
            };
            let is_dir = options
                .get("isDirectory")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let overwrite = options
                .get("overwrite")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let path = Path::new(path_str);
            if path.exists() && !overwrite {
                return Ok((json!(false), None));
            }
            let ok = if is_dir {
                fs::create_dir_all(path).is_ok()
            } else {
                let content = options
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if let Some(parent) = path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(path, content.as_bytes()).is_ok()
            };
            Ok((json!(ok), None))
        }
        "deleteFile" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                return Ok((json!(false), None));
            };
            let path = Path::new(path_str);
            let ok = if path.is_dir() {
                fs::remove_dir_all(path).is_ok()
            } else {
                fs::remove_file(path).is_ok()
            };
            Ok((json!(ok), None))
        }
        "moveFile" => {
            let Some(options) = params.get("options") else {
                return Ok((json!(false), None));
            };
            let Some(from_str) = options.get("from").and_then(|v| v.as_str()) else {
                return Ok((json!(false), None));
            };
            let Some(to_str) = options.get("to").and_then(|v| v.as_str()) else {
                return Ok((json!(false), None));
            };
            let overwrite = options
                .get("overwrite")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let to_path = Path::new(to_str);
            if to_path.exists() && !overwrite {
                return Ok((json!(false), None));
            }
            if let Some(parent) = to_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let ok = fs::rename(from_str, to_path).is_ok();
            Ok((json!(ok), None))
        }
        "listFiles" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                return Ok((Value::Null, None));
            };
            let Ok(entries) = fs::read_dir(path_str) else {
                return Ok((Value::Null, None));
            };
            let files: Vec<String> = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path().to_string_lossy().into_owned())
                .collect();
            Ok((json!(files), None))
        }
        // For the file APIs a missing path means the window's current document (markedit-api).
        "getFileContent" => {
            let Some(path) = api_path_or_current(params, window_label, doc_mgr) else {
                return Ok((Value::Null, None));
            };
            Ok((json!(fs::read_to_string(path).ok()), None))
        }
        "getFileObject" => {
            // The editor expects a JSON string of `FileObject { data (base64), mimeType, … }`.
            let Some(path) = api_path_or_current(params, window_label, doc_mgr) else {
                return Ok((Value::Null, None));
            };
            let Ok(bytes) = fs::read(&path) else {
                return Ok((Value::Null, None));
            };
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase());
            let object = json!({
                "data": base64_encode(&bytes),
                "mimeType": mime_type_for(extension.as_deref().unwrap_or("")),
                "filenameExtension": extension,
            });
            Ok((json!(object.to_string()), None))
        }
        "getFileInfo" => {
            let Some(path) = api_path_or_current(params, window_label, doc_mgr) else {
                return Ok((Value::Null, None));
            };
            let path = path.as_path();
            let Ok(meta) = fs::metadata(path) else {
                return Ok((Value::Null, None));
            };
            let created = meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let info = FileInfo {
                file_path: path.to_string_lossy().into_owned(),
                file_size: meta.len(),
                creation_date: created,
                modification_date: modified,
                parent_path: path.parent().map(|p| p.to_string_lossy().into_owned()),
                is_directory: meta.is_dir(),
            };
            let serialized = serde_json::to_string(&info).ok();
            Ok((json!(serialized), None))
        }
        "addMainMenuItems" => {
            if let Some(items_val) = params.get("items") {
                if let Ok(items) = serde_json::from_value::<Vec<MenuItem>>(items_val.clone()) {
                    doc_mgr.set_user_menu_items(items);
                }
            }
            Ok((Value::Null, None))
        }
        "openFile" => {
            if let Some(path_str) = params.get("path").and_then(|v| v.as_str()) {
                crate::menu::open_in_shell(path_str);
                return Ok((json!(true), None));
            }
            Ok((json!(false), None))
        }
        "revealFile" => {
            if let Some(path_str) = params.get("path").and_then(|v| v.as_str()) {
                crate::menu::reveal_in_file_manager(Path::new(path_str));
                return Ok((json!(true), None));
            }
            Ok((json!(false), None))
        }
        "showPrintPanel" => {
            let script = "window.print();".to_string();
            Ok((json!(true), Some(script)))
        }
        "showContextMenu" => {
            let script = WebBridge::format_chrome_call("showContextMenu", Some(params.clone()));
            Ok((Value::Null, Some(script)))
        }
        "showTextBox" => {
            let default_val = params
                .get("defaultValue")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let script = WebBridge::format_chrome_call("showTextBox", Some(params.clone()));
            Ok((json!(default_val), Some(script)))
        }
        "showAlert" => {
            if let Some(cfg_val) = params.get("configuration") {
                if let Ok(cfg) = serde_json::from_value::<AlertConfiguration>(cfg_val.clone()) {
                    let _ = cfg;
                }
            }
            Ok((json!(0), None))
        }
        _ => Ok((Value::Null, None)),
    }
}

/// Converts a UTF-16 code unit index (what JavaScript strings use) to a UTF-8 byte index.
fn utf16_to_byte_index(text: &str, utf16_index: usize) -> usize {
    let mut units = 0usize;
    for (byte_index, ch) in text.char_indices() {
        if units >= utf16_index {
            return byte_index;
        }
        units += ch.len_utf16();
    }
    text.len()
}

/// Converts a UTF-8 byte index back to a UTF-16 code unit index.
fn byte_to_utf16_index(text: &str, byte_index: usize) -> usize {
    text[..byte_index.min(text.len())].encode_utf16().count()
}

/// Word tokenizer used for double-click selection and Alt+Arrow / Alt+Backspace.
///
/// The web side sends `{ anchor: { text, pos, offset } }` where `text` is the current line,
/// `pos` the caret's UTF-16 index inside that line and `offset` the line's document position.
/// `tokenize` returns a line-relative `{ from, to }`; the move methods return an absolute
/// document position (see `modules/tokenizer/index.ts`).
/// `params.path`, or the current document of the window when no path is given.
fn api_path_or_current(params: &Value, window_label: &str, doc_mgr: &DocumentManager) -> Option<PathBuf> {
    match params.get("path").and_then(|v| v.as_str()) {
        Some(path) if !path.is_empty() => Some(PathBuf::from(path)),
        _ => doc_mgr.with_session(window_label, |s| s.file_path.clone()),
    }
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

fn mime_type_for(extension: &str) -> &'static str {
    match extension {
        "md" | "markdown" | "mdown" | "mkd" => "text/markdown",
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "text/javascript",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn handle_tokenizer_module(
    method: &str,
    params: &Value,
) -> Result<(Value, Option<String>), String> {
    let anchor = params.get("anchor").unwrap_or(params);
    let line = anchor
        .get("text")
        .or_else(|| anchor.get("line"))
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let pos_utf16 = anchor.get("pos").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let offset = anchor.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let pos = utf16_to_byte_index(line, pos_utf16);

    match method {
        "tokenize" => {
            let mut from = pos;
            let mut to = pos;
            for (idx, word) in line.split_word_bound_indices() {
                let end = idx + word.len();
                if pos >= idx && pos < end {
                    from = idx;
                    to = end;
                    break;
                }
                // Caret at the very end of the line selects the last word.
                if pos == end && end == line.len() {
                    from = idx;
                    to = end;
                }
            }
            Ok((
                json!({
                    "from": byte_to_utf16_index(line, from),
                    "to": byte_to_utf16_index(line, to),
                }),
                None,
            ))
        }
        "moveWordBackward" => {
            let mut prev = 0usize;
            for (idx, word) in line.split_word_bound_indices() {
                if !word.trim().is_empty() && idx < pos {
                    prev = idx;
                }
            }
            Ok((json!(offset + byte_to_utf16_index(line, prev)), None))
        }
        "moveWordForward" => {
            let mut next = line.len();
            for (idx, word) in line.split_word_bound_indices() {
                let end = idx + word.len();
                if !word.trim().is_empty() && end > pos {
                    next = end;
                    break;
                }
            }
            Ok((json!(offset + byte_to_utf16_index(line, next)), None))
        }
        other => Err(format!("Unknown tokenizer method: {other}")),
    }
}

fn handle_secret_storage_module(
    method: &str,
    params: &Value,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    let key = params
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match method {
        "has" => {
            let exists = doc_mgr.secrets().has(key);
            Ok((
                json!(serde_json::to_string(&json!({ "value": exists })).unwrap()),
                None,
            ))
        }
        "get" => {
            let val = doc_mgr.secrets().get(key);
            Ok((
                json!(serde_json::to_string(&json!({ "value": val })).unwrap()),
                None,
            ))
        }
        "set" => {
            let value = params
                .get("value")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let ok = doc_mgr.secrets().set(key, value);
            Ok((
                json!(serde_json::to_string(&json!({ "value": ok })).unwrap()),
                None,
            ))
        }
        "delete" => {
            let ok = doc_mgr.secrets().delete(key);
            Ok((
                json!(serde_json::to_string(&json!({ "value": ok })).unwrap()),
                None,
            ))
        }
        other => Err(format!("Unknown secretStorage method: {other}")),
    }
}

fn handle_foundation_models_module(method: &str) -> Result<(Value, Option<String>), String> {
    match method {
        "availability" => Ok((
            json!(
                serde_json::to_string(&json!({
                    "isAvailable": false,
                    "unavailableReason": "Unsupported platform (Windows)"
                }))
                .unwrap()
            ),
            None,
        )),
        "isResponding" => Ok((json!(false), None)),
        _ => Ok((Value::Null, None)),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_apis_fall_back_to_the_current_document() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().join("data"));
        let doc = tmp.path().join("note.md");
        fs::write(&doc, "# Hi").unwrap();
        doc_mgr.with_session("main", |s| s.load_from_path(&doc)).unwrap();

        let call = |method: &str, params: Value| {
            let msg = BridgeMessage { module_name: "api".into(), method_name: method.into(), parameters: params.to_string() };
            dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch").0
        };

        // No path: the current document (the Preview extension calls getFileInfo() this way).
        let info: Value = serde_json::from_str(call("getFileInfo", json!({})).as_str().expect("json string")).unwrap();
        assert_eq!(info["filePath"], doc.to_string_lossy().as_ref());
        assert_eq!(info["parentPath"], tmp.path().to_string_lossy().as_ref());
        assert_eq!(call("getFileContent", json!({})), json!("# Hi"));

        let object: Value = serde_json::from_str(call("getFileObject", json!({ "path": doc })).as_str().expect("json string")).unwrap();
        assert_eq!(object["data"], "IyBIaQ==");
        assert_eq!(object["mimeType"], "text/markdown");
        assert_eq!(object["filenameExtension"], "md");

        // Untitled window: nothing to report.
        let msg = BridgeMessage { module_name: "api".into(), method_name: "getFileInfo".into(), parameters: "{}".into() };
        assert!(dispatch_bridge_message("doc-2", &msg, &doc_mgr).expect("dispatch").0.is_null());
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b""), "");
    }

    #[test]
    fn tokenizer_reads_anchor_and_returns_utf16_positions() {
        let anchor = |text: &str, pos: u64, offset: u64| {
            json!({ "anchor": { "text": text, "pos": pos, "offset": offset } })
        };

        // "hello world": caret after "wor" (pos 9) on a line starting at document offset 100.
        let (back, _) =
            handle_tokenizer_module("moveWordBackward", &anchor("hello world", 9, 100)).unwrap();
        assert_eq!(back, json!(106));
        let (fwd, _) =
            handle_tokenizer_module("moveWordForward", &anchor("hello world", 2, 100)).unwrap();
        assert_eq!(fwd, json!(105));
        let (range, _) =
            handle_tokenizer_module("tokenize", &anchor("hello world", 7, 100)).unwrap();
        assert_eq!(range, json!({ "from": 6, "to": 11 }));

        // Multi-byte text: positions stay in UTF-16 units, not bytes.
        let (range, _) = handle_tokenizer_module("tokenize", &anchor("안녕 세계", 4, 0)).unwrap();
        assert_eq!(range, json!({ "from": 3, "to": 5 }));
        let (back, _) =
            handle_tokenizer_module("moveWordBackward", &anchor("안녕 세계", 5, 10)).unwrap();
        assert_eq!(back, json!(13));
    }

    use super::*;

    #[test]
    fn updates_dirty_state_on_notify_view_did_update() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        let msg = BridgeMessage {
            module_name: "core".to_string(),
            method_name: "notifyViewDidUpdate".to_string(),
            parameters: serde_json::to_string(&json!({
                "contentEdited": true,
                "compositionEnded": true,
                "isDirty": true,
                "selectedLineColumn": {
                    "lineNumber": 2,
                    "columnText": "Hello world",
                    "selectionText": ""
                }
            }))
            .unwrap(),
        };

        let (_, followup_js) =
            dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch view update");
        assert!(followup_js.is_none());

        let is_dirty = doc_mgr.with_session("main", |s| s.is_dirty);
        assert!(is_dirty);

        // Idle notification while dirty should return save_idle_backup invocation script
        let idle_msg = BridgeMessage {
            module_name: "core".to_string(),
            method_name: "notifyEditorDidBecomeIdle".to_string(),
            parameters: "{}".to_string(),
        };
        let (_, idle_js) =
            dispatch_bridge_message("main", &idle_msg, &doc_mgr).expect("dispatch idle");
        assert!(idle_js
            .expect("idle script")
            .contains("save_idle_backup"));
    }

    #[test]
    fn replies_with_document_and_extensions_on_notify_window_did_load() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        doc_mgr.extensions().ensure_directories().unwrap();
        fs::write(
            doc_mgr.extensions().scripts_dir().join("markedit-theme-ext.js"),
            "MarkEdit.onAppReady(() => {});",
        )
        .unwrap();

        doc_mgr.with_session("main", |s| {
            s.content_cache = "# Welcome to MarkEdit-Win".to_string();
        });

        let msg = BridgeMessage {
            module_name: "core".to_string(),
            method_name: "notifyWindowDidLoad".to_string(),
            parameters: "{}".to_string(),
        };

        // A multi-megabyte extension (like markedit-preview.js) must not travel as an eval'd script.
        fs::write(
            doc_mgr.extensions().scripts_dir().join("markedit-theme-big.js"),
            format!("/* {} */", "x".repeat(6 * 1024 * 1024)),
        )
        .unwrap();

        let (reply, followup_js) =
            dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch window load");
        // The document and extensions come back as data; nothing is injected with eval.
        assert!(followup_js.is_none());
        assert_eq!(reply["text"], "# Welcome to MarkEdit-Win");
        assert!(reply["restoreText"].is_null());
        let scripts = reply["extensions"]["scripts"].as_array().expect("scripts");
        assert_eq!(scripts.len(), 2);
        assert!(scripts.iter().any(|script| script["capability"] == "markedit-theme-ext.js"
            && script["source"] == "MarkEdit.onAppReady(() => {});"));

        // Unsaved text recovered from a backup is delivered once.
        doc_mgr.with_session("main", |s| s.pending_restore_text = Some("draft".to_string()));
        let (reply, _) = dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch");
        assert_eq!(reply["restoreText"], "draft");
        let (reply, _) = dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch");
        assert!(reply["restoreText"].is_null());
    }

    #[test]
    fn tokenizes_and_moves_words_correctly() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        let msg = BridgeMessage {
            module_name: "tokenizer".to_string(),
            method_name: "tokenize".to_string(),
            parameters: serde_json::to_string(&json!({
                "line": "Hello MarkEdit world",
                "pos": 8
            }))
            .unwrap(),
        };

        let (res, _) = dispatch_bridge_message("main", &msg, &doc_mgr).expect("tokenize");
        assert_eq!(res["from"], 6);
        assert_eq!(res["to"], 14);
    }

    #[test]
    fn handles_api_filesystem_secret_storage_and_versions_via_bridge() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        let target_file = tmp.path().join("created.md");

        let create_msg = BridgeMessage {
            module_name: "api".to_string(),
            method_name: "createFile".to_string(),
            parameters: serde_json::to_string(&json!({
                "options": {
                    "path": target_file.to_string_lossy(),
                    "content": "# Created via API",
                    "isDirectory": false,
                    "overwrite": true
                }
            }))
            .unwrap(),
        };
        let (created_ok, _) =
            dispatch_bridge_message("main", &create_msg, &doc_mgr).expect("createFile");
        assert_eq!(created_ok, json!(true));

        // SecretStorage via bridge
        let set_secret = BridgeMessage {
            module_name: "secretStorage".to_string(),
            method_name: "set".to_string(),
            parameters: serde_json::to_string(&json!({
                "key": "openai_key",
                "value": "sk-test"
            }))
            .unwrap(),
        };
        dispatch_bridge_message("main", &set_secret, &doc_mgr).expect("set secret");

        let get_secret = BridgeMessage {
            module_name: "secretStorage".to_string(),
            method_name: "get".to_string(),
            parameters: serde_json::to_string(&json!({ "key": "openai_key" })).unwrap(),
        };
        let (got, _) = dispatch_bridge_message("main", &get_secret, &doc_mgr).expect("get secret");
        assert_eq!(got.as_str().unwrap(), r#"{"value":"sk-test"}"#);

        // Version history via bridge
        doc_mgr
            .versions()
            .record_version(&target_file, "# v1")
            .expect("record v1");
        let list_ver = BridgeMessage {
            module_name: "api".to_string(),
            method_name: "getFileVersions".to_string(),
            parameters: serde_json::to_string(&json!({ "path": target_file.to_string_lossy() }))
                .unwrap(),
        };
        let (vers, _) = dispatch_bridge_message("main", &list_ver, &doc_mgr).expect("list vers");
        // JSON text of [{ id, modificationDate, isLocal }], as api/fileVersion.ts parses it.
        let listed: Value = serde_json::from_str(vers.as_str().expect("JSON text")).expect("JSON");
        let listed = listed.as_array().expect("array");
        assert_eq!(listed.len(), 1);
        let id = listed[0]["id"].as_str().expect("id").to_string();
        assert!(listed[0]["modificationDate"].as_f64().unwrap() > 1_600_000_000.0);
        assert_eq!(listed[0]["isLocal"], json!(true));

        let content = BridgeMessage {
            module_name: "api".to_string(),
            method_name: "getFileVersionContent".to_string(),
            parameters: serde_json::to_string(&json!({ "id": id, "path": target_file.to_string_lossy() })).unwrap(),
        };
        let (text, _) = dispatch_bridge_message("main", &content, &doc_mgr).expect("content");
        assert_eq!(text, json!("# v1"));

        // Deleting needs the IDs: without them nothing is removed.
        let delete = |params: Value| BridgeMessage {
            module_name: "api".to_string(),
            method_name: "deleteLocalFileVersions".to_string(),
            parameters: serde_json::to_string(&params).unwrap(),
        };
        let path = target_file.to_string_lossy().to_string();
        let (none, _) = dispatch_bridge_message("main", &delete(json!({ "path": path })), &doc_mgr).expect("delete none");
        assert_eq!(none, json!(false));
        assert_eq!(doc_mgr.versions().list_versions(&target_file).len(), 1);
        let (deleted, _) = dispatch_bridge_message("main", &delete(json!({ "path": path, "ids": [id] })), &doc_mgr).expect("delete");
        assert_eq!(deleted, json!(true));
        assert!(doc_mgr.versions().list_versions(&target_file).is_empty());
    }
}
