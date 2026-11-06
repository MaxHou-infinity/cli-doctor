#!/usr/bin/env bash
# Codex-side decoupling regression (CONTRACT §0).
#
#   bash dsh/test/e2e/codex-decouple.sh
#
# Asserts that the DSH work touched nothing on the Codex adapter path (the only
# allowed exception is the unified-version line in plugin.json / SKILL.md /
# root package.json, checked in §2), that the
# Codex smoke test still passes, that the vendored diagnosis scripts are
# byte-identical to their sources, and that the DSH halves are self-contained
# (no import of @deepseek-ai runtime values, no reference to dashboard/**).

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Every path CONTRACT §0 forbids touching, relative to the repository root.
# The unified-version release convention bumps plugin.json / SKILL.md / root
# package.json, so those three may change **only** on their version line;
# everything else must stay untouched and is guarded strictly below.
PROTECTED="plugin.json mcp.json codex-server.js codex-bridge.js dashboard .agents SKILL.md bin package.json test"
STRICT_PROTECTED="mcp.json codex-server.js codex-bridge.js dashboard .agents bin test"
VERSION_MANIFESTS="plugin.json SKILL.md package.json"

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
' "$STRICT_PROTECTED" "$LOGDIR/git-status.txt")"

if [ -z "$VIOLATIONS" ]; then
  ok "no strictly-protected Codex path appears in git status"
else
  bad "strictly-protected Codex paths were modified:"
  say "$VIOLATIONS"
fi

hdr "2. tracked diffs against protected paths"
# Strict paths: any tracked change is a violation.
git -C "$REPO_ROOT" diff --name-only -- $STRICT_PROTECTED >"$LOGDIR/git-diff-strict.txt" 2>&1
if [ -s "$LOGDIR/git-diff-strict.txt" ]; then
  bad "tracked modifications inside strictly-protected paths:"
  cat "$LOGDIR/git-diff-strict.txt"
else
  ok "no tracked modification inside strictly-protected paths"
fi

# Version manifests: only the version line may differ, and the new version must
# equal the root package.json version (the repo's unified-version convention).
ROOT_VERSION="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version || ""))' "$REPO_ROOT/package.json")"
say "unified version: $ROOT_VERSION"
for f in $VERSION_MANIFESTS; do
  if git -C "$REPO_ROOT" diff --quiet -- "$f"; then
    ok "$f unchanged"
    continue
  fi
  SAFE_NAME="$(echo "$f" | tr '/' '-')"
  git -C "$REPO_ROOT" diff -U0 -- "$f" >"$LOGDIR/diff-$SAFE_NAME.txt" 2>&1
  NON_VERSION="$(grep -E '^[+-][^+-]' "$LOGDIR/diff-$SAFE_NAME.txt" | grep -viE 'version' || true)"
  FILE_VERSION="$(node -e '
    const fs = require("node:fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const m = text.match(/"?version"?\s*[:=]\s*"([^"]+)"/);
    process.stdout.write(m ? m[1] : "");
  ' "$REPO_ROOT/$f")"
  if [ -n "$NON_VERSION" ]; then
    bad "$f changed beyond its version line:"
    say "$NON_VERSION"
  elif [ "$FILE_VERSION" != "$ROOT_VERSION" ]; then
    bad "$f version ($FILE_VERSION) != root version ($ROOT_VERSION)"
  else
    ok "$f diff is version-only and matches $ROOT_VERSION"
  fi
done

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
