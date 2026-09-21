#!/usr/bin/env bash
# Screenshot + assertion harness. Renders every UI state in headless Chrome and greps the
# rendered DOM, so each state is checked by value as well as by eye.
#
#   ./scripts/shots.sh [outdir] [port]
#
# Requires the local server (./run.sh) to be running.

set -uo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-${TMPDIR:-/tmp}/wtshots}"
PORT="${2:-8080}"
BASE="http://localhost:${PORT}"
# Override on other platforms:  CHROME=/path/to/chrome ./scripts/shots.sh
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"

render() { # name, url, budget, window size, extra chrome args...
  local name="$1" url="$2" budget="$3" size="$4"
  shift 4
  "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars \
    "$@" --virtual-time-budget="$budget" --window-size="$size" \
    --screenshot="$OUT/$name.png" "$url" >/dev/null 2>&1
  echo "--- $name"
  "$CHROME" --headless=new --disable-gpu --enable-unsafe-swiftshader "$@" \
    --virtual-time-budget="$budget" --window-size="$size" --dump-dom "$url" 2>/dev/null |
    grep -oE '<span id="state-badge"[^>]*>[^<]*|<span id="state-note"[^>]*>[^<]*|<span id="v-wind">[^<]*|<span id="v-rpm">[^<]*|<dd id="v-power">[^<]*|<span id="v-dir">[^<]*' |
    sed -E 's/<[^>]*>//g' | paste -sd' | ' - || echo "(no readings)"
}

render "01-idle"          "$BASE/" 7000 1280,1000
render "02-parked"        "$BASE/?wind=2&dir=190" 7000 1280,1000
render "03-generating"    "$BASE/?wind=8&dir=260" 7000 1280,1000
render "04-rated"         "$BASE/?wind=15&dir=45" 7000 1280,1000
render "05-storm-park"    "$BASE/?wind=26&dir=315" 7000 1280,1000
render "06-live-coordinate" "$BASE/?coord=52.5200,13.4050" 7000 1280,1000
render "07-api-blocked"   "$BASE/?coord=52.5200,13.4050" 7000 1280,1000 "--host-resolver-rules=MAP api.open-meteo.com 127.0.0.1"
render "08-cdn-blocked"   "$BASE/?coord=52.5200,13.4050" 12000 1280,1000 "--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1"
render "09-no-webgl"      "$BASE/?coord=52.5200,13.4050" 7000 1280,1000 "--disable-3d-apis --disable-webgl"
render "10-narrow-rated"  "$BASE/?wind=15&dir=45" 7000 560,1100
render "11-narrow-live"   "$BASE/?coord=52.5200,13.4050" 7000 560,1100

echo
echo "screenshots in $OUT"
ls -1 "$OUT"
