use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LineEndings {
    #[serde(rename = "\n")]
    LF,
    #[serde(rename = "\r\n")]
    CRLF,
    #[serde(rename = "\r")]
    CR,
}

impl LineEndings {
    pub fn detect(text: &str) -> Self {
        if text.contains("\r\n") {
            Self::CRLF
        } else if text.contains('\r') {
            Self::CR
        } else {
            Self::LF
        }
    }

    pub fn apply(self, text: &str) -> String {
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        match self {
            Self::LF => normalized,
            Self::CRLF => normalized.replace('\n', "\r\n"),
            Self::CR => normalized.replace('\n', "\r"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSession {
    pub window_label: String,
    pub file_path: Option<PathBuf>,
    pub has_utf8_bom: bool,
    pub line_endings: LineEndings,
    pub is_dirty: bool,
    pub content_cache: String,
}

impl DocumentSession {
    pub fn new(window_label: impl Into<String>) -> Self {
        Self {
            window_label: window_label.into(),
            file_path: None,
            has_utf8_bom: false,
            line_endings: LineEndings::CRLF,
            is_dirty: false,
            content_cache: String::new(),
        }
    }

    pub fn display_title(&self) -> String {
        let file_name = self
            .file_path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("Untitled");

        if self.is_dirty {
            format!("● {file_name} — MarkEdit")
        } else {
            format!("{file_name} — MarkEdit")
        }
    }

    pub fn load_from_path(&mut self, path: impl AsRef<Path>) -> Result<String, String> {
        let path_ref = path.as_ref();
        let bytes = fs::read(path_ref).map_err(|e| e.to_string())?;
        let (has_bom, body) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            (true, &bytes[3..])
        } else {
            (false, bytes.as_slice())
        };

        let raw_text = String::from_utf8_lossy(body).into_owned();
        let line_endings = LineEndings::detect(&raw_text);
        let normalized_text = raw_text.replace("\r\n", "\n").replace('\r', "\n");

        self.file_path = Some(path_ref.to_path_buf());
        self.has_utf8_bom = has_bom;
        self.line_endings = line_endings;
        self.is_dirty = false;
        self.content_cache = normalized_text.clone();

        Ok(normalized_text)
    }

    pub fn save_to_disk(&mut self, editor_text: &str) -> Result<PathBuf, String> {
        let target_path = self
            .file_path
            .clone()
            .ok_or_else(|| "No file path associated with document session".to_string())?;

        self.save_as(&target_path, editor_text)?;
        Ok(target_path)
    }

    pub fn save_as(&mut self, path: impl AsRef<Path>, editor_text: &str) -> Result<(), String> {
        let target_path = path.as_ref();
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let formatted = self.line_endings.apply(editor_text);
        let mut out_bytes = Vec::with_capacity(formatted.len() + 3);
        if self.has_utf8_bom {
            out_bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        out_bytes.extend_from_slice(formatted.as_bytes());

        let temp_path = target_path.with_extension("markedit.tmp");
        fs::write(&temp_path, &out_bytes).map_err(|e| e.to_string())?;
        fs::rename(&temp_path, target_path).map_err(|e| e.to_string())?;

        self.file_path = Some(target_path.to_path_buf());
        self.is_dirty = false;
        self.content_cache = editor_text.replace("\r\n", "\n").replace('\r', "\n");
        Ok(())
    }
}

pub struct DocumentManager {
    sessions: Mutex<HashMap<String, DocumentSession>>,
    recent_files: Mutex<Vec<PathBuf>>,
}

impl Default for DocumentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentManager {
    pub fn new() -> Self {
        let mut map = HashMap::new();
        map.insert("main".to_string(), DocumentSession::new("main"));
        Self {
            sessions: Mutex::new(map),
            recent_files: Mutex::new(Vec::new()),
        }
    }

    pub fn with_session<F, R>(&self, label: &str, f: F) -> R
    where
        F: FnOnce(&mut DocumentSession) -> R,
    {
        let mut guard = self.sessions.lock().expect("DocumentManager lock");
        let session = guard
            .entry(label.to_string())
            .or_insert_with(|| DocumentSession::new(label));
        f(session)
    }

    pub fn push_recent(&self, path: PathBuf) {
        let mut recent = self.recent_files.lock().expect("recent_files lock");
        recent.retain(|p| p != &path);
        recent.insert(0, path);
        recent.truncate(15);
    }

    pub fn recent_paths_strings(&self) -> Vec<String> {
        let recent = self.recent_files.lock().expect("recent_files lock");
        recent
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_preserves_crlf_and_utf8_bom() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let file_path = tmp.path().join("note.md");

        let mut raw = vec![0xEF, 0xBB, 0xBF];
        raw.extend_from_slice(b"# Title\r\n\r\n- [ ] Task 1\r\n");
        fs::write(&file_path, &raw).expect("write test file");

        let mut session = DocumentSession::new("main");
        let loaded = session.load_from_path(&file_path).expect("load_from_path");

        assert!(session.has_utf8_bom);
        assert_eq!(session.line_endings, LineEndings::CRLF);
        assert_eq!(loaded, "# Title\n\n- [ ] Task 1\n");
        assert_eq!(session.display_title(), "note.md — MarkEdit");

        session.is_dirty = true;
        assert_eq!(session.display_title(), "● note.md — MarkEdit");

        session
            .save_to_disk("# Title\n\n- [x] Task 1\n")
            .expect("save_to_disk");
        assert!(!session.is_dirty);

        let saved_bytes = fs::read(&file_path).expect("read saved file");
        assert!(saved_bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert_eq!(&saved_bytes[3..], b"# Title\r\n\r\n- [x] Task 1\r\n");
    }
}
