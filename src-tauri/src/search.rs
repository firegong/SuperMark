use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub line_number: usize, // 1-based
    pub line_text: String,
    pub start: usize, // char offset in line
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMatches {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub files: Vec<FileMatches>,
    pub total_matches: usize,
    pub files_searched: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
}

fn is_text_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    // Skip obvious binaries by extension.
    let binary_exts = [
        "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "pdf", "zip", "tar", "gz", "7z", "exe",
        "dll", "so", "dylib", "bin", "woff", "woff2", "ttf", "otf", "mp3", "mp4", "mov", "avi",
    ];
    if let Some(e) = ext {
        if binary_exts.contains(&e.as_str()) {
            return false;
        }
    }
    // Sniff for null bytes.
    if let Ok(bytes) = fs::read(path) {
        let sample = &bytes[..bytes.len().min(8192)];
        if sample.contains(&0u8) {
            return false;
        }
    }
    true
}

fn build_regex(query: &str, opts: SearchOptions) -> Result<regex::Regex, String> {
    let pattern = if opts.use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    let pattern = if opts.whole_word {
        format!(r"\b{}\b", pattern)
    } else {
        pattern
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| e.to_string())
}

pub fn search_in_folder(
    folder: &str,
    query: &str,
    opts: SearchOptions,
    max_results: usize,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult {
            files: vec![],
            total_matches: 0,
            files_searched: 0,
        });
    }
    let re = build_regex(query, opts)?;
    let root = PathBuf::from(folder);
    if !root.is_dir() {
        return Err("not a directory".to_string());
    }

    let mut files: Vec<FileMatches> = Vec::new();
    let mut total = 0usize;
    let mut searched = 0usize;

    for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !is_text_file(path) {
            continue;
        }
        // skip hidden
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        searched += 1;
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let mut matches: Vec<SearchMatch> = Vec::new();
        for (i, line) in content.lines().enumerate() {
            for m in re.find_iter(line) {
                matches.push(SearchMatch {
                    line_number: i + 1,
                    line_text: line.to_string(),
                    start: m.start(),
                    end: m.end(),
                });
                total += 1;
                if total >= max_results {
                    break;
                }
            }
            if total >= max_results {
                break;
            }
        }
        if !matches.is_empty() {
            files.push(FileMatches {
                path: path.to_string_lossy().into_owned(),
                matches,
            });
        }
        if total >= max_results {
            break;
        }
    }

    Ok(SearchResult {
        files,
        total_matches: total,
        files_searched: searched,
    })
}

pub fn replace_in_files(
    folder: &str,
    query: &str,
    replacement: &str,
    opts: SearchOptions,
    target_file: Option<&str>,
) -> Result<usize, String> {
    if query.is_empty() {
        return Ok(0);
    }
    let re = build_regex(query, opts)?;
    let root = PathBuf::from(folder);
    let mut total = 0usize;

    let walk: Vec<PathBuf> = if let Some(tf) = target_file {
        vec![PathBuf::from(tf)]
    } else {
        WalkDir::new(&root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .collect()
    };

    for path in walk {
        if !path.is_file() || !is_text_file(&path) {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let new_content = re.replace_all(&content, replacement).into_owned();
        if new_content != content {
            // count matches
            let count = re.find_iter(&content).count();
            total += count;
            let _ = fs::write(&path, new_content);
        }
    }
    Ok(total)
}
