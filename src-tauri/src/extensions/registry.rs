//! Remote extension registry mirroring upstream `ExtensionRegistry.swift`.
//!
//! - Registry index shape: `{ schemaVersion, extensions: [...] }` (schemaVersion <= 1 supported).
//! - Cache: `<cache>/extensions/index.json` + `metadata.json` (`etag`, `lastChecked`, `lastPrompted`).
//! - Conditional GET with `If-None-Match`; 304 keeps the cached index.
//! - Numeric `version` compare for update detection; `minAppVersion` gate.
use super::config::{ExtensionConfig, UpdateBehavior};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

/// Upstream default: background refresh interval of 1h, prompt interval of 1 day.
pub const INDEX_TTL_SECS: u64 = 60 * 60;
pub const PROMPT_INTERVAL_SECS: u64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionRelease {
    pub version: String,
    pub url: String,
    pub sha256: String,
    #[serde(rename = "minAppVersion", default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Extension,
    Theme,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(rename = "addedDate", default, skip_serializing_if = "Option::is_none")]
    pub added_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<Category>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub featured: Option<bool>,
    pub latest: ExtensionRelease,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryIndex {
    #[serde(rename = "schemaVersion", default)]
    pub schema_version: u32,
    pub extensions: Vec<IndexEntry>,
}

impl RegistryIndex {
    /// Upstream supports schemaVersion <= 1.
    pub fn is_supported(&self) -> bool {
        self.schema_version <= 1
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CacheMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(default)]
    pub last_checked: Option<u64>,
    #[serde(default)]
    pub last_prompted: Option<u64>,
}

pub fn numeric_version_compare(a: &str, b: &str) -> std::cmp::Ordering {
    let parse = |value: &str| -> Vec<u64> {
        value
            .split('.')
            .map(|part| part.chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>())
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (left, right) = (parse(a), parse(b));
    let len = left.len().max(right.len());
    for index in 0..len {
        let l = left.get(index).copied().unwrap_or(0);
        let r = right.get(index).copied().unwrap_or(0);
        if l != r {
            return l.cmp(&r);
        }
    }
    std::cmp::Ordering::Equal
}

/// Upstream `minAppVersion` gate: compatible when min <= appVersion.
pub fn is_app_version_compatible(min_app_version: Option<&str>, app_version: &str) -> bool {
    match min_app_version {
        Some(min) => numeric_version_compare(min, app_version) != std::cmp::Ordering::Greater,
        None => true,
    }
}

pub struct ExtensionRegistry {
    cache_dir: PathBuf,
    registry_url: String,
    app_version: String,
}

impl ExtensionRegistry {
    pub fn new(cache_dir: impl Into<PathBuf>, registry_url: impl Into<String>, app_version: impl Into<String>) -> Self {
        Self {
            cache_dir: cache_dir.into(),
            registry_url: registry_url.into(),
            app_version: app_version.into(),
        }
    }

    pub fn index_cache_path(&self) -> PathBuf {
        self.cache_dir.join("index.json")
    }

    pub fn metadata_cache_path(&self) -> PathBuf {
        self.cache_dir.join("metadata.json")
    }

    fn read_metadata(&self) -> CacheMetadata {
        fs::read_to_string(self.metadata_cache_path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn write_metadata(&self, metadata: &CacheMetadata) -> Result<(), String> {
        fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(metadata).map_err(|e| e.to_string())?;
        fs::write(self.metadata_cache_path(), json).map_err(|e| e.to_string())
    }

    /// Cached index, decoded and schema-checked; `None` on miss/unsupported schema.
    pub fn cached_index(&self) -> Option<RegistryIndex> {
        let raw = fs::read_to_string(self.index_cache_path()).ok()?;
        let index: RegistryIndex = serde_json::from_str(&raw).ok()?;
        index.is_supported().then_some(index)
    }

    pub fn pending_updates(&self, config: &ExtensionConfig) -> Vec<(super::config::Installed, IndexEntry)> {
        let Some(index) = self.cached_index() else {
            return Vec::new();
        };

        let config = config.read();
        let mut updates = Vec::new();
        for record in &config.installed {
            let Some(entry) = index.extensions.iter().find(|entry| entry.id == record.id) else {
                continue;
            };
            let should_migrate = record.version.is_none() && record.id.starts_with("markedit-");
            let is_newer = match &record.version {
                Some(current) => {
                    numeric_version_compare(&entry.latest.version, current) == std::cmp::Ordering::Greater
                }
                None => should_migrate,
            };
            let compatible = is_app_version_compatible(
                entry.latest.min_app_version.as_deref(),
                &self.app_version,
            );

            if is_newer && compatible {
                updates.push((record.clone(), entry.clone()));
            }
        }
        updates
    }

    /// Refresh the index cache (upstream `refresh`).
    ///
    /// - `force`: manual menu action bypasses TTL.
    /// - `never` behavior blocks background refresh only.
    /// - Success stores bytes + etag; 304 keeps cache and touches lastChecked.
    /// - Errors fall back to the cached index (matches upstream).
    pub fn refresh(&self, force: bool, blocking_behavior: bool) -> Result<Option<RegistryIndex>, String> {
        if blocking_behavior && !force {
            return Ok(self.cached_index());
        }

        let metadata = self.read_metadata();
        let now = unix_now();
        if !force {
            if let Some(last_checked) = metadata.last_checked {
                if now.saturating_sub(last_checked) < INDEX_TTL_SECS {
                    return Ok(self.cached_index());
                }
            }
        }

        let request = ureq::get(&self.registry_url);
        let response = match &metadata.etag {
            Some(etag) => request.set("If-None-Match", etag).call(),
            None => request.call(),
        };

        match response {
            Ok(response) => {
                let etag = response.header("etag").map(|value| value.to_string());
                let mut bytes = Vec::new();
                response.into_reader().read_to_end(&mut bytes).map_err(|e| e.to_string())?;

                // Validate decodability before persisting.
                let index: RegistryIndex =
                    serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                if !index.is_supported() {
                    return Ok(self.cached_index());
                }

                fs::create_dir_all(&self.cache_dir).map_err(|e| e.to_string())?;
                fs::write(self.index_cache_path(), &bytes).map_err(|e| e.to_string())?;
                self.write_metadata(&CacheMetadata {
                    etag,
                    last_checked: Some(now),
                    last_prompted: metadata.last_prompted,
                })?;

                Ok(Some(index))
            }
            Err(ureq::Error::Status(code, _)) if code == 304 => {
                self.write_metadata(&CacheMetadata {
                    etag: metadata.etag,
                    last_checked: Some(now),
                    last_prompted: metadata.last_prompted,
                })?;
                Ok(self.cached_index())
            }
            Err(_) => Ok(self.cached_index()), // Network error → cached index fallback.
        }
    }

    /// Whether an update prompt may fire now (notify/automatic only, once per day,
    /// only when every pending update satisfies the app-version gate).
    pub fn should_prompt_updates(&self, behavior: UpdateBehavior, updates_count: usize) -> bool {
        if !matches!(behavior, UpdateBehavior::Notify | UpdateBehavior::Automatic) || updates_count == 0 {
            return false;
        }
        let metadata = self.read_metadata();
        let now = unix_now();
        match metadata.last_prompted {
            Some(last) => now.saturating_sub(last) >= PROMPT_INTERVAL_SECS,
            None => true,
        }
    }

    pub fn mark_prompted(&self) {
        let mut metadata = self.read_metadata();
        metadata.last_prompted = Some(unix_now());
        let _ = self.write_metadata(&metadata);
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::config::{Installed, SCHEMA_URL};
    use std::cmp::Ordering;

    fn sample_index(schema_version: u32) -> String {
        format!(
            r#"{{ "schemaVersion": {schema_version}, "extensions": [
                {{
                    "id": "markedit-focus-mode", "name": "Focus Mode", "description": "d",
                    "author": "someone", "homepage": "https://example.com",
                    "addedDate": "2026-01-02", "category": "extension", "featured": true,
                    "latest": {{ "version": "2.0.1", "date": "2026-10-01", "url": "https://example.com/focus-mode.js", "sha256": "aabb", "minAppVersion": "0.1.0", "notes": "n" }}
                }},
                {{
                    "id": "quill-theme", "name": "Quill", "description": "d", "category": "theme",
                    "latest": {{ "version": "1.0.0", "date": "2026-09-01", "url": "https://example.com/quill.js", "sha256": "ccdd" }}
                }}
            ] }}"#
        )
    }

    #[test]
    fn decodes_live_registry_shape_and_supports_schema_gate() {
        let index: RegistryIndex = serde_json::from_str(&sample_index(1)).unwrap();
        assert!(index.is_supported());
        assert_eq!(index.extensions.len(), 2);
        assert_eq!(index.extensions[0].latest.version, "2.0.1");
        assert_eq!(index.extensions[1].category, Some(Category::Theme));

        let legacy: RegistryIndex = serde_json::from_str(&sample_index(2)).unwrap();
        assert!(!legacy.is_supported());
    }

    #[test]
    fn numeric_compare_and_min_app_gate() {
        assert_eq!(numeric_version_compare("2.0.1", "2.0.0"), Ordering::Greater);
        assert_eq!(numeric_version_compare("1.10", "1.9"), Ordering::Greater);
        assert_eq!(numeric_version_compare("1.2", "1.2.0"), Ordering::Equal);
        assert_eq!(numeric_version_compare("2.0", "2"), Ordering::Equal);

        assert!(is_app_version_compatible(Some("0.1.0"), "0.1.0"));
        assert!(is_app_version_compatible(Some("0.0.9"), "0.1.0"));
        assert!(!is_app_version_compatible(Some("0.2.0"), "0.1.0"));
        assert!(is_app_version_compatible(None, "0.1.0"));
    }

    #[test]
    fn pending_updates_match_ids_and_migration_rule() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("caches");
        let _ = fs::create_dir_all(&cache);
        fs::write(cache.join("index.json"), sample_index(1)).unwrap();

        let config = ExtensionConfig::new(dir.path().join("data"));
        config
            .update(|c| {
                c.installed = vec![
                    Installed { id: "markedit-focus-mode".into(), version: Some("1.0.0".into()), url: None, sha256: None, file: "markedit-focus-mode.js".into(), enabled: None, install_date: None },
                    Installed { id: "quill-theme".into(), version: None, url: None, sha256: None, file: "quill-theme.js".into(), enabled: None, install_date: None },
                ];
            })
            .unwrap();

        let registry = ExtensionRegistry::new(dir.path().join("caches"), SCHEMA_URL, "0.1.0");
        let updates = registry.pending_updates(&config);
        // 2.0.1 > 1.0.0 → update; version-less 'quill-theme' has no markedit- prefix → skipped.
        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].0.id, "markedit-focus-mode");
        assert_eq!(updates[0].1.name, "Focus Mode");
    }

    #[test]
    fn should_prompt_respects_behavior_and_daily_interval() {
        let dir = tempfile::tempdir().unwrap();
        let registry = ExtensionRegistry::new(dir.path(), "registry", "0.1.0");

        // Quiet/never never prompt.
        assert!(!registry.should_prompt_updates(UpdateBehavior::Quiet, 2));
        assert!(!registry.should_prompt_updates(UpdateBehavior::Never, 2));
        // Notify prompts when nothing prompted yet.
        assert!(registry.should_prompt_updates(UpdateBehavior::Notify, 1));
        // ...but not again within one day.
        registry.metadata_cache_path();
        registry.mark_prompted();
        assert!(!registry.should_prompt_updates(UpdateBehavior::Notify, 1));
    }
}
