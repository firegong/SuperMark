use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct ExternalFileWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl ExternalFileWatcher {
    pub fn new<F>(on_modified: F) -> Result<Self, String>
    where
        F: Fn(PathBuf) + Send + Sync + 'static,
    {
        let watched_paths = Arc::new(Mutex::new(HashSet::new()));
        let callback = Arc::new(on_modified);

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() {
                        for path in event.paths {
                            callback(path);
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
        })
    }

    pub fn watch(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let target = path.as_ref().to_path_buf();
        let mut guard = self.watcher.lock().expect("watcher lock");
        if let Some(watcher) = guard.as_mut() {
            watcher
                .watch(&target, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            self.watched_paths
                .lock()
                .expect("watched_paths lock")
                .insert(target);
        }
        Ok(())
    }

    pub fn unwatch(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let target = path.as_ref().to_path_buf();
        let mut guard = self.watcher.lock().expect("watcher lock");
        if let Some(watcher) = guard.as_mut() {
            let _ = watcher.unwatch(&target);
            self.watched_paths
                .lock()
                .expect("watched_paths lock")
                .remove(&target);
        }
        Ok(())
    }

    pub fn is_watching(&self, path: impl AsRef<Path>) -> bool {
        self.watched_paths
            .lock()
            .expect("watched_paths lock")
            .contains(path.as_ref())
    }
}
