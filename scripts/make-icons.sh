#!/usr/bin/env bash
# Regenerates every app icon from src-tauri/icons/icon.svg (and icon-small.svg, a simplified
# version for 32 px and smaller). Needs rsvg-convert (brew install librsvg); the .icns step
# needs macOS (iconutil).
set -euo pipefail
cd "$(dirname "$0")/../src-tauri/icons"

big=icon.svg
small=icon-small.svg
render() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
pick() { if [ "$1" -le 32 ]; then echo "$small"; else echo "$big"; fi; }

for size in 32 64 128; do render "$(pick $size)" $size ${size}x${size}.png; done
render $big 256 128x128@2x.png
render $big 512 icon.png
for size in 30 44 71 89 107 142 150 284 310; do render "$(pick $size)" $size Square${size}x${size}Logo.png; done
render $small 50 StoreLogo.png

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Windows .ico: PNG-compressed entries, 16–256 px.
sizes=(16 24 32 48 64 128 256)
for size in "${sizes[@]}"; do render "$(pick $size)" $size "$work/ico-$size.png"; done
python3 - "$work" "${sizes[@]}" <<'PY'
import struct, sys
work, sizes = sys.argv[1], [int(s) for s in sys.argv[2:]]
images = [open(f'{work}/ico-{s}.png', 'rb').read() for s in sizes]
header = struct.pack('<HHH', 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries = b''
for size, data in zip(sizes, images):
    entries += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open('icon.ico', 'wb').write(header + entries + b''.join(images))
PY

# macOS .icns
if command -v iconutil >/dev/null; then
  set_dir="$work/icon.iconset"
  mkdir "$set_dir"
  for size in 16 32 128 256 512; do
    render "$(pick $size)" $size "$set_dir/icon_${size}x${size}.png"
    render "$(pick $((size * 2)))" $((size * 2)) "$set_dir/icon_${size}x${size}@2x.png"
  done
  iconutil -c icns "$set_dir" -o icon.icns
fi

echo "Icons regenerated in src-tauri/icons"
