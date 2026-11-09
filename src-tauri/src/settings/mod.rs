use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
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
    pub smart_quotes_enabled: bool,
    pub indent_behavior: String,
    pub localizable: EditorLocalizable,
}

impl Default for EditorConfig {
    fn default() -> Self {
        UserSettings::default().to_editor_config()
    }
}

/// Comprehensive settings model matching upstream MarkEdit Settings tabs
/// (`Editor`, `Assistant`, `General`, `Window`) and `MarkEdit.userSettings`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct UserSettings {
    #[serde(rename = "editor.fontFamily")]
    pub font_family: String,
    #[serde(rename = "editor.fontSize")]
    pub font_size: f64,
    #[serde(rename = "editor.lightTheme")]
    pub light_theme: String,
    #[serde(rename = "editor.darkTheme")]
    pub dark_theme: String,
    #[serde(rename = "editor.showLineNumbers")]
    pub show_line_numbers: bool,
    #[serde(rename = "editor.showActiveLineIndicator")]
    pub show_active_line_indicator: bool,
    #[serde(rename = "editor.invisiblesBehavior")]
    pub invisibles_behavior: String,
    #[serde(rename = "editor.typewriterMode")]
    pub typewriter_mode: bool,
    #[serde(rename = "editor.focusMode")]
    pub focus_mode: bool,
    #[serde(rename = "editor.lineWrapping")]
    pub line_wrapping: bool,
    #[serde(rename = "editor.lineHeight")]
    pub line_height: f64,
    #[serde(rename = "editor.tabKeyBehavior")]
    pub tab_key_behavior: i64,
    #[serde(rename = "editor.indentUnit")]
    pub indent_unit: String,

    #[serde(rename = "assistant.insertFinalNewline")]
    pub insert_final_newline: bool,
    #[serde(rename = "assistant.trimTrailingWhitespace")]
    pub trim_trailing_whitespace: bool,
    #[serde(rename = "assistant.wordsInDocument")]
    pub suggest_while_typing: bool,
    #[serde(rename = "assistant.autoCharacterPairs")]
    pub auto_character_pairs: bool,
    #[serde(rename = "assistant.smartQuotes")]
    pub smart_quotes_enabled: bool,

    #[serde(rename = "general.appearance")]
    pub appearance: String,
    #[serde(rename = "general.newFilenameExtension")]
    pub new_filename_extension: String,
    #[serde(rename = "general.defaultTextEncoding")]
    pub default_text_encoding: String,
    #[serde(rename = "general.defaultLineBreak")]
    pub default_line_break: String,

    #[serde(rename = "window.reduceTransparency")]
    pub reduce_transparency: bool,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            font_family: "Cascadia Mono, Consolas, ui-monospace, monospace".to_string(),
            font_size: 15.0,
            light_theme: "github-light".to_string(),
            dark_theme: "github-dark".to_string(),
            show_line_numbers: true,
            show_active_line_indicator: true,
            invisibles_behavior: "selection".to_string(),
            typewriter_mode: false,
            focus_mode: false,
            line_wrapping: true,
            line_height: 1.5,
            tab_key_behavior: 0,
            indent_unit: "  ".to_string(),
            insert_final_newline: false,
            trim_trailing_whitespace: false,
            suggest_while_typing: false,
            auto_character_pairs: true,
            smart_quotes_enabled: true,
            appearance: "system".to_string(),
            new_filename_extension: "md".to_string(),
            default_text_encoding: "UTF-8".to_string(),
            default_line_break: "\r\n".to_string(),
            reduce_transparency: false,
        }
    }
}

impl UserSettings {
    pub fn effective_theme(&self) -> String {
        match self.appearance.as_str() {
            "dark" => self.dark_theme.clone(),
            _ => self.light_theme.clone(),
        }
    }

    pub fn to_editor_config(&self) -> EditorConfig {
        EditorConfig {
            host: "mainApp".to_string(),
            text: String::new(),
            theme: self.effective_theme(),
            font_face: WebFontFace {
                family: self.font_family.clone(),
                weight: Some("normal".to_string()),
                style: Some("normal".to_string()),
            },
            font_size: self.font_size,
            show_line_numbers: self.show_line_numbers,
            show_active_line_indicator: self.show_active_line_indicator,
            invisibles_behavior: self.invisibles_behavior.clone(),
            read_only_mode: false,
            typewriter_mode: self.typewriter_mode,
            focus_mode: self.focus_mode,
            line_wrapping: self.line_wrapping,
            line_height: self.line_height,
            default_line_break: Some(self.default_line_break.clone()),
            tab_key_behavior: Some(self.tab_key_behavior),
            indent_unit: Some(self.indent_unit.clone()),
            suggest_while_typing: self.suggest_while_typing,
            auto_character_pairs: self.auto_character_pairs,
            smart_quotes_enabled: self.smart_quotes_enabled,
            indent_behavior: "paragraph".to_string(),
            localizable: EditorLocalizable::default(),
        }
    }
}

pub struct SettingsManager {
    pub config_dir: PathBuf,
}

impl Default for SettingsManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SettingsManager {
    pub fn new() -> Self {
        let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            config_dir: base.join("MarkEdit"),
        }
    }

    pub fn with_dir(config_dir: impl Into<PathBuf>) -> Self {
        Self {
            config_dir: config_dir.into(),
        }
    }

    pub fn settings_file_path(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn load_user_settings(&self) -> UserSettings {
        let path = self.settings_file_path();
        let Ok(raw) = fs::read_to_string(&path) else {
            return UserSettings::default();
        };

        if let Ok(val) = serde_json::from_str::<Value>(&raw) {
            if let Some(obj) = val.as_object() {
                if obj.keys().any(|k| k.contains('.')) {
                    if let Ok(settings) = serde_json::from_value::<UserSettings>(val) {
                        return settings;
                    }
                }
            }
        }

        if let Ok(legacy) = serde_json::from_str::<EditorConfig>(&raw) {
            let mut s = UserSettings::default();
            s.font_family = legacy.font_face.family;
            s.font_size = legacy.font_size;
            s.light_theme = legacy.theme;
            s.show_line_numbers = legacy.show_line_numbers;
            s.show_active_line_indicator = legacy.show_active_line_indicator;
            s.invisibles_behavior = legacy.invisibles_behavior;
            s.typewriter_mode = legacy.typewriter_mode;
            s.focus_mode = legacy.focus_mode;
            s.line_wrapping = legacy.line_wrapping;
            s.line_height = legacy.line_height;
            if let Some(lb) = legacy.default_line_break {
                s.default_line_break = lb;
            }
            if let Some(tk) = legacy.tab_key_behavior {
                s.tab_key_behavior = tk;
            }
            if let Some(iu) = legacy.indent_unit {
                s.indent_unit = iu;
            }
            s.suggest_while_typing = legacy.suggest_while_typing;
            s.auto_character_pairs = legacy.auto_character_pairs;
            s.smart_quotes_enabled = legacy.smart_quotes_enabled;
            return s;
        }

        UserSettings::default()
    }

    pub fn save_user_settings(&self, settings: &UserSettings) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        let path = self.settings_file_path();
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }

    pub fn update_user_settings(&self, patch: &Value) -> Result<UserSettings, String> {
        let current = self.load_user_settings();
        let mut current_val = serde_json::to_value(&current).map_err(|e| e.to_string())?;
        if let (Some(target_map), Some(patch_map)) =
            (current_val.as_object_mut(), patch.as_object())
        {
            for (k, v) in patch_map {
                target_map.insert(k.clone(), v.clone());
            }
        }
        let updated: UserSettings =
            serde_json::from_value(current_val).map_err(|e| e.to_string())?;
        self.save_user_settings(&updated)?;
        Ok(updated)
    }

    pub fn reset_user_settings(&self) -> Result<UserSettings, String> {
        let defaults = UserSettings::default();
        self.save_user_settings(&defaults)?;
        Ok(defaults)
    }

    pub fn load_or_default(&self) -> EditorConfig {
        self.load_user_settings().to_editor_config()
    }

    pub fn save(&self, config: &EditorConfig) -> Result<(), String> {
        let mut user = self.load_user_settings();
        user.font_family = config.font_face.family.clone();
        user.font_size = config.font_size;
        user.light_theme = config.theme.clone();
        user.show_line_numbers = config.show_line_numbers;
        user.show_active_line_indicator = config.show_active_line_indicator;
        user.invisibles_behavior = config.invisibles_behavior.clone();
        user.typewriter_mode = config.typewriter_mode;
        user.focus_mode = config.focus_mode;
        user.line_wrapping = config.line_wrapping;
        user.line_height = config.line_height;
        if let Some(ref lb) = config.default_line_break {
            user.default_line_break = lb.clone();
        }
        if let Some(tk) = config.tab_key_behavior {
            user.tab_key_behavior = tk;
        }
        if let Some(ref iu) = config.indent_unit {
            user.indent_unit = iu.clone();
        }
        user.suggest_while_typing = config.suggest_while_typing;
        user.auto_character_pairs = config.auto_character_pairs;
        user.smart_quotes_enabled = config.smart_quotes_enabled;
        self.save_user_settings(&user)
    }

    pub fn build_live_sync_js(&self, settings: &UserSettings) -> String {
        let editor_cfg = settings.to_editor_config();
        let cfg_json = serde_json::to_string(&editor_cfg).unwrap_or_else(|_| "{}".to_string());
        let user_json = serde_json::to_string(settings).unwrap_or_else(|_| "{}".to_string());
        let theme_arg = json!({ "name": editor_cfg.theme });
        let font_face_arg = json!({ "fontFace": editor_cfg.font_face });
        let font_size_arg = json!({ "fontSize": editor_cfg.font_size });
        let line_num_arg = json!({ "enabled": editor_cfg.show_line_numbers });
        let active_line_arg = json!({ "enabled": editor_cfg.show_active_line_indicator });
        let invisibles_arg = json!({ "behavior": editor_cfg.invisibles_behavior });
        let typewriter_arg = json!({ "enabled": editor_cfg.typewriter_mode });
        let focus_arg = json!({ "enabled": editor_cfg.focus_mode });
        let wrap_arg = json!({ "enabled": editor_cfg.line_wrapping });
        let lh_arg = json!({ "lineHeight": editor_cfg.line_height });
        let lb_arg = json!({ "lineBreak": settings.default_line_break });
        let tab_arg = json!({ "behavior": settings.tab_key_behavior });
        let indent_arg = json!({ "unit": settings.indent_unit });
        let suggest_arg = json!({ "enabled": editor_cfg.suggest_while_typing });
        let smart_quotes_arg = json!({ "enabled": editor_cfg.smart_quotes_enabled });

        format!(
            r#"(function() {{
  const nextCfg = {cfg_json};
  const nextUser = {user_json};
  window.config = Object.assign({{}}, window.config, nextCfg);
  if (window.MarkEdit) {{
    window.MarkEdit.editorConfig = window.config;
    window.MarkEdit.userSettings = nextUser;
  }}
  const c = window.webModules?.config;
  if (c) {{
    c.setTheme?.({theme_arg});
    c.setFontFace?.({font_face_arg});
    c.setFontSize?.({font_size_arg});
    c.setShowLineNumbers?.({line_num_arg});
    c.setShowActiveLineIndicator?.({active_line_arg});
    c.setInvisiblesBehavior?.({invisibles_arg});
    c.setTypewriterMode?.({typewriter_arg});
    c.setFocusMode?.({focus_arg});
    c.setLineWrapping?.({wrap_arg});
    c.setLineHeight?.({lh_arg});
    c.setDefaultLineBreak?.({lb_arg});
    c.setTabKeyBehavior?.({tab_arg});
    c.setIndentUnit?.({indent_arg});
    c.setSuggestWhileTyping?.({suggest_arg});
    c.setSmartQuotesEnabled?.({smart_quotes_arg});
  }}
}})();"#
        )
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
        let mgr = SettingsManager::with_dir(tmp.path());
        let mut cfg = EditorConfig::default();
        cfg.theme = "github-dark".to_string();
        cfg.font_size = 17.0;

        mgr.save(&cfg).expect("save config");
        let loaded = mgr.load_or_default();
        assert_eq!(loaded.theme, "github-dark");
        assert_eq!(loaded.font_size, 17.0);

        let patched = mgr
            .update_user_settings(&json!({
                "editor.fontSize": 19.0,
                "general.appearance": "dark",
                "editor.darkTheme": "dracula"
            }))
            .expect("update user settings");
        assert_eq!(patched.font_size, 19.0);
        assert_eq!(patched.effective_theme(), "dracula");

        let sync_js = mgr.build_live_sync_js(&patched);
        assert!(sync_js.contains("c.setTheme"));
        assert!(sync_js.contains("dracula"));
    }
}
