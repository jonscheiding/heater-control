#!/usr/bin/env bash
#
# Regenerates the installed-app icons in public/ from app-icon.svg.
# Requires ImageMagick 7 (`brew install imagemagick`). Icons change about never,
# so this runs by hand rather than as part of the build.
set -euo pipefail

cd "$(dirname "$0")"
src=app-icon.svg
out=../public

# Manifest icons ("any"): the artwork already carries its own rounded corners,
# matching the favicon.
magick -background none "$src" -resize 192x192 "$out/icon-192.png"
magick -background none "$src" -resize 512x512 "$out/icon-512.png"
magick -background none "$src" -resize 48x48 "$out/favicon.png"

# Maskable icon: Android crops this to whatever shape the launcher uses, so the
# background goes full-bleed and the artwork shrinks into the 80% safe zone.
magick -size 512x512 "xc:#1e293b" \
  \( -background none "$src" -resize 350x350 \) \
  -gravity center -composite -alpha off -depth 8 "$out/icon-maskable-512.png"

# Apple touch icon: iOS applies its own corner mask and does not want alpha.
magick -size 180x180 "xc:#1e293b" \
  \( -background none "$src" -resize 180x180 \) \
  -gravity center -composite -alpha off -depth 8 "$out/apple-touch-icon.png"

echo "wrote favicon.png icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png"
