#!/usr/bin/env bash
# Launch the Readest mod patcher in your browser (macOS/Linux).
cd "$(dirname "$0")"
( sleep 1; (command -v xdg-open >/dev/null && xdg-open http://localhost:8787) \
  || (command -v open >/dev/null && open http://localhost:8787) ) &
echo "Starting patcher at http://localhost:8787  (Ctrl-C to stop)"
exec node server.mjs
