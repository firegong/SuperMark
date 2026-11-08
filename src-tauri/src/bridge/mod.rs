pub mod generated;
pub mod secret_storage;

use crate::document::DocumentManager;
use generated::{AlertConfiguration, FileInfo, LineColumnInfo};
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
        "translation" => Ok((json!({ "succeeded": false, "text": "" }), None)),
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
            let initial_text = doc_mgr.with_session(window_label, |s| s.content_cache.clone());
            let ext_bootstrap = doc_mgr.extensions().build_extension_bootstrap_js();
            let script = if ext_bootstrap.is_empty() {
                format!(
                    "{}\n{}",
                    WebBridge::reset_editor(&initial_text),
                    WebBridge::notify_app_ready()
                )
            } else {
                format!(
                    "{}\n{}\n{}",
                    ext_bootstrap,
                    WebBridge::reset_editor(&initial_text),
                    WebBridge::notify_app_ready()
                )
            };
            Ok((Value::Null, Some(script)))
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
            let is_dirty = doc_mgr.with_session(window_label, |s| s.is_dirty);
            if is_dirty {
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
            Ok((json!(versions), None))
        }
        "getFileVersionContent" => {
            let Some(version) = params.get("version").and_then(|v| v.as_str()) else {
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
            let Some(version) = params.get("version").and_then(|v| v.as_str()) else {
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
            match doc_mgr.versions().restore_version(&path, version) {
                Ok(restored) => {
                    doc_mgr.with_session(window_label, |s| {
                        s.content_cache = restored.clone();
                        s.is_dirty = false;
                    });
                    Ok((json!(true), Some(WebBridge::reset_editor(&restored))))
                }
                Err(_) => Ok((json!(false), None)),
            }
        }
        "deleteLocalFileVersions" => {
            let target = params
                .get("path")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .or_else(|| doc_mgr.with_session(window_label, |s| s.file_path.clone()));
            let ok = target
                .as_deref()
                .and_then(|p| doc_mgr.versions().delete_local_versions(p).ok())
                .unwrap_or(false);
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
        "getFileContent" | "getFileObject" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                return Ok((Value::Null, None));
            };
            let content = fs::read_to_string(path_str).ok();
            Ok((json!(content), None))
        }
        "getFileInfo" => {
            let Some(path_str) = params.get("path").and_then(|v| v.as_str()) else {
                return Ok((Value::Null, None));
            };
            let path = Path::new(path_str);
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

fn handle_tokenizer_module(
    method: &str,
    params: &Value,
) -> Result<(Value, Option<String>), String> {
    let line = params
        .get("line")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let pos = params
        .get("pos")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    match method {
        "tokenize" => {
            let mut from = 0usize;
            let mut to = line.len();
            for (idx, word) in line.split_word_bound_indices() {
                let end = idx + word.len();
                if pos >= idx && pos <= end {
                    from = idx;
                    to = end;
                    break;
                }
            }
            Ok((json!({ "from": from, "to": to }), None))
        }
        "moveWordBackward" => {
            let mut prev = 0usize;
            for (idx, word) in line.split_word_bound_indices() {
                if !word.trim().is_empty() && idx < pos {
                    prev = idx;
                }
            }
            Ok((json!(prev), None))
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
            Ok((json!(next), None))
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
    fn returns_reset_editor_and_user_extensions_on_notify_window_did_load() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        doc_mgr.extensions().ensure_directories().unwrap();
        fs::write(
            doc_mgr.extensions().scripts_dir().join("ext.js"),
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

        let (_, followup_js) =
            dispatch_bridge_message("main", &msg, &doc_mgr).expect("dispatch window load");
        let script = followup_js.expect("followup script expected");
        assert!(script.contains("__prepareScriptContexts__"));
        assert!(script.contains("window.webModules?.core?.resetEditor"));
        assert!(script.contains("# Welcome to MarkEdit-Win"));
        assert!(script.contains("window.webModules?.api?.notifyAppReady"));
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
        assert_eq!(vers.as_array().unwrap().len(), 1);
    }
}
