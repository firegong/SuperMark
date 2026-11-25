//! `extensions.json` config mirroring upstream MarkEdit's `ExtensionConfig.swift`.
//!
//! Shape:
//! ```json
//! {
//!   "$schema": "https://raw.githubusercontent.com/MarkEdit-app/schemas/main/extensions.json",
//!   "registry.url": "https://raw.githubusercontent.com/firegong/SuperMark-extensions/main/index.json",
//!   "registry.updateBehavior": "quiet",
//!   "installed": [
//!     { "id": "...", "version": null, "url": null, "sha256": "...", "file": "....js",
//!       "enabled": false, "installDate": "ISO-8601" }
//!   ]
//! }
//! ```
//!
//! Like upstream, the config is read fresh from disk on every access and the
//! filesystem remains the source of truth during reconciliation.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/firegong/SuperMark-extensions/main/index.json";
pub const SCHEMA_URL: &str =
    "https://raw.githubusercontent.com/MarkEdit-app/schemas/main/extensions.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum UpdateBehavior {
    Never,
    #[default]
    Quiet,
    Notify,
    Automatic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Installed {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    pub file: String,
    /// Absent (`None`) means enabled, same as upstream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(rename = "installDate", skip_serializing_if = "Option::is_none")]
    pub install_date: Option<String>,
}

impl Installed {
    /// Absent `enabled` means enabled (upstream semantics).
    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema_url: Option<String>,
    #[serde(rename = "registry.url", skip_serializing_if = "Option::is_none")]
    pub registry_url: Option<String>,
    #[serde(rename = "registry.updateBehavior", skip_serializing_if = "Option::is_none")]
    pub update_behavior: Option<UpdateBehavior>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub installed: Vec<Installed>,
    /// Built-in extensions (see `extensions::BUILTIN_EXTENSIONS`) the user turned off.
    #[serde(rename = "builtin.disabled", default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_builtins: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            schema_url: Some(SCHEMA_URL.to_string()),
            registry_url: Some(DEFAULT_REGISTRY_URL.to_string()),
            update_behavior: Some(UpdateBehavior::Quiet),
            installed: Vec::new(),
            disabled_builtins: Vec::new(),
        }
    }
}

impl Config {
    pub fn registry_url(&self) -> &str {
        self.registry_url.as_deref().unwrap_or(DEFAULT_REGISTRY_URL)
    }

    pub fn update_behavior(&self) -> UpdateBehavior {
        self.update_behavior.unwrap_or_default()
    }

    pub fn upsert(&mut self, record: Installed) {
        self.installed.retain(|existing| existing.id != record.id);
        self.installed.push(record);
    }

    pub fn remove(&mut self, id: &str) {
        self.installed.retain(|existing| existing.id != id);
    }

    pub fn find(&self, id: &str) -> Option<&Installed> {
        self.installed.iter().find(|existing| existing.id == id)
    }
}

/// A single extensions.json document on disk with fresh-read/atomic-write semantics.
#[derive(Debug, Clone)]
pub struct ExtensionConfig {
    path: PathBuf,
}

impl ExtensionConfig {
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        Self {
            path: base_dir.as_ref().join("extensions.json"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Read fresh from disk on every access (upstream semantics).
    pub fn read(&self) -> Config {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn write(&self, config: &Config) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        let tmp_path = self.path.with_extension("json.tmp");
        fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &self.path).map_err(|e| e.to_string())
    }

    /// Mutate helper: read fresh → mutate → persist atomically.
    pub fn update<R>(&self, mutate: impl FnOnce(&mut Config) -> R) -> Result<R, String> {
        let mut config = self.read();
        let result = mutate(&mut config);
        self.write(&config)?;
        Ok(result)
    }

    /// Reconcile `installed` with the filesystem (upstream `reconcileInstalled`):
    /// drop records whose file was removed, adopt untracked sorted `.js` files.
    pub fn reconcile_installed(&self, scripts_dir: &Path) -> Result<Config, String> {
        self.update(|config| {
            let tracked_files: Vec<String> = config
                .installed
                .iter()
                .map(|record| record.file.clone())
                .collect();

            // 1. Drop records whose backing file is gone.
            config
                .installed
                .retain(|record| scripts_dir.join(&record.file).is_file());

            // 2. Adopt untracked scripts, in sorted (discovery) order.
            let mut untracked: Vec<PathBuf> = fs::read_dir(scripts_dir)
                .map(|entries| {
                    entries
                        .filter_map(|entry| entry.ok())
                        .map(|entry| entry.path())
                        .filter(|path| {
                            path.is_file()
                                && path
                                    .extension()
                                    .and_then(|ext| ext.to_str())
                                    .map(|ext| ext.eq_ignore_ascii_case("js"))
                                    .unwrap_or(false)
                        })
                        .collect()
                })
                .unwrap_or_default();
            untracked.sort();

            for file_path in untracked {
                let Some(file_name) = file_path.file_name().and_then(|name| name.to_str()) else {
                    continue;
                };
                if tracked_files.iter().any(|tracked| tracked == file_name) {
                    continue;
                }

                let bytes = fs::read(&file_path).unwrap_or_default();
                config.installed.push(Installed {
                    id: kebab_case_identifier(file_name),
                    version: None,
                    url: None,
                    sha256: Some(sha256_hex(&bytes)),
                    file: file_name.to_string(),
                    enabled: None,
                    install_date: Some(iso8601_now()),
                });
            }

            config.clone()
        })
    }
}

/// Convert a file name into a kebab-case extension id (upstream `kebab-case` id rule).
pub fn kebab_case_identifier(name: &str) -> String {
    // Upstream derives identifiers from the file name WITHOUT its extension.
    let trimmed = name.strip_suffix(".js").unwrap_or(name);
    let mut out = String::new();
    let mut previous_dash = true;
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            previous_dash = false;
            out.push(ch.to_ascii_lowercase());
        } else {
            if previous_dash {
                continue;
            }
            previous_dash = true;
            out.push('-');
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("extension");
    }
    out
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

static EPOCH_SEQ: AtomicU64 = AtomicU64::new(1);

/// Current time as ISO-8601 UTC without external crates.
pub fn iso8601_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    iso8601_from_unix_millis(millis, EPOCH_SEQ.fetch_add(1, Ordering::Relaxed) % 1000)
}

pub fn iso8601_from_unix_millis(millis: u64, _sub: u64) -> String {
    let secs = millis / 1000;
    let days = (secs / 86_400) as i64;
    let secs_of_day = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_config_with_upstream_keys() {
        let dir = tempfile::tempdir().unwrap();
        let store = ExtensionConfig::new(dir.path());

        let mut config = store.read();
        assert_eq!(config.registry_url(), DEFAULT_REGISTRY_URL);
        assert_eq!(config.update_behavior(), UpdateBehavior::Quiet);
        assert!(config.installed.is_empty());

        config.installed.push(Installed {
            id: "word-count".into(),
            version: Some("1.2.0".into()),
            url: Some("https://github.com/example/word-count/releases/1.2.0/word-count.js".into()),
            sha256: Some("abc123".into()),
            file: "word-count.js".into(),
            enabled: Some(false),
            install_date: Some("2026-11-09T00:00:00Z".into()),
        });
        config.update_behavior = Some(UpdateBehavior::Notify);
        store.write(&config).unwrap();

        let reloaded = store.read();
        assert_eq!(reloaded.update_behavior(), UpdateBehavior::Notify);
        assert_eq!(reloaded.installed.len(), 1);
        let record = &reloaded.installed[0];
        assert_eq!(record.id, "word-count");
        assert!(matches!(record.enabled, Some(false)));
        assert!(!record.is_enabled());

        let serialized = serde_json::to_string_pretty(&reloaded).unwrap();
        assert!(serialized.contains("\"$schema\""));
        assert!(serialized.contains("\"registry.url\""));
        assert!(serialized.contains("\"registry.updateBehavior\""));
        assert!(serialized.contains("\"installDate\""));
    }

    #[test]
    fn reconciles_drop_and_adopt() {
        let dir = tempfile::tempdir().unwrap();
        let scripts_dir = dir.path().join("scripts");
        fs::create_dir_all(&scripts_dir).unwrap();

        fs::write(scripts_dir.join("Tracked Ext.js"), "// tracked").unwrap();
        fs::write(scripts_dir.join("zeta.js"), "// zeta").unwrap();
        fs::write(scripts_dir.join("alpha.js"), "// alpha").unwrap();
        let _removed = dir.path().join("scripts").join("removed.js");
        // 'removed.js' is referenced by config but will not exist on disk.

        let store = ExtensionConfig::new(dir.path());
        store
            .update(|config| {
                config.installed.push(Installed {
                    id: "removed".into(),
                    version: None,
                    url: None,
                    sha256: None,
                    file: "removed.js".into(),
                    enabled: None,
                    install_date: None,
                });
            })
            .unwrap();

        let config = store.reconcile_installed(&scripts_dir).unwrap();
        let ids: Vec<&str> = config.installed.iter().map(|r| r.id.as_str()).collect();
        // Removed record dropped; untracked files adopted in sorted (byte) order
        // 'Tracked Ext.js' < 'alpha.js' < 'zeta.js'.
        assert_eq!(ids, vec!["tracked-ext", "alpha", "zeta"]);
        assert!(config.find("alpha").unwrap().sha256.is_some());
        assert!(config.find("alpha").unwrap().install_date.is_some());
    }

    #[test]
    fn kebab_ids_and_hashes_match_upstream_rules() {
        assert_eq!(kebab_case_identifier("Tracked Ext.js"), "tracked-ext");
        assert_eq!(kebab_case_identifier("My_Tool-Kit.js"), "my-tool-kit");
        assert_eq!(kebab_case_identifier(".hidden.js"), "hidden");
        // Upstream reference: sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
