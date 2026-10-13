#!/usr/bin/env bash
# Negative verification of the client-bundle purity gate (CONTRACT §3.2).
#
#   bash dsh/test/e2e/purity-negative.sh
#
# Everything happens on a COPY of the package under $DSH_HOME/purity-pkg; the
# real dsh/src, dsh/scripts and dsh/lib are never modified. Three steps:
#
#   A. control: the untouched copy builds cleanly;
#   B. a copy whose esbuild marks a non-platform module external and imports it
#      must FAIL the build with the purity error, and must not touch its artifact;
#   C. a bundle hand-patched to require("react-dom") must be refused by the
#      browser-table require used in load-client-bundle.mjs — which is the same
#      failure a real Web GUI would hit, since react-dom is not in the table.

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

WORK="$DSH_HOME/purity-pkg"
NODE_MODULES_LINK="$PKG_DIR/node_modules"

hdr "purity gate negative verification"
say "package copy : $WORK"

for f in scripts/build-client.mjs src/client/index.jsx package.json lib/client.js; do
  assert_file "preflight: dsh/$f exists" "$PKG_DIR/$f"
done
if [ ! -d "$NODE_MODULES_LINK" ]; then
  bad "preflight: dsh/node_modules missing (run the package install first)"
  summary "purity-negative" || true
  exit 3
fi

# ---- fresh copy -----------------------------------------------------------
case "$WORK" in
  "$DSH_HOME"/*) rm -rf "$WORK" ;;
  *) bad "refusing to remove unsafe path $WORK"; summary "purity-negative" || true; exit 2 ;;
esac
mkdir -p "$WORK"
cp -R "$PKG_DIR/scripts" "$PKG_DIR/src" "$PKG_DIR/lib" "$WORK/"
cp "$PKG_DIR/package.json" "$WORK/package.json"
ln -s "$NODE_MODULES_LINK" "$WORK/node_modules"
say "copied package skeleton + symlinked node_modules"

# ---- A. control build -----------------------------------------------------
hdr "A. control: unmodified copy must build"
( cd "$WORK" && node scripts/build-client.mjs ) >"$LOGDIR/purity-A.log" 2>&1
RC_A=$?
say "control build exit=$RC_A"
tail -3 "$LOGDIR/purity-A.log"
assert_eq "control build exit code" "0" "$RC_A"
CONTROL_HASH="$(shasum -a 256 "$WORK/lib/client.js" | cut -d' ' -f1)"
say "control artifact sha256=${CONTROL_HASH:0:16}…"

# ---- B. forbidden require must fail the build -----------------------------
hdr "B. a non-platform require must fail the build"
# The gate inspects the emitted chunk, so the violation is produced the way it
# would occur in practice: a dependency esbuild leaves as a runtime require().
PATCH_SRC_RC=0
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const source = fs.readFileSync(file, "utf8");
  const marker = "import { CliDoctorIcon } from \x27./icon.jsx\x27;";
  if (!source.includes(marker)) { console.error("source anchor not found"); process.exit(1); }
  fs.writeFileSync(file, source.replace(marker, `import \x27react-dom\x27;\n${marker}`));
' "$WORK/src/client/index.jsx" || PATCH_SRC_RC=1
assert_eq "patched the copy's client source" "0" "$PATCH_SRC_RC"
PATCH_BUILD_RC=0
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const source = fs.readFileSync(file, "utf8");
  const from = "external: [...ALLOWED_REQUIRES],";
  if (!source.includes(from)) { console.error("build anchor not found"); process.exit(1); }
  fs.writeFileSync(file, source.replace(from, "external: [...ALLOWED_REQUIRES, \x27react-dom\x27],"));
' "$WORK/scripts/build-client.mjs" || PATCH_BUILD_RC=1
assert_eq "patched the copy's build script" "0" "$PATCH_BUILD_RC"
say "patched copy: src/client/index.jsx imports react-dom; build marks it external"

HASH_BEFORE="$(shasum -a 256 "$WORK/lib/client.js" | cut -d' ' -f1)"
( cd "$WORK" && node scripts/build-client.mjs ) >"$LOGDIR/purity-B.log" 2>&1
RC_B=$?
say "forbidden-require build exit=$RC_B"
say "--- build output ---"
cat "$LOGDIR/purity-B.log"
assert_eq "forbidden-require build fails" "1" "$RC_B"
assert_contains "build names the forbidden target" "forbidden require() target(s): react-dom" "$LOGDIR/purity-B.log"
HASH_AFTER="$(shasum -a 256 "$WORK/lib/client.js" | cut -d' ' -f1)"
assert_eq "failed build did not rewrite lib/client.js" "$HASH_BEFORE" "$HASH_AFTER"

# ---- C. the browser table refuses an unknown module ------------------------
hdr "C. browser-side require of an unknown module must fail"
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes("require(\"react\")")) { console.error("no require(\"react\") anchor"); process.exit(1); }
  fs.writeFileSync(file, source.replace("require(\"react\")", "require(\"react-dom\")"));
' "$WORK/lib/client.js"
node "$E2E_DIR/load-client-bundle.mjs" "$WORK/lib/client.js" >"$LOGDIR/purity-C.log" 2>&1
RC_C=$?
say "patched-bundle load exit=$RC_C"
tail -12 "$LOGDIR/purity-C.log"
assert_eq "loading a bundle that requires react-dom fails" "1" "$RC_C"
assert_contains "harness names the unavailable module" 'the browser module table has no module "react-dom"' "$LOGDIR/purity-C.log"

hdr "D. the real artifact still passes the same harness"
node "$E2E_DIR/load-client-bundle.mjs" "$PKG_DIR/lib/client.js" >"$LOGDIR/purity-D.log" 2>&1
RC_D=$?
say "real bundle load exit=$RC_D"
assert_eq "real bundle passes the loader harness" "0" "$RC_D"
assert_eq "real artifact unchanged by this script" "$CONTROL_HASH" "$(shasum -a 256 "$PKG_DIR/lib/client.js" | cut -d' ' -f1)"

summary "purity-negative"
