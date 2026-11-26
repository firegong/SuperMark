use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Normalizes a path so that the same file is recognized regardless of
/// Windows UNC prefixes (`\\?\C:\...` vs `C:\...`) or separator differences.
pub fn normalize_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
    // UNC server paths: \\?\UNC\server\share → \\server\share
    let s = s.strip_prefix("UNC\\").map(|rest| format!(r"\\{rest}")).unwrap_or_else(|| s.to_string());
    // Normalize separators to forward slashes for comparison stability.
    PathBuf::from(s.replace('\\', "/"))
}

pub struct ExternalFileWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<std::collections::HashSet<PathBuf>>>,
    /// Paths we recently saved ourselves; the watcher ignores them for ~2s
    /// so our own writes do not trigger a reload prompt.
    ignored: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl ExternalFileWatcher {
    pub fn new<F>(on_modified: F) -> Result<Self, String>
    where
        F: Fn(PathBuf) + Send + Sync + 'static,
    {
        let watched_paths = Arc::new(Mutex::new(std::collections::HashSet::new()));
        let ignored = Arc::new(Mutex::new(HashMap::new()));
        let ignored_cb = ignored.clone();
        let callback = Arc::new(on_modified);

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() {
                        for path in event.paths {
                            let norm = normalize_path(&path);
                            // First filter: ignore self-saves.
                            {
                                let mut guard = ignored_cb.lock().expect("ignored lock");
                                // Expire old entries.
                                let now = Instant::now();
                                guard.retain(|_, expiry| *expiry > now);
                                if guard.contains_key(&norm) {
                                    continue;
                                }
                            }
                            callback(norm);
                        }
                    }
                }
            },
            Config::default(),
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            watcher: Mutex::new(Some(watcher)),
            watched_paths,
            ignored,
        })
    }

    pub fn watch(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let target = normalize_path(path.as_ref());
        let mut guard = self.watcher.lock().expect("watcher lock");
        if let Some(watcher) = guard.as_mut() {
            watcher
                .watch(path.as_ref(), RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            self.watched_paths
                .lock()
                .expect("watched_paths lock")
                .insert(target);
        }
        Ok(())
    }

    pub fn unwatch(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let target = normalize_path(path.as_ref());
        let mut guard = self.watcher.lock().expect("watcher lock");
        if let Some(watcher) = guard.as_mut() {
            let _ = watcher.unwatch(path.as_ref());
            self.watched_paths
                .lock()
                .expect("watched_paths lock")
                .remove(&target);
        }
        Ok(())
    }

    pub fn is_watching(&self, path: impl AsRef<Path>) -> bool {
        let target = normalize_path(path.as_ref());
        self.watched_paths
            .lock()
            .expect("watched_paths lock")
            .contains(&target)
    }

    /// Mark a path as recently saved by us; the watcher ignores it for ~2s.
    pub fn ignore(&self, path: impl AsRef<Path>) {
        let target = normalize_path(path.as_ref());
        let mut guard = self.ignored.lock().expect("ignored lock");
        guard.insert(target, Instant::now() + Duration::from_secs(2));
    }

    /// Check if a path is currently ignored (self-save).
    pub fn is_ignored(&self, path: impl AsRef<Path>) -> bool {
        let target = normalize_path(path.as_ref());
        let mut guard = self.ignored.lock().expect("ignored lock");
        let now = Instant::now();
        guard.retain(|_, expiry| *expiry > now);
        guard.contains_key(&target)
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_path;
    use std::path::PathBuf;

    #[test]
    fn normalize_strips_unc_prefix() {
        let p = PathBuf::from(r"\\?\C:\foo\bar.md");
        assert_eq!(normalize_path(&p), PathBuf::from("C:/foo/bar.md"));
    }

    #[test]
    fn normalize_converts_backslashes() {
        let p = PathBuf::from(r"C:\foo\bar\baz.md");
        assert_eq!(normalize_path(&p), PathBuf::from("C:/foo/bar/baz.md"));
    }

    #[test]
    fn normalize_unc_server_path() {
        let p = PathBuf::from(r"\\?\UNC\server\share\file.md");
        assert_eq!(normalize_path(&p), PathBuf::from("//server/share/file.md"));
    }

    #[test]
    fn normalize_leaves_forward_slashes() {
        let p = PathBuf::from("/tmp/foo.md");
        assert_eq!(normalize_path(&p), PathBuf::from("/tmp/foo.md"));
    }
}
