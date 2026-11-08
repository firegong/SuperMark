use crate::document::DocumentManager;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
pub struct LineColumnInfo {
    pub line_number: i64,
    pub column_text: String,
    pub selection_text: String,
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
        "translation" => Ok((
            json!({ "succeeded": false, "text": "" }),
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
        "notifyEditorDidBecomeIdle"
        | "notifyBackgroundColorDidChange"
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
    _params: &Value,
    doc_mgr: &DocumentManager,
) -> Result<(Value, Option<String>), String> {
    match method {
        "recentDocumentPaths" => Ok((json!(doc_mgr.recent_paths_strings()), None)),
        "getFileVersions" => Ok((json!([]), None)),
        "getPasteboardString" => Ok((Value::Null, None)),
        "getPasteboardItems" => Ok((Value::Null, None)),
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
        "has" => Ok((json!( serde_json::to_string(&json!({ "value": false })).unwrap() ), None)),
        "get" => Ok((json!( serde_json::to_string(&json!({ "value": Value::Null })).unwrap() ), None)),
        "set" | "delete" => Ok((json!( serde_json::to_string(&json!({ "value": true })).unwrap() ), None)),
        other => Err(format!("Unknown secretStorage method: {other}")),
    }
}

fn handle_foundation_models_module(method: &str) -> Result<(Value, Option<String>), String> {
    match method {
        "availability" => Ok((
            json!(serde_json::to_string(&json!({ "isAvailable": false, "unavailableReason": "Unsupported platform (Windows)" })).unwrap()),
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
        let doc_mgr = DocumentManager::new();
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
    }

    #[test]
    fn returns_reset_editor_script_on_notify_window_did_load() {
        let doc_mgr = DocumentManager::new();
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
    fn tokenizes_word_boundaries_accurately() {
        let doc_mgr = DocumentManager::new();
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
