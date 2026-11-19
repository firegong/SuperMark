# Builds a runnable production app binary without the Tauri CLI (Windows).
#
# Plain `cargo build --release` makes a *development* binary that loads the editor from the
# Vite dev server and shows a blank window without it. The `tauri/custom-protocol` feature
# embeds packages/core-editor/dist instead (what `tauri build` does).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Push-Location packages/core-editor
yarn build
Pop-Location

cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml
Write-Host 'Built src-tauri\target\release\markedit-win.exe (production, editor embedded)'
