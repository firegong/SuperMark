This directory contains the Tauri v2 (Rust + Microsoft Edge WebView2) based Windows native host application code.

## Module structure (planned)
- `src/main.rs` / `src/lib.rs`: app entry point and Tauri builder setup
- `src/document/`: document sessions replacing `NSDocument`, encoding/line-break handling, file watcher, auto-backup management
- `src/menu/`: Windows native menu bar and context menus (`muda`)
- `src/settings/`: `%APPDATA%/SuperMark/settings.json` and user script/style loader
- `src/extensions/`: extension manager
- `src/diagrams/`: local diagram rendering (plantuml, d2, mermaid)
- `src/bridge/`: WebView2 ↔ Rust bridge message router