use serde::{Deserialize, Serialize};

pub type CodeGenInt = i64;
pub type CodeGenUInt64 = u64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LineColumnInfo {
    pub line_number: CodeGenInt,
    pub column_text: String,
    pub selection_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeadingInfo {
    pub title: String,
    pub level: CodeGenInt,
    pub from: CodeGenInt,
    pub to: CodeGenInt,
    #[serde(default)]
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub search: String,
    pub case_sensitive: bool,
    pub diode: Option<bool>,
    pub literal: bool,
    pub regexp: bool,
    pub whole_word: bool,
    pub refocus: bool,
    #[serde(default)]
    pub replace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlertConfiguration {
    pub title: Option<String>,
    pub message: Option<String>,
    pub buttons: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextBoxConfiguration {
    pub title: Option<String>,
    pub message: Option<String>,
    pub default_value: Option<String>,
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub file_path: String,
    pub file_size: u64,
    pub creation_date: u64,
    pub modification_date: u64,
    pub parent_path: Option<String>,
    pub is_directory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemState {
    #[serde(default = "default_true")]
    pub is_enabled: bool,
    #[serde(default)]
    pub is_selected: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuItem {
    #[serde(default)]
    pub separator: Option<bool>,
    pub title: Option<String>,
    pub icon: Option<String>,
    #[serde(alias = "actionID")]
    pub action_id: Option<String>,
    #[serde(alias = "stateGetterID")]
    pub state_id: Option<String>,
    pub key: Option<String>,
    pub modifiers: Option<Vec<String>>,
    pub children: Option<Vec<MenuItem>>,
}
