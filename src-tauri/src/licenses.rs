//! Third-party attribution shown in the About dialog: the app's runtime dependencies and the
//! licenses of the code they bundle. Versions match packages/core-editor/package.json and the
//! installed node_modules; CodeMirror, Lezer, mdast-util-*, mermaid and the micromark extensions
//! are all MIT-licensed.

/// A third-party component bundled with the app.
struct ThirdParty {
    /// Component name as shown in the About dialog.
    name: &'static str,
    /// Installed version.
    version: &'static str,
    /// License the app uses the component under.
    license: &'static str,
}

/// Direct runtime dependencies of the app: everything the editor loads in the browser.
const THIRD_PARTY: &[ThirdParty] = &[
    ThirdParty { name: "CodeMirror autocomplete", version: "6.20.4", license: "MIT" },
    ThirdParty { name: "CodeMirror commands", version: "6.11.1", license: "MIT" },
    ThirdParty { name: "CodeMirror lang-markdown", version: "6.5.2", license: "MIT" },
    ThirdParty { name: "CodeMirror lang-yaml", version: "6.1.3", license: "MIT" },
    ThirdParty { name: "CodeMirror language", version: "6.13.1", license: "MIT" },
    ThirdParty { name: "CodeMirror legacy-modes", version: "6.5.5", license: "MIT" },
    ThirdParty { name: "CodeMirror search", version: "6.7.2", license: "MIT" },
    ThirdParty { name: "CodeMirror state", version: "6.7.6", license: "MIT" },
    ThirdParty { name: "CodeMirror view", version: "6.43.15", license: "MIT" },
    ThirdParty { name: "Lezer common", version: "1.5.4", license: "MIT" },
    ThirdParty { name: "Lezer highlight", version: "1.2.5", license: "MIT" },
    ThirdParty { name: "Lezer html", version: "1.3.13", license: "MIT" },
    ThirdParty { name: "Lezer lr", version: "1.4.11", license: "MIT" },
    ThirdParty { name: "Lezer markdown", version: "1.8.1", license: "MIT" },
    ThirdParty { name: "Graphviz (viz.js)", version: "3.31.0", license: "MIT" },
    ThirdParty { name: "Mermaid", version: "12.3.0", license: "MIT" },
    ThirdParty { name: "mdast-util-from-markdown", version: "2.1.0", license: "MIT" },
    ThirdParty { name: "mdast-util-gfm", version: "3.1.0", license: "MIT" },
    ThirdParty { name: "mdast-util-math", version: "3.0.0", license: "MIT" },
    ThirdParty { name: "micromark-extension-gfm", version: "3.0.0", license: "MIT" },
    ThirdParty { name: "micromark-extension-math", version: "3.1.0", license: "MIT" },
];

/// The "Third-party licenses" block for the About dialog: one line per component.
pub fn third_party_licenses_text() -> String {
    let mut text = String::from("Third-party licenses:");
    for component in THIRD_PARTY {
        text.push_str(&format!("\n- {} v{} — {}", component.name, component.version, component.license));
    }
    text
}
