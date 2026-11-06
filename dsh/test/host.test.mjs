/**
 * Host half tests — dsh/src/host/index.js.
 *
 * Everything runs against a fake Cordis context, fake req/res objects and an
 * injected `spawn`, so no test ever touches brew, npm, pip or the real
 * bin/check.js. The subprocess seam is the only thing replaced: the route
 * dispatch, the fence, the single-flight guard and the failure mapping under
 * test are the production code paths.
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as host from '../src/host/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const PKG_VERSION = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version
const CHECK_PATH = path.join(PKG_ROOT, 'bin', 'check.js')
const SOURCE_PATH = path.join(PKG_ROOT, 'src', 'host', 'index.js')

const HEALTH = '/api/cli-doctor/health'
const CHECK = '/api/cli-doctor/check'
const CANCEL = '/api/cli-doctor/check/cancel'
const SNAPSHOT = '/api/cli-doctor/snapshot'
const STATUS = '/api/cli-doctor/status'
const HISTORY = '/api/cli-doctor/history'
const JSON_TYPE = 'application/json; charset=utf-8'

/** Temporary data directories created by one test, removed in its `finally`. */
function makeTempDataDir(t, prefix = 'cli-doctor-host-') {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  if (t !== undefined && typeof t.after === 'function') {
    t.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* already gone */ } })
  }
  return dir
}

/* ------------------------------------------------------------------ harness */

function makeCtx() {
  const routes = []
  const routeDisposers = []
  const harness = { routes, effects: [], fiberDisposer: null }
  harness.ctx = {
    webServer: {
      register(route) {
        routes.push(route)
        const disposer = () => { route.disposed = (route.disposed ?? 0) + 1 }
        routeDisposers.push(disposer)
        return disposer
      },
    },
    effect(callback, label) {
      harness.effects.push(label)
      harness.fiberDisposer = callback()
      return () => { if (typeof harness.fiberDisposer === 'function') harness.fiberDisposer() }
    },
  }
  return harness
}

/** Apply the plugin and return the registered route plus lifecycle handles. */
function boot(config = {}) {
  const harness = makeCtx()
  // Tests must never write the user's real ~/.dsh: persistence defaults off and
  // every persistence test injects its own temporary dataDir.
  host.apply(harness.ctx, { persist: false, ...config })
  assert.equal(harness.routes.length, 1, 'apply must register exactly one route')
  const route = harness.routes[0]
  return {
    ...harness,
    route,
    handler: route.handler,
    disposeFiber: () => harness.fiberDisposer?.(),
  }
}

function makeReq({ method = 'GET', url = HEALTH, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  return { method, url, headers, socket: { remoteAddress } }
}

function makeRes() {
  const res = {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      res.statusCode = status
      res.headers = headers
      res.headersSent = true
      return res
    },
    end(chunk) {
      if (chunk !== undefined) res.body = String(chunk)
      res.writableEnded = true
      return res
    },
  }
  return res
}

/** Wait (bounded) until the response has been ended by the async dispatch. */
async function until(predicate, timeoutMs = 2000, label = 'response') {
  const deadline = Date.now() + timeoutMs
  while (predicate() !== true) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

/** Drive one request through the route handler and return the finished res. */
async function request(handler, req) {
  const res = makeRes()
  handler(req, res)
  await until(() => res.writableEnded, 2000, `${req.method} ${req.url}`)
  return res
}

function json(res) {
  assert.ok(res.body !== undefined && res.body !== '', `expected a JSON body, got ${JSON.stringify(res.body)}`)
  return JSON.parse(res.body)
}

/** A diagnosis failure body: the code is stable; detail/elapsedMs are additive. */
function assertDiagnosisFailure(body, code) {
  assert.equal(body.ok, false)
  assert.equal(body.error, code)
  if (body.detail !== undefined) assert.equal(typeof body.detail, 'string')
  if (body.elapsedMs !== undefined) assert.equal(typeof body.elapsedMs, 'number')
}

/** Assert the two contract headers on every response. */
function assertJsonHeaders(res) {
  assert.equal(res.headers['content-type'], JSON_TYPE)
  assert.equal(res.headers['cache-control'], 'no-store')
}

function makeFakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killSignals = []
  child.kill = signal => { child.killSignals.push(signal); return true }
  return child
}

/**
 * Build a recording spawn double. `script(child, index)` configures what the
 * fake child emits; emission is deferred to setImmediate so the runner has
 * attached its listeners first.
 */
function makeSpawn(script = () => {}) {
  const calls = []
  const spawnImpl = (cmd, args, opts) => {
    const child = makeFakeChild()
    calls.push({ cmd, args, opts, child })
    script(child, calls.length)
    return child
  }
  spawnImpl.calls = calls
  return spawnImpl
}

function succeedWith(child, report, { defer = true, code = 0, signal = null } = {}) {
  const emit = () => {
    child.stdout.emit('data', Buffer.from(JSON.stringify(report)))
    child.emit('close', code, signal)
  }
  if (defer) setImmediate(emit)
  else emit()
}

/**
 * A real child_process seam: the diagnosis is replaced by an inline `node -e`
 * script, keeping the pipes, exit codes and signals genuine without ever
 * running the real check.js.
 */
function realSpawn(code) {
  const calls = []
  const spawnImpl = (cmd, args, opts) => {
    const child = spawn(cmd, ['-e', code], opts)
    calls.push({ cmd, args, opts, child })
    return child
  }
  spawnImpl.calls = calls
  return spawnImpl
}

/** Start a real loopback HTTP server wired to the plugin's route handler. */
async function startServer(config) {
  const harness = boot(config)
  const server = http.createServer((req, res) => { harness.handler(req, res) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    port,
    harness,
    close: () => new Promise(resolve => { server.close(() => resolve()) }),
  }
}

/** One real HTTP request; the Host header is explicit when supplied. */
function httpRequest(port, { method = 'GET', url = HEALTH, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: url,
      method,
      headers,
      setHost: headers.host === undefined,
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Wait (bounded) for a pid to disappear, proving SIGTERM landed. */
async function waitForExit(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return false
}

const SAMPLE_REPORT = {
  generated_at: '2026-10-13T00:00:00Z',
  scope: 'all',
  elapsed_ms: 12,
  skipped: [],
  managers: {
    homebrew: { tools: [], deps: [] },
    npm_global: { tools: [], deps: [] },
    python_pip: { tools: [], deps: [] },
    rust_bun_uv: { tools: [], deps: [] },
    self_updating: { tools: [], deps: [] },
  },
}

/** A report exercising every v2 summary counter (tools + dependency risks). */
const RICH_REPORT = {
  generated_at: '2026-10-13T01:02:03Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 42,
  skipped: [],
  managers: {
    homebrew: {
      tools: [
        {
          name: 'safe-tool',
          current: '1.2.0',
          latest: '1.3.0',
          outdated: true,
          upgrade_cmd: 'brew upgrade safe-tool',
          impact: { checked: true, scope: 'x', dependents: [], indirect: [], conflicts: [], uncertain: [] },
        },
        { name: 'unknown-tool', current: '0.1.0', latest: null, outdated: null },
      ],
      deps: [
        {
          name: 'conflicted-lib',
          current: '1.0.0',
          latest: '2.0.0',
          outdated: null,
          impact: { checked: true, scope: 'x', dependents: [], indirect: [], conflicts: [{ name: 'parent' }], uncertain: [] },
        },
        {
          name: 'uncertain-lib',
          current: '1.0.0',
          latest: '1.1.0',
          outdated: null,
          impact: { checked: true, scope: 'x', dependents: [], indirect: [], conflicts: [], uncertain: [{ name: 'maybe' }] },
        },
      ],
    },
  },
}

/* ------------------------------------------------------------ module surface */

test('module exports the Cordis function-plugin surface', () => {
  assert.equal(host.name, 'cli-doctor')
  assert.deepEqual(host.inject, ['webServer'])
  assert.equal(typeof host.apply, 'function')
})

test('host half has zero third-party imports', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const specifiers = [...source.matchAll(/^\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
  assert.ok(specifiers.length > 0, 'expected the host half to import node: builtins')
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith('node:'), `non-builtin import found: ${specifier}`)
  }
  assert.ok(!/\brequire\s*\(/.test(source), 'the host half must not use require()')
  for (const forbidden of ['@deepseek-ai/', 'cordis']) {
    assert.ok(!source.includes(`from '${forbidden}`), `must not import ${forbidden}`)
  }
})

/* ------------------------------------------------------------- registration */

test('apply registers one prefix route and binds it to the fiber', () => {
  const harness = boot()
  assert.equal(harness.route.kind, 'prefix')
  assert.equal(harness.route.path, '/api/cli-doctor')
  assert.equal(typeof harness.route.handler, 'function')
  assert.deepEqual(harness.effects, ['cli-doctor: routes'])
})

test('fiber disposal disposes the registered route', () => {
  const harness = boot()
  assert.equal(harness.route.disposed, undefined)
  harness.disposeFiber()
  assert.equal(harness.route.disposed, 1)
  harness.disposeFiber()
  assert.equal(harness.route.disposed, 2, 'the composite disposer stays callable')
})

test('fiber disposal terminates an in-flight diagnosis', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const res = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' } }), res)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')
  harness.disposeFiber()
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])
})

/* ------------------------------------------------------------------ health */

test('GET health returns ok/version/busy with the contract headers', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const res = await request(harness.handler, makeReq({
    url: HEALTH,
    headers: { host: '127.0.0.1:8787', 'sec-fetch-site': 'same-origin' },
  }))
  assert.equal(res.statusCode, 200)
  assertJsonHeaders(res)
  assert.deepEqual(json(res), {
    ok: true,
    version: PKG_VERSION,
    busy: false,
    capabilities: { snapshot: true, history: true, cancel: true },
    lastCheck: null,
  })
  assert.equal(spawnImpl.calls.length, 0)
})

test('HEAD health answers 200 with headers and no body', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({
    method: 'HEAD',
    headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
  }))
  assert.equal(res.statusCode, 200)
  assertJsonHeaders(res)
  assert.equal(res.body, undefined)
})

test('health ignores a query string or fragment', async () => {
  const harness = boot()
  for (const url of [`${HEALTH}?t=1`, `${HEALTH}#frag`, `http://127.0.0.1:8787${HEALTH}?t=2`]) {
    const res = await request(harness.handler, makeReq({
      url,
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
    }))
    assert.equal(res.statusCode, 200, url)
    assert.equal(json(res).ok, true)
  }
})

/* --------------------------------------------------------------- 405 / 404 */

test('non-GET/HEAD on health is 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const spawnImpl = makeSpawn()
    const harness = boot({ spawn: spawnImpl })
    const res = await request(harness.handler, makeReq({
      method,
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
    }))
    assert.equal(res.statusCode, 405, `${method} health`)
    assertJsonHeaders(res)
    assert.deepEqual(json(res), { ok: false, error: 'method' })
    assert.equal(spawnImpl.calls.length, 0)
  }
})

test('non-POST on check is 405', async () => {
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) {
    const spawnImpl = makeSpawn()
    const harness = boot({ spawn: spawnImpl })
    const res = await request(harness.handler, makeReq({
      method,
      url: CHECK,
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
    }))
    assert.equal(res.statusCode, 405, `${method} check`)
    assert.deepEqual(json(res), { ok: false, error: 'method' })
    assert.equal(spawnImpl.calls.length, 0)
  }
})

test('unknown subpaths under the prefix are 404', async () => {
  for (const url of ['/api/cli-doctor', '/api/cli-doctor/', '/api/cli-doctor/nope', '/api/cli-doctor/health/extra']) {
    const harness = boot()
    const res = await request(harness.handler, makeReq({
      url,
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
    }))
    assert.equal(res.statusCode, 404, url)
    assertJsonHeaders(res)
    assert.deepEqual(json(res), { ok: false, error: 'not-found' })
  }
})

/* ------------------------------------------------------------------- fence */

/** Every rejection must be a 403 and must never reach the diagnosis. */
async function assertForbidden(req) {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const res = await request(harness.handler, req)
  assert.equal(res.statusCode, 403, `${req.method} ${req.url} ${JSON.stringify(req.headers)}`)
  assertJsonHeaders(res)
  assert.deepEqual(json(res), { ok: false, error: 'forbidden' })
  assert.equal(spawnImpl.calls.length, 0, 'a fenced request must not spawn a diagnosis')
  return res
}

test('fence rejects non-loopback socket addresses', async () => {
  for (const remoteAddress of ['10.0.0.5', '192.168.1.9', '::ffff:10.0.0.5', 'fe80::1', '127.0.0.256', '', null]) {
    await assertForbidden(makeReq({
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
      remoteAddress,
    }))
  }
})

test('fence rejects a missing socket (malformed request)', async () => {
  const harness = boot()
  const res = await request(harness.handler, {
    method: 'GET',
    url: HEALTH,
    headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(res.statusCode, 403)
})

test('fence rejects non-loopback or missing Host authorities', async () => {
  for (const host of ['example.com', 'eviI.com:80', '127.0.0.1.evil.com', 'evil@127.0.0.1', '127.0.0.1/path', '', ' 127.0.0.1']) {
    await assertForbidden(makeReq({
      headers: { host, 'sec-fetch-site': 'same-origin' },
    }))
  }
  await assertForbidden(makeReq({ headers: { 'sec-fetch-site': 'same-origin' } }))
})

test('fence rejects a request with no browser marker', async () => {
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1' } }))
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1', cookie: 'dsh-other=1; session=2' } }))
  // A cookie that merely contains the prefix inside another name is not a credential.
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1', cookie: 'x-dsh-auth-a=1' } }))
})

test('fence rejects cross-site markers and mismatched or invalid Origins', async () => {
  await assertForbidden(makeReq({
    headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:9999', 'sec-fetch-site': 'same-origin' },
  }))
  await assertForbidden(makeReq({
    headers: { host: '127.0.0.1:8787', origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
  }))
  await assertForbidden(makeReq({
    headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'sec-fetch-site': 'cross-site' },
  }))
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1', origin: '' } }))
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1', origin: 'not-a-url' } }))
  await assertForbidden(makeReq({ headers: { host: '127.0.0.1', origin: 'dsh-app://app' } }))
})

test('fence passes the sec-fetch-site same-origin marker', async () => {
  for (const remoteAddress of ['127.0.0.1', '127.0.0.7', '::1', '::ffff:127.0.0.1']) {
    for (const host of ['127.0.0.1', '127.0.0.1:8787', 'localhost', 'localhost:3000', '[::1]:8787']) {
      const harness = boot()
      const res = await request(harness.handler, makeReq({
        headers: { host, 'sec-fetch-site': 'same-origin' },
        remoteAddress,
      }))
      assert.equal(res.statusCode, 200, `${remoteAddress} / ${host}`)
    }
  }
})

test('fence passes a same-origin Origin header', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' },
  }))
  assert.equal(res.statusCode, 200)
  assert.equal(json(res).ok, true)
})

test('fence passes the dsh-auth cookie marker (desktop shell forwarding)', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1:8787', cookie: 'theme=dark; dsh-auth-desktop=signed-token' },
  }))
  assert.equal(res.statusCode, 200)
  assert.equal(json(res).ok, true)
})

/* ------------------------------------------------------- diagnosis success */

test('POST check runs check.js --json --no-update and returns the report', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl })
  const startedAt = Date.now()
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' },
  }))

  assert.equal(res.statusCode, 200)
  assertJsonHeaders(res)
  const body = json(res)
  assert.equal(body.ok, true)
  assert.deepEqual(body.report, SAMPLE_REPORT)
  assert.equal(body.mode, 'full')
  assert.equal(body.cache, 'fresh')
  assert.equal(body.shared, false)
  assert.equal(typeof body.elapsedMs, 'number')
  assert.equal(typeof body.checkedAt, 'string')
  const checkedAt = Date.parse(body.checkedAt)
  assert.ok(Number.isFinite(checkedAt), `checkedAt must be an ISO timestamp: ${body.checkedAt}`)
  assert.ok(checkedAt >= startedAt - 1000 && checkedAt <= Date.now() + 1000)

  assert.equal(spawnImpl.calls.length, 1)
  const call = spawnImpl.calls[0]
  assert.equal(call.cmd, process.execPath)
  assert.deepEqual(call.args, [CHECK_PATH, '--json', '--no-update'])
  assert.deepEqual(
    Object.keys(call.opts).sort(),
    process.platform === 'win32' ? ['cwd', 'env'] : ['cwd', 'detached', 'env'],
  )
  assert.equal(call.opts.cwd, PKG_ROOT)
  assert.equal(call.opts.env.HOMEBREW_NO_AUTO_UPDATE, '1')
  assert.equal(call.opts.env.HOMEBREW_NO_ANALYTICS, '1')
  assert.equal(call.opts.env.PIP_DISABLE_PIP_VERSION_CHECK, '1')
  assert.equal(call.opts.env.NO_COLOR, '1')
  assert.equal(call.opts.env.PATH, process.env.PATH)
})

test('check tolerates stderr noise on a successful run', async () => {
  const spawnImpl = makeSpawn(child => {
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('warning: something\n'))
      succeedWith(child, SAMPLE_REPORT, { defer: false })
    })
  })
  const harness = boot({ spawn: spawnImpl })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(json(res).report, SAMPLE_REPORT)
})

test('health reports busy while a diagnosis is running', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const headers = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }

  const checkRes = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), checkRes)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')

  const busyRes = await request(harness.handler, makeReq({ headers }))
  const busyBody = json(busyRes)
  assert.equal(busyBody.ok, true)
  assert.equal(busyBody.version, PKG_VERSION)
  assert.equal(busyBody.busy, true)
  assert.deepEqual(busyBody.capabilities, { snapshot: true, history: true, cancel: true })
  assert.equal(busyBody.lastCheck, null)

  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => checkRes.writableEnded, 2000, 'check response')
  const idleRes = await request(harness.handler, makeReq({ headers }))
  const idleBody = json(idleRes)
  assert.equal(idleBody.busy, false)
  assert.equal(idleBody.lastCheck.mode, 'full')
  assert.equal(typeof idleBody.lastCheck.checkedAt, 'string')
  assert.equal(typeof idleBody.lastCheck.ageMs, 'number')
})

/* ------------------------------------------------------- shared single flight */

test('concurrent checks share one run: no 409, same result, one spawn', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1' }

  const first = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), first)
  await until(() => spawnImpl.calls.length === 1, 1000, 'first spawn')

  const attachedRes = []
  for (let i = 0; i < 3; i += 1) {
    const res = makeRes()
    harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), res)
    attachedRes.push(res)
  }
  assert.equal(spawnImpl.calls.length, 1, 'attached requests must not spawn')

  // The initiating request is the only waiter reported while every response
  // is still pending; the attached ones joined the same waiter set.
  const status = await request(harness.handler, makeReq({ url: STATUS, headers }))
  const statusBody = json(status)
  assert.equal(statusBody.busy, true)
  assert.equal(statusBody.running.waiters, 4)

  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => first.writableEnded && attachedRes.every(res => res.writableEnded), 2000, 'all responses')

  const fresh = json(first)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.cache, 'fresh')
  assert.equal(fresh.shared, false)
  assert.deepEqual(fresh.report, SAMPLE_REPORT)
  for (const res of attachedRes) {
    assert.equal(res.statusCode, 200)
    const body = json(res)
    assert.equal(body.ok, true)
    assert.equal(body.cache, 'attached')
    assert.equal(body.shared, true)
    assert.equal(body.checkedAt, fresh.checkedAt)
    assert.deepEqual(body.report, SAMPLE_REPORT)
  }
  assert.equal(spawnImpl.calls.length, 1)

  // A later POST starts a new run (fresh snapshot still respects default force=1).
  const next = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), next)
  await until(() => spawnImpl.calls.length === 2, 1000, 'second spawn')
  succeedWith(spawnImpl.calls[1].child, SAMPLE_REPORT)
  await until(() => next.writableEnded, 2000, 'second response')
  assert.equal(json(next).ok, true)
})

test('force=0 returns the cached snapshot without spawning', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl })
  const headers = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }

  const first = await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers }))
  const firstBody = json(first)
  assert.equal(firstBody.cache, 'fresh')

  const hit = await request(harness.handler, makeReq({ method: 'POST', url: `${CHECK}?force=0`, headers }))
  const hitBody = json(hit)
  assert.equal(hit.statusCode, 200)
  assert.equal(hitBody.ok, true)
  assert.equal(hitBody.cache, 'hit')
  assert.equal(hitBody.checkedAt, firstBody.checkedAt)
  assert.deepEqual(hitBody.report, SAMPLE_REPORT)
  assert.equal(spawnImpl.calls.length, 1, 'a cache hit must not spawn')

  // Default force=1 keeps the v0.2 "every click runs" behaviour.
  const forced = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), forced)
  await until(() => spawnImpl.calls.length === 2, 1000, 'forced spawn')
  succeedWith(spawnImpl.calls[1].child, SAMPLE_REPORT)
  await until(() => forced.writableEnded, 2000, 'forced response')
  assert.equal(json(forced).cache, 'fresh')
})

test('force=0 reruns once the snapshot is older than the TTL', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  // ttlMs = staleAfterHours * 3600_000, so a tiny value makes the snapshot stale fast.
  const harness = boot({ spawn: spawnImpl, staleAfterHours: 0.000001 })
  const headers = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }
  await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers }))
  await new Promise(resolve => setTimeout(resolve, 20))

  const res = makeRes()
  harness.handler(makeReq({ method: 'POST', url: `${CHECK}?force=0`, headers }), res)
  await until(() => spawnImpl.calls.length === 2, 1000, 'stale spawn')
  succeedWith(spawnImpl.calls[1].child, SAMPLE_REPORT)
  await until(() => res.writableEnded, 2000, 'stale response')
  assert.equal(json(res).cache, 'fresh')
})

test('mode=fast passes --fast and records the mode on the snapshot', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl })
  const headers = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }
  const res = await request(harness.handler, makeReq({ method: 'POST', url: `${CHECK}?mode=fast`, headers }))
  assert.deepEqual(spawnImpl.calls[0].args, [CHECK_PATH, '--json', '--fast', '--no-update'])
  assert.equal(json(res).mode, 'fast')

  const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers })))
  assert.equal(snapshot.snapshot.mode, 'fast')

  // An unknown mode falls back to full (no new error code in v2.1).
  const fallbackSpawn = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const fallback = boot({ spawn: fallbackSpawn })
  await request(fallback.handler, makeReq({ method: 'POST', url: `${CHECK}?mode=bogus`, headers }))
  assert.deepEqual(fallbackSpawn.calls[0].args, [CHECK_PATH, '--json', '--no-update'])
})

/* -------------------------------------------------------- diagnosis failure */

test('non-zero exit becomes a structured 500 and logs to the host stderr seam', async () => {
  const logged = []
  const spawnImpl = makeSpawn(child => {
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('boom: brew missing\n'))
      child.emit('close', 1, null)
    })
  })
  const harness = boot({ spawn: spawnImpl, logger: message => logged.push(message) })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 500)
  assertJsonHeaders(res)
  assertDiagnosisFailure(json(res), 'exit-1')
  assert.ok(logged.some(line => line.includes('exit-1')), `expected a logged failure, got ${JSON.stringify(logged)}`)

  // The single-flight guard must be released after a failure.
  const health = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
  }))
  assert.equal(json(health).busy, false)
})

test('a signal-terminated child becomes a structured 500', async () => {
  const spawnImpl = makeSpawn(child => { setImmediate(() => { child.emit('close', null, 'SIGKILL') }) })
  const harness = boot({ spawn: spawnImpl, logger: () => {} })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 500)
  assertDiagnosisFailure(json(res), 'signal-SIGKILL')
})

test('invalid JSON stdout becomes a structured 500', async () => {
  for (const stdout of ['not json at all', '', '{ "truncated": ']) {
    const spawnImpl = makeSpawn(child => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(stdout))
        child.emit('close', 0, null)
      })
    })
    const harness = boot({ spawn: spawnImpl, logger: () => {} })
    const res = await request(harness.handler, makeReq({
      method: 'POST',
      url: CHECK,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    }))
    assert.equal(res.statusCode, 500, JSON.stringify(stdout))
    assertDiagnosisFailure(json(res), 'invalid-json')
  }
})

test('a diagnosis that never finishes times out: SIGTERM plus a 500', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl, timeoutMs: 30, logger: () => {} })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 500)
  assertDiagnosisFailure(json(res), 'timeout')
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])

  // v2: busy only clears once the child really closed.
  const stillRunning = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
  }))
  assert.equal(json(stillRunning).busy, true)

  // A late close after the timeout must only release the inflight slot.
  spawnImpl.calls[0].child.emit('close', null, 'SIGTERM')
  const health = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
  }))
  assert.equal(json(health).busy, false)
})

test('stdout over the cap is rejected and the child is terminated', async () => {
  const spawnImpl = makeSpawn(child => {
    setImmediate(() => { child.stdout.emit('data', Buffer.alloc(4096, 0x20)) })
  })
  const harness = boot({ spawn: spawnImpl, maxOutputBytes: 1024, logger: () => {} })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 500)
  assertDiagnosisFailure(json(res), 'output-too-large')
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])
})

test('spawn failures become structured 500s instead of escaping the handler', async () => {
  const cases = [
    () => { throw new Error('EACCES: spawn denied') },
    () => null,
    () => ({ on: undefined }),
  ]
  for (const spawnImpl of cases) {
    const harness = boot({ spawn: spawnImpl, logger: () => {} })
    const res = await request(harness.handler, makeReq({
      method: 'POST',
      url: CHECK,
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    }))
    assert.equal(res.statusCode, 500)
    assertDiagnosisFailure(json(res), 'spawn-error')
  }
})

test("a child 'error' event becomes a structured 500", async () => {
  const spawnImpl = makeSpawn(child => {
    setImmediate(() => { child.emit('error', new Error('ENOENT')) })
  })
  const harness = boot({ spawn: spawnImpl, logger: () => {} })
  const res = await request(harness.handler, makeReq({
    method: 'POST',
    url: CHECK,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
  }))
  assert.equal(res.statusCode, 500)
  assertDiagnosisFailure(json(res), 'spawn-error')
})

test('handler errors never escape as unhandled rejections', async () => {
  const rejections = []
  const onRejection = reason => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  try {
    const harness = boot({ spawn: () => { throw new Error('spawn exploded') }, logger: () => {} })
    const brokenRes = {
      statusCode: undefined,
      headersSent: false,
      writableEnded: false,
      writeHead() { throw new Error('socket is closed') },
      end() {},
    }
    assert.doesNotThrow(() => {
      harness.handler(makeReq({
        method: 'POST',
        url: CHECK,
        headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      }), brokenRes)
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(rejections, [])
  } finally {
    process.off('unhandledRejection', onRejection)
  }
})

test('malformed requests are answered, never thrown', async () => {
  const harness = boot()
  const headers = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }
  const cases = [
    [{}, 404],
    [{ method: 'GET' }, 404],
    [null, 404],
    [{ method: 'GET', url: HEALTH, headers: null }, 403],
    [makeReq({ url: HEALTH, headers }), 200],
  ]
  for (const [req, status] of cases) {
    const res = makeRes()
    assert.doesNotThrow(() => harness.handler(req, res))
    await until(() => res.writableEnded, 1000, 'malformed request response')
    assert.equal(res.statusCode, status, JSON.stringify(req))
  }
})

test('the version reported by health matches package.json', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({
    headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' },
  }))
  assert.equal(json(res).version, PKG_VERSION)
  assert.match(PKG_VERSION, /^\d+\.\d+\.\d+$/)
})

/* ------------------------------------------------- real HTTP + real process */

test('real HTTP: health answers on loopback and refuses a marker-less or foreign Host', async () => {
  const { port, close } = await startServer()
  try {
    const auto = await httpRequest(port, { url: HEALTH })
    assert.equal(auto.status, 403, 'a bare request without any browser marker is refused')
    assert.deepEqual(JSON.parse(auto.body), { ok: false, error: 'forbidden' })

    const foreign = await httpRequest(port, {
      url: HEALTH,
      headers: { host: 'example.com', 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(foreign.status, 403)

    const allowed = await httpRequest(port, {
      url: HEALTH,
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
    })
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers['content-type'], JSON_TYPE)
    assert.equal(allowed.headers['cache-control'], 'no-store')
    assert.deepEqual(JSON.parse(allowed.body), {
      ok: true,
      version: PKG_VERSION,
      busy: false,
      capabilities: { snapshot: true, history: true, cancel: true },
      lastCheck: null,
    })

    const head = await httpRequest(port, {
      method: 'HEAD',
      url: HEALTH,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(head.status, 200)
    assert.equal(head.body, '')

    // Absolute-form request target: the webserver's own matcher parses it the
    // same way, so the handler must not fall through as not-found.
    const absolute = await httpRequest(port, {
      url: `http://127.0.0.1:${port}${HEALTH}`,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(absolute.status, 200)
    assert.equal(JSON.parse(absolute.body).ok, true)
  } finally {
    await close()
  }
})

test('real HTTP: POST check pipes a real subprocess report back', async () => {
  const code = `process.stdout.write(${JSON.stringify(JSON.stringify(SAMPLE_REPORT))})`
  const spawnImpl = realSpawn(code)
  const { port, close } = await startServer({ spawn: spawnImpl })
  try {
    const res = await httpRequest(port, {
      method: 'POST',
      url: CHECK,
      headers: { host: `127.0.0.1:${port}`, cookie: 'dsh-auth-desktop=token' },
    })
    assert.equal(res.status, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.deepEqual(body.report, SAMPLE_REPORT)
    assert.ok(Number.isFinite(Date.parse(body.checkedAt)))
    assert.equal(spawnImpl.calls.length, 1)
    assert.deepEqual(spawnImpl.calls[0].args, [CHECK_PATH, '--json', '--no-update'])
    assert.equal(spawnImpl.calls[0].child.exitCode, 0)
  } finally {
    await close()
  }
})

test('real HTTP: a failing subprocess becomes a 500 and frees the single-flight guard', async () => {
  const spawnImpl = realSpawn("process.stderr.write('brew exploded\\n'); process.exit(3)")
  const { port, close } = await startServer({ spawn: spawnImpl, logger: () => {} })
  try {
    const res = await httpRequest(port, {
      method: 'POST',
      url: CHECK,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(res.status, 500)
    assertDiagnosisFailure(JSON.parse(res.body), 'exit-3')

    const health = await httpRequest(port, {
      url: HEALTH,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(JSON.parse(health.body).busy, false)
  } finally {
    await close()
  }
})

test('real HTTP: a hung subprocess is SIGTERMed at the timeout', async () => {
  const spawnImpl = realSpawn('setTimeout(() => {}, 60000)')
  const { port, close } = await startServer({ spawn: spawnImpl, timeoutMs: 150, logger: () => {} })
  try {
    const res = await httpRequest(port, {
      method: 'POST',
      url: CHECK,
      headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
    })
    assert.equal(res.status, 500)
    assertDiagnosisFailure(JSON.parse(res.body), 'timeout')
    const pid = spawnImpl.calls[0].child.pid
    assert.equal(await waitForExit(pid), true, `child ${pid} survived the SIGTERM`)
  } finally {
    await close()
  }
})

test('real HTTP: two concurrent checks share one run and both answer 200', async () => {
  const spawnImpl = realSpawn('setTimeout(() => { process.stdout.write("{}") }, 200)')
  const { port, close } = await startServer({ spawn: spawnImpl })
  try {
    const headers = { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }
    const [first, second] = await Promise.all([
      httpRequest(port, { method: 'POST', url: CHECK, headers }),
      httpRequest(port, { method: 'POST', url: CHECK, headers }),
    ])
    assert.deepEqual([first.status, second.status].sort(), [200, 200])
    const bodies = [first, second].map(res => JSON.parse(res.body))
    assert.equal(bodies[0].checkedAt, bodies[1].checkedAt, 'both clients see the same result')
    const caches = bodies.map(body => body.cache).sort()
    assert.deepEqual(caches, ['attached', 'fresh'])
    assert.equal(spawnImpl.calls.length, 1)
  } finally {
    await close()
  }
})

test('real HTTP: cancel terminates the child and keeps busy until it closed', async () => {
  const spawnImpl = realSpawn('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)')
  const { port, close } = await startServer({ spawn: spawnImpl, killGraceMs: 50 })
  try {
    const headers = { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }
    const pending = httpRequest(port, { method: 'POST', url: CHECK, headers })
    const deadline = Date.now() + 2000
    while (spawnImpl.calls.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(spawnImpl.calls.length, 1)

    const cancel = await httpRequest(port, { method: 'POST', url: CANCEL, headers })
    assert.equal(cancel.status, 200)
    assert.deepEqual(JSON.parse(cancel.body), { ok: true, cancelled: true })

    const check = await pending
    assert.equal(check.status, 500)
    const cancelledBody = JSON.parse(check.body)
    assert.equal(cancelledBody.ok, false)
    assert.equal(cancelledBody.error, 'cancelled')
    assert.equal(typeof cancelledBody.elapsedMs, 'number')

    const pid = spawnImpl.calls[0].child.pid
    assert.equal(await waitForExit(pid), true, `child ${pid} survived the SIGTERM/SIGKILL escalation`)

    const status = await httpRequest(port, { url: STATUS, headers })
    assert.equal(JSON.parse(status.body).busy, false)
  } finally {
    await close()
  }
})

/* ------------------------------------------------------ v2: routes & shape */

const V2_HEADERS = { host: '127.0.0.1', 'sec-fetch-site': 'same-origin' }

/** Drive one POST /check request without awaiting the run's completion. */
function startCheck(harness, url = CHECK, headers = V2_HEADERS) {
  const res = makeRes()
  harness.handler(makeReq({ method: 'POST', url, headers }), res)
  return res
}

test('snapshot answers 200 with snapshot:null and the cache envelope before any run', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS }))
  assert.equal(res.statusCode, 200)
  assertJsonHeaders(res)
  assert.deepEqual(json(res), {
    ok: true,
    snapshot: null,
    busy: false,
    cache: { ttlMs: 12 * 60 * 60 * 1000, autoCheck: true },
  })

  const head = await request(harness.handler, makeReq({ method: 'HEAD', url: SNAPSHOT, headers: V2_HEADERS }))
  assert.equal(head.statusCode, 200)
  assertJsonHeaders(head)
  assert.equal(head.body, undefined)
})

test('status answers an idle view before any run', async () => {
  const harness = boot()
  const res = await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS }))
  assert.equal(res.statusCode, 200)
  assertJsonHeaders(res)
  assert.deepEqual(json(res), {
    ok: true,
    busy: false,
    running: null,
    lastCheck: null,
    cache: { ttlMs: 12 * 60 * 60 * 1000 },
  })
})

test('snapshot/status/history reflect one completed run and hide the report by default', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, RICH_REPORT) })
  const harness = boot({ spawn: spawnImpl })
  const checkBody = json(await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS })))

  const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS })))
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.busy, false)
  assert.equal(snapshot.snapshot.checkedAt, checkBody.checkedAt)
  assert.equal(snapshot.snapshot.mode, 'full')
  assert.equal(typeof snapshot.snapshot.elapsedMs, 'number')
  assert.ok(snapshot.snapshot.ageMs >= 0)
  assert.equal(snapshot.snapshot.stale, false)
  assert.equal('report' in snapshot.snapshot, false)

  const summary = snapshot.snapshot.summary
  assert.equal(summary.toolCount, 2)
  assert.equal(summary.depCount, 2)
  assert.equal(summary.updateCount, 1)
  assert.equal(summary.recommendedCount, 1)
  assert.equal(summary.reviewCount, 0)
  assert.equal(summary.unknownCount, 1)
  assert.equal(summary.conflictCount, 1)
  assert.equal(summary.uncertainCount, 1)
  assert.equal(summary.generatedAt, RICH_REPORT.generated_at)
  assert.equal(summary.checkedAt, checkBody.checkedAt)
  assert.equal(summary.mode, 'full')
  assert.equal(summary.stale, false)
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 1024, 'summary must stay <= 1 KB')

  const full = json(await request(harness.handler, makeReq({ url: `${SNAPSHOT}?full=1`, headers: V2_HEADERS })))
  assert.deepEqual(full.snapshot.report, RICH_REPORT)

  const status = json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS })))
  assert.equal(status.busy, false)
  assert.equal(status.running, null)
  assert.equal(status.lastCheck.checkedAt, checkBody.checkedAt)
  assert.equal(status.lastCheck.mode, 'full')
  assert.ok(status.lastCheck.ageMs >= 0)

  const history = json(await request(harness.handler, makeReq({ url: HISTORY, headers: V2_HEADERS })))
  assert.equal(history.ok, true)
  assert.equal(history.entries.length, 1)
  assert.equal(history.entries[0].checkedAt, checkBody.checkedAt)
  assert.equal(history.entries[0].mode, 'full')
  assert.equal(typeof history.entries[0].elapsedMs, 'number')
  assert.equal(history.entries[0].summary.toolCount, 2)
})

test('history is newest-first and respects keepHistory plus the limit parameter', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl, keepHistory: 2 })
  for (let index = 0; index < 3; index += 1) {
    const res = startCheck(harness)
    await until(() => spawnImpl.calls.length === index + 1, 1000, `spawn ${index + 1}`)
    succeedWith(spawnImpl.calls[index].child, SAMPLE_REPORT)
    await until(() => res.writableEnded, 2000, `check ${index + 1}`)
  }

  const entries = json(await request(harness.handler, makeReq({ url: HISTORY, headers: V2_HEADERS }))).entries
  assert.equal(entries.length, 2, 'keepHistory bounds the stored history')
  const timestamps = entries.map(entry => Date.parse(entry.checkedAt))
  assert.ok(timestamps[0] >= timestamps[1], 'newest entry first')

  const limited = json(await request(harness.handler, makeReq({ url: `${HISTORY}?limit=1`, headers: V2_HEADERS })))
  assert.equal(limited.entries.length, 1)
  const huge = json(await request(harness.handler, makeReq({ url: `${HISTORY}?limit=500`, headers: V2_HEADERS })))
  assert.equal(huge.entries.length, 2)
})

test('status exposes the in-flight run, its mode and waiter count', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const first = startCheck(harness, `${CHECK}?mode=fast`)
  startCheck(harness)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')

  const status = json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS })))
  assert.equal(status.busy, true)
  assert.equal(status.running.mode, 'fast', 'the second request attaches to the in-flight mode')
  assert.equal(status.running.waiters, 2)
  assert.equal(typeof status.running.startedAt, 'string')
  assert.ok(status.running.elapsedMs >= 0)

  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => first.writableEnded, 2000, 'responses')
})

test('v2 routes keep the v1 405/404 semantics', async () => {
  const harness = boot()
  const cases = [
    ['POST', SNAPSHOT],
    ['POST', STATUS],
    ['POST', HISTORY],
    ['GET', CANCEL],
    ['HEAD', CANCEL],
  ]
  for (const [method, url] of cases) {
    const res = await request(harness.handler, makeReq({ method, url, headers: V2_HEADERS }))
    assert.equal(res.statusCode, 405, `${method} ${url}`)
    assert.deepEqual(json(res), { ok: false, error: 'method' })
  }
  for (const url of ['/api/cli-doctor/snapshot/x', '/api/cli-doctor/check/cancel/x', '/api/cli-doctor/status/']) {
    const res = await request(harness.handler, makeReq({ url, headers: V2_HEADERS }))
    assert.equal(res.statusCode, 404, url)
    assert.deepEqual(json(res), { ok: false, error: 'not-found' })
  }
})

test('v2 routes sit behind the same loopback fence', async () => {
  for (const [method, url] of [['GET', SNAPSHOT], ['GET', STATUS], ['GET', HISTORY], ['POST', CANCEL]]) {
    const spawnImpl = makeSpawn()
    const harness = boot({ spawn: spawnImpl })
    const res = await request(harness.handler, makeReq({ method, url }))
    assert.equal(res.statusCode, 403, `${method} ${url}`)
    assert.deepEqual(json(res), { ok: false, error: 'forbidden' })
    assert.equal(spawnImpl.calls.length, 0)
  }
})

/* --------------------------------------------------- v2: cancel & disposal */

test('cancel settles waiters with 500 cancelled and keeps busy until the child closed', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const pending = startCheck(harness)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')

  const cancel = json(await request(harness.handler, makeReq({ method: 'POST', url: CANCEL, headers: V2_HEADERS })))
  assert.deepEqual(cancel, { ok: true, cancelled: true })
  await until(() => pending.writableEnded, 1000, 'cancelled response')
  assert.equal(pending.statusCode, 500)
  const cancelledWaiter = json(pending)
  assert.equal(cancelledWaiter.ok, false)
  assert.equal(cancelledWaiter.error, 'cancelled')
  assert.equal(typeof cancelledWaiter.elapsedMs, 'number')
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])

  const stillBusy = json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS })))
  assert.equal(stillBusy.busy, true, 'busy clears only after the child really closed')

  spawnImpl.calls[0].child.emit('close', null, 'SIGTERM')
  const idle = json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS })))
  assert.equal(idle.busy, false)
  assert.equal(idle.lastCheck, null, 'a cancelled run must not create a snapshot')

  const again = json(await request(harness.handler, makeReq({ method: 'POST', url: CANCEL, headers: V2_HEADERS })))
  assert.deepEqual(again, { ok: true, cancelled: false })
})

test('fiber disposal settles in-flight waiters before terminating the child', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const pending = startCheck(harness)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')

  harness.disposeFiber()
  await until(() => pending.writableEnded, 1000, 'disposed waiter')
  assert.equal(pending.statusCode, 500)
  const disposedWaiter = json(pending)
  assert.equal(disposedWaiter.ok, false)
  assert.equal(disposedWaiter.error, 'cancelled')
  assert.equal(typeof disposedWaiter.elapsedMs, 'number')
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])
})

test('a response closing early leaves the run alive and caches its result', async () => {
  const abortable = () => {
    const res = makeRes()
    const closeHandlers = []
    res.once = (name, handler) => { if (name === 'close') closeHandlers.push(handler) }
    res.closeHandlers = closeHandlers
    return res
  }
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl })

  const first = abortable()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }), first)
  await until(() => spawnImpl.calls.length === 1, 1000, 'spawn')
  const second = abortable()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }), second)
  assert.equal(first.closeHandlers.length, 1)
  assert.equal(second.closeHandlers.length, 1)
  assert.equal(json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS }))).running.waiters, 2)

  // The first browser aborts: the run keeps going and the second client still
  // receives the shared result.
  first.closeHandlers[0]()
  assert.equal(json(await request(harness.handler, makeReq({ url: STATUS, headers: V2_HEADERS }))).running.waiters, 1)
  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => second.writableEnded, 2000, 'shared response')
  assert.equal(json(second).checkedAt, json(second).checkedAt)

  const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS })))
  assert.equal(snapshot.snapshot.checkedAt, json(second).checkedAt, 'the completed run is cached for later clients')
  const hit = json(await request(harness.handler, makeReq({ method: 'POST', url: `${CHECK}?force=0`, headers: V2_HEADERS })))
  assert.equal(hit.cache, 'hit')
})

/* ------------------------------------------------------- v2: persistence */

test('state persists to dataDir and reloads snapshot + history in a new instance', async (t) => {
  const dataDir = makeTempDataDir(t)
  const spawnImpl = makeSpawn(child => { succeedWith(child, RICH_REPORT) })
  const harness = boot({ spawn: spawnImpl, persist: true, dataDir })
  const checkedAt = json(await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }))).checkedAt

  const statePath = path.join(dataDir, 'state.json')
  const raw = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(raw.schemaVersion, 1)
  assert.equal(raw.snapshot.checkedAt, checkedAt)
  assert.equal(raw.snapshot.mode, 'full')
  assert.equal(typeof raw.snapshot.elapsedMs, 'number')
  assert.deepEqual(raw.snapshot.report, RICH_REPORT)
  assert.equal(raw.history.length, 1)
  assert.equal(raw.history[0].checkedAt, checkedAt)
  assert.equal(raw.history[0].summary.toolCount, 2)
  if (process.platform !== 'win32') {
    assert.equal(statSync(statePath).mode & 0o777, 0o600)
    assert.equal(statSync(dataDir).mode & 0o777, 0o700)
  }

  const reloaded = boot({ dataDir, persist: true })
  const snapshot = json(await request(reloaded.handler, makeReq({ url: `${SNAPSHOT}?full=1`, headers: V2_HEADERS })))
  assert.equal(snapshot.snapshot.checkedAt, checkedAt)
  assert.deepEqual(snapshot.snapshot.report, RICH_REPORT)
  assert.equal(snapshot.snapshot.summary.toolCount, 2)
  const health = json(await request(reloaded.handler, makeReq({ url: HEALTH, headers: V2_HEADERS })))
  assert.equal(health.lastCheck.checkedAt, checkedAt)
  const history = json(await request(reloaded.handler, makeReq({ url: HISTORY, headers: V2_HEADERS })))
  assert.equal(history.entries.length, 1)

  const hit = json(await request(reloaded.handler, makeReq({ method: 'POST', url: `${CHECK}?force=0`, headers: V2_HEADERS })))
  assert.equal(hit.cache, 'hit', 'a reloaded snapshot serves force=0 from disk')
})

test('the default dataDir follows DSH_HOME/storages/cli-doctor', async (t) => {
  const home = makeTempDataDir(t)
  const saved = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = home
    const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
    const harness = boot({ spawn: spawnImpl, persist: true })
    await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }))
    assert.equal(statSync(path.join(home, 'storages', 'cli-doctor', 'state.json')).isFile(), true)
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('corrupt or unsupported state files are ignored without crashing', async (t) => {
  const invalidStates = [
    '{not json at all',
    '[]',
    JSON.stringify({ schemaVersion: 99, snapshot: null, history: [] }),
    JSON.stringify({ schemaVersion: 1, snapshot: { checkedAt: 'not-a-date' }, history: 'nope' }),
  ]
  for (const content of invalidStates) {
    const dataDir = makeTempDataDir(t)
    writeFileSync(path.join(dataDir, 'state.json'), content)
    const harness = boot({ dataDir, persist: true })
    const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS })))
    assert.equal(snapshot.snapshot, null, content)
    assert.equal(snapshot.ok, true)
  }
})

test('persistence write failures are logged and never fail a diagnosis', async (t) => {
  const root = makeTempDataDir(t)
  const blocker = path.join(root, 'blocker')
  writeFileSync(blocker, 'x')
  const logged = []
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({
    spawn: spawnImpl,
    persist: true,
    dataDir: path.join(blocker, 'nested'),
    logger: message => logged.push(message),
  })
  const res = await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }))
  assert.equal(res.statusCode, 200)
  assert.equal(json(res).ok, true)
  assert.ok(logged.some(line => line.includes('state persistence failed')), JSON.stringify(logged))
})

test('apply loads a large persisted state well under the 50 ms budget', async (t) => {
  const dataDir = makeTempDataDir(t)
  const tools = Array.from({ length: 800 }, (_, index) => ({
    name: `tool-${index}`,
    current: '1.0.0',
    latest: '1.1.0',
    outdated: true,
    impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] },
  }))
  const report = { generated_at: '2026-01-01T00:00:00Z', managers: { homebrew: { tools, deps: [] } } }
  writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    snapshot: { report, checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1 },
    history: [],
  }))
  const started = Date.now()
  const harness = boot({ dataDir, persist: true })
  const elapsed = Date.now() - started
  assert.ok(elapsed < 50, `apply blocked for ${elapsed} ms`)
  const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS })))
  assert.equal(snapshot.snapshot.summary.toolCount, 800)
})

/* --------------------------------------------------- v2: TTL & env seams */

test('summary stale follows the TTL while history keeps its capture-time summary', async () => {
  const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
  const harness = boot({ spawn: spawnImpl, staleAfterHours: 0.000001 })
  await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }))
  await new Promise(resolve => setTimeout(resolve, 20))

  const snapshot = json(await request(harness.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS })))
  assert.equal(snapshot.snapshot.stale, true)
  assert.equal(snapshot.snapshot.summary.stale, true)
  assert.ok(snapshot.snapshot.ageMs >= 0)

  const history = json(await request(harness.handler, makeReq({ url: HISTORY, headers: V2_HEADERS })))
  assert.equal(history.entries[0].summary.stale, false, 'history records the summary captured at run time')
})

test('CLI_DOCTOR_AUTO_CHECK overrides config and surfaces in the cache envelope', async () => {
  const saved = process.env.CLI_DOCTOR_AUTO_CHECK
  try {
    process.env.CLI_DOCTOR_AUTO_CHECK = '0'
    const off = boot()
    assert.equal(json(await request(off.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS }))).cache.autoCheck, false)

    process.env.CLI_DOCTOR_AUTO_CHECK = '1'
    const on = boot({ autoCheck: false })
    assert.equal(json(await request(on.handler, makeReq({ url: SNAPSHOT, headers: V2_HEADERS }))).cache.autoCheck, true)
  } finally {
    if (saved === undefined) delete process.env.CLI_DOCTOR_AUTO_CHECK
    else process.env.CLI_DOCTOR_AUTO_CHECK = saved
  }
})

test('spawn env hygiene never overrides explicit user values', async () => {
  const savedAutoUpdate = process.env.HOMEBREW_NO_AUTO_UPDATE
  const savedNoColor = process.env.NO_COLOR
  try {
    process.env.HOMEBREW_NO_AUTO_UPDATE = 'user-wins'
    delete process.env.NO_COLOR
    const spawnImpl = makeSpawn(child => { succeedWith(child, SAMPLE_REPORT) })
    const harness = boot({ spawn: spawnImpl })
    await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers: V2_HEADERS }))
    const env = spawnImpl.calls[0].opts.env
    assert.equal(env.HOMEBREW_NO_AUTO_UPDATE, 'user-wins')
    assert.equal(env.HOMEBREW_NO_ANALYTICS, '1')
    assert.equal(env.PIP_DISABLE_PIP_VERSION_CHECK, '1')
    assert.equal(env.NO_COLOR, '1')
  } finally {
    if (savedAutoUpdate === undefined) delete process.env.HOMEBREW_NO_AUTO_UPDATE
    else process.env.HOMEBREW_NO_AUTO_UPDATE = savedAutoUpdate
    if (savedNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = savedNoColor
  }
})

test('/history defaults to 20 entries and clamps the limit to 100', async (t) => {
  const dataDir = makeTempDataDir(t)
  const summary = {
    toolCount: 1, depCount: 0, updateCount: 0, recommendedCount: 0, reviewCount: 0,
    unknownCount: 0, conflictCount: 0, uncertainCount: 0,
    generatedAt: null, checkedAt: '2026-01-01T00:00:00Z', mode: 'full', stale: false,
  }
  const entries = Array.from({ length: 22 }, (_, index) => ({
    checkedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    mode: 'full',
    elapsedMs: index,
    summary: { ...summary, checkedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() },
  }))
  writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify({
    schemaVersion: 1, snapshot: null, history: entries,
  }))
  const harness = boot({ dataDir, persist: true, keepHistory: 30 })
  const defaultPage = json(await request(harness.handler, makeReq({ url: HISTORY, headers: V2_HEADERS })))
  assert.equal(defaultPage.entries.length, 20, 'the /history default limit is 20')
  const capped = json(await request(harness.handler, makeReq({ url: `${HISTORY}?limit=500`, headers: V2_HEADERS })))
  assert.equal(capped.entries.length, 22, 'the clamp cannot exceed what is stored')
})
