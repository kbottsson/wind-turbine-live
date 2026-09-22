#!/usr/bin/env bash
# Local development server for the wind turbine page.
#
# Why this exists: browsers refuse `fetch` from a file:// page (null origin), which
# kills the weather lookup. Serving over http:// gives the page a real origin.
#
# Binds 127.0.0.1 by default, so the page is reachable only from this machine.
# To test it on a phone on the same wifi, ask for the LAN binding explicitly.
#
# Usage:  ./run.sh [port] [lan]
#         ./run.sh              -> http://localhost:8080/     (this machine only)
#         ./run.sh 8080 lan     -> http://<your-ip>:8080/      (also on your network)
set -euo pipefail
PORT="${1:-8080}"
BIND="127.0.0.1"
if [ "${2:-}" = "lan" ]; then
  BIND="0.0.0.0"
fi
cd "$(dirname "$0")"
echo "Serving $(pwd) at http://localhost:${PORT}/  (Ctrl-C to stop)"
if [ "$BIND" = "0.0.0.0" ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || echo '<your-ip>')"
  echo "LAN mode: also reachable at http://${LAN_IP}:${PORT}/ — unauthenticated, so only on a network you trust."
else
  echo "Bound to localhost only: not reachable from other devices."
fi
exec python3 -m http.server "$PORT" --bind "$BIND"
