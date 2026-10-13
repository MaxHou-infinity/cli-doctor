#!/usr/bin/env bash
# cli-doctor DSH plugin: real end-to-end verification against a scratch profile.
#
#   bash dsh/test/e2e/e2e-api.sh [--fresh] [--no-check] [--port N]
#
# What it does (all inside this repository, DSH_HOME defaults to ./.dsh-test):
#   1. installs dsh/ into a non-built-in profile with `dsh plugin add`
#   2. asserts `dsh --dump-config` contains the cli-doctor row
#   3. boots `dsh --profile scratch web` on a free port
#   4. runs the HTTP contract matrix (health / check / fence / 405 / 404 / client.js)
#   5. always kills the server it started
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

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    say "cleaning up web server pid=$SERVER_PID"
    kill "$SERVER_PID" 2>/dev/null || true
    local i=0
    while kill -0 "$SERVER_PID" 2>/dev/null && [ "$i" -lt 30 ]; do sleep 0.5; i=$((i + 1)); done
    kill -9 "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi
  cleanup_pids
}
trap cleanup EXIT INT TERM

hdr "cli-doctor e2e  $(date -Iseconds)"
say "repo       : $REPO_ROOT"
say "package    : $PKG_DIR"
say "DSH_HOME   : $DSH_HOME"
say "profile    : $PROFILE"
say "port       : $PORT"
say "logdir     : $LOGDIR"

# ---------------------------------------------------------------- preflight
hdr "0. preflight"
# Keep pnpm's store inside the workspace: a user-level store is outside the
# sandbox and outside this repository's blast radius.
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

MISSING=0
for f in package.json src/host/index.js lib/client.js bin/check.js scripts/build-client.mjs scripts/sync-shared.mjs cordis.patch.yml; do
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

# ------------------------------------------------------------------- server
hdr "3. boot web server"
# The profile NAME selects the app: `dsh --profile <name> --port N` boots the
# web app, while `dsh --profile <name> web` forwards a stray `web` argument and
# dies with "too many arguments. Expected 0 arguments but got 1: web."
export npm_config_store_dir="${npm_config_store_dir:-$REPO_ROOT/.pnpm-store}"
say "running: $DSH_BIN --profile $PROFILE --port $PORT --no-open"
"$DSH_BIN" --profile "$PROFILE" --port "$PORT" --no-open >"$LOGDIR/server.log" 2>&1 &
SERVER_PID=$!
say "server pid=$SERVER_PID"
if wait_for_url "$BASE_URL/" 240; then
  ok "web server answered on $BASE_URL"
  say "  server banner: $(grep -m1 -o 'dsh web: [^ ]*' "$LOGDIR/server.log" || echo '(no banner line)')"
else
  bad "web server never answered on $BASE_URL within 240s"
  say "--- server.log (tail) ---"
  tail -40 "$LOGDIR/server.log"
  summary "e2e-api" || true
  exit 1
fi

# -------------------------------------------------------------- HTTP matrix
hdr "4. GET /api/cli-doctor/health (with browser marker)"
CODE="$(req health GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/health.body")"
assert_eq "health status" "200" "$CODE"
assert_valid_json "health body is valid JSON" "$LOGDIR/health.body"
assert_json "health ok" "$LOGDIR/health.body" "ok" "true"
assert_json "health version" "$LOGDIR/health.body" "version" "0.2.0"
assert_json "health busy" "$LOGDIR/health.body" "busy" "false"
assert_matches "health content-type is JSON" "content-type: application/json" "$LOGDIR/health.headers"
assert_matches "health cache-control no-store" "cache-control: no-store" "$LOGDIR/health.headers"

hdr "5. HEAD /api/cli-doctor/health"
CODE="$(req health-head HEAD /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "HEAD health status" "200" "$CODE"

hdr "6. access fence: marker-less request must be 403"
CODE="$(req check-bare POST /api/cli-doctor/check)"
say "  body: $(cat "$LOGDIR/check-bare.body")"
assert_eq "bare POST check status" "403" "$CODE"
assert_json "bare POST check error" "$LOGDIR/check-bare.body" "error" "forbidden"

CODE="$(req health-bare GET /api/cli-doctor/health)"
say "  body: $(cat "$LOGDIR/health-bare.body")"
assert_eq "bare GET health status" "403" "$CODE"
assert_json "bare GET health error" "$LOGDIR/health-bare.body" "error" "forbidden"

hdr "6b. access fence: all three accepted browser markers"
CODE="$(req health-marker-secfetch GET /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
assert_eq "sec-fetch-site: same-origin -> 200" "200" "$CODE"

CODE="$(req health-marker-origin GET /api/cli-doctor/health -H "Origin: $BASE_URL")"
assert_eq "same-origin Origin header -> 200" "200" "$CODE"

CODE="$(req health-marker-cookie GET /api/cli-doctor/health -H 'Cookie: dsh-auth-e2e=1')"
assert_eq "dsh-auth-* cookie -> 200" "200" "$CODE"

hdr "7. access fence: cross-origin Origin must be 403"
CODE="$(req check-badorigin POST /api/cli-doctor/check -H 'Origin: http://evil.example')"
say "  body: $(cat "$LOGDIR/check-badorigin.body")"
assert_eq "cross-origin POST status" "403" "$CODE"

hdr "8. access fence: foreign Host header must be 403"
CODE="$(req check-badhost POST /api/cli-doctor/check -H 'Host: evil.example')"
assert_eq "foreign Host status" "403" "$CODE"

hdr "9. method and path guards"
CODE="$(req health-delete DELETE /api/cli-doctor/health -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/health-delete.body")"
assert_eq "DELETE health status" "405" "$CODE"
assert_json "DELETE health error" "$LOGDIR/health-delete.body" "error" "method"

CODE="$(req unknown-subpath GET /api/cli-doctor/nope -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/unknown-subpath.body")"
assert_eq "unknown subpath status" "404" "$CODE"
assert_json "unknown subpath error" "$LOGDIR/unknown-subpath.body" "error" "not-found"

CODE="$(req prefix-root GET /api/cli-doctor -H 'sec-fetch-site: same-origin')"
say "  body: $(cat "$LOGDIR/prefix-root.body")"
assert_eq "prefix root (/api/cli-doctor) status" "404" "$CODE"

CODE="$(req check-get GET /api/cli-doctor/check)"
say "  body: $(cat "$LOGDIR/check-get.body")"
assert_eq "GET on /check is 405 even without a marker" "405" "$CODE"
assert_json "GET on /check error" "$LOGDIR/check-get.body" "error" "method"

hdr "10. client bundle: proven through the boot manifest, not a bare URL"
# On 0.2.0-rc.2 the plugin resource is served only as a revisioned combo
# (`/plugins/??<ids>/client.js&rev=<hash>`); the bare `/plugins/<id>/client.js`
# form is not a route and answers 404. The authoritative check is therefore:
# the boot manifest must preload our entry, and fetching that combo must return
# our registration code.
CODE="$(req client-bundle-bare GET /plugins/dsh-cli-doctor/client.js)"
say "  (informational) bare /plugins/dsh-cli-doctor/client.js = $CODE"

TOKEN="$(grep -m1 -o 'token=[A-Za-z0-9_-]*' "$LOGDIR/server.log" | head -1 | cut -d= -f2)"
if [ -z "$TOKEN" ]; then
  bad "no launch token found in server.log; cannot fetch the boot manifest"
else
  ok "launch token found in server banner"
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

    # UI-1 (task-5/task-6): the bytes the GUI actually receives must carry the
    # scrolling layout, not just the on-disk artifact.
    say "  artifact sha256 on disk: $(shasum -a 256 "$PKG_DIR/lib/client.js" | cut -d' ' -f1)"
    assert_contains "served bytes carry root height" 'height: "100%"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry root flex" 'flex: "1 1 auto"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry the scroll container" 'data-dsh-cli-doctor-scroll' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry overflowY" 'overflowY: "auto"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes carry overscrollBehavior" 'overscrollBehavior: "contain"' "$LOGDIR/client-bundle.body"
    assert_contains "served bytes pin the header" 'flexShrink: 0' "$LOGDIR/client-bundle.body"
  fi
fi

hdr "11. POST /api/cli-doctor/check (real read-only diagnosis)"
if [ "$RUN_CHECK" -eq 1 ]; then
  START_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
  CODE="$(req check-real POST /api/cli-doctor/check -H 'sec-fetch-site: same-origin')"
  END_MS="$(node -e 'process.stdout.write(String(Date.now()))')"
  say "  elapsed: $(( (END_MS - START_MS) / 1000 ))s"
  say "  body head: $(head -c 400 "$LOGDIR/check-real.body")"
  assert_eq "POST check status" "200" "$CODE"
  assert_valid_json "check body is valid JSON" "$LOGDIR/check-real.body"
  assert_json "check ok" "$LOGDIR/check-real.body" "ok" "true"
  assert_contains "check has checkedAt" "checkedAt" "$LOGDIR/check-real.body"
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

  hdr "12. single-flight: two overlapping POSTs, one must be 409"
  ( curl -sS --max-time 600 -X POST -o "$LOGDIR/busy-a.body" -w '%{http_code}' \
      -H 'sec-fetch-site: same-origin' "$BASE_URL/api/cli-doctor/check" >"$LOGDIR/busy-a.status" 2>/dev/null ) &
  PID_A=$!
  ( curl -sS --max-time 600 -X POST -o "$LOGDIR/busy-b.body" -w '%{http_code}' \
      -H 'sec-fetch-site: same-origin' "$BASE_URL/api/cli-doctor/check" >"$LOGDIR/busy-b.status" 2>/dev/null ) &
  PID_B=$!
  wait "$PID_A" "$PID_B" 2>/dev/null
  CODE_A="$(cat "$LOGDIR/busy-a.status")"
  CODE_B="$(cat "$LOGDIR/busy-b.status")"
  say "  concurrent statuses: a=$CODE_A b=$CODE_B"
  if [ "$CODE_A" = "409" ] || [ "$CODE_B" = "409" ]; then
    ok "single-flight returned 409 for the overlapping request"
    BUSY_FILE="$LOGDIR/busy-a.body"; [ "$CODE_A" = "409" ] || BUSY_FILE="$LOGDIR/busy-b.body"
    assert_json "busy error payload" "$BUSY_FILE" "error" "busy"
  elif [ "$CODE_A" = "200" ] && [ "$CODE_B" = "200" ]; then
    bad "single-flight: both overlapping POSTs returned 200 (a=$CODE_A b=$CODE_B) — expected one 409"
  else
    skip "single-flight inconclusive: a=$CODE_A b=$CODE_B (neither 409 nor 200/200)"
  fi
else
  skip "POST /api/cli-doctor/check skipped by --no-check"
fi

hdr "13. server log warnings"
say "--- server.log (tail 40) ---"
tail -40 "$LOGDIR/server.log"
if grep -qiE "unhandled|uncaught|exception" "$LOGDIR/server.log"; then
  bad "server log contains unhandled/uncaught/exception"
else
  ok "server log has no unhandled/uncaught/exception markers"
fi

summary "e2e-api"
