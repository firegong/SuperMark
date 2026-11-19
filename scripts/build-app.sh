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

# macOS: wrap the binary in an .app bundle so Finder and the Dock show the app icon and name
# (a bare executable gets the generic icon). Installers for Windows and macOS come from the
# Release workflow (`tauri build`).
if [[ "$(uname)" == "Darwin" ]]; then
  name=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["productName"])')
  version=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')
  identifier=$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["identifier"])')
  app="src-tauri/target/release/bundle/macos/$name.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cp src-tauri/target/release/markedit-win "$app/Contents/MacOS/markedit-win"
  cp src-tauri/icons/icon.icns "$app/Contents/Resources/icon.icns"
  cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>English</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>markedit-win</string>
  <key>CFBundleIdentifier</key><string>$identifier</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string></array>
      <key>CFBundleTypeName</key><string>Markdown Document</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Default</string>
    </dict>
    <dict>
      <key>CFBundleTypeExtensions</key><array><string>textpack</string></array>
      <key>CFBundleTypeName</key><string>TextPack Archive</string>
      <key>CFBundleTypeRole</key><string>Editor</string>
      <key>LSHandlerRank</key><string>Default</string>
    </dict>
  </array>
</dict>
</plist>
PLIST
  codesign --force --sign - "$app" >/dev/null 2>&1 || true
  touch "$app"
  echo "Built $app"
fi
