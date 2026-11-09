pub mod textbundle;
pub mod versions;
pub mod watcher;

use crate::bridge::secret_storage::SecretStorageManager;
use crate::extensions::ExtensionManager;
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use textbundle::{
    is_textbundle_path, is_textpack_path, read_textbundle, read_textpack, write_textbundle,
    write_textpack,
};
use versions::VersionManager;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BomKind {
    None,
    Utf8,
    Utf16Le,
    Utf16Be,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub window_label: String,
    pub original_path: Option<PathBuf>,
    pub timestamp_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSession {
    pub window_label: String,
    pub file_path: Option<PathBuf>,
    pub bom: BomKind,
    pub encoding_name: String,
    pub line_endings: LineEndings,
    pub is_dirty: bool,
    pub content_cache: String,
    pub last_modified_secs: Option<u64>,
}

impl DocumentSession {
    pub fn new(window_label: impl Into<String>) -> Self {
        Self {
            window_label: window_label.into(),
            file_path: None,
            bom: BomKind::None,
            encoding_name: "UTF-8".to_string(),
            line_endings: LineEndings::CRLF,
            is_dirty: false,
            content_cache: String::new(),
            last_modified_secs: None,
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
            format!("● {file_name} — MarkEdit-Rust")
        } else {
            format!("{file_name} — MarkEdit-Rust")
        }
    }

    pub fn load_from_path(&mut self, path: impl AsRef<Path>) -> Result<String, String> {
        let path_ref = path.as_ref();

        if is_textbundle_path(path_ref) {
            let raw_text = read_textbundle(path_ref)?;
            let line_endings = LineEndings::detect(&raw_text);
            let normalized = raw_text.replace("\r\n", "\n").replace('\r', "\n");
            self.file_path = Some(path_ref.to_path_buf());
            self.bom = BomKind::None;
            self.encoding_name = "UTF-8".to_string();
            self.line_endings = line_endings;
            self.is_dirty = false;
            self.content_cache = normalized.clone();
            self.last_modified_secs = file_mtime_secs(path_ref);
            return Ok(normalized);
        }

        if is_textpack_path(path_ref) {
            let raw_text = read_textpack(path_ref)?;
            let line_endings = LineEndings::detect(&raw_text);
            let normalized = raw_text.replace("\r\n", "\n").replace('\r', "\n");
            self.file_path = Some(path_ref.to_path_buf());
            self.bom = BomKind::None;
            self.encoding_name = "UTF-8".to_string();
            self.line_endings = line_endings;
            self.is_dirty = false;
            self.content_cache = normalized.clone();
            self.last_modified_secs = file_mtime_secs(path_ref);
            return Ok(normalized);
        }

        let bytes = fs::read(path_ref).map_err(|e| e.to_string())?;
        let (bom, encoding, raw_text) = decode_bytes(&bytes);

        let line_endings = LineEndings::detect(&raw_text);
        let normalized_text = raw_text.replace("\r\n", "\n").replace('\r', "\n");

        self.file_path = Some(path_ref.to_path_buf());
        self.bom = bom;
        self.encoding_name = encoding.name().to_string();
        self.line_endings = line_endings;
        self.is_dirty = false;
        self.content_cache = normalized_text.clone();
        self.last_modified_secs = file_mtime_secs(path_ref);

        Ok(normalized_text)
    }

    pub fn load_from_path_with_encoding(
        &mut self,
        path: impl AsRef<Path>,
        encoding_label: &str,
    ) -> Result<String, String> {
        let path_ref = path.as_ref();
        if is_textbundle_path(path_ref) || is_textpack_path(path_ref) {
            return self.load_from_path(path_ref);
        }

        let bytes = fs::read(path_ref).map_err(|e| e.to_string())?;
        let upper = encoding_label.trim().to_ascii_uppercase();
        let (bom, encoding_name, raw_text) = match upper.as_str() {
            "UTF-8-BOM" => {
                let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    &bytes[3..]
                } else {
                    &bytes[..]
                };
                let (cow, _, _) = UTF_8.decode(slice);
                (BomKind::Utf8, "UTF-8".to_string(), cow.into_owned())
            }
            "UTF-16LE" => {
                let slice = if bytes.starts_with(&[0xFF, 0xFE]) {
                    &bytes[2..]
                } else {
                    &bytes[..]
                };
                let (cow, _, _) = UTF_16LE.decode(slice);
                (BomKind::Utf16Le, "UTF-16LE".to_string(), cow.into_owned())
            }
            "UTF-16BE" => {
                let slice = if bytes.starts_with(&[0xFE, 0xFF]) {
                    &bytes[2..]
                } else {
                    &bytes[..]
                };
                let (cow, _, _) = UTF_16BE.decode(slice);
                (BomKind::Utf16Be, "UTF-16BE".to_string(), cow.into_owned())
            }
            _ => {
                let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    &bytes[3..]
                } else {
                    &bytes[..]
                };
                let enc = Encoding::for_label(encoding_label.trim().as_bytes()).unwrap_or(UTF_8);
                let (cow, _, _) = enc.decode(slice);
                (BomKind::None, enc.name().to_string(), cow.into_owned())
            }
        };

        let line_endings = LineEndings::detect(&raw_text);
        let normalized_text = raw_text.replace("\r\n", "\n").replace('\r', "\n");

        self.file_path = Some(path_ref.to_path_buf());
        self.bom = bom;
        self.encoding_name = encoding_name;
        self.line_endings = line_endings;
        self.is_dirty = false;
        self.content_cache = normalized_text.clone();
        self.last_modified_secs = file_mtime_secs(path_ref);

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
        let formatted = self.line_endings.apply(editor_text);

        if is_textbundle_path(target_path) {
            write_textbundle(target_path, &formatted)?;
            self.file_path = Some(target_path.to_path_buf());
            self.is_dirty = false;
            self.content_cache = editor_text.replace("\r\n", "\n").replace('\r', "\n");
            self.last_modified_secs = file_mtime_secs(target_path);
            return Ok(());
        }

        if is_textpack_path(target_path) {
            write_textpack(target_path, &formatted)?;
            self.file_path = Some(target_path.to_path_buf());
            self.is_dirty = false;
            self.content_cache = editor_text.replace("\r\n", "\n").replace('\r', "\n");
            self.last_modified_secs = file_mtime_secs(target_path);
            return Ok(());
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let out_bytes = encode_text(&formatted, &self.encoding_name, &self.bom);

        let temp_path = target_path.with_extension("markedit.tmp");
        fs::write(&temp_path, &out_bytes).map_err(|e| e.to_string())?;
        fs::rename(&temp_path, target_path).map_err(|e| e.to_string())?;

        self.file_path = Some(target_path.to_path_buf());
        self.is_dirty = false;
        self.content_cache = editor_text.replace("\r\n", "\n").replace('\r', "\n");
        self.last_modified_secs = file_mtime_secs(target_path);
        Ok(())
    }
}

fn decode_bytes(bytes: &[u8]) -> (BomKind, &'static Encoding, String) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let (cow, _, _) = UTF_8.decode(&bytes[3..]);
        return (BomKind::Utf8, UTF_8, cow.into_owned());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, _) = UTF_16LE.decode(&bytes[2..]);
        return (BomKind::Utf16Le, UTF_16LE, cow.into_owned());
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = UTF_16BE.decode(&bytes[2..]);
        return (BomKind::Utf16Be, UTF_16BE, cow.into_owned());
    }
    if let Ok(valid_utf8) = std::str::from_utf8(bytes) {
        return (BomKind::None, UTF_8, valid_utf8.to_string());
    }

    let mut detector = EncodingDetector::new();
    detector.feed(bytes, true);
    let encoding = detector.guess(None, true);
    let (cow, _, _) = encoding.decode(bytes);
    (BomKind::None, encoding, cow.into_owned())
}

fn encode_text(text: &str, encoding_name: &str, bom: &BomKind) -> Vec<u8> {
    let mut out = Vec::new();
    match bom {
        BomKind::Utf8 => {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            out.extend_from_slice(text.as_bytes());
            return out;
        }
        BomKind::Utf16Le => {
            out.extend_from_slice(&[0xFF, 0xFE]);
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_le_bytes());
            }
            return out;
        }
        BomKind::Utf16Be => {
            out.extend_from_slice(&[0xFE, 0xFF]);
            for u in text.encode_utf16() {
                out.extend_from_slice(&u.to_be_bytes());
            }
            return out;
        }
        BomKind::None => {}
    }

    let encoding = Encoding::for_label(encoding_name.as_bytes()).unwrap_or(UTF_8);
    if encoding == UTF_16LE {
        for u in text.encode_utf16() {
            out.extend_from_slice(&u.to_le_bytes());
        }
        return out;
    }
    if encoding == UTF_16BE {
        for u in text.encode_utf16() {
            out.extend_from_slice(&u.to_be_bytes());
        }
        return out;
    }

    let (cow, _, _) = encoding.encode(text);
    out.extend_from_slice(&cow);
    out
}

fn file_mtime_secs(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

pub struct DocumentManager {
    sessions: Mutex<HashMap<String, DocumentSession>>,
    recent_files: Mutex<Vec<PathBuf>>,
    user_menu_items: Mutex<Vec<crate::bridge::generated::MenuItem>>,
    app_data_dir: PathBuf,
    versions: VersionManager,
    extensions: ExtensionManager,
    secrets: SecretStorageManager,
}

impl Default for DocumentManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DocumentManager {
    pub fn new() -> Self {
        let base = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("MarkEdit");
        Self::with_data_dir(base)
    }

    pub fn with_data_dir(app_data_dir: PathBuf) -> Self {
        let mut map = HashMap::new();
        map.insert("main".to_string(), DocumentSession::new("main"));

        let recent_path = app_data_dir.join("recent.json");
        let recent_loaded: Vec<PathBuf> = fs::read_to_string(&recent_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .map(|list| list.into_iter().map(PathBuf::from).collect())
            .unwrap_or_default();

        let versions = VersionManager::new(&app_data_dir);
        let extensions = ExtensionManager::new(&app_data_dir);
        let secrets = SecretStorageManager::new(&app_data_dir);

        Self {
            sessions: Mutex::new(map),
            recent_files: Mutex::new(recent_loaded),
            user_menu_items: Mutex::new(Vec::new()),
            app_data_dir,
            versions,
            extensions,
            secrets,
        }
    }

    pub fn set_user_menu_items(&self, items: Vec<crate::bridge::generated::MenuItem>) {
        if let Ok(mut guard) = self.user_menu_items.lock() {
            *guard = items;
        }
    }

    pub fn user_menu_items(&self) -> Vec<crate::bridge::generated::MenuItem> {
        self.user_menu_items
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn versions(&self) -> &VersionManager {
        &self.versions
    }

    pub fn extensions(&self) -> &ExtensionManager {
        &self.extensions
    }

    pub fn secrets(&self) -> &SecretStorageManager {
        &self.secrets
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

    pub fn next_window_label(&self) -> String {
        let guard = self.sessions.lock().expect("DocumentManager lock");
        for idx in 2..=1000 {
            let candidate = format!("doc-{idx}");
            if !guard.contains_key(&candidate) {
                return candidate;
            }
        }
        "doc-extra".to_string()
    }

    pub fn push_recent(&self, path: PathBuf) {
        let mut recent = self.recent_files.lock().expect("recent_files lock");
        recent.retain(|p| p != &path);
        recent.insert(0, path);
        recent.truncate(15);

        let _ = fs::create_dir_all(&self.app_data_dir);
        let serialized: Vec<String> = recent
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        if let Ok(json_str) = serde_json::to_string_pretty(&serialized) {
            let _ = fs::write(self.app_data_dir.join("recent.json"), json_str);
        }
    }

    pub fn clear_recents(&self) {
        let mut recent = self.recent_files.lock().expect("recent_files lock");
        recent.clear();
        let _ = fs::write(self.app_data_dir.join("recent.json"), "[]");
    }

    pub fn recent_paths_strings(&self) -> Vec<String> {
        let recent = self.recent_files.lock().expect("recent_files lock");
        recent
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect()
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("Backups")
    }

    pub fn save_backup_snapshot(&self, label: &str, text: &str) -> Result<PathBuf, String> {
        let dir = self.backups_dir();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let md_path = dir.join(format!("{label}.md"));
        let meta_path = dir.join(format!("{label}.json"));

        let original_path = self.with_session(label, |s| s.file_path.clone());
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let meta = BackupMetadata {
            window_label: label.to_string(),
            original_path,
            timestamp_secs: now_secs,
        };

        fs::write(&md_path, text.as_bytes()).map_err(|e| e.to_string())?;
        let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
        fs::write(&meta_path, meta_json).map_err(|e| e.to_string())?;
        Ok(md_path)
    }

    pub fn load_backup_snapshot(&self, label: &str) -> Option<(BackupMetadata, String)> {
        let dir = self.backups_dir();
        let md_path = dir.join(format!("{label}.md"));
        let meta_path = dir.join(format!("{label}.json"));

        let text = fs::read_to_string(&md_path).ok()?;
        let meta_raw = fs::read_to_string(&meta_path).ok()?;
        let meta = serde_json::from_str::<BackupMetadata>(&meta_raw).ok()?;
        Some((meta, text))
    }

    pub fn clear_backup_snapshot(&self, label: &str) {
        let dir = self.backups_dir();
        let _ = fs::remove_file(dir.join(format!("{label}.md")));
        let _ = fs::remove_file(dir.join(format!("{label}.json")));
    }

    pub fn list_backup_labels(&self) -> Vec<String> {
        let dir = self.backups_dir();
        let Ok(entries) = fs::read_dir(&dir) else {
            return Vec::new();
        };
        entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|ext| ext.to_str()) == Some("json") {
                    p.file_stem()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
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

        assert_eq!(session.bom, BomKind::Utf8);
        assert_eq!(session.line_endings, LineEndings::CRLF);
        assert_eq!(loaded, "# Title\n\n- [ ] Task 1\n");
        assert_eq!(session.display_title(), "note.md — MarkEdit-Rust");

        session.is_dirty = true;
        assert_eq!(session.display_title(), "● note.md — MarkEdit-Rust");

        session
            .save_to_disk("# Title\n\n- [x] Task 1\n")
            .expect("save_to_disk");
        assert!(!session.is_dirty);

        let saved_bytes = fs::read(&file_path).expect("read saved file");
        assert!(saved_bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
        assert_eq!(&saved_bytes[3..], b"# Title\r\n\r\n- [x] Task 1\r\n");
    }

    #[test]
    fn detects_and_preserves_utf16le_bom_and_euckr() {
        let tmp = tempfile::tempdir().expect("tempdir");

        // 1. UTF-16LE with BOM
        let utf16_path = tmp.path().join("utf16.md");
        let sample = "# 한글 마크다운\r\n본문입니다.";
        let mut utf16_bytes = vec![0xFF, 0xFE];
        for u in sample.encode_utf16() {
            utf16_bytes.extend_from_slice(&u.to_le_bytes());
        }
        fs::write(&utf16_path, &utf16_bytes).expect("write utf16");

        let mut session = DocumentSession::new("main");
        let loaded = session.load_from_path(&utf16_path).expect("load utf16");
        assert_eq!(session.bom, BomKind::Utf16Le);
        assert_eq!(loaded, "# 한글 마크다운\n본문입니다.");

        session
            .save_to_disk("# 한글 마크다운\n본문입니다.")
            .expect("save utf16");
        let saved = fs::read(&utf16_path).expect("read saved utf16");
        assert_eq!(saved, utf16_bytes);

        // 2. EUC-KR encoding detection & roundtrip
        let euckr_path = tmp.path().join("euckr.md");
        let kor_text = "# 한국어 인코딩 테스트\n안녕하세요 반갑습니다. 마크다운 문서입니다.";
        let (encoded, _, _) = encoding_rs::EUC_KR.encode(kor_text);
        fs::write(&euckr_path, &encoded).expect("write euckr");

        let mut session2 = DocumentSession::new("main");
        let loaded2 = session2.load_from_path(&euckr_path).expect("load euckr");
        assert_eq!(loaded2, kor_text);
        assert_eq!(session2.encoding_name, "EUC-KR");
    }

    #[test]
    fn persists_recent_documents_and_hot_exit_backups() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = DocumentManager::with_data_dir(tmp.path().to_path_buf());

        let p1 = tmp.path().join("a.md");
        let p2 = tmp.path().join("b.md");
        mgr.push_recent(p1.clone());
        mgr.push_recent(p2.clone());
        mgr.push_recent(p1.clone()); // deduplicate and move to front

        let recents = mgr.recent_paths_strings();
        assert_eq!(recents.len(), 2);
        assert!(recents[0].ends_with("a.md"));
        assert!(recents[1].ends_with("b.md"));

        // Verify persistence across reload
        let mgr_reloaded = DocumentManager::with_data_dir(tmp.path().to_path_buf());
        assert_eq!(mgr_reloaded.recent_paths_strings(), recents);

        // Backup snapshot lifecycle
        mgr.with_session("main", |s| {
            s.file_path = Some(p1.clone());
            s.is_dirty = true;
        });
        mgr.save_backup_snapshot("main", "# Unsaved Draft")
            .expect("save backup");
        assert_eq!(mgr.list_backup_labels(), vec!["main".to_string()]);

        let (meta, text) = mgr.load_backup_snapshot("main").expect("load backup");
        assert_eq!(text, "# Unsaved Draft");
        assert_eq!(meta.original_path, Some(p1));

        mgr.clear_backup_snapshot("main");
        assert!(mgr.load_backup_snapshot("main").is_none());
    }

    #[test]
    fn loads_and_saves_textbundle_and_textpack_via_document_session() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let bundle_path = tmp.path().join("Doc.textbundle");
        let mut s1 = DocumentSession::new("main");
        s1.save_as(&bundle_path, "# Bundle Header\nLine 2")
            .expect("save textbundle");

        let mut s2 = DocumentSession::new("main");
        let loaded = s2.load_from_path(&bundle_path).expect("load textbundle");
        assert_eq!(loaded, "# Bundle Header\nLine 2");

        let pack_path = tmp.path().join("Doc.textpack");
        s2.save_as(&pack_path, "# Pack Header\nLine 2")
            .expect("save textpack");

        let mut s3 = DocumentSession::new("main");
        let loaded_pack = s3.load_from_path(&pack_path).expect("load textpack");
        assert_eq!(loaded_pack, "# Pack Header\nLine 2");
    }
}
