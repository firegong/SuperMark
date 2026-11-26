This directory contains the `CoreEditor` package from [`MarkEdit-app/MarkEdit`](https://github.com/MarkEdit-app/MarkEdit) (CodeMirror 6 based web editor core).

## Main responsibilities
- CodeMirror 6 + Lezer based GitHub Flavored Markdown editor
- `src/bridge/`: Native ↔ Web bidirectional bridge interface definitions
- `src/@codegen/`: `ts-gyb` based native binding code generator (includes Rust templates)
- Single HTML bundle (`dist/index.html`) built via `vite-plugin-singlefile`