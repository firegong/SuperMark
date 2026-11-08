use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

/// Provides persistent secret storage for `MarkEdit.secretStorage` (`NativeModuleSecretStorage`).
pub struct SecretStorageManager {
    secrets_file: PathBuf,
    cache: Mutex<HashMap<String, String>>,
}

impl SecretStorageManager {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        let secrets_file = data_dir.into().join("secrets.json");
        let loaded = fs::read_to_string(&secrets_file)
            .ok()
            .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
            .unwrap_or_default();

        Self {
            secrets_file,
            cache: Mutex::new(loaded),
        }
    }

    fn flush(&self, map: &HashMap<String, String>) -> bool {
        if let Some(parent) = self.secrets_file.parent() {
            if fs::create_dir_all(parent).is_err() {
                return false;
            }
        }
        let Ok(json_str) = serde_json::to_string_pretty(map) else {
            return false;
        };
        fs::write(&self.secrets_file, json_str).is_ok()
    }

    pub fn has(&self, key: &str) -> bool {
        let guard = self.cache.lock().expect("SecretStorage lock");
        guard.contains_key(key)
    }

    pub fn get(&self, key: &str) -> Option<String> {
        let guard = self.cache.lock().expect("SecretStorage lock");
        guard.get(key).cloned()
    }

    pub fn set(&self, key: &str, value: &str) -> bool {
        let mut guard = self.cache.lock().expect("SecretStorage lock");
        guard.insert(key.to_string(), value.to_string());
        self.flush(&guard)
    }

    pub fn delete(&self, key: &str) -> bool {
        let mut guard = self.cache.lock().expect("SecretStorage lock");
        guard.remove(key);
        self.flush(&guard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_storage_crud_persists_to_disk() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let store = SecretStorageManager::new(tmp.path());

        assert!(!store.has("api_token"));
        assert!(store.set("api_token", "secret-12345"));
        assert!(store.has("api_token"));
        assert_eq!(store.get("api_token").as_deref(), Some("secret-12345"));

        // Reload from disk
        let store2 = SecretStorageManager::new(tmp.path());
        assert!(store2.has("api_token"));
        assert_eq!(store2.get("api_token").as_deref(), Some("secret-12345"));

        assert!(store2.delete("api_token"));
        assert!(!store2.has("api_token"));
        assert_eq!(store2.get("api_token"), None);
    }
}
