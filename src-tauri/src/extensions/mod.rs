pub mod config;
pub mod downloader;
pub mod registry;

pub use config::{Config, ExtensionConfig, UpdateBehavior};
pub use downloader::{install_bytes, install_url, is_safe_identifier, uninstall, PendingInstall};
pub use registry::{ExtensionRegistry, IndexEntry, RegistryIndex};

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Extensions that ship with the app. They are listed in Extensions → Installed like
/// default-installed extensions and can be turned off, but not uninstalled.
/// (id, name, description)
pub const BUILTIN_EXTENSIONS: &[(&str, &str, &str)] = &[(
    "supermarkdown",
    "Markdown Super Set",
    "Markdown parser: MultiMarkdown 6 with Pandoc, GFM and Obsidian syntax, merged table cells, cross references, run/render chunks, includes and more. Choose it in View → Markdown Parser.",
)];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinExtension {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub enabled: bool,
}

/// The built-in extension that provides a Markdown parser (renderer id → extension id).
pub fn builtin_for_parser(parser_id: &str) -> Option<&'static str> {
    match parser_id {
        "super" => Some("supermarkdown"),
        _ => None,
    }
}

pub fn is_builtin_extension(id: &str) -> bool {
    BUILTIN_EXTENSIONS.iter().any(|(builtin, _, _)| *builtin == id)
}

/// A user stylesheet (`styles/*.css`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStyle {
    pub name: String,
    pub css: String,
}

/// An enabled user script with its source, in `installed[]` order.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionScript {
    pub path: String,
    pub capability: String,
    pub source: String,
}

/// Extensions sent to the editor as data (IPC reply) rather than as one injected script:
/// a single multi-megabyte `eval` is fragile in WebView2, and each script can then run on its
/// own, so one broken or huge extension cannot keep the document from loading.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionBootstrap {
    pub styles: Vec<ExtensionStyle>,
    pub scripts: Vec<ExtensionScript>,
    /// Built-in extensions that are turned off (e.g. `supermarkdown`).
    pub disabled_builtins: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptDescriptor {
    pub path: String,
    pub capability: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionUpdateInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    pub latest_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsManagerState {
    pub catalog: Vec<IndexEntry>,
    pub builtins: Vec<BuiltinExtension>,
    pub installed: Vec<config::Installed>,
    pub updates: Vec<ExtensionUpdateInfo>,
    pub update_behavior: UpdateBehavior,
    pub app_version: String,
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
    /// Installed stylesheets and enabled scripts, with the same order and theme patching as
    /// `build_extension_bootstrap_js`.
    pub fn extension_bootstrap(&self) -> ExtensionBootstrap {
        let _ = self.ensure_directories();
        let config = self.config();
        let _ = config.reconcile_installed(&self.scripts_dir());
        let current = config.read();
        let installed = current.installed;
        let mut bootstrap = ExtensionBootstrap {
            disabled_builtins: current.disabled_builtins,
            ..ExtensionBootstrap::default()
        };

        for css_path in Self::list_sorted_files(&self.styles_dir(), "css") {
            let Some(name) = css_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if let Ok(css) = fs::read_to_string(&css_path) {
                bootstrap.styles.push(ExtensionStyle { name: name.to_string(), css });
            }
        }

        for record in &installed {
            if !record.is_enabled() {
                continue;
            }
            let script_path = self.scripts_dir().join(&record.file);
            let Some(file_name) = script_path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            let Ok(source) = fs::read_to_string(&script_path) else {
                continue;
            };
            let source = if is_theme_script(file_name) {
                apply_theme_patch(&source)
            } else {
                source
            };
            bootstrap.scripts.push(ExtensionScript {
                path: script_path.to_string_lossy().into_owned(),
                capability: file_name.to_string(),
                source,
            });
        }

        bootstrap
    }

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
            // The source is embedded as a JSON string and compiled with `new Function`, so a
            // syntax error in one extension throws inside this `try` instead of aborting the
            // whole bootstrap (and with it, loading the document into the editor).
            let source_json = serde_json::to_string(&format!("{js_source}\n//# sourceURL={capability}"))
                .unwrap_or_else(|_| "\"\"".to_string());
            runner_calls.push(format!(
                r#"try {{
  window.__runScriptWithContext__?.({cap_json}, new Function('MarkEdit', 'require', {source_json}));
}} catch (err) {{
  console.error('[SuperMark] Failed to execute extension script ' + {cap_json} + ':', err);
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

    pub fn registry(&self, app_version: &str) -> ExtensionRegistry {
        let cfg = self.config().read();
        ExtensionRegistry::new(
            self.registry_cache_dir(),
            cfg.registry_url().to_string(),
            app_version.to_string(),
        )
    }

    pub fn get_manager_state(&self, force_refresh: bool, app_version: &str) -> ExtensionsManagerState {
        let _ = self.ensure_directories();
        let config = self.config();
        let _ = config.reconcile_installed(&self.scripts_dir());

        let registry = self.registry(app_version);
        let index = if force_refresh || registry.cached_index().is_none() {
            registry
                .refresh(force_refresh, false)
                .ok()
                .flatten()
                .or_else(|| registry.cached_index())
        } else {
            registry.cached_index()
        };

        let catalog = index.map(|idx| idx.extensions).unwrap_or_default();
        let pending = registry.pending_updates(&config);
        let updates = pending
            .into_iter()
            .map(|(record, entry)| ExtensionUpdateInfo {
                id: entry.id,
                installed_version: record.version,
                latest_version: entry.latest.version,
            })
            .collect();

        let current_cfg = config.read();
        ExtensionsManagerState {
            catalog,
            builtins: self.builtin_extensions(app_version),
            installed: current_cfg.installed.clone(),
            updates,
            update_behavior: current_cfg.update_behavior(),
            app_version: app_version.to_string(),
        }
    }

    pub fn install_catalog_entry(
        &self,
        id: &str,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let _ = self.ensure_directories();
        let config = self.config();
        let registry = self.registry(app_version);
        let index = match registry.cached_index() {
            Some(cached) => cached,
            None => registry
                .refresh(true, false)?
                .ok_or_else(|| "Extension catalog is unavailable".to_string())?,
        };

        let entry = index
            .extensions
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(|| format!("Extension '{id}' not found in catalog"))?;

        let existing = config.read().find(id).cloned();
        let pending = PendingInstall::from_release(entry, &entry.latest);
        let response = ureq::get(&entry.latest.url).call().map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut response.into_reader(), &mut bytes)
            .map_err(|e| e.to_string())?;

        install_bytes(
            &self.scripts_dir(),
            &pending,
            &bytes,
            &config,
            app_version,
            existing.as_ref(),
        )?;

        Ok(self.get_manager_state(false, app_version))
    }

    pub fn install_from_url_state(
        &self,
        url: &str,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let _ = self.ensure_directories();
        let config = self.config();
        install_url(url.trim(), &config, &self.scripts_dir(), app_version)?;
        Ok(self.get_manager_state(false, app_version))
    }

    pub fn uninstall_extension(
        &self,
        id: &str,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let _ = self.ensure_directories();
        let config = self.config();
        uninstall(id, &self.scripts_dir(), &config)?;
        Ok(self.get_manager_state(false, app_version))
    }

    pub fn builtin_extensions(&self, app_version: &str) -> Vec<BuiltinExtension> {
        let disabled = self.config().read().disabled_builtins;
        BUILTIN_EXTENSIONS
            .iter()
            .map(|(id, name, description)| BuiltinExtension {
                id: (*id).to_string(),
                name: (*name).to_string(),
                description: (*description).to_string(),
                version: app_version.to_string(),
                enabled: !disabled.iter().any(|item| item == id),
            })
            .collect()
    }

    pub fn is_builtin_enabled(&self, id: &str) -> bool {
        !self.config().read().disabled_builtins.iter().any(|item| item == id)
    }

    pub fn set_extension_enabled(
        &self,
        id: &str,
        enabled: bool,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let _ = self.ensure_directories();
        let config = self.config();
        if is_builtin_extension(id) {
            config.update(|cfg| {
                cfg.disabled_builtins.retain(|item| item != id);
                if !enabled {
                    cfg.disabled_builtins.push(id.to_string());
                }
            })?;
            return Ok(self.get_manager_state(false, app_version));
        }
        let _ = config.reconcile_installed(&self.scripts_dir());
        config.update(|cfg| {
            if let Some(record) = cfg.installed.iter_mut().find(|item| item.id == id) {
                record.enabled = if enabled { None } else { Some(false) };
            }
        })?;
        Ok(self.get_manager_state(false, app_version))
    }

    pub fn update_extensions(
        &self,
        target_id: Option<&str>,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let _ = self.ensure_directories();
        let config = self.config();
        let registry = self.registry(app_version);
        if registry.cached_index().is_none() {
            let _ = registry.refresh(true, false);
        }

        let updates = registry.pending_updates(&config);
        for (record, entry) in &updates {
            if let Some(id) = target_id {
                if entry.id != id {
                    continue;
                }
            }
            downloader::download_update(
                &self.scripts_dir(),
                record,
                entry,
                &config,
                app_version,
            )?;
        }

        Ok(self.get_manager_state(false, app_version))
    }

    pub fn set_update_behavior(
        &self,
        behavior: UpdateBehavior,
        app_version: &str,
    ) -> Result<ExtensionsManagerState, String> {
        let config = self.config();
        config.update(|cfg| {
            cfg.update_behavior = Some(behavior);
        })?;
        Ok(self.get_manager_state(false, app_version))
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
    fn builtin_extensions_can_be_turned_off_but_are_always_listed() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");

        let state = mgr.get_manager_state(false, "1.0.0");
        assert_eq!(state.builtins.len(), 1);
        assert_eq!(state.builtins[0].id, "supermarkdown");
        assert!(state.builtins[0].enabled);
        assert!(mgr.extension_bootstrap().disabled_builtins.is_empty());

        let off = mgr.set_extension_enabled("supermarkdown", false, "1.0.0").expect("disable");
        assert!(!off.builtins[0].enabled);
        assert!(off.installed.is_empty(), "built-ins are not installed[] records");
        assert_eq!(mgr.extension_bootstrap().disabled_builtins, vec!["supermarkdown".to_string()]);
        assert!(!mgr.is_builtin_enabled("supermarkdown"));

        // Idempotent and reversible.
        mgr.set_extension_enabled("supermarkdown", false, "1.0.0").expect("disable again");
        assert_eq!(mgr.config().read().disabled_builtins.len(), 1);
        let on = mgr.set_extension_enabled("supermarkdown", true, "1.0.0").expect("enable");
        assert!(on.builtins[0].enabled);
        assert!(mgr.is_builtin_enabled("supermarkdown"));
    }

    #[test]
    fn broken_extension_source_is_embedded_as_a_string() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");
        // ESM syntax is a parse error inside a function body; it must not break the bootstrap.
        fs::write(mgr.scripts_dir().join("broken.js"), "import x from 'y';\n}}}")
            .expect("write js");
        mgr.config().reconcile_installed(&mgr.scripts_dir()).expect("reconcile");

        let bootstrap = mgr.build_extension_bootstrap_js();
        assert!(bootstrap.contains("new Function('MarkEdit', 'require', \"import x from 'y';\\n}}}"));
        assert!(!bootstrap.contains("\nimport x from 'y';"));
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

    #[test]
    fn manager_state_enable_toggle_uninstall_and_behavior() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mgr = ExtensionManager::new(tmp.path());
        mgr.ensure_directories().expect("ensure dirs");

        // Pre-seed cached registry index so get_manager_state does not hit network.
        fs::create_dir_all(mgr.registry_cache_dir()).expect("cache dir");
        fs::write(
            mgr.registry_cache_dir().join("index.json"),
            r#"{
              "schemaVersion": 1,
              "extensions": [
                {
                  "id": "markedit-preview",
                  "name": "MarkEdit-preview",
                  "description": "Preview extension",
                  "category": "extension",
                  "featured": true,
                  "latest": {
                    "version": "1.2.0",
                    "url": "https://example.com/markedit-preview.js",
                    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                  }
                }
              ]
            }"#,
        )
        .expect("write cached index");

        fs::write(mgr.scripts_dir().join("markedit-preview.js"), "// v1").expect("write script");

        let state = mgr.get_manager_state(false, "0.1.0");
        assert_eq!(state.catalog.len(), 1);
        assert_eq!(state.installed.len(), 1);
        assert_eq!(state.updates.len(), 1); // version-less markedit-* migrates to 1.2.0

        let disabled_state = mgr
            .set_extension_enabled("markedit-preview", false, "0.1.0")
            .expect("disable");
        assert_eq!(disabled_state.installed[0].enabled, Some(false));

        let behavior_state = mgr
            .set_update_behavior(UpdateBehavior::Notify, "0.1.0")
            .expect("behavior");
        assert_eq!(behavior_state.update_behavior, UpdateBehavior::Notify);

        let uninstalled_state = mgr
            .uninstall_extension("markedit-preview", "0.1.0")
            .expect("uninstall");
        assert!(uninstalled_state.installed.is_empty());
    }
}
