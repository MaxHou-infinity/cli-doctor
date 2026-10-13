#!/usr/bin/env bash
# End-to-end verification of the Host failure semantics (CONTRACT §2.5).
#
#   bash dsh/test/e2e/e2e-failure-paths.sh [--port N]
#
# The real diagnosis takes ~1 minute when it succeeds, so the failure branches
# are driven through the Host's documented check-path seam
# (`CLI_DOCTOR_CHECK_PATH`), which is read when the plugin is applied. A second
# web server is booted on its own port with a stub checker, and each stub must
# surface as a structured 500 — never as the webserver's generic 400, never as
# an unhandled rejection.
#
# The 8-minute timeout branch is NOT covered here: reproducing it would take
# eight minutes of wall clock. It is covered by the author's unit tests through
# the injected timeout seam, and is reported as unverified by this script.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

PORT="${FAILURE_PORT:-19392}"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="$1" ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done
BASE_URL="http://127.0.0.1:$PORT"
STUB_DIR="$DSH_HOME/failure-stubs"
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

hdr "Host failure paths (CONTRACT §2.5)"
say "stub dir: $STUB_DIR  port: $PORT"

# ---- stubs ----------------------------------------------------------------
case "$STUB_DIR" in
  "$DSH_HOME"/*) rm -rf "$STUB_DIR" ;;
  *) bad "refusing to remove unsafe path $STUB_DIR"; summary "e2e-failure-paths" || true; exit 2 ;;
esac
mkdir -p "$STUB_DIR"

cat >"$STUB_DIR/exit1.js" <<'EOF'
process.stderr.write('stub: deliberate failure\n')
process.exit(1)
EOF

cat >"$STUB_DIR/notjson.js" <<'EOF'
process.stdout.write('this is not JSON at all\n')
process.exit(0)
EOF

cat >"$STUB_DIR/oversize.js" <<'EOF'
const chunk = 'x'.repeat(1024 * 1024)
for (let i = 0; i < 26; i += 1) process.stdout.write(chunk)
EOF

ls -la "$STUB_DIR"
say "stubs written"

# ---- boot a server with the exit-1 stub -----------------------------------
boot_with_stub() { # stub-file
  if [ -n "$SERVER_PID" ]; then cleanup; fi
  export CLI_DOCTOR_CHECK_PATH="$1"
  "$DSH_BIN" --profile "$PROFILE" --port "$PORT" --no-open >"$LOGDIR/server-$(basename "$1").log" 2>&1 &
  SERVER_PID=$!
  unset CLI_DOCTOR_CHECK_PATH
  wait_for_url "$BASE_URL/" 240
}

if boot_with_stub "$STUB_DIR/exit1.js"; then
  ok "server booted with the exit-1 stub"
else
  bad "server did not boot with the exit-1 stub"
  summary "e2e-failure-paths" || true
  exit 1
fi

hdr "1. checker exits non-zero -> 500 exit-1"
CODE="$(req fail-exit1 POST /api/cli-doctor/check -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/fail-exit1.body")"
assert_eq "exit-1 status" "500" "$CODE"
assert_json "exit-1 error code" "$LOGDIR/fail-exit1.body" "error" "exit-1"
assert_json "exit-1 ok flag" "$LOGDIR/fail-exit1.body" "ok" "false"

CODE="$(req fail-exit1-health GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "server survives the failed diagnosis" "200" "$CODE"
assert_json "busy is released after a failure" "$LOGDIR/fail-exit1-health.body" "busy" "false"

# ---- invalid JSON ---------------------------------------------------------
hdr "2. checker prints non-JSON -> 500 invalid-json"
if boot_with_stub "$STUB_DIR/notjson.js"; then
  CODE="$(req fail-notjson POST /api/cli-doctor/check -H 'sec-fetch-site: same-origin')"
  say "  body: $(cat "$LOGDIR/fail-notjson.body")"
  assert_eq "invalid-json status" "500" "$CODE"
  assert_json "invalid-json error code" "$LOGDIR/fail-notjson.body" "error" "invalid-json"
else
  bad "server did not boot with the non-JSON stub"
fi

# ---- oversized stdout -----------------------------------------------------
hdr "3. checker floods stdout -> 500 output-too-large"
if boot_with_stub "$STUB_DIR/oversize.js"; then
  CODE="$(req fail-oversize POST /api/cli-doctor/check -H 'sec-fetch-site: same-origin')"
  say "  body: $(cat "$LOGDIR/fail-oversize.body")"
  assert_eq "output-too-large status" "500" "$CODE"
  assert_json "output-too-large error code" "$LOGDIR/fail-oversize.body" "error" "output-too-large"
else
  bad "server did not boot with the oversize stub"
fi

hdr "4. timeout branch"
skip "8-minute timeout path not reproduced end-to-end (would cost 8 minutes); covered by the injected-timeout unit test"

hdr "5. host log hygiene"
for LOG in "$LOGDIR"/server-*.log; do
  say "--- $LOG ---"
  tail -6 "$LOG"
done
if grep -qiE "unhandled|uncaught|UnhandledPromiseRejection" "$LOGDIR"/server-*.log; then
  bad "host log contains an unhandled rejection"
else
  ok "no unhandled rejection in any failure run"
fi

summary "e2e-failure-paths"
