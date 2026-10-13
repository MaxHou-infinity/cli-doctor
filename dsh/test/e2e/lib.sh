#!/usr/bin/env bash
# Shared helpers for the cli-doctor DSH end-to-end verification scripts.
#
# Source this file, never execute it:
#   . "$(dirname "$0")/lib.sh"
#
# Hard safety rules encoded here:
#   * every run uses DSH_HOME inside this repository (default <repo>/.dsh-test);
#     the user's real ~/.dsh is refused outright;
#   * all artifacts are written under $LOGDIR (inside .dsh-test/);
#   * the scripts never modify dsh/src, dsh/lib, dsh/scripts or Codex files.

set -uo pipefail

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$E2E_DIR/../../.." && pwd)"
PKG_DIR="$REPO_ROOT/dsh"

DSH_BIN="${DSH_BIN:-dsh}"
PROFILE="${PROFILE:-scratch}"
PORT="${PORT:-19390}"
BASE_URL="http://127.0.0.1:$PORT"

# ---- safety fence: DSH_HOME must stay inside the repository --------------
# This harness owns its DSH_HOME by default and never inherits one from the
# calling shell: an interactive DSH session (or the desktop shell) exports the
# user's real ~/.dsh, and a test run must never write there. E2E_DSH_HOME is the
# only knob, and it is itself fenced to the repository.
E2E_DSH_HOME="${E2E_DSH_HOME:-$REPO_ROOT/.dsh-test}"
case "$E2E_DSH_HOME" in
  "$REPO_ROOT"/*) : ;;
  *)
    printf 'FATAL: E2E_DSH_HOME must live inside %s (got %s).\n' "$REPO_ROOT" "$E2E_DSH_HOME" >&2
    printf 'This guard exists so an end-to-end run can never touch the user profile.\n' >&2
    exit 2
    ;;
esac
if [ -n "${DSH_HOME:-}" ] && [ "$DSH_HOME" != "$E2E_DSH_HOME" ]; then
  printf 'NOTE: ignoring inherited DSH_HOME=%s; this harness uses %s\n' "$DSH_HOME" "$E2E_DSH_HOME" >&2
fi
DSH_HOME="$E2E_DSH_HOME"
export DSH_HOME

STAMP="${STAMP:-$(date +%Y%m%d-%H%M%S)}"
LOGDIR="${LOGDIR:-$DSH_HOME/e2e-$STAMP}"
mkdir -p "$LOGDIR"

# ---- result bookkeeping ---------------------------------------------------
PASS=0
FAIL=0
UNVERIFIED=0
FAILURES=()

# All human-readable narration goes to stderr so that $(req ...) captures only
# the HTTP status code. Everything is still mirrored into the run log.
say() { printf '%s\n' "$*" | tee -a "$LOGDIR/run.log" >&2; }
hdr() { say ""; say "================ $* ================"; }
ok()  { PASS=$((PASS + 1)); say "PASS: $*"; }
bad() { FAIL=$((FAIL + 1)); FAILURES+=("$*"); say "FAIL: $*"; }
skip(){ UNVERIFIED=$((UNVERIFIED + 1)); say "UNVERIFIED: $*"; }

summary() {
  local title="$1"
  say ""
  say "---------------- $title: pass=$PASS fail=$FAIL unverified=$UNVERIFIED ----------------"
  if [ "$FAIL" -gt 0 ]; then
    say "failed assertions:"
    local f
    for f in "${FAILURES[@]}"; do say "  - $f"; done
  fi
  say "raw logs: $LOGDIR"
  [ "$FAIL" -eq 0 ] || return 1
  return 0
}

# ---- assertions -----------------------------------------------------------
assert_eq() { # label expected actual
  if [ "$2" = "$3" ]; then ok "$1 (=$3)"; else bad "$1: expected [$2] actual [$3]"; fi
}

assert_contains() { # label needle file
  if grep -qF -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1: [$2] not found in $3"; fi
}

assert_not_contains() { # label needle file
  if grep -qF -- "$2" "$3" 2>/dev/null; then bad "$1: [$2] unexpectedly present in $3"; else ok "$1"; fi
}

assert_matches() { # label regex file
  if grep -qE -- "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1: /$2/ does not match $3"; fi
}

assert_file() { # label path
  if [ -f "$2" ]; then ok "$1"; else bad "$1: missing file $2"; fi
}

# ---- JSON helpers ---------------------------------------------------------
json_get() { # file dot.path
  node -e '
    const fs = require("node:fs");
    const [file, dotted] = process.argv.slice(1);
    let value = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of dotted.split(".")) {
      if (key === "") continue;
      value = value === null || value === undefined ? value : value[key];
    }
    if (value === undefined) { process.stdout.write(""); }
    else if (typeof value === "object") { process.stdout.write(JSON.stringify(value)); }
    else { process.stdout.write(String(value)); }
  ' "$1" "$2"
}

assert_json() { # label file dot.path expected
  local actual
  actual="$(json_get "$2" "$3" 2>/dev/null)"
  assert_eq "$1" "$4" "$actual"
}

is_valid_json() { # file
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$1" >/dev/null 2>&1
}

assert_valid_json() { # label file
  if is_valid_json "$2"; then ok "$1"; else bad "$1: $2 is not valid JSON"; fi
}

# ---- ports / HTTP ---------------------------------------------------------
free_port() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  '
}

# req <label> <method> <path> [extra curl args...]  -> prints the status code
# Raw evidence lands in $LOGDIR/<label>.{status,headers,body,err}
req() {
  local label="$1" method="$2" path="$3"
  shift 3
  local base="$LOGDIR/$label"
  local code
  local method_args=(-X "$method")
  # `curl -X HEAD` waits for a body that HEAD never sends; --head is the correct form.
  [ "$method" = "HEAD" ] && method_args=(--head)
  code="$(curl -sS --max-time "${CURL_MAX_TIME:-600}" "${method_args[@]}" \
    -o "$base.body" -D "$base.headers" -w '%{http_code}' \
    "$BASE_URL$path" "$@" 2>"$base.err")" || code="000"
  printf '%s' "$code" >"$base.status"
  say "  -> $method $path [$label] = $code ($(wc -c <"$base.body" | tr -d ' ') bytes)"
  printf '%s' "$code"
}

wait_for_url() { # url tries
  local url="$1" tries="${2:-180}" i=0 code
  while [ "$i" -lt "$tries" ]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || true)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then return 0; fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# ---- process cleanup ------------------------------------------------------
E2E_PIDS=()
cleanup_pids() {
  local pid
  for pid in "${E2E_PIDS[@]:-}"; do
    [ -n "$pid" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      local i=0
      while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.5; i=$((i + 1)); done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  E2E_PIDS=()
}
