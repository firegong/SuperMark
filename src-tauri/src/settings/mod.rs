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
    /// Render tables, math, diagrams and other elements inside the editor (off: plain source).
    #[serde(default)]
    pub live_preview: bool,
    /// Theme extension (script file name) applied over the theme; empty: built-in theme only.
    #[serde(default)]
    pub theme_extension: String,
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
    /// Installed theme extension (script file name, e.g. `markedit-theme-one-dark.js`) whose
    /// colors apply over the theme. Empty: the built-in theme as chosen, no extension colors.
    #[serde(rename = "editor.themeExtension")]
    pub theme_extension: String,
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
    /// Render tables, math, diagrams and other elements inside the editor. Off by default:
    /// the editor shows Markdown source; the preview renders it.
    #[serde(rename = "editor.livePreview")]
    pub live_preview: bool,
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
    /// What to show when the app starts without files: `newDocument` (default) opens an empty
    /// document, `lastSession` reopens the windows (and unsaved changes) of the last session.
    #[serde(rename = "general.startupBehavior")]
    pub startup_behavior: String,

    #[serde(rename = "window.reduceTransparency")]
    pub reduce_transparency: bool,

    /// Markdown parser used by the preview: `extended`, `super`, `gfm`, `commonmark` or a
    /// renderer registered by an extension.
    #[serde(rename = "preview.markdownRenderer")]
    pub markdown_renderer: String,

    /// Kroki-compatible server used by the PlantUML / D2 (and advanced Mermaid) diagram
    /// plugins. Empty turns online diagram rendering off; diagram sources are sent here.
    #[serde(rename = "preview.diagramServer")]
    pub diagram_server: String,
    /// `auto` (local tools first, then the diagram server), `local` or `server`.
    #[serde(rename = "preview.diagramRendering")]
    pub diagram_rendering: String,
    /// Command for local PlantUML: `plantuml`, a path to `plantuml.jar`, or `java -jar …`.
    #[serde(rename = "preview.plantumlCommand")]
    pub plantuml_command: String,
    /// Command for local D2.
    #[serde(rename = "preview.d2Command")]
    pub d2_command: String,
    /// Preview typography per theme (font, size, weight and color of the body text, headings,
    /// links, code and blockquotes), keyed by theme id or `extension:<script file name>`.
    #[serde(rename = "preview.themeStyles")]
    pub preview_theme_styles: Value,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            font_family: "Cascadia Mono, Consolas, ui-monospace, monospace".to_string(),
            font_size: 15.0,
            light_theme: "github-light".to_string(),
            dark_theme: "github-dark".to_string(),
            theme_extension: String::new(),
            show_line_numbers: true,
            show_active_line_indicator: true,
            invisibles_behavior: "selection".to_string(),
            typewriter_mode: false,
            focus_mode: false,
            live_preview: false,
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
            startup_behavior: "newDocument".to_string(),
            reduce_transparency: false,
            markdown_renderer: "extended".to_string(),
            diagram_server: "https://kroki.io".to_string(),
            diagram_rendering: "auto".to_string(),
            plantuml_command: "plantuml".to_string(),
            d2_command: "d2".to_string(),
            preview_theme_styles: json!({}),
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
            live_preview: self.live_preview,
            theme_extension: self.theme_extension.clone(),
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

    pub fn to_frontend_value(&self) -> Value {
        let mut val = serde_json::to_value(self).unwrap_or_else(|_| json!({}));
        if let Some(obj) = val.as_object_mut() {
            let active_theme = self.effective_theme();
            obj.insert("theme".to_string(), json!(active_theme));
            obj.insert("lightTheme".to_string(), json!(self.light_theme));
            obj.insert("darkTheme".to_string(), json!(self.dark_theme));
            obj.insert("themeExtension".to_string(), json!(self.theme_extension));
            obj.insert("fontFamily".to_string(), json!(self.font_family));
            obj.insert("fontSize".to_string(), json!(self.font_size));
            obj.insert("showLineNumbers".to_string(), json!(self.show_line_numbers));
            obj.insert(
                "showActiveLineIndicator".to_string(),
                json!(self.show_active_line_indicator),
            );
            obj.insert(
                "invisiblesBehavior".to_string(),
                json!(self.invisibles_behavior),
            );
            obj.insert("typewriterMode".to_string(), json!(self.typewriter_mode));
            obj.insert("focusMode".to_string(), json!(self.focus_mode));
            obj.insert("livePreview".to_string(), json!(self.live_preview));
            obj.insert("lineWrapping".to_string(), json!(self.line_wrapping));
            obj.insert("lineHeight".to_string(), json!(self.line_height));
            obj.insert("tabKeyBehavior".to_string(), json!(self.tab_key_behavior));
            obj.insert("indentUnit".to_string(), json!(self.indent_unit));
            obj.insert(
                "insertFinalNewline".to_string(),
                json!(self.insert_final_newline),
            );
            obj.insert(
                "trimTrailingWhitespace".to_string(),
                json!(self.trim_trailing_whitespace),
            );
            obj.insert(
                "suggestWhileTyping".to_string(),
                json!(self.suggest_while_typing),
            );
            obj.insert(
                "autoCharacterPairs".to_string(),
                json!(self.auto_character_pairs),
            );
            obj.insert(
                "smartQuotesEnabled".to_string(),
                json!(self.smart_quotes_enabled),
            );
            obj.insert("appearance".to_string(), json!(self.appearance));
            obj.insert(
                "newFilenameExtension".to_string(),
                json!(self.new_filename_extension),
            );
            obj.insert(
                "defaultTextEncoding".to_string(),
                json!(self.default_text_encoding),
            );
            obj.insert(
                "defaultLineBreak".to_string(),
                json!(self.default_line_break),
            );
            obj.insert(
                "startupBehavior".to_string(),
                json!(self.startup_behavior),
            );
            obj.insert(
                "reduceTransparency".to_string(),
                json!(self.reduce_transparency),
            );
            obj.insert(
                "markdownRenderer".to_string(),
                json!(self.markdown_renderer),
            );
            obj.insert("diagramServer".to_string(), json!(self.diagram_server));
            obj.insert("diagramRendering".to_string(), json!(self.diagram_rendering));
            obj.insert("plantumlCommand".to_string(), json!(self.plantuml_command));
            obj.insert("d2Command".to_string(), json!(self.d2_command));
            obj.insert(
                "previewThemeStyles".to_string(),
                self.preview_theme_styles.clone(),
            );
        }
        val
    }
}

fn canonical_setting_key(key: &str) -> Option<&'static str> {
    match key {
        "editor.fontFamily" | "fontFamily" => Some("editor.fontFamily"),
        "editor.fontSize" | "fontSize" => Some("editor.fontSize"),
        "editor.lightTheme" | "lightTheme" => Some("editor.lightTheme"),
        "editor.darkTheme" | "darkTheme" => Some("editor.darkTheme"),
        "editor.themeExtension" | "themeExtension" => Some("editor.themeExtension"),
        "editor.showLineNumbers" | "showLineNumbers" => Some("editor.showLineNumbers"),
        "editor.showActiveLineIndicator" | "showActiveLineIndicator" => {
            Some("editor.showActiveLineIndicator")
        }
        "editor.invisiblesBehavior" | "invisiblesBehavior" => Some("editor.invisiblesBehavior"),
        "editor.typewriterMode" | "typewriterMode" => Some("editor.typewriterMode"),
        "editor.focusMode" | "focusMode" => Some("editor.focusMode"),
        "editor.livePreview" | "livePreview" => Some("editor.livePreview"),
        "editor.lineWrapping" | "lineWrapping" => Some("editor.lineWrapping"),
        "editor.lineHeight" | "lineHeight" => Some("editor.lineHeight"),
        "editor.tabKeyBehavior" | "tabKeyBehavior" => Some("editor.tabKeyBehavior"),
        "editor.indentUnit" | "indentUnit" => Some("editor.indentUnit"),
        "assistant.insertFinalNewline" | "insertFinalNewline" => {
            Some("assistant.insertFinalNewline")
        }
        "assistant.trimTrailingWhitespace" | "trimTrailingWhitespace" => {
            Some("assistant.trimTrailingWhitespace")
        }
        "assistant.wordsInDocument" | "wordsInDocument" | "suggestWhileTyping" => {
            Some("assistant.wordsInDocument")
        }
        "assistant.autoCharacterPairs" | "autoCharacterPairs" => {
            Some("assistant.autoCharacterPairs")
        }
        "assistant.smartQuotes" | "smartQuotes" | "smartQuotesEnabled" => {
            Some("assistant.smartQuotes")
        }
        "general.appearance" | "appearance" => Some("general.appearance"),
        "general.newFilenameExtension" | "newFilenameExtension" => {
            Some("general.newFilenameExtension")
        }
        "general.defaultTextEncoding" | "defaultTextEncoding" => {
            Some("general.defaultTextEncoding")
        }
        "general.defaultLineBreak" | "defaultLineBreak" => Some("general.defaultLineBreak"),
        "general.startupBehavior" | "startupBehavior" => Some("general.startupBehavior"),
        "window.reduceTransparency" | "reduceTransparency" => Some("window.reduceTransparency"),
        "preview.markdownRenderer" | "markdownRenderer" => Some("preview.markdownRenderer"),
        "preview.diagramServer" | "diagramServer" => Some("preview.diagramServer"),
        "preview.diagramRendering" | "diagramRendering" => Some("preview.diagramRendering"),
        "preview.plantumlCommand" | "plantumlCommand" => Some("preview.plantumlCommand"),
        "preview.d2Command" | "d2Command" => Some("preview.d2Command"),
        "preview.themeStyles" | "previewThemeStyles" => Some("preview.themeStyles"),
        _ => None,
    }
}

fn apply_settings_patch_map(
    target_map: &mut serde_json::Map<String, Value>,
    patch_map: &serde_json::Map<String, Value>,
) {
    for (k, v) in patch_map {
        if k == "theme" || k == "editor.theme" {
            target_map.insert("editor.lightTheme".to_string(), v.clone());
            target_map.insert("editor.darkTheme".to_string(), v.clone());
        } else if let Some(canonical) = canonical_setting_key(k) {
            target_map.insert(canonical.to_string(), v.clone());
        } else {
            target_map.insert(k.clone(), v.clone());
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
                if obj.keys().any(|k| canonical_setting_key(k).is_some() || k == "theme")
                    && !obj.contains_key("fontFace")
                {
                    let mut base_val = serde_json::to_value(UserSettings::default())
                        .unwrap_or_else(|_| json!({}));
                    if let Some(target_map) = base_val.as_object_mut() {
                        apply_settings_patch_map(target_map, obj);
                    }
                    if let Ok(settings) = serde_json::from_value::<UserSettings>(base_val) {
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
            s.live_preview = legacy.live_preview;
            s.theme_extension = legacy.theme_extension;
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
            apply_settings_patch_map(target_map, patch_map);
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
        user.live_preview = config.live_preview;
        user.theme_extension = config.theme_extension.clone();
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
        let user_json =
            serde_json::to_string(&settings.to_frontend_value()).unwrap_or_else(|_| "{}".to_string());
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
        let auto_pairs_arg = json!({ "enabled": editor_cfg.auto_character_pairs });
        let smart_quotes_arg = json!({ "enabled": editor_cfg.smart_quotes_enabled });
        let appearance_json =
            serde_json::to_string(&settings.appearance).unwrap_or_else(|_| "\"system\"".to_string());
        let diagram_rendering_json = serde_json::to_string(&settings.diagram_rendering)
            .unwrap_or_else(|_| "\"auto\"".to_string());
        let diagram_server_json = serde_json::to_string(&settings.diagram_server)
            .unwrap_or_else(|_| "\"\"".to_string());
        let renderer_json = serde_json::to_string(&settings.markdown_renderer)
            .unwrap_or_else(|_| "\"extended\"".to_string());
        let live_preview = settings.live_preview;
        let theme_extension_json =
            serde_json::to_string(&settings.theme_extension).unwrap_or_else(|_| "\"\"".to_string());
        let preview_theme_styles_json = serde_json::to_string(&settings.preview_theme_styles)
            .unwrap_or_else(|_| "{}".to_string());
        let reduce_trans_str = if settings.reduce_transparency {
            "true"
        } else {
            "false"
        };

        format!(
            r#"(function() {{
  const nextCfg = {cfg_json};
  const nextUser = {user_json};
  // In place: theme extensions hook properties of window.config (e.g. `theme`).
  if (typeof window.config !== 'object' || window.config === null) {{ window.config = {{}}; }}
  Object.assign(window.config, nextCfg);
  if (window.MarkEdit) {{
    window.MarkEdit.editorConfig = window.config;
    window.MarkEdit.userSettings = nextUser;
  }}
  if (document?.documentElement) {{
    document.documentElement.dataset.appearance = {appearance_json};
    document.documentElement.dataset.reduceTransparency = "{reduce_trans_str}";
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
    c.setAutoCharacterPairs?.({auto_pairs_arg});
    c.setSmartQuotesEnabled?.({smart_quotes_arg});
  }}
  window.chromeUI?.setDiagramRendering?.({diagram_rendering_json});
  window.chromeUI?.setDiagramServer?.({diagram_server_json});
  window.chromeUI?.setMarkdownRenderer?.({renderer_json});
  window.chromeUI?.setEditorLivePreview?.({live_preview});
  window.chromeUI?.setThemeExtension?.({theme_extension_json});
  window.chromeUI?.setPreviewThemeStyles?.({preview_theme_styles_json});
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

        // Flat camelCase keys from SettingsModal UI must also patch without duplicate-field errors
        let patched_flat = mgr
            .update_user_settings(&json!({
                "theme": "synthwave84",
                "fontFamily": "Consolas",
                "fontSize": 20.0,
                "showLineNumbers": false,
                "suggestWhileTyping": true,
                "autoCharacterPairs": false,
                "smartQuotesEnabled": false,
                "reduceTransparency": true
            }))
            .expect("update user settings with flat camelCase keys");
        assert_eq!(patched_flat.effective_theme(), "synthwave84");
        assert_eq!(patched_flat.font_family, "Consolas");
        assert_eq!(patched_flat.font_size, 20.0);
        assert!(!patched_flat.show_line_numbers);
        assert!(patched_flat.suggest_while_typing);
        assert!(!patched_flat.auto_character_pairs);
        assert!(!patched_flat.smart_quotes_enabled);
        assert!(patched_flat.reduce_transparency);

        let frontend_val = patched_flat.to_frontend_value();
        assert_eq!(frontend_val["theme"], "synthwave84");
        assert_eq!(frontend_val["fontSize"], 20.0);
        assert_eq!(frontend_val["editor.fontSize"], 20.0);
        assert_eq!(frontend_val["showLineNumbers"], false);
        assert_eq!(frontend_val["suggestWhileTyping"], true);

        let sync_js = mgr.build_live_sync_js(&patched_flat);
        assert!(sync_js.contains("c.setTheme"));
        assert!(sync_js.contains("synthwave84"));

        // Markdown parser choice persists under `preview.markdownRenderer`.
        assert_eq!(patched_flat.markdown_renderer, "extended");
        let with_renderer = mgr
            .update_user_settings(&json!({ "markdownRenderer": "super" }))
            .expect("update markdown renderer");
        assert_eq!(with_renderer.markdown_renderer, "super");
        assert_eq!(mgr.load_user_settings().markdown_renderer, "super");
        assert_eq!(with_renderer.to_frontend_value()["markdownRenderer"], "super");
        assert_eq!(with_renderer.to_frontend_value()["preview.markdownRenderer"], "super");
        assert_eq!(with_renderer.diagram_server, "https://kroki.io");
        assert_eq!(with_renderer.diagram_rendering, "auto");
        assert_eq!(with_renderer.plantuml_command, "plantuml");
        let local = mgr
            .update_user_settings(&json!({ "diagramRendering": "local", "plantumlCommand": "C:\\tools\\plantuml.jar" }))
            .expect("local diagrams");
        assert_eq!(local.diagram_rendering, "local");
        assert_eq!(local.plantuml_command, "C:\\tools\\plantuml.jar");
        assert!(mgr.build_live_sync_js(&local).contains("setDiagramRendering?.(\"local\")"));
        let no_server = mgr
            .update_user_settings(&json!({ "diagramServer": "" }))
            .expect("turn diagram server off");
        assert_eq!(no_server.diagram_server, "");
        assert!(mgr.build_live_sync_js(&no_server).contains("setDiagramServer?.(\"\")"));
        assert_eq!(with_renderer.startup_behavior, "newDocument");
        let with_startup = mgr
            .update_user_settings(&json!({ "startupBehavior": "lastSession" }))
            .expect("update startup behavior");
        assert_eq!(with_startup.startup_behavior, "lastSession");
        assert_eq!(with_startup.to_frontend_value()["startupBehavior"], "lastSession");
        assert!(mgr
            .build_live_sync_js(&with_renderer)
            .contains("window.chromeUI?.setMarkdownRenderer?.(\"super\")"));
    }

    #[test]
    fn persists_preview_theme_styles_and_syncs_them_to_windows() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = SettingsManager::with_dir(tmp.path());
        assert_eq!(mgr.load_user_settings().preview_theme_styles, json!({}));

        let styles = json!({ "dracula": { "h1": { "fontSize": 32, "color": "#ff79c6" } } });
        let updated = mgr
            .update_user_settings(&json!({ "previewThemeStyles": styles }))
            .expect("update preview theme styles");
        assert_eq!(updated.preview_theme_styles, styles);
        assert_eq!(mgr.load_user_settings().preview_theme_styles, styles);
        assert_eq!(updated.to_frontend_value()["previewThemeStyles"], styles);
        assert_eq!(updated.to_frontend_value()["preview.themeStyles"], styles);
        assert!(mgr
            .build_live_sync_js(&updated)
            .contains("setPreviewThemeStyles?.({\"dracula\""));
    }
}
