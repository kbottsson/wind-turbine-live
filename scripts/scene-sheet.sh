#!/usr/bin/env bash
# Render one tile per (season, phase) so the sixteen palettes can be judged side by side, rather
# than described. Forced through ?scene=<season>.<phase>, cropped to the picture band — the readout
# is identical in every scene, so it would only waste the sheet — and tiled by scripts/scene_sheet.py.
#
# Each launch gets its own browser profile and is verified before the next: sharing a profile makes
# the renders race (a tile showing its neighbour's scene), and a headless capture occasionally comes
# back black on a cold start. Retrying a black tile beats debugging a sheet with holes in it.
#
# Do not add --virtual-time-budget: it advances the page's timers past the first canvas paint and
# every tile comes out black.
set -euo pipefail
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PYTHON="${PYTHON:-python3}"   # needs Pillow: point this at a venv that has PIL
OUT="${1:-/Users/smithdn/.hermes/cache/scratch/scenes}"
W=600
H=1024

PROFILE="$(mktemp -d)"   # one profile for the whole run: creating a fresh one per launch is slow enough
                        # that chrome is still starting when the capture fires, which comes back black
trap 'rm -rf "$PROFILE"' EXIT

render() { # $1 = tile name, $2 = query string
  local attempt
  for attempt in 1 2 3 4 5; do
    "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars \
      --no-first-run --no-default-browser-check --user-data-dir="$PROFILE" \
      --run-all-compositor-stages-before-draw \
      --window-size=$W,$H --screenshot="$OUT/$1.png" "file://$PWD/lite.html?$2" >/dev/null 2>&1
    if "$PYTHON" scripts/scene_sheet.py --check "$OUT/$1.png" >/dev/null 2>&1; then
      if [ "$attempt" -gt 1 ]; then echo "  $1: rendered on attempt $attempt" >&2; fi
      return 0
    fi
    sleep 1
  done
  echo "  $1: never rendered" >&2
  return 1
}

rm -rf "$OUT"; mkdir -p "$OUT"
for season in winter spring summer autumn; do
  for phase in night dawn day dusk; do
    render "$season-$phase" "wind=9.4&dir=265&px=4&motion=off&scene=$season.$phase"
  done
done

"$PYTHON" scripts/scene_sheet.py "$OUT" "$OUT/sheet.png"
echo "$OUT/sheet.png"
