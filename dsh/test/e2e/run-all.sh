#!/usr/bin/env bash
# One-shot independent verification sweep for the dsh-cli-doctor plugin.
#
#   bash dsh/test/e2e/run-all.sh [--port 19390] [--skip-e2e]
#
# Every stage is also runnable on its own; this script only orders them and
# aggregates pass/fail. It never writes outside the repository: DSH_HOME is
# forced to <repo>/.dsh-test by lib.sh, and the user's real ~/.dsh is refused.
#
# Stages
#   1 build-repro.sh --with-tests   build idempotence + author suite
#   2 load-client-bundle.mjs        loader shell, slots, disposers, first paint
#   3 view-contract.mjs             pure view semantics + malformed reports
#   4 panel-behavior.mjs            jsdom click-through, loading/error states
#   5 purity-negative.sh            purity gate must reject a foreign require
#   6 codex-decouple.sh             Codex paths untouched + smoke test
#   7 e2e-api.sh                    real scratch profile + HTTP matrix

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

E2E_PORT="$PORT"
SKIP_E2E=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; E2E_PORT="$1" ;;
    --skip-e2e) SKIP_E2E=1 ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

STAGE_RESULTS=()
run_stage() { # label command...
  local label="$1"; shift
  hdr "stage: $label"
  "$@"
  local rc=$?
  if [ "$rc" -eq 0 ]; then STAGE_RESULTS+=("PASS  $label"); else STAGE_RESULTS+=("FAIL  $label (exit $rc)"); fi
  return 0
}

run_stage "build reproducibility" bash "$E2E_DIR/build-repro.sh" --with-tests
run_stage "client bundle loader" node "$E2E_DIR/load-client-bundle.mjs"
run_stage "view contract" node "$E2E_DIR/view-contract.mjs"
run_stage "panel behavior (jsdom)" node "$E2E_DIR/panel-behavior.mjs"
run_stage "purity gate negative" bash "$E2E_DIR/purity-negative.sh"
run_stage "codex decoupling" bash "$E2E_DIR/codex-decouple.sh"
if [ "$SKIP_E2E" -eq 1 ]; then
  STAGE_RESULTS+=("SKIP  real DSH end-to-end (--skip-e2e)")
  STAGE_RESULTS+=("SKIP  host failure paths (--skip-e2e)")
  STAGE_RESULTS+=("SKIP  real browser layout (--skip-e2e)")
else
  run_stage "real DSH end-to-end (port $E2E_PORT)" bash "$E2E_DIR/e2e-api.sh" --port "$E2E_PORT"
  run_stage "host failure paths (port $((E2E_PORT + 2)))" bash "$E2E_DIR/e2e-failure-paths.sh" --port "$((E2E_PORT + 2))"
  # Skips itself (exit 0) when no Chrome is installed, so the sweep stays green
  # on machines that cannot measure real layout.
  run_stage "real browser layout (port $((E2E_PORT + 4)))" bash "$E2E_DIR/e2e-browser-layout.sh" --port "$((E2E_PORT + 4))"
fi

hdr "combined result"
failures=0
for entry in "${STAGE_RESULTS[@]}"; do
  say "$entry"
  case "$entry" in FAIL*) failures=$((failures + 1)) ;; esac
done
say ""
say "logs: $LOGDIR"
if [ "$failures" -eq 0 ]; then
  say "ALL STAGES PASSED"
  exit 0
fi
say "$failures stage(s) failed"
exit 1
