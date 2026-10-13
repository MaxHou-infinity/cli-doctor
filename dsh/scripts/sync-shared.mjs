#!/usr/bin/env node
/**
 * sync-shared.mjs — vendor the repository's read-only diagnosis scripts into the
 * DSH plugin package.
 *
 * The plugin ships as `dsh/` and must not reach outside its own directory at
 * runtime, so `bin/check.js` and `bin/python_dependency_audit.py` are copied to
 * `dsh/bin/` (check.js resolves its Python helper next to itself) and committed.
 * `dsh/bin/package.json` is maintained alongside them as the CommonJS boundary
 * marker (see BIN_BOUNDARY_CONTENT): this package is ESM, the vendored scripts
 * are CommonJS, and without the nested declaration Node refuses to load them.
 *
 * Guarantees:
 *   - idempotent: a destination whose sha256 already equals the source is left
 *     untouched (no rewrite, no mtime churn), so re-running is a no-op;
 *   - verified: every destination is re-hashed after the copy and must match the
 *     source exactly, and strays in `dsh/bin/` are reported;
 *   - explicit failure: a missing source, an unreadable file, or a hash mismatch
 *     prints the reason and exits 1 — the sync never silently ships a stale copy.
 *
 * Usage:
 *   node scripts/sync-shared.mjs           copy (or refresh) dsh/bin/**
 *   node scripts/sync-shared.mjs --check   verify only, write nothing
 */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PKG_ROOT, '..')
const SRC_DIR = path.join(REPO_ROOT, 'bin')
const DEST_DIR = path.join(PKG_ROOT, 'bin')

/** Files vendored from ../bin into dsh/bin. Keep in sync with test/parity.test.mjs. */
const SHARED_FILES = ['check.js', 'python_dependency_audit.py']

/**
 * Node's module-system boundary for the vendored scripts.
 *
 * The vendored check.js is CommonJS, but this package declares
 * `"type": "module"` (dsh/package.json), so without a nested declaration Node
 * parses dsh/bin/check.js as ESM and every diagnosis dies with
 * `ReferenceError: require is not defined in ES module scope` — i.e. POST
 * /api/cli-doctor/check answers 500 exit-1. A nested `bin/package.json` with
 * exactly this content scopes the CommonJS declaration to the vendored copies
 * while leaving src/** and the build scripts ESM.
 *
 * Maintained, not copied from ../bin (the repository root has no such file),
 * and validated on every run: drift fails loudly instead of silently breaking
 * the diagnosis subprocess.
 */
const BIN_BOUNDARY_FILE = 'package.json'
const BIN_BOUNDARY_CONTENT = '{"type":"commonjs"}'

/** Everything this script owns inside dsh/bin; anything else is a stray. */
const GENERATED_FILES = [...SHARED_FILES, BIN_BOUNDARY_FILE]

const checkOnly = process.argv.includes('--check')

/** sha256 of a file's bytes, or null when it cannot be read. */
function sha256(file) {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

let failed = 0

function fail(message) {
  failed += 1
  process.stderr.write(`sync-shared: ERROR ${message}\n`)
}

if (!existsSync(SRC_DIR) || !statSync(SRC_DIR).isDirectory()) {
  fail(`source directory not found: ${SRC_DIR}`)
}

if (failed === 0 && !checkOnly && !existsSync(DEST_DIR)) {
  try {
    mkdirSync(DEST_DIR, { recursive: true })
  } catch (error) {
    fail(`cannot create ${DEST_DIR}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

let copied = 0
let unchanged = 0

if (failed === 0) {
  for (const name of SHARED_FILES) {
    const source = path.join(SRC_DIR, name)
    const dest = path.join(DEST_DIR, name)

    if (!isFile(source)) {
      fail(`source file missing or not a regular file: ${source}`)
      continue
    }
    const sourceHash = sha256(source)
    if (sourceHash === null) {
      fail(`source file is unreadable: ${source}`)
      continue
    }

    let action
    if (isFile(dest) && sha256(dest) === sourceHash) {
      action = 'unchanged'
      unchanged += 1
    } else if (checkOnly) {
      fail(`${name}: dsh/bin copy is missing or differs from ../bin/${name}`)
      continue
    } else {
      try {
        copyFileSync(source, dest)
      } catch (error) {
        fail(`cannot copy ${source} -> ${dest}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      action = 'copied'
      copied += 1
    }

    const destHash = sha256(dest)
    if (destHash !== sourceHash) {
      fail(`${name}: sha256 mismatch after sync (source ${sourceHash}, dest ${destHash === null ? 'unreadable' : destHash})`)
      continue
    }

    process.stdout.write(`${action.padEnd(9)} ${name}  sha256=${sourceHash.slice(0, 16)}…\n`)
  }
}

// The CommonJS boundary marker: written when absent, validated byte-for-byte
// when present. Drift (e.g. back to "module", or a semantic no-op rewrite)
// fails the sync instead of silently breaking the diagnosis subprocess.
let boundaryOk = false
if (failed === 0) {
  const boundaryPath = path.join(DEST_DIR, BIN_BOUNDARY_FILE)
  let current = null
  if (isFile(boundaryPath)) {
    try {
      current = readFileSync(boundaryPath, 'utf8')
    } catch {
      current = null
    }
  }
  if (current === BIN_BOUNDARY_CONTENT) {
    boundaryOk = true
    process.stdout.write(`unchanged ${BIN_BOUNDARY_FILE}  (${BIN_BOUNDARY_CONTENT})\n`)
  } else if (current !== null) {
    fail(
      `${BIN_BOUNDARY_FILE}: dsh/bin/${BIN_BOUNDARY_FILE} has drifted from the required CommonJS boundary. ` +
      `Expected exactly ${JSON.stringify(BIN_BOUNDARY_CONTENT)}, found ${JSON.stringify(current)}. ` +
      'The vendored check.js is CommonJS; without this declaration Node parses it as ESM and every diagnosis fails.',
    )
  } else if (checkOnly) {
    fail(`${BIN_BOUNDARY_FILE}: dsh/bin/${BIN_BOUNDARY_FILE} is missing (expected exactly ${JSON.stringify(BIN_BOUNDARY_CONTENT)})`)
  } else {
    try {
      writeFileSync(boundaryPath, BIN_BOUNDARY_CONTENT)
    } catch (error) {
      fail(`cannot write ${boundaryPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (failed === 0) {
      let written = null
      try {
        written = readFileSync(boundaryPath, 'utf8')
      } catch {
        written = null
      }
      if (written !== BIN_BOUNDARY_CONTENT) {
        fail(`${BIN_BOUNDARY_FILE}: verify-after-write failed in ${boundaryPath}`)
      } else {
        boundaryOk = true
        process.stdout.write(`created   ${BIN_BOUNDARY_FILE}  (${BIN_BOUNDARY_CONTENT})\n`)
      }
    }
  }
}

// Parity also means "nothing else lives here": a stray regular file in dsh/bin
// would ship in the package without a source of truth.
if (failed === 0 && existsSync(DEST_DIR)) {
  for (const entry of readdirSync(DEST_DIR, { withFileTypes: true })) {
    if (entry.isFile() && !GENERATED_FILES.includes(entry.name)) {
      fail(`unexpected file in dsh/bin: ${entry.name} (only ${GENERATED_FILES.join(', ')} are maintained)`)
    }
  }
}

if (failed > 0) {
  process.stderr.write(`sync-shared: FAILED (${failed} problem${failed === 1 ? '' : 's'})\n`)
  process.exitCode = 1
} else {
  process.stdout.write(
    `sync-shared: ok — ${SHARED_FILES.length} shared file${SHARED_FILES.length === 1 ? '' : 's'}` +
    ` (${copied} copied, ${unchanged} unchanged), ` +
    `CommonJS boundary ${boundaryOk ? 'ok' : 'MISSING'}${checkOnly ? ' [check only]' : ''}\n`,
  )
}
