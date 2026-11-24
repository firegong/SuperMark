//! Where a clicked link goes (preview links and Ctrl+click in the editor).
//!
//! Only safe targets leave the app: web and mail links open in the default browser or mail app,
//! Markdown documents open in the app, and other local files are only revealed in Explorer —
//! never run (a link to an `.exe` must not launch it). Anything else (`javascript:`, unknown
//! schemes) is ignored.

use std::path::{Path, PathBuf};

/// Extensions the app opens as documents.
const DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "txt", "textbundle"];

#[derive(Debug, PartialEq, Eq)]
pub enum LinkTarget {
    /// http(s) or mailto, opened by the system.
    External(String),
    /// A document to open in the app.
    Document(PathBuf),
    /// Another existing local file: revealed in the file manager, not opened.
    Reveal(PathBuf),
    /// A local target that does not exist.
    NotFound(PathBuf),
    /// In-page anchors (handled by the page), empty links and unsafe or unknown schemes.
    Ignored,
}

/// Decodes `%XX` escapes (invalid ones are kept as they are).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(value) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn is_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| DOCUMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Resolves `href` against the folder of the current document (`base_dir`, if it has been saved).
pub fn resolve_link(href: &str, base_dir: Option<&Path>) -> LinkTarget {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') {
        return LinkTarget::Ignored;
    }

    let lower = href.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
        // One argument for the shell: no whitespace or quotes that could split or escape it.
        if href.chars().any(|c| c.is_whitespace() || c == '"' || c.is_control()) {
            return LinkTarget::Ignored;
        }
        return LinkTarget::External(href.to_string());
    }

    // A local path: `file:` URLs, absolute paths, or paths relative to the document.
    let local = if lower.starts_with("file://") {
        let rest = &href["file://".len()..];
        // file:///C:/x → C:/x on Windows, /x elsewhere.
        if cfg!(windows) {
            rest.trim_start_matches('/').to_string()
        } else {
            rest.to_string()
        }
    } else if let Some(colon) = href.find(':') {
        // Any other scheme (javascript:, data:, ms-settings:, …) is not followed. A drive letter
        // (C:\…) is the one exception.
        let is_drive = colon == 1 && href.as_bytes()[0].is_ascii_alphabetic();
        if !is_drive {
            return LinkTarget::Ignored;
        }
        href.to_string()
    } else {
        href.to_string()
    };

    // Drop the anchor and query, then decode (wikilinks are encodeURI'd).
    let without_fragment = local.split(['#', '?']).next().unwrap_or("");
    let decoded = percent_decode(without_fragment);
    if decoded.is_empty() || decoded.contains('\0') {
        return LinkTarget::Ignored;
    }

    let mut path = PathBuf::from(&decoded);
    if path.is_relative() {
        match base_dir {
            Some(base) => path = base.join(path),
            // An unsaved document has no folder to resolve against.
            None => return LinkTarget::NotFound(path),
        }
    }

    // `[[Note]]` and `[x](Note)`: try the Markdown file when the name has no extension.
    if !path.exists() && path.extension().is_none() {
        let with_md = path.with_extension("md");
        if with_md.exists() {
            path = with_md;
        }
    }

    if !path.exists() {
        LinkTarget::NotFound(path)
    } else if is_document(&path) {
        // A Markdown file, or a .textbundle folder.
        LinkTarget::Document(path)
    } else {
        LinkTarget::Reveal(path)
    }
}

/// Shows a file in the system file manager without opening it.
pub fn reveal_in_file_manager(path: &Path) {
    #[cfg(target_os = "windows")]
    {
        let mut select = std::ffi::OsString::from("/select,");
        select.push(path.as_os_str());
        let _ = std::process::Command::new("explorer").arg(select).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn web_and_mail_links_open_externally() {
        assert_eq!(resolve_link("https://example.com/a?b=1#c", None), LinkTarget::External("https://example.com/a?b=1#c".into()));
        assert_eq!(resolve_link("  HTTP://Example.com ", None), LinkTarget::External("HTTP://Example.com".into()));
        assert_eq!(resolve_link("mailto:a@example.com", None), LinkTarget::External("mailto:a@example.com".into()));
        // Cannot be split into several shell arguments.
        assert_eq!(resolve_link("https://a.com/\" --flag", None), LinkTarget::Ignored);
    }

    #[test]
    fn unsafe_and_unknown_schemes_are_ignored() {
        for href in ["javascript:alert(1)", "JaVaScRiPt:x", "data:text/html,x", "vbscript:x", "ms-settings:", "#heading", "", "   "] {
            assert_eq!(resolve_link(href, None), LinkTarget::Ignored, "{href}");
        }
    }

    #[test]
    fn local_links_resolve_against_the_document_folder() {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join("Note.md"), "# note").unwrap();
        fs::write(dir.path().join("한글 문서.md"), "# 한글").unwrap();
        fs::write(dir.path().join("tool.exe"), "MZ").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let base = Some(dir.path());

        assert_eq!(resolve_link("Note.md", base), LinkTarget::Document(dir.path().join("Note.md")));
        // Wikilink without extension, with an anchor.
        assert_eq!(resolve_link("Note#section", base), LinkTarget::Document(dir.path().join("Note.md")));
        // encodeURI'd Korean name with a space.
        assert_eq!(
            resolve_link("%ED%95%9C%EA%B8%80%20%EB%AC%B8%EC%84%9C.md", base),
            LinkTarget::Document(dir.path().join("한글 문서.md"))
        );
        // Never run programs: reveal them.
        assert_eq!(resolve_link("tool.exe", base), LinkTarget::Reveal(dir.path().join("tool.exe")));
        assert_eq!(resolve_link("sub", base), LinkTarget::Reveal(dir.path().join("sub")));
        assert_eq!(resolve_link("missing.md", base), LinkTarget::NotFound(dir.path().join("missing.md")));
        // An unsaved document has no folder.
        assert!(matches!(resolve_link("Note.md", None), LinkTarget::NotFound(_)));
        // Invalid escapes stay as they are.
        assert!(matches!(resolve_link("100%zz.md", base), LinkTarget::NotFound(_)));
    }
}
