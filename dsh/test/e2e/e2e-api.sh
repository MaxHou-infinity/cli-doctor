#!/usr/bin/env bash
# cli-doctor DSH plugin: real end-to-end verification against a scratch profile.
#
#   bash dsh/test/e2e/e2e-api.sh [--fresh] [--no-check] [--port N]
#
# Updated for CONTRACT v2 (2026-11-06):
#   * a plugin-added run never answers 409: overlapping POSTs attach the same
#     run and both settle with the same `checkedAt` (one child spawn);
#   * `GET /snapshot[?full=1]`, `GET /status`, `GET /history`, `POST /check/cancel`;
#   * `?mode=fast|full` selects the checker arguments and is echoed as `mode`;
#   * `force=0` serves a fresh cached snapshot (`cache:'hit'`), default reruns;
#   * state survives a Host restart through `<dataDir>/state.json`, a corrupt
#     file is ignored, and a failed write never changes a response;
#   * the v1 fence / 405 / 404 / boot-manifest assertions are all kept.
#
# Two servers are booted so the matrix stays fast and deterministic:
#   A. "contract server" — CLI_DOCTOR_CHECK_PATH points at a stub checker that
#      logs argv/env/spawn count and sleeps a configurable delay. All HTTP
#      contract checks (attach, cache, cancel, persistence, corruption) run here.
#   B. "real server" — no seam; one REAL full diagnosis (~70 s) plus a restart
#      proving the real snapshot is persisted.
#
# Everything runs inside this repository: DSH_HOME defaults to ./.dsh-test and
# the user's real ~/.dsh is refused by lib.sh. The test writes its state under
# $DSH_HOME/storages/cli-doctor and removes it before the matrix starts.
#
# Evidence for every request is kept in $LOGDIR (headers, body, status, stderr).

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FRESH=0
RUN_CHECK=1
while [ $# -gt 0 ]; do
  case "$1" in
    --fresh) FRESH=1 ;;
    --no-check) RUN_CHECK=0 ;;
    --port) shift; PORT="$1"; BASE_URL="http://127.0.0.1:$PORT" ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

SERVER_PID=""
SERVER_LOG=""

cleanup() {
  stop_server
  cleanup_pids
}
trap cleanup EXIT INT TERM

hdr "cli-doctor e2e v2  $(date -Iseconds)"
say "repo       : $REPO_ROOT"
say "package    : $PKG_DIR"
say "DSH_HOME   : $DSH_HOME"
say "profile    : $PROFILE"
say "port       : $PORT"
say "logdir     : $LOGDIR"

stop_server() {
  if [ -n "$SERVER_PID" ]; then
    say "stopping web server pid=$SERVER_PID"
    kill "$SERVER_PID" 2>/dev/null || true
    local i=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.5; i=$((i + 1)); done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
}

start_server() { # label [env assignments...]
  local label="$1"; shift
  local log="$LOGDIR/server-$label.log"
  SERVER_LOG="$log"
  say "running: env $* $DSH_BIN --profile $PROFILE --port $PORT --no-open  (log: server-$label.log)"
  env "$@" "$DSH_BIN" --profile "$PROFILE" --port "$PORT" --no-open >"$log" 2>&1 &
  SERVER_PID=$!
  say "server pid=$SERVER_PID label=$label"
  if ! wait_for_url "$BASE_URL/" 240; then
    bad "web server ($label) never answered on $BASE_URL within 240s"
    say "--- server-$label.log (tail) ---"
    tail -40 "$log"
    return 1
  fi
  ok "web server ($label) answered on $BASE_URL"
  say "  server banner: $(grep -m1 -o 'dsh web: [^ ]*' "$log" || echo '(no banner line)')"
  return 0
}

# ---------------------------------------------------------------- preflight
hdr "0. preflight"
export npm_config_store_dir="${npm_config_store_dir:-$REPO_ROOT/.pnpm-store}"
if command -v "$DSH_BIN" >/dev/null 2>&1; then
  ok "dsh CLI found: $(command -v "$DSH_BIN")"
else
  bad "dsh CLI not on PATH"
  summary "e2e-api" || true
  exit 1
fi
DSH_VERSION="$("$DSH_BIN" --version 2>&1 | tail -1)"
say "dsh version: $DSH_VERSION"
PKG_VERSION="$(node -e 'process.stdout.write(String(require(process.argv[1]).version))' "$PKG_DIR/package.json" 2>/dev/null)"
say "plugin version: ${PKG_VERSION:-<unknown>}"

MISSING=0
for f in package.json src/host/index.js src/client/store.js lib/client.js bin/check.js \
  scripts/build-client.mjs scripts/sync-shared.mjs cordis.patch.yml; do
  if [ -e "$PKG_DIR/$f" ]; then
    ok "package artifact present: dsh/$f"
  else
    skip "package artifact missing (author work not finished?): dsh/$f"
    MISSING=1
  fi
done
if [ "$MISSING" -ne 0 ]; then
  say "preflight incomplete: cannot run the end-to-end matrix yet."
  summary "e2e-api" || true
  exit 3
fi

# ------------------------------------------------------------- profile setup
hdr "1. scratch profile + plugin add"
if [ "$FRESH" -eq 1 ]; then
  TARGET="$DSH_HOME/profiles/$PROFILE"
  case "$TARGET" in
    "$DSH_HOME"/profiles/*) rm -rf "$TARGET"; say "removed $TARGET (--fresh)" ;;
    *) bad "--fresh refused: unsafe path $TARGET" ;;
  esac
fi

# A brand-new profile created by `dsh plugin add` only carries @deepseek-ai/dsh-base,
# so `dsh --profile <name> web` starts a process that never binds a port (verified:
# 30s alive, no listener, empty log). The profile must be initialized from the
# shipped `web` template so that `@deepseek-ai/dsh-web-app` is in its bundle list.
if [ ! -d "$DSH_HOME/profiles/$PROFILE" ] || ! grep -q '"@deepseek-ai/dsh-web-app"' "$DSH_HOME/profiles/$PROFILE/package.json" 2>/dev/null; then
  TARGET="$DSH_HOME/profiles/$PROFILE"
  case "$TARGET" in
    "$DSH_HOME"/profiles/*) rm -rf "$TARGET" ;;
    *) bad "profile init refused: unsafe path $TARGET" ;;
  esac
  say "initializing profile '$PROFILE' from the shipped web template"
  "$DSH_BIN" --profile "$PROFILE" --from-default-profile web --dump-config \
    >"$LOGDIR/profile-init.yml" 2>&1
  INIT_RC=$?
  say "profile init exit=$INIT_RC"
  assert_eq "profile init exit code" "0" "$INIT_RC"
  assert_contains "profile carries the web app bundle" '"@deepseek-ai/dsh-web-app"' \
    "$DSH_HOME/profiles/$PROFILE/package.json"
else
  ok "profile '$PROFILE' already carries @deepseek-ai/dsh-web-app"
fi

say "running: $DSH_BIN plugin --profile $PROFILE add $PKG_DIR"
"$DSH_BIN" plugin --profile "$PROFILE" add "$PKG_DIR" >"$LOGDIR/plugin-add.log" 2>&1
ADD_RC=$?
say "plugin add exit=$ADD_RC"
tail -25 "$LOGDIR/plugin-add.log" | tee -a "$LOGDIR/run.log" >/dev/null
say "--- plugin-add.log (tail) ---"
tail -25 "$LOGDIR/plugin-add.log"
assert_eq "plugin add exit code" "0" "$ADD_RC"

if grep -qF "dsh-cli-doctor" "$DSH_HOME/profiles/$PROFILE/package.json" 2>/dev/null; then
  ok "profile package.json lists dsh-cli-doctor"
else
  bad "profile package.json does not list dsh-cli-doctor"
fi

hdr "2. dump-config"
"$DSH_BIN" --profile "$PROFILE" --dump-config >"$LOGDIR/dump-config.yml" 2>"$LOGDIR/dump-config.err"
DUMP_RC=$?
say "dump-config exit=$DUMP_RC"
head -40 "$LOGDIR/dump-config.yml"
say "--- cli-doctor rows ---"
grep -n -A2 -B2 "cli-doctor" "$LOGDIR/dump-config.yml" || say "(no cli-doctor row found)"
assert_eq "dump-config exit code" "0" "$DUMP_RC"
assert_contains "dump-config has id: cli-doctor" "id: cli-doctor" "$LOGDIR/dump-config.yml"
assert_contains "dump-config has name: dsh-cli-doctor" "name: dsh-cli-doctor" "$LOGDIR/dump-config.yml"
for key in autoCheck staleAfterHours keepHistory checkTimeoutMs; do
  if grep -qE "^[[:space:]]*$key:" "$LOGDIR/dump-config.yml"; then
    ok "dump-config carries v2 config key: $key"
  else
    skip "dump-config has no v2 config key: $key (cordis.patch.yml default block not updated?)"
  fi
done

# ------------------------------------------------------- contract fixtures
hdr "3. contract fixtures (stub checker + canned report)"
# The seam is read when the plugin is applied: CLI_DOCTOR_CHECK_PATH names a
# Node script the Host spawns exactly like the real one. The stub records every
# spawn (argv + env hygiene) and sleeps for the delay in E2E_DELAY_FILE so the
# attach/cancel/status paths are deterministic instead of 70 s apiece.
CONTRACT_STUB="$LOGDIR/contract-check.cjs"
FAKE_REPORT="$LOGDIR/fake-report.json"
SPAWN_LOG="$LOGDIR/contract-spawns.jsonl"
DELAY_FILE="$LOGDIR/delay-ms"
: >"$SPAWN_LOG"
printf '1200' >"$DELAY_FILE"

cat >"$FAKE_REPORT" <<'JSON'
{
  "generated_at": "2026-11-06T00:00:00.000Z",
  "scope": "本机 CLI 工具与依赖包版本现状（只读检查）",
  "elapsed_ms": 1234,
  "skipped": ["brew services"],
  "managers": {
    "homebrew": {
      "tools": [
        { "name": "stub-tool-a", "current": "1.0.0", "latest": "2.0.0", "outdated": true, "upgrade_cmd": "brew upgrade stub-tool-a", "impact": { "checked": true, "dependents": [], "indirect": [], "conflicts": [], "uncertain": [] } },
        { "name": "stub-tool-b", "current": "1.0.0", "latest": null, "outdated": null }
      ],
      "deps": [
        { "name": "stub-dep-a", "current": "1.0.0", "latest": "1.1.0", "outdated": null, "impact": { "checked": true, "dependents": [], "indirect": [], "conflicts": [{ "name": "stub-tool-a", "requirement": "<1.1" }], "uncertain": [] } },
        { "name": "stub-dep-b", "current": "2.0.0", "latest": "2.1.0", "outdated": null, "impact": { "checked": true, "dependents": [], "indirect": [], "conflicts": [], "uncertain": [{ "name": "stub-tool-a" }] } }
      ]
    },
    "npm_global": { "tools": [], "deps": [] },
    "python_pip": { "tools": [], "deps": [] },
    "rust_bun_uv": { "tools": [], "deps": [] },
    "self_updating": { "tools": [], "deps": [] }
  }
}
JSON

cat >"$CONTRACT_STUB" <<'EOF'
'use strict'
const fs = require('node:fs')
const argv = process.argv.slice(2)
const envKeys = ['HOMEBREW_NO_AUTO_UPDATE', 'HOMEBREW_NO_ANALYTICS', 'PIP_DISABLE_PIP_VERSION_CHECK', 'NO_COLOR']
let delay = 1200
try {
  const raw = fs.readFileSync(process.env.E2E_DELAY_FILE, 'utf8').trim()
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed >= 0) delay = parsed
} catch { /* default delay */ }
if (typeof process.env.E2E_SPAWN_LOG === 'string' && process.env.E2E_SPAWN_LOG) {
  fs.appendFileSync(process.env.E2E_SPAWN_LOG, JSON.stringify({
    pid: process.pid,
    argv,
    env: Object.fromEntries(envKeys.map((key) => [key, process.env[key] ?? null])),
    at: Date.now(),
  }) + '\n')
}
const report = fs.readFileSync(process.env.E2E_FAKE_REPORT, 'utf8')
setTimeout(() => {
  process.stdout.write(report)
  process.exit(0)
}, delay)
EOF


STATE_DIR="$DSH_HOME/storages/cli-doctor"
case "$STATE_DIR" in
  "$DSH_HOME"/storages/*) rm -rf "$STATE_DIR"; say "cleaned previous state dir: $STATE_DIR" ;;
  *) bad "refusing to remove unsafe state path $STATE_DIR"; summary "e2e-api" || true; exit 2 ;;
esac

spawn_count() {
  if [ -s "$SPAWN_LOG" ]; then wc -l <"$SPAWN_LOG" | tr -d ' '; else printf '0'; fi
}

spawn_last_field() { # dotted expression evaluated against the last spawn record
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const expr = process.argv[2];
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    if (lines.length === 0) { process.stdout.write(""); process.exit(0); }
    const record = JSON.parse(lines[lines.length - 1]);
    const value = expr.split(".").reduce((current, key) => (current == null ? current : current[key]), record);
    if (value === undefined || value === null) process.stdout.write("");
    else if (typeof value === "object") process.stdout.write(JSON.stringify(value));
    else process.stdout.write(String(value));
  ' "$SPAWN_LOG" "$1"
}

wait_busy() { # wanted tries
  local wanted="$1" tries="${2:-60}" i=0 busy=""
  while [ "$i" -lt "$tries" ]; do
    curl -sS --max-time 5 -H 'sec-fetch-site: same-origin' -o "$LOGDIR/status-poll.body" \
      "$BASE_URL/api/cli-doctor/status" 2>/dev/null || true
    busy="$(json_get "$LOGDIR/status-poll.body" "busy" 2>/dev/null)"
    [ "$busy" = "$wanted" ] && return 0
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

BG_PID=""
bg_post() { # label path -- starts curl in the BACKGROUND and stores its pid in BG_PID
  local label="$1" path="$2"
  curl -sS --max-time 600 -X POST -H 'sec-fetch-site: same-origin' \
    -o "$LOGDIR/$label.body" -w '%{http_code}' >"$LOGDIR/$label.status" 2>"$LOGDIR/$label.err" \
    "$BASE_URL$path" &
  BG_PID=$!
}

checked_at_now() { json_get "$LOGDIR/snapshot.body" "snapshot.checkedAt"; }

# ------------------------------------------------------- A. contract server
hdr "4. boot contract server (stub checker, auto-check isolated off)"
start_server contract \
  "CLI_DOCTOR_CHECK_PATH=$CONTRACT_STUB" \
  "E2E_SPAWN_LOG=$SPAWN_LOG" \
  "E2E_FAKE_REPORT=$FAKE_REPORT" \
  "E2E_DELAY_FILE=$DELAY_FILE" \
  "CLI_DOCTOR_AUTO_CHECK=0" || { summary "e2e-api" || true; exit 1; }

hdr "5. GET /health (v2 capabilities + lastCheck)"
CODE="$(req health GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/health.body")"
assert_eq "health status" "200" "$CODE"
assert_valid_json "health body is valid JSON" "$LOGDIR/health.body"
assert_json "health ok" "$LOGDIR/health.body" "ok" "true"
assert_json "health version" "$LOGDIR/health.body" "version" "${PKG_VERSION:-0.2.0}"
assert_json "health busy" "$LOGDIR/health.body" "busy" "false"
assert_json "health advertises snapshot capability" "$LOGDIR/health.body" "capabilities.snapshot" "true"
assert_json "health advertises history capability" "$LOGDIR/health.body" "capabilities.history" "true"
assert_json "health advertises cancel capability" "$LOGDIR/health.body" "capabilities.cancel" "true"
assert_json "health lastCheck is null before any run" "$LOGDIR/health.body" "lastCheck" "null"
assert_matches "health content-type is JSON" "content-type: application/json" "$LOGDIR/health.headers"
assert_matches "health cache-control no-store" "cache-control: no-store" "$LOGDIR/health.headers"

CODE="$(req health-head HEAD /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "HEAD health status" "200" "$CODE"

hdr "6. GET /snapshot with no cache -> 200 snapshot:null (not 404)"
CODE="$(req snapshot-empty GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/snapshot-empty.body")"
assert_eq "empty snapshot status" "200" "$CODE"
assert_json "empty snapshot is null" "$LOGDIR/snapshot-empty.body" "snapshot" "null"
assert_json "empty snapshot reports busy=false" "$LOGDIR/snapshot-empty.body" "busy" "false"
assert_json "empty snapshot exposes cache ttl" "$LOGDIR/snapshot-empty.body" "cache.ttlMs" "43200000"
assert_json "empty snapshot exposes autoCheck=false from the env seam" "$LOGDIR/snapshot-empty.body" "cache.autoCheck" "false"

CODE="$(req snapshot-empty-full GET '/api/cli-doctor/snapshot?full=1' -H 'sec-fetch-site: same-origin')"
assert_eq "empty snapshot?full=1 status" "200" "$CODE"
assert_json "empty snapshot?full=1 is null too" "$LOGDIR/snapshot-empty-full.body" "snapshot" "null"

CODE="$(req snapshot-head HEAD /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
assert_eq "HEAD snapshot status" "200" "$CODE"

hdr "7. GET /status when idle"
CODE="$(req status-idle GET /api/cli-doctor/status -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/status-idle.body")"
assert_eq "idle status status" "200" "$CODE"
assert_json "idle status busy" "$LOGDIR/status-idle.body" "busy" "false"
assert_json "idle status running is null" "$LOGDIR/status-idle.body" "running" "null"
assert_json "idle status lastCheck is null" "$LOGDIR/status-idle.body" "lastCheck" "null"
assert_json "idle status exposes cache ttlMs" "$LOGDIR/status-idle.body" "cache.ttlMs" "43200000"

hdr "8. GET /history when empty"
CODE="$(req history-empty GET /api/cli-doctor/history -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/history-empty.body")"
assert_eq "empty history status" "200" "$CODE"
assert_json "empty history ok" "$LOGDIR/history-empty.body" "ok" "true"
assert_json "empty history entries" "$LOGDIR/history-empty.body" "entries" "[]"

# ------------------------------------------------------------- fence matrix
hdr "9. access fence on the v2 routes"
CODE="$(req check-bare POST /api/cli-doctor/check)"
say "  body: $(cat "$LOGDIR/check-bare.body")"
assert_eq "bare POST check status" "403" "$CODE"
assert_json "bare POST check error" "$LOGDIR/check-bare.body" "error" "forbidden"

for route in snapshot status history; do
  CODE="$(req "fence-$route-bare" GET "/api/cli-doctor/$route")"
  assert_eq "bare GET /$route status" "403" "$CODE"
  assert_json "bare GET /$route error" "$LOGDIR/fence-$route-bare.body" "error" "forbidden"
done

CODE="$(req cancel-bare POST /api/cli-doctor/check/cancel)"
assert_eq "bare POST /check/cancel status" "403" "$CODE"

CODE="$(req health-bare GET /api/cli-doctor/health)"
assert_eq "bare GET health status" "403" "$CODE"
assert_json "bare GET health error" "$LOGDIR/health-bare.body" "error" "forbidden"

hdr "9b. access fence: all three accepted browser markers"
CODE="$(req health-marker-secfetch GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "sec-fetch-site: same-origin -> 200" "200" "$CODE"
CODE="$(req health-marker-origin GET /api/cli-doctor/health -H "Origin: $BASE_URL")"
assert_eq "same-origin Origin header -> 200" "200" "$CODE"
CODE="$(req health-marker-cookie GET /api/cli-doctor/health -H 'Cookie: dsh-auth-e2e=1')"
assert_eq "dsh-auth-* cookie -> 200" "200" "$CODE"

hdr "9c. access fence: rejected markers"
CODE="$(req check-badorigin POST /api/cli-doctor/check -H 'Origin: http://evil.example')"
assert_eq "cross-origin POST status" "403" "$CODE"
CODE="$(req snapshot-badorigin GET /api/cli-doctor/snapshot -H 'Origin: http://evil.example')"
assert_eq "cross-origin GET /snapshot status" "403" "$CODE"
CODE="$(req check-badhost POST /api/cli-doctor/check -H 'Host: evil.example')"
assert_eq "foreign Host status" "403" "$CODE"

# --------------------------------------------------------- method/path guard
hdr "10. method and path guards (v1 semantics, all v2 routes)"
CODE="$(req health-delete DELETE /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "DELETE health status" "405" "$CODE"
assert_json "DELETE health error" "$LOGDIR/health-delete.body" "error" "method"

CODE="$(req snapshot-post POST /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
assert_eq "POST /snapshot status" "405" "$CODE"
assert_json "POST /snapshot error" "$LOGDIR/snapshot-post.body" "error" "method"
CODE="$(req status-post POST /api/cli-doctor/status -H 'sec-fetch-site: same-origin')"
assert_eq "POST /status status" "405" "$CODE"
CODE="$(req history-post POST /api/cli-doctor/history -H 'sec-fetch-site: same-origin')"
assert_eq "POST /history status" "405" "$CODE"
CODE="$(req cancel-get GET /api/cli-doctor/check/cancel -H 'sec-fetch-site: same-origin')"
assert_eq "GET /check/cancel status" "405" "$CODE"
assert_json "GET /check/cancel error" "$LOGDIR/cancel-get.body" "error" "method"

CODE="$(req unknown-subpath GET /api/cli-doctor/nope -H 'sec-fetch-site: same-origin')"
assert_eq "unknown subpath status" "404" "$CODE"
assert_json "unknown subpath error" "$LOGDIR/unknown-subpath.body" "error" "not-found"

CODE="$(req prefix-root GET /api/cli-doctor -H 'sec-fetch-site: same-origin')"
assert_eq "prefix root (/api/cli-doctor) status" "404" "$CODE"

CODE="$(req check-get GET /api/cli-doctor/check)"
assert_eq "GET on /check is 405 even without a marker" "405" "$CODE"
assert_json "GET on /check error" "$LOGDIR/check-get.body" "error" "method"

# ------------------------------------------------------------- fast/full ---
hdr "11. POST /check?mode=fast (fake checker; spawn argv + env hygiene)"
SPAWNS_BEFORE="$(spawn_count)"
CODE="$(req check-fast POST '/api/cli-doctor/check?mode=fast' -H 'sec-fetch-site: same-origin')"
say "  body head: $(head -c 300 "$LOGDIR/check-fast.body")"
assert_eq "fast check status" "200" "$CODE"
assert_valid_json "fast check body is valid JSON" "$LOGDIR/check-fast.body"
assert_json "fast check ok" "$LOGDIR/check-fast.body" "ok" "true"
assert_json "fast check mode" "$LOGDIR/check-fast.body" "mode" "fast"
assert_json "fast check cache is fresh" "$LOGDIR/check-fast.body" "cache" "fresh"
assert_json "fast check shared is false" "$LOGDIR/check-fast.body" "shared" "false"
assert_contains "fast check has checkedAt" "checkedAt" "$LOGDIR/check-fast.body"
assert_contains "fast check has elapsedMs" "elapsedMs" "$LOGDIR/check-fast.body"
assert_contains "fast check carries the report" "stub-tool-a" "$LOGDIR/check-fast.body"
assert_eq "fast check spawned exactly one child" "$((SPAWNS_BEFORE + 1))" "$(spawn_count)"
CHECKED_AT_1="$(json_get "$LOGDIR/check-fast.body" "checkedAt")"
say "  checkedAt=$CHECKED_AT_1"

say "  spawn argv: $(spawn_last_field 'argv')"
SPAWN_ARGV="$(spawn_last_field 'argv')"
case "$SPAWN_ARGV" in
  *--fast*) ok "fast mode passed --fast to the checker" ;;
  *) bad "fast mode did not pass --fast to the checker: $SPAWN_ARGV" ;;
esac
case "$SPAWN_ARGV" in
  *--json*) ok "checker always receives --json" ;;
  *) bad "checker did not receive --json: $SPAWN_ARGV" ;;
esac
case "$SPAWN_ARGV" in
  *--no-update*) ok "checker receives --no-update" ;;
  *) bad "checker did not receive --no-update: $SPAWN_ARGV" ;;
esac
for key in HOMEBREW_NO_AUTO_UPDATE HOMEBREW_NO_ANALYTICS PIP_DISABLE_PIP_VERSION_CHECK NO_COLOR; do
  value="$(spawn_last_field "env.$key")"
  if [ -n "$value" ]; then ok "spawn env carries $key=$value"; else bad "spawn env is missing $key"; fi
done

hdr "12. snapshot after the first run (summary vs full=1)"
CODE="$(req snapshot GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
say "  body: $(head -c 500 "$LOGDIR/snapshot.body")"
assert_eq "snapshot status" "200" "$CODE"
assert_json "snapshot ok" "$LOGDIR/snapshot.body" "ok" "true"
assert_json "snapshot busy" "$LOGDIR/snapshot.body" "busy" "false"
assert_json "snapshot checkedAt" "$LOGDIR/snapshot.body" "snapshot.checkedAt" "$CHECKED_AT_1"
assert_json "snapshot mode" "$LOGDIR/snapshot.body" "snapshot.mode" "fast"
assert_contains "snapshot exposes ageMs" "ageMs" "$LOGDIR/snapshot.body"
assert_contains "snapshot exposes stale flag" "stale" "$LOGDIR/snapshot.body"
assert_contains "snapshot carries a summary" "toolCount" "$LOGDIR/snapshot.body"
if [ -z "$(json_get "$LOGDIR/snapshot.body" "snapshot.report")" ]; then
  ok "default snapshot summary omits the full report"
else
  bad "default /snapshot carries the full report (should require ?full=1)"
fi
assert_json "summary toolCount counts the tool layer" "$LOGDIR/snapshot.body" "snapshot.summary.toolCount" "2"
assert_json "summary depCount counts the dep layer" "$LOGDIR/snapshot.body" "snapshot.summary.depCount" "2"
assert_json "summary conflictCount counts dep conflicts" "$LOGDIR/snapshot.body" "snapshot.summary.conflictCount" "1"
assert_json "summary uncertainCount counts dep uncertain" "$LOGDIR/snapshot.body" "snapshot.summary.uncertainCount" "1"
assert_json "summary mode is echoed" "$LOGDIR/snapshot.body" "snapshot.summary.mode" "fast"
assert_json "summary checkedAt is echoed" "$LOGDIR/snapshot.body" "snapshot.summary.checkedAt" "$CHECKED_AT_1"

CODE="$(req snapshot-full GET '/api/cli-doctor/snapshot?full=1' -H 'sec-fetch-site: same-origin')"
assert_eq "snapshot?full=1 status" "200" "$CODE"
assert_contains "snapshot?full=1 carries the complete report" "stub-tool-a" "$LOGDIR/snapshot-full.body"
assert_contains "snapshot?full=1 report has managers" "managers" "$LOGDIR/snapshot-full.body"

hdr "13. /status and /history after the first run"
CODE="$(req status-after GET /api/cli-doctor/status -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/status-after.body")"
assert_eq "status after run status" "200" "$CODE"
assert_json "status busy after run" "$LOGDIR/status-after.body" "busy" "false"
assert_json "status lastCheck.checkedAt" "$LOGDIR/status-after.body" "lastCheck.checkedAt" "$CHECKED_AT_1"
assert_json "status lastCheck.mode" "$LOGDIR/status-after.body" "lastCheck.mode" "fast"
assert_contains "status lastCheck exposes ageMs" "ageMs" "$LOGDIR/status-after.body"

CODE="$(req history-one GET /api/cli-doctor/history -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/history-one.body")"
assert_eq "history after run status" "200" "$CODE"
assert_json "history has one entry" "$LOGDIR/history-one.body" "entries.0.checkedAt" "$CHECKED_AT_1"
assert_json "history entry records the mode" "$LOGDIR/history-one.body" "entries.0.mode" "fast"
assert_contains "history entries only carry the summary (no report)" "summary" "$LOGDIR/history-one.body"
assert_not_contains "history entries omit the full report" "stub-tool-a" "$LOGDIR/history-one.body"

CODE="$(req history-limit GET '/api/cli-doctor/history?limit=1' -H 'sec-fetch-site: same-origin')"
assert_eq "history?limit=1 status" "200" "$CODE"
HISTORY_LEN="$(node -e '
  const fs = require("node:fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(Array.isArray(body.entries) ? body.entries.length : -1));
' "$LOGDIR/history-limit.body")"
assert_eq "history?limit=1 returns one page entry" "1" "$HISTORY_LEN"
CODE="$(req history-badlimit GET '/api/cli-doctor/history?limit=9999' -H 'sec-fetch-site: same-origin')"
assert_eq "history caps an oversized limit without failing" "200" "$CODE"

hdr "14. cache semantics: force=0 hit, default force=1 reruns"
SPAWNS_BEFORE="$(spawn_count)"
CODE="$(req check-cache-hit POST '/api/cli-doctor/check?mode=fast&force=0' -H 'sec-fetch-site: same-origin')"
assert_eq "force=0 status" "200" "$CODE"
assert_json "force=0 is served from cache" "$LOGDIR/check-cache-hit.body" "cache" "hit"
assert_json "force=0 keeps the original checkedAt" "$LOGDIR/check-cache-hit.body" "checkedAt" "$CHECKED_AT_1"
assert_eq "force=0 did not spawn a child" "$SPAWNS_BEFORE" "$(spawn_count)"

CODE="$(req check-force-default POST '/api/cli-doctor/check?mode=fast' -H 'sec-fetch-site: same-origin')"
assert_eq "default force re-runs" "200" "$CODE"
assert_json "default force is fresh" "$LOGDIR/check-force-default.body" "cache" "fresh"
assert_eq "default force spawned exactly one child" "$((SPAWNS_BEFORE + 1))" "$(spawn_count)"
CHECKED_AT_2="$(json_get "$LOGDIR/check-force-default.body" "checkedAt")"
if [ "$CHECKED_AT_1" != "$CHECKED_AT_2" ]; then ok "a rerun advances checkedAt"; else bad "rerun reused checkedAt=$CHECKED_AT_1"; fi

hdr "15. POST /check?mode=full (stub) — mode is echoed, no --fast"
CODE="$(req check-full-stub POST '/api/cli-doctor/check?mode=full' -H 'sec-fetch-site: same-origin')"
assert_eq "full(stub) status" "200" "$CODE"
assert_json "full(stub) mode" "$LOGDIR/check-full-stub.body" "mode" "full"
SPAWN_ARGV="$(spawn_last_field 'argv')"
case "$SPAWN_ARGV" in
  *--fast*) bad "full mode passed --fast to the checker: $SPAWN_ARGV" ;;
  *) ok "full mode does not pass --fast" ;;
esac

# ------------------------------------------------------- concurrency/attach
hdr "16. concurrent POSTs attach one run: both 200, same checkedAt, one spawn"
printf '3000' >"$DELAY_FILE"
SPAWNS_BEFORE="$(spawn_count)"
bg_post attach-a '/api/cli-doctor/check?mode=fast'
PID_A="$BG_PID"
sleep 0.8
bg_post attach-b '/api/cli-doctor/check?mode=fast'
PID_B="$BG_PID"
wait "$PID_A" 2>/dev/null; wait "$PID_B" 2>/dev/null
CODE_A="$(cat "$LOGDIR/attach-a.status")"
CODE_B="$(cat "$LOGDIR/attach-b.status")"
say "  concurrent statuses: a=$CODE_A b=$CODE_B"
assert_eq "concurrent request A is 200" "200" "$CODE_A"
assert_eq "concurrent request B is 200" "200" "$CODE_B"
assert_eq "concurrent requests spawned exactly one child" "$((SPAWNS_BEFORE + 1))" "$(spawn_count)"
ATTACH_AT_A="$(json_get "$LOGDIR/attach-a.body" "checkedAt")"
ATTACH_AT_B="$(json_get "$LOGDIR/attach-b.body" "checkedAt")"
assert_eq "both requests observed the same checkedAt" "$ATTACH_AT_A" "$ATTACH_AT_B"
CACHE_A="$(json_get "$LOGDIR/attach-a.body" "cache")"
CACHE_B="$(json_get "$LOGDIR/attach-b.body" "cache")"
say "  cache tags: a=$CACHE_A b=$CACHE_B shared=$(json_get "$LOGDIR/attach-b.body" "shared")"
if { [ "$CACHE_A" = "fresh" ] && [ "$CACHE_B" = "attached" ]; } || { [ "$CACHE_A" = "attached" ] && [ "$CACHE_B" = "fresh" ]; }; then
  ok "one request is fresh and the other is attached"
else
  bad "expected one fresh + one attached, got a=$CACHE_A b=$CACHE_B"
fi
ATTACHED_FILE="$LOGDIR/attach-a.body"
[ "$CACHE_A" = "attached" ] && ATTACHED_FILE="$LOGDIR/attach-a.body" || ATTACHED_FILE="$LOGDIR/attach-b.body"
assert_json "the attached request is marked shared" "$ATTACHED_FILE" "shared" "true"
assert_not_contains "the attached request carries no error payload" '"error"' "$ATTACHED_FILE"

hdr "16b. /status and /health report the run while it is in flight"
printf '60000' >"$DELAY_FILE"
bg_post run-a '/api/cli-doctor/check?mode=full'
PID_RUN="$BG_PID"
if wait_busy true 30; then
  ok "status flips to busy while a run is in flight"
  curl -sS --max-time 5 -H 'sec-fetch-site: same-origin' -o "$LOGDIR/status-running.body" \
    "$BASE_URL/api/cli-doctor/status"
  say "  running status: $(cat "$LOGDIR/status-running.body")"
  assert_json "running status has a running object" "$LOGDIR/status-running.body" "running.mode" "full"
  assert_contains "running status exposes startedAt" "startedAt" "$LOGDIR/status-running.body"
  assert_contains "running status exposes elapsedMs" "elapsedMs" "$LOGDIR/status-running.body"
  assert_contains "running status exposes waiters" "waiters" "$LOGDIR/status-running.body"
  CODE="$(req health-busy GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
  assert_json "health busy flag follows the run" "$LOGDIR/health-busy.body" "busy" "true"
else
  bad "status never reported busy while a run was in flight"
fi

# ------------------------------------------------------------------ cancel
hdr "17. POST /check/cancel cancels the in-flight run"
SNAPSHOT_BEFORE_CANCEL="$(curl -sS --max-time 5 -H 'sec-fetch-site: same-origin' "$BASE_URL/api/cli-doctor/snapshot" | node -e '
  let raw = ""; process.stdin.on("data", (chunk) => { raw += chunk }); process.stdin.on("end", () => {
    const body = JSON.parse(raw);
    process.stdout.write(body.snapshot ? body.snapshot.checkedAt : "");
  });
')"
say "  snapshot before cancel: ${SNAPSHOT_BEFORE_CANCEL:-<none>}"
CODE="$(req cancel POST /api/cli-doctor/check/cancel -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/cancel.body")"
assert_eq "cancel status" "200" "$CODE"
assert_json "cancel ok" "$LOGDIR/cancel.body" "ok" "true"
assert_json "cancel reports true for a running check" "$LOGDIR/cancel.body" "cancelled" "true"
wait "$PID_RUN" 2>/dev/null
CODE_RUN="$(cat "$LOGDIR/run-a.status")"
say "  cancelled waiter status: $CODE_RUN body=$(head -c 200 "$LOGDIR/run-a.body")"
assert_eq "a cancelled waiter receives 500" "500" "$CODE_RUN"
assert_json "the waiter error code is cancelled" "$LOGDIR/run-a.body" "error" "cancelled"
assert_json "the waiter ok flag is false" "$LOGDIR/run-a.body" "ok" "false"
if wait_busy false 60; then ok "busy is released only after the child closed"; else bad "busy never returned to false after cancel"; fi
curl -sS --max-time 5 -H 'sec-fetch-site: same-origin' -o "$LOGDIR/snapshot-after-cancel.body" \
  "$BASE_URL/api/cli-doctor/snapshot"
SNAPSHOT_AFTER_CANCEL="$(json_get "$LOGDIR/snapshot-after-cancel.body" "snapshot.checkedAt")"
assert_eq "a cancelled run does not overwrite the snapshot" "$SNAPSHOT_BEFORE_CANCEL" "$SNAPSHOT_AFTER_CANCEL"
CODE="$(req cancel-idle POST /api/cli-doctor/check/cancel -H 'sec-fetch-site: same-origin')"
assert_eq "cancel when idle status" "200" "$CODE"
assert_json "cancel when idle reports false" "$LOGDIR/cancel-idle.body" "cancelled" "false"

# ------------------------------------------------------------ persistence --
printf '1200' >"$DELAY_FILE"
hdr "18. persistence + corrupt-file tolerance + write-failure containment"
STATE_FILE="$STATE_DIR/state.json"
if [ -f "$STATE_FILE" ]; then
  ok "state.json was written: $STATE_FILE ($(wc -c <"$STATE_FILE" | tr -d ' ') bytes)"
else
  bad "state.json missing after successful runs: $STATE_FILE"
fi
assert_eq "state schemaVersion" "1" "$(json_get "$STATE_FILE" "schemaVersion" 2>/dev/null)"
assert_contains "state persists the snapshot" "checkedAt" "$STATE_FILE"
assert_contains "state persists the history" "history" "$STATE_FILE"
if stat -f '%Lp' "$STATE_DIR" >/dev/null 2>&1; then
  assert_eq "state directory is 0700" "700" "$(stat -f '%Lp' "$STATE_DIR")"
  if [ -f "$STATE_FILE" ]; then
    assert_eq "state file is 0600" "600" "$(stat -f '%Lp' "$STATE_FILE")"
  fi
else
  skip "stat -f unavailable; directory/file mode not checked"
fi

stop_server
start_server contract-restart \
  "CLI_DOCTOR_CHECK_PATH=$CONTRACT_STUB" \
  "E2E_SPAWN_LOG=$SPAWN_LOG" \
  "E2E_FAKE_REPORT=$FAKE_REPORT" \
  "E2E_DELAY_FILE=$DELAY_FILE" \
  "CLI_DOCTOR_AUTO_CHECK=0" || { summary "e2e-api" || true; exit 1; }
CODE="$(req snapshot-restored GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
assert_eq "snapshot after restart status" "200" "$CODE"
assert_json "snapshot survives a restart" "$LOGDIR/snapshot-restored.body" "snapshot.checkedAt" "$SNAPSHOT_BEFORE_CANCEL"
CODE="$(req history-restored GET /api/cli-doctor/history -H 'sec-fetch-site: same-origin')"
HISTORY_RESTORED_LEN="$(node -e '
  const fs = require("node:fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(Array.isArray(body.entries) ? body.entries.length : -1));
' "$LOGDIR/history-restored.body")"
if [ "$HISTORY_RESTORED_LEN" -ge 1 ] 2>/dev/null; then
  ok "history survives a restart ($HISTORY_RESTORED_LEN entries)"
else
  bad "history did not survive the restart (entries=$HISTORY_RESTORED_LEN)"
fi

stop_server
say "corrupting $STATE_FILE to prove load tolerance"
printf '{ this is not json' >"$STATE_FILE"
start_server contract-corrupt \
  "CLI_DOCTOR_CHECK_PATH=$CONTRACT_STUB" \
  "E2E_SPAWN_LOG=$SPAWN_LOG" \
  "E2E_FAKE_REPORT=$FAKE_REPORT" \
  "E2E_DELAY_FILE=$DELAY_FILE" \
  "CLI_DOCTOR_AUTO_CHECK=0" || { summary "e2e-api" || true; exit 1; }
CODE="$(req health-corrupt GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "health survives a corrupt state file" "200" "$CODE"
CODE="$(req snapshot-corrupt GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
assert_eq "snapshot survives a corrupt state file" "200" "$CODE"
assert_json "a corrupt state file is ignored, not fatal" "$LOGDIR/snapshot-corrupt.body" "snapshot" "null"

if chmod 500 "$STATE_DIR" 2>/dev/null; then
  CODE="$(req check-writefail POST '/api/cli-doctor/check?mode=fast' -H 'sec-fetch-site: same-origin')"
  assert_eq "a failed state write never changes the response" "200" "$CODE"
  assert_json "the in-memory snapshot still lands when the write fails" "$LOGDIR/check-writefail.body" "ok" "true"
  chmod 700 "$STATE_DIR" 2>/dev/null || true
else
  skip "could not chmod the state dir; write-failure containment not exercised"
fi
stop_server
rm -rf "$STATE_DIR"
STATE_FILE="$STATE_DIR/state.json"

# --------------------------------------------------------------- real run ---
if [ "$RUN_CHECK" -eq 1 ]; then
  hdr "19. real server: one REAL full diagnosis (no seam)"
  start_server real || { summary "e2e-api" || true; exit 1; }
  CODE="$(req health-real GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
  assert_eq "real health status" "200" "$CODE"
  assert_json "real health advertises the v2 capabilities" "$LOGDIR/health-real.body" "capabilities.snapshot" "true"
  CODE="$(req snapshot-real-empty GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
  assert_eq "real server starts with an empty cache after cleanup" "200" "$CODE"
  assert_json "real server empty snapshot" "$LOGDIR/snapshot-real-empty.body" "snapshot" "null"
  assert_json "real server defaults autoCheck to true (env seam unset)" "$LOGDIR/snapshot-real-empty.body" "cache.autoCheck" "true"

  START_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
  CODE="$(req check-real POST '/api/cli-doctor/check?mode=full' -H 'sec-fetch-site: same-origin')"
  END_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
  say "  elapsed: $(( (END_MS - START_MS) / 1000 ))s"
  say "  body head: $(head -c 400 "$LOGDIR/check-real.body")"
  assert_eq "POST real check status" "200" "$CODE"
  assert_valid_json "real check body is valid JSON" "$LOGDIR/check-real.body"
  assert_json "real check ok" "$LOGDIR/check-real.body" "ok" "true"
  assert_json "real check mode" "$LOGDIR/check-real.body" "mode" "full"
  assert_contains "real check has checkedAt" "checkedAt" "$LOGDIR/check-real.body"
  assert_contains "real check has elapsedMs" "elapsedMs" "$LOGDIR/check-real.body"
  MANAGER_VERDICT="$(node -e '
    const fs = require("node:fs");
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const want = ["homebrew", "npm_global", "python_pip", "rust_bun_uv", "self_updating"];
    const managers = report?.report?.managers;
    if (managers === undefined || managers === null) { console.log("BAD managers-missing"); process.exit(0); }
    const problems = [];
    for (const key of want) {
      const value = managers[key];
      if (value === undefined) problems.push(key + ":missing");
      else if (!Array.isArray(value.tools) || !Array.isArray(value.deps)) problems.push(key + ":bad-shape");
    }
    const extra = Object.keys(managers).filter((key) => !want.includes(key));
    console.log(problems.length > 0 ? "BAD " + problems.join(",") : "OK" + (extra.length > 0 ? " extra=" + extra.join(",") : ""));
  ' "$LOGDIR/check-real.body")"
  say "  managers verdict: $MANAGER_VERDICT"
  if [ "${MANAGER_VERDICT#OK}" != "$MANAGER_VERDICT" ]; then
    ok "report.managers has all five ecosystems with tools[]/deps[]"
  else
    bad "report.managers malformed: $MANAGER_VERDICT"
  fi
  say "  report.generated_at: $(json_get "$LOGDIR/check-real.body" "report.generated_at")"
  say "  report.scope: $(json_get "$LOGDIR/check-real.body" "report.scope")"
  say "  report.elapsed_ms: $(json_get "$LOGDIR/check-real.body" "report.elapsed_ms")"
  REAL_CHECKED_AT="$(json_get "$LOGDIR/check-real.body" "checkedAt")"
  REAL_ELAPSED_MS="$(json_get "$LOGDIR/check-real.body" "elapsedMs")"
  if node -e 'const value = Number(process.argv[1]); process.exit(Number.isFinite(value) && value >= 1000 ? 0 : 1)' "$REAL_ELAPSED_MS"; then
    ok "real check reports a realistic elapsedMs (${REAL_ELAPSED_MS} ms)"
  else
    bad "real check elapsedMs is not realistic: ${REAL_ELAPSED_MS}"
  fi
  assert_json "real check is served fresh" "$LOGDIR/check-real.body" "cache" "fresh"
  assert_json "real check is not a shared attach" "$LOGDIR/check-real.body" "shared" "false"

  hdr "19b. real snapshot persists across a restart"
  stop_server
  start_server real-restart || { summary "e2e-api" || true; exit 1; }
  CODE="$(req snapshot-real-restored GET /api/cli-doctor/snapshot -H 'sec-fetch-site: same-origin')"
  assert_eq "real snapshot after restart status" "200" "$CODE"
  assert_json "the real snapshot survives a restart" "$LOGDIR/snapshot-real-restored.body" "snapshot.checkedAt" "$REAL_CHECKED_AT"
  assert_json "the restored real snapshot keeps mode=full" "$LOGDIR/snapshot-real-restored.body" "snapshot.mode" "full"
  CODE="$(req snapshot-real-full GET '/api/cli-doctor/snapshot?full=1' -H 'sec-fetch-site: same-origin')"
  assert_contains "the restored real snapshot carries the full report" "managers" "$LOGDIR/snapshot-real-full.body"
else
  skip "real full diagnosis skipped by --no-check"
  if [ -z "$SERVER_PID" ]; then
    start_server bundle || { summary "e2e-api" || true; exit 1; }
  fi
fi

# -------------------------------------------------- client bundle evidence --
hdr "20. client bundle: proven through the boot manifest, not a bare URL"
CODE="$(req client-bundle-bare GET /plugins/dsh-cli-doctor/client.js)"
say "  (informational) bare /plugins/dsh-cli-doctor/client.js = $CODE"

TOKEN="$(grep -h -m1 -o 'token=[A-Za-z0-9_-]*' "$SERVER_LOG" 2>/dev/null | head -1 | cut -d= -f2)"
if [ -z "$TOKEN" ]; then
  bad "no launch token found in the server banners; cannot fetch the boot manifest"
else
  ok "launch token found in the server banner"
  COOKIE_JAR="$LOGDIR/cookies.txt"
  EXCHANGE="$(curl -sS -c "$COOKIE_JAR" -o /dev/null -D "$LOGDIR/token-exchange.headers" \
    -w '%{http_code}' "$BASE_URL/?token=$TOKEN" 2>"$LOGDIR/token-exchange.err")" || EXCHANGE="000"
  say "  token exchange status: $EXCHANGE"
  assert_eq "token exchange is a 303 cookie handoff" "303" "$EXCHANGE"

  BOOT="$(curl -sS -b "$COOKIE_JAR" -o "$LOGDIR/boot.html" -D "$LOGDIR/boot.headers" \
    -w '%{http_code}' "$BASE_URL/" 2>"$LOGDIR/boot.err")" || BOOT="000"
  say "  boot index status: $BOOT ($(wc -c <"$LOGDIR/boot.html" | tr -d ' ') bytes)"
  assert_eq "authenticated index is 200" "200" "$BOOT"

  COMBO_REF="$(node -e '
    const fs = require("node:fs");
    const html = fs.readFileSync(process.argv[1], "utf8");
    const match = html.match(/(?:href|src)="([^"]*dsh-cli-doctor\/client\.js[^"]*)"/);
    if (!match) { console.error("no dsh-cli-doctor/client.js reference in the boot manifest"); process.exit(1); }
    process.stdout.write(match[1].replaceAll("&amp;", "&"));
  ' "$LOGDIR/boot.html" 2>"$LOGDIR/combo-extract.err")"
  if [ -z "$COMBO_REF" ]; then
    bad "boot manifest does not preload dsh-cli-doctor/client.js: $(cat "$LOGDIR/combo-extract.err")"
  else
    ok "boot manifest preloads dsh-cli-doctor/client.js"
    say "  combo reference: $(printf '%s' "$COMBO_REF" | head -c 200)…"
    case "$COMBO_REF" in
      /*) COMBO_PATH="$COMBO_REF" ;;
      *) COMBO_PATH="/$COMBO_REF" ;;
    esac
    CODE="$(req client-bundle GET "$COMBO_PATH" -b "$COOKIE_JAR")"
    say "  combo size: $(wc -c <"$LOGDIR/client-bundle.body" | tr -d ' ') bytes"
    assert_eq "combo bundle status" "200" "$CODE"
    assert_contains "bundle opens with the loader shell" 'window.__ModuleLoader__.load({ id: "dsh-cli-doctor", factory: (require) => {' "$LOGDIR/client-bundle.body"
    assert_contains "bundle registers sidebar.panellist" "sidebar.panellist" "$LOGDIR/client-bundle.body"
    assert_contains "bundle carries the panel id" '"cli-doctor"' "$LOGDIR/client-bundle.body"
    assert_contains "bundle carries the check route" "/api/cli-doctor/check" "$LOGDIR/client-bundle.body"
    # v2 client surface (CONTRACT v2.3): the shipped bytes must carry the
    # snapshot/status/cancel wiring, not only the v1 check route.
    assert_contains "bundle carries the snapshot route" "/api/cli-doctor/snapshot" "$LOGDIR/client-bundle.body"
    assert_contains "bundle carries the status route" "/api/cli-doctor/status" "$LOGDIR/client-bundle.body"
    assert_contains "bundle carries the cancel route" "/api/cli-doctor/check/cancel" "$LOGDIR/client-bundle.body"

    # UI-1 (task-5/task-6): the bytes the GUI actually receives must carry the
    # scrolling layout, not just the on-disk artifact.
    say "  artifact sha256 on disk: $(shasum -a 256 "$PKG_DIR/lib/client.js" | cut -d' ' -f1)"
    assert_contains "served bytes carry root height" 'height: "100%"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry root flex" 'flex: "1 1 auto"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the scroll container" 'data-dsh-cli-doctor-scroll' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry overflowY" 'overflowY: "auto"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry overscrollBehavior" 'overscrollBehavior: "contain"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes pin the header" 'flexShrink: 0' "$LOGDIR/client-bundle.body"
    # v2 theme tokens replace hard-coded semantic colors (CONTRACT v2.3).
    assert_contains "served bytes use a theme token for state colors" "var(--dsw-alias-" "$LOGDIR/client-bundle.body"
    # v2.8 batch-2 surface: report copy + summary-card filter (strings are inlined
    # into the shipped bundle, so the GUI really receives them).
    assert_contains "served bytes carry the report copy action" "复制报告" "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the raw JSON copy action" "复制原始 JSON" "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the copy fallback marker" "data-dsh-cli-doctor-copy" "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the copy feedback marker" "data-dsh-cli-doctor-copy-feedback" "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the summary filter clear action" "清除筛选" "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the filter match header" "匹配 " "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry aria-pressed summary cards" "aria-pressed" "$LOGDIR/client-bundle.body"
  fi
fi

hdr "21. server log warnings"
for LOG in "$LOGDIR"/server-*.log; do
  say "--- $LOG (tail 10) ---"
  tail -10 "$LOG"
done
if grep -qiE "unhandled|uncaught|exception" "$LOGDIR"/server-*.log; then
  bad "a server log contains unhandled/uncaught/exception"
else
  ok "no server log contains unhandled/uncaught/exception markers"
fi

summary "e2e-api"
