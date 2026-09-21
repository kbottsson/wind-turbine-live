#!/usr/bin/env bash
# Local development server for the wind turbine page.
#
# Why this exists: browsers refuse `fetch` from a file:// page (null origin), which
# kills the weather lookup. Serving over http:// gives the page a real origin.
#
# Usage:  ./run.sh [port]      then open http://localhost:8080/
set -euo pipefail
PORT="${1:-8080}"
cd "$(dirname "$0")"
echo "Serving $(pwd) at http://localhost:${PORT}/  (Ctrl-C to stop)"
exec python3 -m http.server "$PORT"
