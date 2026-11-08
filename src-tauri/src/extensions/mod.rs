use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct ScriptDescriptor {
    pub path: String,
    pub capability: String,
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

    /// Generates JavaScript code to inject user `.css` stylesheets and execute user `.js` scripts
    /// via `window.__prepareScriptContexts__` and `window.__runScriptWithContext__`.
    pub fn build_extension_bootstrap_js(&self) -> String {
        let _ = self.ensure_directories();
        let css_files = Self::list_sorted_files(&self.styles_dir(), "css");
        let js_files = Self::list_sorted_files(&self.scripts_dir(), "js");

        if css_files.is_empty() && js_files.is_empty() {
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

        // 2. Prepare and execute user JS scripts with isolated MarkEdit contexts
        if !js_files.is_empty() {
            let mut descriptors = Vec::new();
            let mut runner_calls = Vec::new();

            for js_path in js_files {
                let Some(file_name) = js_path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                let Ok(js_source) = fs::read_to_string(&js_path) else {
                    continue;
                };
                let path_str = js_path.to_string_lossy().into_owned();
                let capability = file_name.to_string();

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
  console.error('[MarkEdit-Win] Failed to execute user script ' + {cap_json} + ':', err);
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
        }

        snippets.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let bootstrap = mgr.build_extension_bootstrap_js();
        assert!(bootstrap.contains("data-markedit-user-style"));
        assert!(bootstrap.contains("custom-theme.css"));
        assert!(bootstrap.contains(".cm-editor { font-size: 18px; }"));
        assert!(bootstrap.contains("__prepareScriptContexts__"));
        assert!(bootstrap.contains("__runScriptWithContext__"));
        assert!(bootstrap.contains("hello-plugin.js"));
        assert!(bootstrap.contains("MarkEdit.onAppReady"));
    }
}
