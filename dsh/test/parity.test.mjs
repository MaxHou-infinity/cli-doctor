/**
 * Parity tests — the vendored diagnosis scripts in `dsh/bin/**` must be
 * byte-identical to the repository's `bin/**` sources, the CommonJS boundary
 * marker next to them must stay exact, and the sync script that produces them
 * must be safe to re-run.
 *
 * No test here executes a diagnosis: `--check` only hashes, the idempotency
 * check runs the sync script twice, and the DEFECT-1 regression runs
 * `check.js --version`, which prints the package version and exits without
 * touching brew/npm/pip.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PKG_ROOT, '..')
const SRC_DIR = path.join(REPO_ROOT, 'bin')
const DEST_DIR = path.join(PKG_ROOT, 'bin')
const PKG_VERSION = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version

/** Keep in sync with scripts/sync-shared.mjs. */
const SHARED_FILES = ['check.js', 'python_dependency_audit.py']

/**
 * Node's module-system boundary for the vendored CommonJS scripts.
 *
 * DEFECT-1: `dsh/package.json` declares `"type": "module"`, so without this
 * nested declaration Node parses dsh/bin/check.js as ESM and every diagnosis
 * subprocess dies with `ReferenceError: require is not defined in ES module
 * scope`. POST /api/cli-doctor/check answered 500 exit-1 and the panel was
 * unusable. The file is maintenance-critical, not a stray.
 */
const BOUNDARY_FILE = 'package.json'
const BOUNDARY_CONTENT = '{"type":"commonjs"}'

/** Everything dsh/bin may contain; anything else is a stray. */
const GENERATED_FILES = [...SHARED_FILES, BOUNDARY_FILE]

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Snapshot of name → hash/mtime/size for the idempotency assertions. */
function snapshot(names) {
  return names.map(name => {
    const file = path.join(DEST_DIR, name)
    return { name, hash: sha256(file), mtimeMs: statSync(file).mtimeMs, size: statSync(file).size }
  })
}

function runSync(args = []) {
  return spawnSync(process.execPath, ['scripts/sync-shared.mjs', ...args], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
  })
}

test('every shared script exists in both ../bin and dsh/bin', () => {
  for (const name of SHARED_FILES) {
    assert.ok(statSync(path.join(SRC_DIR, name)).isFile(), `missing source ../bin/${name}`)
    assert.ok(statSync(path.join(DEST_DIR, name)).isFile(), `missing vendored dsh/bin/${name}`)
  }
})

test('dsh/bin copies are byte-identical to ../bin sources', () => {
  for (const name of SHARED_FILES) {
    const source = readFileSync(path.join(SRC_DIR, name))
    const dest = readFileSync(path.join(DEST_DIR, name))
    assert.equal(Buffer.compare(source, dest), 0, `dsh/bin/${name} differs from ../bin/${name}`)
    assert.equal(sha256(path.join(DEST_DIR, name)), sha256(path.join(SRC_DIR, name)), `sha256 mismatch for ${name}`)
    assert.ok(dest.length > 0, `dsh/bin/${name} is empty`)
  }
})

test('the CommonJS boundary marker is exact', () => {
  const file = path.join(DEST_DIR, BOUNDARY_FILE)
  assert.ok(statSync(file).isFile(), `dsh/bin/${BOUNDARY_FILE} is missing — the vendored CommonJS scripts would be parsed as ESM`)
  const raw = readFileSync(file, 'utf8')
  assert.equal(raw, BOUNDARY_CONTENT, `dsh/bin/${BOUNDARY_FILE} must be exactly ${BOUNDARY_CONTENT}`)
  assert.deepEqual(JSON.parse(raw), { type: 'commonjs' })
  // The parent package is ESM; the boundary is what keeps the two worlds apart.
  assert.equal(JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).type, 'module')
})

test('vendored scripts are real files, not symlinks into the repository', () => {
  for (const name of SHARED_FILES) {
    const stats = lstatSync(path.join(DEST_DIR, name))
    assert.equal(stats.isSymbolicLink(), false, `dsh/bin/${name} must be a copy, not a symlink`)
    assert.ok(stats.size > 0)
  }
})

test('dsh/bin contains nothing but the generated files', () => {
  const entries = readdirSync(DEST_DIR, { withFileTypes: true })
  const strays = entries.filter(entry => entry.isFile() && !GENERATED_FILES.includes(entry.name)).map(entry => entry.name)
  assert.deepEqual(strays, [], `unexpected files in dsh/bin: ${strays.join(', ')}`)
})

/* ------------------------------------------------- DEFECT-1 regression guard */

test('the vendored check.js really runs as CommonJS (real subprocess, no injection)', () => {
  const result = spawnSync(process.execPath, [path.join(DEST_DIR, 'check.js'), '--version'], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.signal, null, `check.js was killed by ${result.signal}`)
  assert.equal(result.status, 0, `check.js --version exited ${result.status}\nstderr:\n${result.stderr}`)
  assert.equal(result.stdout.trim(), PKG_VERSION)
  assert.doesNotMatch(result.stderr, /require is not defined/)
  assert.equal(result.stderr, '', 'a clean --version run writes nothing to stderr')
})

test('the default spawn target exists, is a file, and sits behind the boundary', () => {
  const hostSource = readFileSync(path.join(PKG_ROOT, 'src', 'host', 'index.js'), 'utf8')
  assert.match(hostSource, /'bin', 'check\.js'/, 'host half must spawn <pkg>/bin/check.js')
  const checkPath = path.join(DEST_DIR, 'check.js')
  assert.ok(statSync(checkPath).isFile(), 'the default checkPath must exist')
  // Nearest package.json to the spawned script is the boundary marker.
  assert.equal(readFileSync(path.join(DEST_DIR, BOUNDARY_FILE), 'utf8'), BOUNDARY_CONTENT)
  assert.equal(sha256(checkPath), sha256(path.join(SRC_DIR, 'check.js')))
})

/* --------------------------------------------------------------------- sync */

test('sync-shared.mjs verifies parity in --check mode without writing', () => {
  const names = GENERATED_FILES
  const before = snapshot(names)
  const result = runSync(['--check'])
  assert.equal(result.status, 0, `sync --check failed:\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /check only/)
  assert.match(result.stdout, /CommonJS boundary ok/)
  assert.deepEqual(snapshot(names), before, '--check must not touch dsh/bin')
})

test('sync-shared.mjs is repeatable and idempotent', () => {
  const names = GENERATED_FILES
  const first = runSync()
  assert.equal(first.status, 0, `sync run 1 failed:\n${first.stdout}\n${first.stderr}`)
  assert.match(first.stdout, /CommonJS boundary ok/)

  const before = snapshot(names)
  const second = runSync()
  assert.equal(second.status, 0, `sync run 2 failed:\n${second.stdout}\n${second.stderr}`)
  for (const name of names) {
    assert.match(second.stdout, new RegExp(`unchanged\\s+${name.replace('.', '\\.')}`), `second run must not rewrite ${name}`)
  }
  assert.deepEqual(snapshot(names), before, 'a second sync must not rewrite or change dsh/bin')
})

test('the vendored check.js needs no repository checkout to run', () => {
  // Run the copy from an unrelated cwd: it resolves its Python helper next to
  // itself and only ever reads <pkg>/package.json for --version.
  const result = spawnSync(process.execPath, [path.join(DEST_DIR, 'check.js'), '--version'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(result.status, 0, `exit ${result.status}\nstderr:\n${result.stderr}`)
  assert.equal(result.stdout.trim(), PKG_VERSION)
})
