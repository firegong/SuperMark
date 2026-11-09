pub mod config;
pub mod downloader;
pub mod registry;

pub use config::{Config, ExtensionConfig, UpdateBehavior};
pub use downloader::{install_bytes, install_url, is_safe_identifier, uninstall, PendingInstall};
pub use registry::{ExtensionRegistry, IndexEntry, RegistryIndex};

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ScriptDescriptor {
    pub path: String,
    pub capability: String,
}

/// Mirror of upstream `EditorUserAsset.applyThemePatch` — dirty patch for the
/// CodeMirror circular-reference issue in legacy themes (`markedit-theme-*.js`).
/// Idempotent: skipped when the theme is already patched (`circularReferencePatched`).
fn apply_theme_patch(contents: &str) -> String {
    if contents.contains("circularReferencePatched") {
        return contents.to_string();
    }

    // Matches `)":"extension"in (.+?)\?` and rewrites it to guard against self-reference.
    let needle = "):\"extension\"in ";
    let mut out = String::with_capacity(contents.len());
    let mut rest = contents;

    loop {
        let Some(pos) = rest.find(needle) else { break };
        let after = &rest[pos + needle.len()..];
        let Some(q) = after.find('?') else { break };
        if q == 0 {
            // `.+` requires at least one character; keep scanning past this occurrence.
            out.push_str(&rest[..pos + needle.len()]);
            rest = after;
            continue;
        }

        let theme = &after[..q];
        out.push_str(&rest[..pos]); // text before the match
        out.push_str(&format!("):(\"extension\"in {theme}&&{theme}.extension!=={theme})?"));
        rest = &after[q + 1..];
    }

    out.push_str(rest);
    out
}

fn is_theme_script(file_name: &str) -> bool {
    file_name.to_lowercase().starts_with("markedit-theme-")
}

#[derive(Debug, Clone)]
pub struct ExtensionManager {
    data_dir: PathBuf,
}

impl ExtensionManager {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
        }
    }

    pub fn config(&self) -> ExtensionConfig {
        ExtensionConfig::new(&self.data_dir)
    }

    pub fn registry_cache_dir(&self) -> PathBuf {
        self.data_dir.join("cache")
    }

    pub fn scripts_dir(&self) -> PathBuf {
        self.data_dir.join("scripts")
    }

    pub fn styles_dir(&self) -> PathBuf {
        self.data_dir.join("styles")
    }

    pub fn ensure_directories(&self) -> Result<(), String> {
        fs::create_dir_all(self.scripts_dir()).map_err(|e| e.to_string())?;
        fs::create_dir_all(self.styles_dir()).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_sorted_files(dir: &Path, extension: &str) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case(extension))
                        .unwrap_or(false)
            })
            .collect();
        files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        files
    }

    /// Generates JavaScript code to inject user `.css` stylesheets and execute installed
    /// user `.js` scripts via `window.__prepareScriptContexts__` and
    /// `window.__runScriptWithContext__`.
    ///
    /// Mirror of upstream `EditorUserAsset.userScripts(from:)` semantics:
    /// - extensions.json `installed` array is the source of truth for order;
    /// - records with `enabled: false` are skipped;
    /// - leftover untracked files are adopted by `reconcile_installed` first.
    pub fn build_extension_bootstrap_js(&self) -> String {
        let _ = self.ensure_directories();
        let config = self.config();
        // Filesystem is truth: drop records for deleted files, adopt untracked ones.
        let _ = config.reconcile_installed(&self.scripts_dir());
        let installed = config.read().installed;

        let css_files = Self::list_sorted_files(&self.styles_dir(), "css");
        if css_files.is_empty() && installed.is_empty() {
            return String::new();
        }

        let mut snippets = Vec::new();

        // 1. Inject user CSS files into <head>
        for css_path in css_files {
            let Some(file_name) = css_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(css_content) = fs::read_to_string(&css_path) else {
                continue;
            };
            let name_json = serde_json::to_string(file_name).unwrap_or_else(|_| "\"style.css\"".to_string());
            let css_json = serde_json::to_string(&css_content).unwrap_or_else(|_| "\"\"".to_string());

            snippets.push(format!(
                r#"(function() {{
  const id = {name_json};
  let el = document.querySelector(`style[data-markedit-user-style="${{CSS.escape(id)}}"]`);
  if (!el) {{
    el = document.createElement('style');
    el.setAttribute('data-markedit-user-style', id);
    document.head.appendChild(el);
  }}
  el.textContent = {css_json};
}})();"#
            ));
        }

        // 2. Prepare and execute installed JS scripts with isolated MarkEdit contexts,
        //    honoring the installed[] record order and enabled flags.
        let mut descriptors = Vec::new();
        let mut runner_calls = Vec::new();

        for record in &installed {
            if !record.is_enabled() {
                continue;
            }
            let script_path = self.scripts_dir().join(&record.file);
            let Some(file_name) = script_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(js_source) = fs::read_to_string(&script_path) else {
                continue;
            };
            let capability = file_name.to_string();
            let js_source = if is_theme_script(file_name) {
                apply_theme_patch(&js_source)
            } else {
                js_source
            };
            let path_str = script_path.to_string_lossy().into_owned();

            descriptors.push(ScriptDescriptor {
                path: path_str,
                capability: capability.clone(),
            });

            let cap_json = serde_json::to_string(&capability).unwrap_or_else(|_| "\"script.js\"".to_string());
            runner_calls.push(format!(
                r#"try {{
  window.__runScriptWithContext__?.({cap_json}, function(MarkEdit, require) {{
{js_source}
  }});
}} catch (err) {{
  console.error('[MarkEdit-Rust] Failed to execute extension script ' + {cap_json} + ':', err);
}}"#
            ));
        }

        if !descriptors.is_empty() {
            let descriptors_json =
                serde_json::to_string(&descriptors).unwrap_or_else(|_| "[]".to_string());
            snippets.push(format!(
                r#"try {{
  window.__prepareScriptContexts__?.({descriptors_json});
}} catch (_err) {{}}"#
            ));
            snippets.extend(runner_calls);
        }

        snippets.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extensions::config::SCHEMA_URL;

    #[test]
    fn theme_patch_rewrites_circular_extension_references() {
        let legacy = "):\"extension\"in e?e.output:[e]"; // minified legacy theme pattern
        let patched = super::apply_theme_patch(legacy);
        assert_eq!(patched, "):(\"extension\"in e&&e.extension!==e)?e.output:[e]");

        // Idempotent when the theme already carries the fix.
        let fixed = "circularReferencePatched=true;):\"extension\"in e?";
        assert_eq!(super::apply_theme_patch(fixed), fixed);

        // Untouched when the pattern is absent.
        assert_eq!(super::apply_theme_patch("plain();"), "plain();");

        // Multiple occurrences are all rewritten.
        let twice = "):\"extension\"in e?1:):\"extension\"in t?2";
        let patched_twice = super::apply_theme_patch(twice);
        assert!(patched_twice.matches("e.extension!==e").count() == 1);
        assert!(patched_twice.matches("t.extension!==t").count() == 1);

        assert!(super::is_theme_script("markedit-theme-catppuccin.js"));
        assert!(super::is_theme_script("MarkEdit-Theme-Gruvbox.js"));
        assert!(!super::is_theme_script("hello-plugin.js"));
    }

    #[test]
    fn generates_css_and_contextual_js_bootstrap() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");

        fs::write(
            mgr.styles_dir().join("custom-theme.css"),
            ".cm-editor { font-size: 18px; }",
        )
        .expect("write css");
        fs::write(
            mgr.scripts_dir().join("hello-plugin.js"),
            "MarkEdit.onAppReady(() => console.log('ready'));",
        )
        .expect("write js");
        mgr.config().reconcile_installed(&mgr.scripts_dir()).expect("reconcile");

        let bootstrap = mgr.build_extension_bootstrap_js();
        assert!(bootstrap.contains("data-markedit-user-style"));
        assert!(bootstrap.contains("custom-theme.css"));
        assert!(bootstrap.contains(".cm-editor { font-size: 18px; }"));
        assert!(bootstrap.contains("__prepareScriptContexts__"));
        assert!(bootstrap.contains("__runScriptWithContext__"));
        assert!(bootstrap.contains("hello-plugin.js"));
        assert!(bootstrap.contains("MarkEdit.onAppReady"));
    }

    #[test]
    fn bootstrap_respects_installed_order_and_enabled_flags() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");

        for (name, body) in [
            ("aaa-first.js", "// aaa"),
            ("bbb-second.js", "// bbb"),
            ("ccc-disabled.js", "// ccc"),
        ] {
            fs::write(mgr.scripts_dir().join(name), body).expect("write script");
        }
        let config = mgr.config();
        config.reconcile_installed(&mgr.scripts_dir()).expect("reconcile");

        // Disable "bbb" and reorder: ccc (even though disabled) stays in record order.
        config.update(|updated| {
            let mut records = std::mem::take(&mut updated.installed);
            if let Some(bbb) = records.iter_mut().find(|record| record.id == "bbb-second") {
                bbb.enabled = Some(false);
            }
            records.rotate_left(1);
            updated.installed = records;
        })
        .expect("update config");

        // Sanity: config schema is in place on disk.
        let raw = fs::read_to_string(mgr.config().path()).expect("extensions.json");
        assert!(raw.contains(SCHEMA_URL));

        let bootstrap = mgr.build_extension_bootstrap_js();
        assert!(bootstrap.contains("aaa-first.js"));
        assert!(!bootstrap.contains("bbb-second.js"), "disabled record must be excluded: {bootstrap}");
        assert!(bootstrap.contains("ccc-disabled.js"));

        // Record order wins: with rotate_left the first descriptor is bbb (excluded),
        // so the first prepared context must be ccc.
        let ccc_pos = bootstrap.find("ccc-disabled.js").expect("ccc present");
        let aaa_pos = bootstrap.find("aaa-first.js").expect("aaa present");
        assert!(ccc_pos < aaa_pos, "installed[] order must be respected");
    }

    #[test]
    fn disabled_records_survive_reconcile_when_file_still_exists() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");

        fs::write(mgr.scripts_dir().join("toggle.js"), "// toggle").expect("write script");
        let config = mgr.config();
        config.reconcile_installed(&mgr.scripts_dir()).expect("reconcile");
        config
            .update(|updated| {
                for record in &mut updated.installed {
                    record.enabled = Some(false);
                }
            })
            .expect("disable");

        let reconciled = config.reconcile_installed(&mgr.scripts_dir()).expect("re-reconcile");
        assert_eq!(reconciled.installed.len(), 1);
        assert_eq!(reconciled.installed[0].enabled, Some(false));

        assert!(mgr.build_extension_bootstrap_js().is_empty());
    }
}
