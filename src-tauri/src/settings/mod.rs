use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebFontFace {
    pub family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorLocalizable {
    pub control_character: String,
    pub folded_lines: String,
    pub unfolded_lines: String,
    pub folded_code: String,
    pub unfold: String,
    pub fold_line: String,
    pub unfold_line: String,
    pub preview_button_title: String,
    pub close_button_title: String,
    pub cmd_click_to_follow: String,
    pub cmd_click_to_toggle_todo: String,
}

impl Default for EditorLocalizable {
    fn default() -> Self {
        Self {
            control_character: "Control Character".to_string(),
            folded_lines: "Folded Lines".to_string(),
            unfolded_lines: "Unfolded Lines".to_string(),
            folded_code: "Folded Code".to_string(),
            unfold: "Unfold".to_string(),
            fold_line: "Fold Line".to_string(),
            unfold_line: "Unfold Line".to_string(),
            preview_button_title: "Preview".to_string(),
            close_button_title: "Close".to_string(),
            cmd_click_to_follow: "Ctrl+Click to follow link".to_string(),
            cmd_click_to_toggle_todo: "Ctrl+Click to toggle todo".to_string(),
        }
    }
}

/// Matches `CoreEditor/src/config.ts` `Config` interface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    pub host: String,
    pub text: String,
    pub theme: String,
    pub font_face: WebFontFace,
    pub font_size: f64,
    pub show_line_numbers: bool,
    pub show_active_line_indicator: bool,
    pub invisibles_behavior: String,
    pub read_only_mode: bool,
    pub typewriter_mode: bool,
    pub focus_mode: bool,
    pub line_wrapping: bool,
    pub line_height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_line_break: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab_key_behavior: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indent_unit: Option<String>,
    pub suggest_while_typing: bool,
    pub auto_character_pairs: bool,
    pub indent_behavior: String,
    pub localizable: EditorLocalizable,
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            host: "mainApp".to_string(),
            text: String::new(),
            theme: "github-light".to_string(),
            font_face: WebFontFace {
                family: "Cascadia Mono, Consolas, ui-monospace, monospace".to_string(),
                weight: Some("normal".to_string()),
                style: Some("normal".to_string()),
            },
            font_size: 15.0,
            show_line_numbers: true,
            show_active_line_indicator: true,
            invisibles_behavior: "selection".to_string(),
            read_only_mode: false,
            typewriter_mode: false,
            focus_mode: false,
            line_wrapping: true,
            line_height: 1.5,
            default_line_break: Some("\r\n".to_string()),
            tab_key_behavior: Some(0),
            indent_unit: Some("  ".to_string()),
            suggest_while_typing: false,
            auto_character_pairs: true,
            indent_behavior: "paragraph".to_string(),
            localizable: EditorLocalizable::default(),
        }
    }
}

pub struct SettingsManager {
    pub config_dir: PathBuf,
}

impl SettingsManager {
    pub fn new() -> Self {
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            config_dir: base.join("MarkEdit"),
        }
    }

    pub fn settings_file_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn load_or_default(&self) -> EditorConfig {
        let path = self.settings_file_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<EditorConfig>(&raw) {
                return cfg;
            }
        }
        EditorConfig::default()
    }

    pub fn save(&self, config: &EditorConfig) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(self.settings_file_path(), json).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_default_editor_config_with_camel_case_keys() {
        let config = EditorConfig::default();
        let json = serde_json::to_value(&config).expect("serialize EditorConfig");

        assert_eq!(json["host"], "mainApp");
        assert_eq!(json["showLineNumbers"], true);
        assert_eq!(json["invisiblesBehavior"], "selection");
        assert_eq!(
            json["localizable"]["cmdClickToFollow"],
            "Ctrl+Click to follow link"
        );
    }

    #[test]
    fn saves_and_reloads_settings_from_disk() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = SettingsManager {
            config_dir: tmp.path().to_path_buf(),
        };
        let mut cfg = EditorConfig::default();
        cfg.theme = "github-dark".to_string();
        cfg.font_size = 17.0;

        mgr.save(&cfg).expect("save config");
        let loaded = mgr.load_or_default();
        assert_eq!(loaded.theme, "github-dark");
        assert_eq!(loaded.font_size, 17.0);
    }
}
