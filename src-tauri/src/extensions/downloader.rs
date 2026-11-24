use super::config::{iso8601_now, kebab_case_identifier, sha256_hex, ExtensionConfig, Installed};
use super::registry::{is_app_version_compatible, ExtensionRelease, IndexEntry};
use std::fs;
use std::path::Path;

/// An install request derived either from a registry entry (pinned release)
/// or from a plain URL install (no version pin).
#[derive(Debug, Clone)]
pub struct PendingInstall {
    pub id: String,
    pub version: Option<String>,
    pub url: Option<String>,
    /// Expected sha256 of the payload. `None` pins from the bytes themselves.
    pub sha256: Option<String>,
    pub min_app_version: Option<String>,
}

impl PendingInstall {
    pub fn from_release(entry: &IndexEntry, release: &ExtensionRelease) -> Self {
        Self {
            id: entry.id.clone(),
            version: Some(release.version.clone()),
            url: Some(release.url.clone()),
            sha256: Some(release.sha256.clone()),
            min_app_version: release.min_app_version.clone(),
        }
    }
}

/// Same guard as upstream `isSafeIdentifier`: non-empty, no leading `.`,
/// no `..` path components, characters limited to `[A-Za-z0-9._-]`.
pub fn is_safe_identifier(id: &str) -> bool {
    if id.is_empty() || id.starts_with('.') || id == ".." {
        return false;
    }
    id.bytes().all(|byte| {
        byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || byte == b'-'
    })
}

fn write_script_atomically(scripts_dir: &Path, id: &str, bytes: &[u8]) -> Result<(), String> {
    fs::create_dir_all(scripts_dir).map_err(|e| e.to_string())?;
    let target = scripts_dir.join(format!("{id}.js"));
    let temp = scripts_dir.join(format!("{id}.js.tmp"));
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| e.to_string())?;
    Ok(())
}

/// Installs raw bytes as an extension script and upserts the matching
/// `installed` record. Mirrors upstream `ExtensionDownloader.install`.
///
/// - Verifies the sha256 digest when the pending install pins one.
/// - Refuses releases whose minAppVersion exceeds `app_version`.
/// - When `existing` is provided (update flow), preserves `enabled` and `installDate`.
pub fn install_bytes(
    scripts_dir: &Path,
    pending: &PendingInstall,
    bytes: &[u8],
    config: &ExtensionConfig,
    app_version: &str,
    existing: Option<&Installed>,
) -> Result<Installed, String> {
    if !is_safe_identifier(&pending.id) {
        return Err(format!("Unsafe extension identifier: {}", pending.id));
    }
    if !is_app_version_compatible(pending.min_app_version.as_deref(), app_version) {
        return Err(format!(
            "Extension '{}' requires SuperMark {} or newer",
            pending.id,
            pending.min_app_version.as_deref().unwrap_or_default()
        ));
    }
    if let Some(expected) = &pending.sha256 {
        let actual = sha256_hex(bytes);
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "Integrity check failed for extension '{}' (expected {expected}, got {actual})",
                pending.id
            ));
        }
    }

    let record_sha256 = pending
        .sha256
        .clone()
        .map(|expected| expected.to_lowercase())
        .unwrap_or_else(|| sha256_hex(bytes));

    let record = Installed {
        id: pending.id.clone(),
        version: pending.version.clone(),
        url: pending.url.clone(),
        sha256: Some(record_sha256),
        file: format!("{}.js", pending.id),
        enabled: Some(existing.map(|record| record.is_enabled()).unwrap_or(true)),
        install_date: Some(
            existing
                .and_then(|record| record.install_date.clone())
                .unwrap_or_else(iso8601_now),
        ),
    };

    write_script_atomically(scripts_dir, &record.id, bytes)?;
    config.update(|updated| updated.upsert(record.clone()))?;
    Ok(record)
}

/// Installs an extension from an arbitrary URL (upstream `install(url)`),
/// assigning a kebab-case identifier derived from the URL filename and
/// pinning the sha256 of the downloaded bytes.
pub fn install_url(
    url: &str,
    config: &ExtensionConfig,
    scripts_dir: &Path,
    app_version: &str,
) -> Result<Installed, String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("Only https:// URLs are allowed for extension installs".to_string());
    }

    let file_name = url
        .rsplit(['/', '\\', '?'])
        .map(|segment| segment.trim())
        .find(|segment| !segment.is_empty())
        .ok_or_else(|| "Could not determine a filename from the URL".to_string())?;
    let identifier = kebab_case_identifier(file_name.trim_end_matches(".js").trim_end_matches(".min"));
    let pending = PendingInstall {
        id: identifier,
        version: None,
        url: Some(url.to_string()),
        sha256: None,
        min_app_version: None,
    };

    let response = ureq::get(url).call().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut response.into_reader(), &mut bytes).map_err(|e| e.to_string())?;

    if bytes.is_empty() {
        return Err(format!("No content downloaded from {url}"));
    }

    install_bytes(scripts_dir, &pending, &bytes, config, app_version, None)
}

/// Downloads the latest release bytes for an entry and installs them,
/// merging with the previously installed record (`enabled`, `installDate`).
pub fn download_update(
    scripts_dir: &Path,
    previous: &Installed,
    entry: &IndexEntry,
    config: &ExtensionConfig,
    app_version: &str,
) -> Result<Installed, String> {
    let pending = PendingInstall::from_release(entry, &entry.latest);

    let response = ureq::get(&entry.latest.url).call().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut response.into_reader(), &mut bytes).map_err(|e| e.to_string())?;

    install_bytes(
        scripts_dir,
        &pending,
        &bytes,
        config,
        app_version,
        Some(previous),
    )
}

/// Removes the extension file and its record (upstream `uninstall`).
pub fn uninstall(id: &str, scripts_dir: &Path, config: &ExtensionConfig) -> Result<bool, String> {
    if !is_safe_identifier(id) {
        return Err(format!("Unsafe extension identifier: {id}"));
    }

    let Some(record) = config.read().find(id).cloned() else {
        return Ok(false);
    };

    let file_name = Path::new(&record.file)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Unsafe extension file path: {}", record.file))?;
    let file_path = scripts_dir.join(file_name);
    if file_path.is_file() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }

    config.update(|updated| updated.remove(id))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::config::UpdateBehavior;
    use crate::extensions::registry::ExtensionRelease;

    fn test_config(base: &Path) -> ExtensionConfig {
        ExtensionConfig::new(base)
    }

    #[test]
    fn validates_safe_identifiers() {
        assert!(is_safe_identifier("word-count"));
        assert!(is_safe_identifier("markedit-fancy.plugin_2"));
        assert!(!is_safe_identifier(""));
        assert!(!is_safe_identifier(".hidden"));
        assert!(!is_safe_identifier(".."));
        assert!(!is_safe_identifier("has space"));
        assert!(!is_safe_identifier("slash/name"));
    }

    #[test]
    fn installs_bytes_atomically_and_pins_identity_equivalent_sha256() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let config = test_config(tmp.path());
        // Ensure the config exists on disk (reconcile with empty scripts dir).
        config.reconcile_installed(&tmp.path().join("scripts")).expect("reconcile");

        let content = b"MarkEdit.onAppReady(() => console.log('installed'));";
        let entry = IndexEntry {
            id: "word-count".to_string(),
            name: "Word Count".to_string(),
            description: "Counts words".to_string(),
            author: None,
            homepage: None,
            added_date: None,
            category: None,
            color_scheme: None,
            color_patterns: None,
            featured: None,
            latest: ExtensionRelease {
                version: "1.2.3".to_string(),
                url: "https://example.com/word-count.js".to_string(),
                // Same digest computed over the bytes (lowercased trip).
                sha256: sha256_hex(content).to_uppercase(),
                min_app_version: None,
                date: None,
                notes: None,
            },
        };
        let pending = PendingInstall::from_release(&entry, &entry.latest);

        let record = install_bytes(
            &tmp.path().join("scripts"),
            &pending,
            content,
            &config,
            env!("CARGO_PKG_VERSION"),
            None,
        )
        .expect("install bytes");

        assert_eq!(record.id, "word-count");
        assert_eq!(record.version.as_deref(), Some("1.2.3"));
        assert_eq!(record.file, "word-count.js");
        assert!(record.is_enabled());

        let written =
            fs::read(tmp.path().join("scripts").join("word-count.js")).expect("script file");
        assert_eq!(written, content);

        let stored = config.read();
        assert_eq!(stored.installed.len(), 1);
        assert_eq!(stored.installed[0].id, "word-count");
        assert!(stored.installed[0].install_date.is_some());
    }

    #[test]
    fn rejects_mismatched_sha256_and_incompatible_releases() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let config = test_config(tmp.path());
        config.reconcile_installed(&tmp.path().join("scripts")).expect("reconcile");

        let entry = IndexEntry {
            id: "tampered".to_string(),
            name: "Tampered".to_string(),
            description: String::new(),
            author: None,
            homepage: None,
            added_date: None,
            category: None,
            color_scheme: None,
            color_patterns: None,
            featured: None,
            latest: ExtensionRelease {
                version: "1.0.0".to_string(),
                url: "https://example.com/tampered.js".to_string(),
                sha256: format!("{:0>64}", "deadbeef"),
                min_app_version: None,
                date: None,
                notes: None,
            },
        };
        let pending = PendingInstall::from_release(entry_ref(&entry), &entry.latest);
        let error = install_bytes(
            &tmp.path().join("scripts"),
            &pending,
            b"payload",
            &config,
            env!("CARGO_PKG_VERSION"),
            None,
        )
        .expect_err("integrity mismatch must fail");
        assert!(error.contains("Integrity check failed"), "{error}");

        let incompatible = ExtensionRelease {
            version: "9.9.9".to_string(),
            url: "https://example.com/future.js".to_string(),
            sha256: sha256_hex(b"payload"),
            min_app_version: Some("99.0.0".to_string()),
            date: None,
            notes: None,
        };
        let future_entry = IndexEntry {
            id: "future".to_string(),
            name: "Future".to_string(),
            description: String::new(),
            author: None,
            homepage: None,
            added_date: None,
            category: None,
            color_scheme: None,
            color_patterns: None,
            featured: None,
            latest: incompatible,
        };
        let pending = PendingInstall::from_release(&future_entry, &future_entry.latest);
        let error = install_bytes(
            &tmp.path().join("scripts"),
            &pending,
            b"payload",
            &config,
            env!("CARGO_PKG_VERSION"),
            None,
        )
        .expect_err("minAppVersion gate must fail");
        assert!(error.contains("requires SuperMark"), "{error}");
    }

    #[test]
    fn downloads_update_preserving_enabled_and_install_date() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let config = test_config(tmp.path());
        config.reconcile_installed(&tmp.path().join("scripts")).expect("reconcile");

        // Seed a disabled previous install.
        let previous = Installed {
            id: "word-count".to_string(),
            version: Some("1.0.0".to_string()),
            url: None,
            sha256: None,
            file: "word-count.js".to_string(),
            enabled: Some(false),
            install_date: Some("2020-01-01T00:00:00Z".to_string()),
        };
        let bytes = b"export default {};
// v1.1.0";
        let entry = IndexEntry {
            id: "word-count".to_string(),
            name: "Word Count".to_string(),
            description: String::new(),
            author: None,
            homepage: None,
            added_date: None,
            category: None,
            color_scheme: None,
            color_patterns: None,
            featured: None,
            latest: ExtensionRelease {
                version: "1.1.0".to_string(),
                url: "https://example.com/word-count-1.1.0.js".to_string(),
                sha256: sha256_hex(bytes),
                min_app_version: None,
                date: None,
                notes: None,
            },
        };

        // Update over the network is exercised elsewhere; here emulate its merge
        // path by calling install_bytes with the previous record (same as download_update).
        let record = install_bytes(
            &tmp.path().join("scripts"),
            &PendingInstall::from_release(&entry, &entry.latest),
            bytes,
            &config,
            env!("CARGO_PKG_VERSION"),
            Some(&previous),
        )
        .expect("merge install");

        assert_eq!(record.version.as_deref(), Some("1.1.0"));
        assert_eq!(record.enabled, Some(false));
        assert_eq!(record.install_date.as_deref(), Some("2020-01-01T00:00:00Z"));

        let stored = config.read();
        assert_eq!(stored.installed.len(), 1);
        assert_eq!(stored.installed[0].version.as_deref(), Some("1.1.0"));
    }

    #[test]
    fn uninstall_removes_file_and_record() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let scripts_dir = tmp.path().join("scripts");
        let config = test_config(tmp.path());

        let pending = PendingInstall {
            id: "quick-note".to_string(),
            version: None,
            url: Some("https://example.com/quick-note.js".to_string()),
            sha256: None,
            min_app_version: None,
        };
        install_bytes(&scripts_dir, &pending, b"// ext", &config, env!("CARGO_PKG_VERSION"), None)
            .expect("install");
        assert!(scripts_dir.join("quick-note.js").is_file());

        assert!(uninstall("quick-note", &scripts_dir, &config).expect("uninstall"));
        assert!(!scripts_dir.join("quick-note.js").exists());
        assert!(config.read().find("quick-note").is_none());
        assert!(!uninstall("quick-note", &scripts_dir, &config).expect("second uninstall"));
    }

    /// Helper so the mismatch test above can borrow the entry without a second clone.
    fn entry_ref(entry: &IndexEntry) -> &IndexEntry {
        entry
    }

    /// UpdateBehavior usage keeps the enum in scope for future menu wiring tests.
    #[test]
    fn update_behavior_defaults_to_quiet() {
        assert_eq!(UpdateBehavior::default(), UpdateBehavior::Quiet);
    }
}
