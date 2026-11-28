#!/usr/bin/env bash
# Atlas base map: rebuilds every bundled map file from scratch.
#
#   forge-web-app/scripts/atlas/build.sh            (add --clean to delete downloads first)
#
# Writes to forge-ios-app/Forge/Forge/Resources/Atlas/:
#   atlas.pmtiles         vector tiles: land, coast, shelf, lakes, rivers (rank), hills, peaks
#   atlas-relief.pmtiles  shaded relief overlay (palette PNG, black shadows / white highlights in alpha)
#   atlas-night.json, atlas-cream.json   MapLibre styles from one token table (atlas.py TOKENS)
#   water-labels.json     curated water names (copied from this folder)
#   ATLAS.md              what each file is, sizes, zooms, credits (from ATLAS.template.md)
#
# Sources: Natural Earth 1:10m physical (github.com/nvkelso/natural-earth-vector) and
# AWS Open Data Terrain Tiles (Terrarium). Downloads, the Python venv and intermediates live
# in ./build (git-ignored). Needs: tippecanoe and pmtiles (brew install tippecanoe pmtiles),
# Python 3.10+ (3.13 preferred). Preview screenshots afterwards: node preview.mjs
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
OUT="$(cd "$HERE/../../.." && pwd)/forge-ios-app/Forge/Forge/Resources/Atlas"

if [[ "${1:-}" == "--clean" ]]; then rm -rf "$BUILD"; fi
mkdir -p "$BUILD" "$OUT"

for tool in tippecanoe pmtiles; do
  command -v "$tool" >/dev/null || { echo "missing $tool: brew install tippecanoe pmtiles"; exit 1; }
done

if [[ ! -x "$BUILD/venv/bin/python" ]]; then
  PY="$(command -v python3.13 || command -v python3.12 || command -v python3)"
  "$PY" -m venv "$BUILD/venv"
  "$BUILD/venv/bin/pip" install -q -r "$HERE/requirements.txt"
fi
PYTHON=("$BUILD/venv/bin/python" -I "$HERE/atlas.py")

"${PYTHON[@]}" fetch "$BUILD"
"${PYTHON[@]}" vectors "$BUILD"

V="$BUILD/vectors"
tippecanoe -q -f -o "$OUT/atlas.pmtiles" -Z0 -z9 --no-feature-limit --no-tile-size-limit \
  --detect-shared-borders --name atlas --attribution "Made with Natural Earth" \
  -L land:"$V/land.geojson" -L coast:"$V/coast.geojson" -L shelf:"$V/shelf.geojson" \
  -L lakes:"$V/lakes.geojson" -L rivers:"$V/rivers.geojson" \
  -L hills:"$V/hills.geojson" -L peaks:"$V/peaks.geojson"

"${PYTHON[@]}" relief "$BUILD"
pmtiles convert "$BUILD/relief.mbtiles" "$OUT/atlas-relief.pmtiles" >/dev/null

"${PYTHON[@]}" styles "$BUILD" "$OUT"
ls -l "$OUT"
