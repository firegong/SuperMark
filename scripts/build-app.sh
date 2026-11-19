#!/usr/bin/env bash
# Builds a runnable production app binary without the Tauri CLI.
#
# Plain `cargo build --release` makes a *development* binary: it loads the editor from the Vite
# dev server (http://localhost:5173) and shows a blank window when that server is not running.
# The `tauri/custom-protocol` feature embeds packages/core-editor/dist instead (this is what
# `tauri build` does).
set -euo pipefail
cd "$(dirname "$0")/.."

(cd packages/core-editor && yarn build)
cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml

echo "Built src-tauri/target/release/markedit-win (production, editor embedded)"
