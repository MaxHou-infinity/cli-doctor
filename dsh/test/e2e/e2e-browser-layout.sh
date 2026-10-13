#!/usr/bin/env bash
# Real-browser closure for UI-1: boots the scratch profile, opens the actual Web
# GUI in headless Chrome and measures the panel's layout.
#
#   bash dsh/test/e2e/e2e-browser-layout.sh [--port 19394]
#
# Requires Google Chrome (or CHROME_BIN). Uses a throwaway Chrome profile under
# /tmp; the user's browser profile is never touched. If no Chrome is present the
# stage reports UNVERIFIED instead of failing.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PORT="${BROWSER_PORT:-19394}"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="$1" ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
BASE_URL="http://127.0.0.1:$PORT"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    local i=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ "$i" -lt 30 ]; do sleep 0.5; i=$((i + 1)); done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}
trap cleanup EXIT INT TERM

CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME_BIN" ]; then
  skip "no Chrome at $CHROME_BIN — real-browser layout measurement not run"
  summary "e2e-browser-layout" || true
  exit 0
fi

hdr "real browser layout probe (UI-1)"
say "chrome: $CHROME_BIN"
say "port  : $PORT"

export npm_config_store_dir="${npm_config_store_dir:-$REPO_ROOT/.pnpm-store}"
"$DSH_BIN" --profile "$PROFILE" --port "$PORT" --no-open >"$LOGDIR/browser-server.log" 2>&1 &
SERVER_PID=$!
say "server pid=$SERVER_PID"

if ! wait_for_url "$BASE_URL/" 240; then
  bad "web server never answered on $BASE_URL"
  tail -20 "$LOGDIR/browser-server.log"
  summary "e2e-browser-layout" || true
  exit 1
fi
ok "web server answered"

TOKEN_URL="$(grep -m1 -o "dsh web: http://127.0.0.1:$PORT/?token=[A-Za-z0-9_-]*" "$LOGDIR/browser-server.log" | sed 's/^dsh web: //')"
if [ -z "$TOKEN_URL" ]; then
  bad "no authenticated URL in the server banner"
  tail -5 "$LOGDIR/browser-server.log"
  summary "e2e-browser-layout" || true
  exit 1
fi
say "authenticated URL: $(printf '%s' "$TOKEN_URL" | sed 's/token=.*/token=***/')"

CHROME_BIN="$CHROME_BIN" node "$E2E_DIR/browser-layout-probe.mjs" --url "$TOKEN_URL" 2>&1 | tee -a "$LOGDIR/run.log"
PROBE_RC="${PIPESTATUS[0]}"
say "browser probe exit=$PROBE_RC"
if [ "$PROBE_RC" -eq 0 ]; then
  ok "real-browser layout probe passed"
else
  bad "real-browser layout probe failed (exit $PROBE_RC)"
fi

summary "e2e-browser-layout"
