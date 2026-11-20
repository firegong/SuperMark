use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static VERSION_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct VersionManager {
    versions_root: PathBuf,
}

impl VersionManager {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            versions_root: data_dir.into().join("Versions"),
        }
    }

    fn bucket_dir_for(&self, file_path: &Path) -> PathBuf {
        let canonical = file_path.to_string_lossy().replace('\\', "/");
        let mut hasher = DefaultHasher::new();
        canonical.hash(&mut hasher);
        let hash = hasher.finish();
        self.versions_root.join(format!("{hash:016x}"))
    }

    /// Saves a version snapshot for `file_path` and returns the version ID.
    pub fn record_version(&self, file_path: &Path, content: &str) -> Result<String, String> {
        let dir = self.bucket_dir_for(file_path);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let seq = VERSION_SEQ.fetch_add(1, Ordering::Relaxed);
        let version_id = format!("v-{millis}-{seq:04}");
        let snap_path = dir.join(format!("{version_id}.md"));
        fs::write(&snap_path, content.as_bytes()).map_err(|e| e.to_string())?;
        Ok(version_id)
    }

    /// Lists all version IDs for `file_path`, sorted newest-first.
    pub fn list_versions(&self, file_path: &Path) -> Vec<String> {
        let dir = self.bucket_dir_for(file_path);
        let Ok(entries) = fs::read_dir(&dir) else {
            return Vec::new();
        };
        let mut versions: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let p = e.path();
                if p.extension().and_then(|ext| ext.to_str()) == Some("md") {
                    p.file_stem()
                        .and_then(|s| s.to_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect();
        versions.sort_by(|a, b| b.cmp(a));
        versions
    }

    /// Version IDs look like `v-<millis>-<seq>`; anything else (e.g. `../x`) could reach files
    /// outside the versions folder, so it is rejected.
    pub fn is_valid_id(version_id: &str) -> bool {
        let mut parts = version_id.split('-');
        parts.next() == Some("v")
            && parts.next().is_some_and(|millis| !millis.is_empty() && millis.bytes().all(|b| b.is_ascii_digit()))
            && parts.next().is_some_and(|seq| !seq.is_empty() && seq.bytes().all(|b| b.is_ascii_digit()))
            && parts.next().is_none()
    }

    /// When a version was saved, in seconds since 1970 (from its ID).
    pub fn version_timestamp(version_id: &str) -> Option<f64> {
        if !Self::is_valid_id(version_id) {
            return None;
        }
        version_id.split('-').nth(1)?.parse::<u64>().ok().map(|millis| millis as f64 / 1000.0)
    }

    /// Deletes the given versions of `file_path` (only those), returning how many were removed.
    pub fn delete_versions(&self, file_path: &Path, version_ids: &[String]) -> Result<usize, String> {
        let dir = self.bucket_dir_for(file_path);
        let mut removed = 0;
        for id in version_ids.iter().filter(|id| Self::is_valid_id(id)) {
            let snap_path = dir.join(format!("{id}.md"));
            if snap_path.exists() {
                fs::remove_file(&snap_path).map_err(|e| e.to_string())?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub fn get_version_content(&self, file_path: &Path, version_id: &str) -> Option<String> {
        if !Self::is_valid_id(version_id) {
            return None;
        }
        let snap_path = self
            .bucket_dir_for(file_path)
            .join(format!("{version_id}.md"));
        fs::read_to_string(snap_path).ok()
    }

    pub fn delete_local_versions(&self, file_path: &Path) -> Result<bool, String> {
        let dir = self.bucket_dir_for(file_path);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_only_the_requested_versions_and_rejects_odd_ids() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = VersionManager::new(tmp.path());
        let doc_path = tmp.path().join("doc.md");
        let v1 = mgr.record_version(&doc_path, "# v1").expect("v1");
        let v2 = mgr.record_version(&doc_path, "# v2").expect("v2");
        let v3 = mgr.record_version(&doc_path, "# v3").expect("v3");

        let removed = mgr
            .delete_versions(&doc_path, &[v2.clone(), "../../doc".to_string(), "v-1-x".to_string()])
            .expect("delete");
        assert_eq!(removed, 1);
        let left = mgr.list_versions(&doc_path);
        assert!(left.contains(&v1) && left.contains(&v3) && !left.contains(&v2));

        assert!(VersionManager::is_valid_id(&v1));
        for id in ["", "v-", "v-12", "v-12-", "x-1-2", "v-1-2-3", "v-1/2-3", "../v-1-2"] {
            assert!(!VersionManager::is_valid_id(id), "{id}");
        }
        assert_eq!(mgr.get_version_content(&doc_path, "../doc"), None);
        assert!(VersionManager::version_timestamp(&v1).unwrap() > 1_600_000_000.0);
    }

    #[test]
    fn records_lists_restores_and_deletes_file_versions() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = VersionManager::new(tmp.path());
        let doc_path = tmp.path().join("doc.md");
        fs::write(&doc_path, "# v1").expect("write initial");

        let v1 = mgr.record_version(&doc_path, "# v1").expect("record v1");
        let v2 = mgr.record_version(&doc_path, "# v2").expect("record v2");

        let versions = mgr.list_versions(&doc_path);
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0], v2);
        assert_eq!(versions[1], v1);

        assert_eq!(
            mgr.get_version_content(&doc_path, &v1).as_deref(),
            Some("# v1")
        );

        assert!(mgr.delete_local_versions(&doc_path).expect("delete versions"));
        assert!(mgr.list_versions(&doc_path).is_empty());
    }
}
