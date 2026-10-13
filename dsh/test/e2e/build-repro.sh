#!/usr/bin/env bash
# Build reproducibility and artifact stability (CONTRACT §5/§6).
#
#   bash dsh/test/e2e/build-repro.sh [--with-tests]
#
# Asserts:
#   1. `npm run build` succeeds;
#   2. the whole dsh/ tree (minus node_modules) is byte-identical before/after,
#      so the committed artifacts already match their sources;
#   3. a second build is idempotent (no rewrite, no new diff);
#   4. `git status --porcelain` gains no entry;
#   5. `node scripts/sync-shared.mjs --check` passes;
#   6. with --with-tests, `npm test` (the package's own suite) passes.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

WITH_TESTS=0
[ "${1:-}" = "--with-tests" ] && WITH_TESTS=1

# Digest of every tracked-ish file in the package, excluding node_modules.
tree_digest() {
  find "$PKG_DIR" -type f -not -path '*/node_modules/*' -print0 |
    sort -z |
    xargs -0 shasum -a 256 |
    sed "s#$PKG_DIR/##" |
    shasum -a 256 |
    cut -d' ' -f1
}

hdr "build reproducibility"
say "repo: $REPO_ROOT"

BEFORE_DIGEST="$(tree_digest)"
BEFORE_STATUS="$(git -C "$REPO_ROOT" status --porcelain)"
say "tree digest before : ${BEFORE_DIGEST:0:16}…"
say "artifacts before:"
for f in lib/client.js bin/check.js bin/python_dependency_audit.py bin/package.json; do
  if [ -f "$PKG_DIR/$f" ]; then
    say "  $(shasum -a 256 "$PKG_DIR/$f" | cut -d' ' -f1 | cut -c1-16)…  dsh/$f ($(wc -c <"$PKG_DIR/$f" | tr -d ' ') bytes)"
  else
    say "  (absent)          dsh/$f"
  fi
done

# Set EXPECTED_CLIENT_SHA256 to pin the reviewed artifact; both builds below must
# reproduce exactly this value.
if [ -n "${EXPECTED_CLIENT_SHA256:-}" ]; then
  CLIENT_SHA="$(shasum -a 256 "$PKG_DIR/lib/client.js" | cut -d' ' -f1)"
  assert_eq "lib/client.js sha256 matches the reviewed artifact" "$EXPECTED_CLIENT_SHA256" "$CLIENT_SHA"
else
  skip "EXPECTED_CLIENT_SHA256 not set; artifact identity only checked for stability"
fi

hdr "1. npm run build"
( cd "$PKG_DIR" && npm run build ) >"$LOGDIR/build-1.log" 2>&1
RC1=$?
say "build #1 exit=$RC1"
tail -12 "$LOGDIR/build-1.log"
assert_eq "build #1 exit code" "0" "$RC1"

AFTER1_DIGEST="$(tree_digest)"
say "tree digest after #1: ${AFTER1_DIGEST:0:16}…"
assert_eq "build #1 leaves the package byte-identical" "$BEFORE_DIGEST" "$AFTER1_DIGEST"

hdr "2. second build is idempotent"
( cd "$PKG_DIR" && npm run build ) >"$LOGDIR/build-2.log" 2>&1
RC2=$?
say "build #2 exit=$RC2"
tail -12 "$LOGDIR/build-2.log"
assert_eq "build #2 exit code" "0" "$RC2"
AFTER2_DIGEST="$(tree_digest)"
assert_eq "build #2 leaves the package byte-identical" "$BEFORE_DIGEST" "$AFTER2_DIGEST"
if grep -q "unchanged" "$LOGDIR/build-2.log"; then
  ok "second build reported the artifact as unchanged"
else
  skip "second build did not print an 'unchanged' marker (artifact still byte-identical)"
fi

hdr "3. git status does not change"
AFTER_STATUS="$(git -C "$REPO_ROOT" status --porcelain)"
if [ "$BEFORE_STATUS" = "$AFTER_STATUS" ]; then
  ok "git status --porcelain is unchanged by the build"
else
  bad "build changed git status"
  say "--- before ---"; say "$BEFORE_STATUS"
  say "--- after  ---"; say "$AFTER_STATUS"
fi
say "current git status:"
say "$AFTER_STATUS"

hdr "4. sync-shared --check"
( cd "$PKG_DIR" && node scripts/sync-shared.mjs --check ) >"$LOGDIR/sync-check.log" 2>&1
RC3=$?
say "sync --check exit=$RC3"
cat "$LOGDIR/sync-check.log"
assert_eq "sync-shared --check exit code" "0" "$RC3"

hdr "5. package test suite"
if [ "$WITH_TESTS" -eq 1 ]; then
  ( cd "$PKG_DIR" && npm test ) >"$LOGDIR/npm-test.log" 2>&1
  RC4=$?
  say "npm test exit=$RC4"
  # node:test prints either TAP ("# tests N") or the spec reporter ("ℹ tests N").
  grep -E "^([ℹ#] ?(tests|pass|fail|skipped)|(not )?ok )" "$LOGDIR/npm-test.log" | tail -12
  assert_eq "npm test exit code" "0" "$RC4"
  TEST_TOTAL="$(grep -oE "^[ℹ#] ?tests [0-9]+" "$LOGDIR/npm-test.log" | grep -oE "[0-9]+" | tail -1)"
  TEST_FAILED="$(grep -oE "^[ℹ#] ?fail [0-9]+" "$LOGDIR/npm-test.log" | grep -oE "[0-9]+" | tail -1)"
  say "parsed test totals: tests=${TEST_TOTAL:-?} fail=${TEST_FAILED:-?}"
  if [ -n "${EXPECTED_TEST_COUNT:-}" ]; then
    assert_eq "test count matches the expected total" "$EXPECTED_TEST_COUNT" "${TEST_TOTAL:-missing}"
  fi
  assert_eq "no failing test in the author suite" "0" "${TEST_FAILED:-missing}"
else
  skip "npm test not run (pass --with-tests)"
fi

summary "build-repro"
