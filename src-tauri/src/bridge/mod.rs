pub mod generated;

use crate::document::DocumentManager;
use generated::{AlertConfiguration, FileInfo, LineColumnInfo};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
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
                let serialized = serde_json::to_string(&val).unwrap_or_else(|_| "false".to_string());
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
        "api" => handle_api_module(&msg.method_name, &params, doc_mgr),
        "tokenizer" => handle_tokenizer_module(&msg.method_name, &params),
        "completion" => Ok((Value::Null, None)),
        "secretStorage" => handle_secret_storage_module(&msg.method_name, &params),
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
            let script = format!(
                "{}\n{}",
                WebBridge::reset_editor(&initial_text),
                WebBridge::notify_app_ready()
            );
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
    method: &str,
    params: &Value,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    match method {
        "recentDocumentPaths" => Ok((json!(doc_mgr.recent_paths_strings()), None)),
        "getFileVersions" => Ok((json!([]), None)),
        "getPasteboardString" => Ok((Value::Null, None)),
        "getPasteboardItems" => Ok((Value::Null, None)),
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
        "getFileContent" => {
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
    _params: &Value,
) -> Result<(Value, Option<String>), String> {
    match method {
        "has" => Ok((
            json!(serde_json::to_string(&json!({ "value": false })).unwrap()),
            None,
        )),
        "get" => Ok((
            json!(serde_json::to_string(&json!({ "value": Value::Null })).unwrap()),
            None,
        )),
        "set" | "delete" => Ok((
            json!(serde_json::to_string(&json!({ "value": true })).unwrap()),
            None,
        )),
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
    fn returns_reset_editor_script_on_notify_window_did_load() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
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
        let script = followup_js.expect("followup script");
        assert!(script.contains("window.webModules?.core?.resetEditor"));
        assert!(script.contains("# Welcome to MarkEdit-Win"));
        assert!(script.contains("window.webModules?.api?.notifyAppReady"));
    }

    #[test]
    fn handles_api_filesystem_methods() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        let target_file = tmp.path().join("plugin-note.md");

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
        let (created, _) = dispatch_bridge_message("main", &create_msg, &doc_mgr).unwrap();
        assert_eq!(created, json!(true));

        let read_msg = BridgeMessage {
            module_name: "api".to_string(),
            method_name: "getFileContent".to_string(),
            parameters: serde_json::to_string(&json!({
                "path": target_file.to_string_lossy()
            }))
            .unwrap(),
        };
        let (content, _) = dispatch_bridge_message("main", &read_msg, &doc_mgr).unwrap();
        assert_eq!(content, json!("# Created via API"));
    }

    #[test]
    fn tokenizes_word_boundaries_accurately() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc_mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        let msg = BridgeMessage {
            module_name: "tokenizer".to_string(),
            method_name: "tokenize".to_string(),
            parameters: serde_json::to_string(&json!({
                "line": "Hello Markdown World",
                "pos": 8
            }))
            .unwrap(),
        };

        let (result, _) = dispatch_bridge_message("main", &msg, &doc_mgr).expect("tokenize");
        assert_eq!(result["from"], 6);
        assert_eq!(result["to"], 14);
    }
}
