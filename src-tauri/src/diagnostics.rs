//! Small diagnostic log: `<config dir>/MarkEdit/logs/markedit.log` (on Windows
//! `%APPDATA%\MarkEdit\logs\markedit.log`). Records startup arguments, document loads and
//! failures so problems like "the file opens but shows nothing" can be traced on the user's
//! machine. Kept under ~1 MB by rotating to `markedit.log.1`.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG_BYTES: u64 = 1024 * 1024;

pub fn log_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("SuperMark")
        .join("logs")
}

pub fn log_file() -> PathBuf {
    log_dir().join("markedit.log")
}

/// Appends a timestamped line. Never fails the caller.
pub fn log(message: &str) {
    // Unit tests exercise these code paths; keep them out of the user's real log.
    if cfg!(test) {
        return;
    }
    let _ = write_line(message);
    if cfg!(debug_assertions) {
        eprintln!("[MarkEdit] {message}");
    }
}

fn write_line(message: &str) -> std::io::Result<()> {
    let dir = log_dir();
    fs::create_dir_all(&dir)?;
    let path = log_file();

    if fs::metadata(&path).map(|m| m.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join("markedit.log.1"));
    }

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "[{secs}] {message}")
}
