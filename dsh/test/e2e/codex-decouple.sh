#!/usr/bin/env bash
# Codex-side decoupling regression (CONTRACT §0).
#
#   bash dsh/test/e2e/codex-decouple.sh
#
# Asserts that the DSH work touched nothing on the Codex adapter path, that the
# Codex smoke test still passes, that the vendored diagnosis scripts are
# byte-identical to their sources, and that the DSH halves are self-contained
# (no import of @deepseek-ai runtime values, no reference to dashboard/**).

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Every path CONTRACT §0 forbids touching, relative to the repository root.
PROTECTED="plugin.json mcp.json codex-server.js codex-bridge.js dashboard .agents SKILL.md bin package.json test"

hdr "Codex decoupling"
say "repo: $REPO_ROOT"
say "protected paths: $PROTECTED"

hdr "1. git status --porcelain"
git -C "$REPO_ROOT" status --porcelain >"$LOGDIR/git-status.txt"
cat "$LOGDIR/git-status.txt"
if [ -s "$LOGDIR/git-status.txt" ]; then
  ok "git status captured ($(wc -l <"$LOGDIR/git-status.txt" | tr -d ' ') entr(ies))"
else
  say "(clean tree)"
fi

VIOLATIONS="$(node -e '
  const fs = require("node:fs");
  const protectedPaths = process.argv[1].split(" ");
  const lines = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
  const hits = [];
  for (const line of lines) {
    const file = line.slice(3).trim().replace(/^"|"$/g, "");
    for (const guarded of protectedPaths) {
      if (file === guarded || file.startsWith(guarded + "/")) hits.push(`${line}  <-- ${guarded}`);
    }
  }
  process.stdout.write(hits.join("\n"));
' "$PROTECTED" "$LOGDIR/git-status.txt")"

if [ -z "$VIOLATIONS" ]; then
  ok "no protected Codex path appears in git status"
else
  bad "protected Codex paths were modified:"
  say "$VIOLATIONS"
fi

hdr "2. tracked diffs against protected paths"
git -C "$REPO_ROOT" diff --name-only -- $PROTECTED >"$LOGDIR/git-diff-protected.txt" 2>&1
if [ -s "$LOGDIR/git-diff-protected.txt" ]; then
  bad "tracked modifications inside protected paths:"
  cat "$LOGDIR/git-diff-protected.txt"
else
  ok "no tracked modification inside protected paths"
fi

hdr "3. Codex smoke test"
( cd "$REPO_ROOT" && node test/codex_plugin_smoke.js ) >"$LOGDIR/codex-smoke.log" 2>&1
RC=$?
say "codex smoke exit=$RC"
cat "$LOGDIR/codex-smoke.log"
assert_eq "codex smoke test exit code" "0" "$RC"
assert_contains "codex smoke test reports success" "MCP 握手、侧栏入口和页面资源正常" "$LOGDIR/codex-smoke.log"

hdr "4. vendored scripts are byte-identical to their sources"
for f in check.js python_dependency_audit.py; do
  SRC_HASH="$(shasum -a 256 "$REPO_ROOT/bin/$f" | cut -d' ' -f1)"
  DST_HASH="$(shasum -a 256 "$PKG_DIR/bin/$f" | cut -d' ' -f1)"
  if [ "$SRC_HASH" = "$DST_HASH" ]; then
    ok "dsh/bin/$f == bin/$f (${SRC_HASH:0:16}…)"
  else
    bad "dsh/bin/$f differs from bin/$f (src ${SRC_HASH:0:16}… dst ${DST_HASH:0:16}…)"
  fi
done

hdr "5. DSH halves stay self-contained"
if grep -rn "@deepseek-ai" "$PKG_DIR/src" "$PKG_DIR/lib" 2>/dev/null | grep -vE '^\S+:\s*(\*|//)' | grep -q .; then
  bad "runtime import of a @deepseek-ai module found in dsh/src or dsh/lib:"
  grep -rn "@deepseek-ai" "$PKG_DIR/src" "$PKG_DIR/lib" | head -10
else
  ok "no @deepseek-ai runtime reference in dsh/src or dsh/lib"
fi

# A comment naming dashboard/app.js as the porting reference is fine; an import
# or require of it is not.
if grep -rnE "(from|require\()\s*['\"][^'\"]*dashboard/" "$PKG_DIR/src" "$PKG_DIR/lib" 2>/dev/null | grep -q .; then
  bad "dsh/src or dsh/lib imports from dashboard/:"
  grep -rnE "(from|require\()\s*['\"][^'\"]*dashboard/" "$PKG_DIR/src" "$PKG_DIR/lib" | head -10
else
  ok "dsh never imports from dashboard/ (comments may name it as the reference)"
fi

if grep -rnE "from ['\"](\.\./)+bin/|require\(['\"](\.\./)+bin/" "$PKG_DIR/src" "$PKG_DIR/lib" 2>/dev/null | grep -q .; then
  bad "dsh runtime code reaches outside the package for bin/:"
  grep -rnE "from ['\"](\.\./)+bin/|require\(['\"](\.\./)+bin/" "$PKG_DIR/src" "$PKG_DIR/lib" | head
else
  ok "dsh runtime code does not reach outside the package for bin/"
fi

summary "codex-decouple"
