#!/usr/bin/env bash
# UX review evidence: build, serve, capture at 1280 and 390, list repeated lines. Then run review-prompt.md.
# usage: bash scripts/ux-review/run.sh [OUT_DIR]
set -euo pipefail
cd "$(dirname "$0")/../.."
O=${1:-${TMPDIR:-/tmp}/fsa-ux-review}
rm -rf "$O"; mkdir -p "$O"
export DO_NOT_TRACK=1
# ci-gates installs with --omit=optional, which drops agent-browser's native binary.
node_modules/.bin/agent-browser --version >/dev/null 2>&1 || npm ci --ignore-scripts --no-audit --no-fund >/dev/null
node scripts/build.mjs >/dev/null
# agent-browser uses its own Chrome; fetch it once if missing.
[ -d "$HOME/.agent-browser/browsers" ] || [ -n "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ] || node_modules/.bin/agent-browser install
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
# Threaded server with a deep queue: the app requests ~40 modules at once.
python3 -c 'import sys, functools, http.server as h
class S(h.ThreadingHTTPServer): request_queue_size = 128
S(("127.0.0.1", int(sys.argv[1])), functools.partial(h.SimpleHTTPRequestHandler, directory="dist")).serve_forever()' "$PORT" >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
for wh in "1280 800" "390 844"; do
  set -- $wh
  bash scripts/ux-review/capture.sh "http://127.0.0.1:$PORT/" "$O" "$1" "$2"
  python3 scripts/ux-review/dupes.py "$O" "$1" > "$O/dupes-$1.json"
done
echo "Evidence in $O. Next: give scripts/ux-review/review-prompt.md to a read-only agent with EVIDENCE=$O."
