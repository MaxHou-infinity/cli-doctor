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
import { readFileSync } from 'node:fs'
import http from 'node:http'
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
const JSON_TYPE = 'application/json; charset=utf-8'

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
  host.apply(harness.ctx, config)
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
  assert.deepEqual(json(res), { ok: true, version: PKG_VERSION, busy: false })
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
  assert.equal(typeof body.checkedAt, 'string')
  const checkedAt = Date.parse(body.checkedAt)
  assert.ok(Number.isFinite(checkedAt), `checkedAt must be an ISO timestamp: ${body.checkedAt}`)
  assert.ok(checkedAt >= startedAt - 1000 && checkedAt <= Date.now() + 1000)

  assert.equal(spawnImpl.calls.length, 1)
  const call = spawnImpl.calls[0]
  assert.equal(call.cmd, process.execPath)
  assert.deepEqual(call.args, [CHECK_PATH, '--json', '--no-update'])
  assert.deepEqual(Object.keys(call.opts).sort(), ['cwd', 'env'])
  assert.equal(call.opts.cwd, PKG_ROOT)
  assert.equal(call.opts.env, process.env)
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
  assert.deepEqual(json(busyRes), { ok: true, version: PKG_VERSION, busy: true })

  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => checkRes.writableEnded, 2000, 'check response')
  const idleRes = await request(harness.handler, makeReq({ headers }))
  assert.deepEqual(json(idleRes), { ok: true, version: PKG_VERSION, busy: false })
})

/* --------------------------------------------------------- single flight */

test('a concurrent check is refused with 409 busy and no second spawn', async () => {
  const spawnImpl = makeSpawn()
  const harness = boot({ spawn: spawnImpl })
  const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1' }

  const first = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), first)
  await until(() => spawnImpl.calls.length === 1, 1000, 'first spawn')

  for (let i = 0; i < 3; i += 1) {
    const res = await request(harness.handler, makeReq({ method: 'POST', url: CHECK, headers }))
    assert.equal(res.statusCode, 409)
    assertJsonHeaders(res)
    assert.deepEqual(json(res), { ok: false, error: 'busy' })
  }
  assert.equal(spawnImpl.calls.length, 1)

  succeedWith(spawnImpl.calls[0].child, SAMPLE_REPORT)
  await until(() => first.writableEnded, 2000, 'first response')
  assert.equal(json(first).ok, true)

  const next = makeRes()
  harness.handler(makeReq({ method: 'POST', url: CHECK, headers }), next)
  await until(() => spawnImpl.calls.length === 2, 1000, 'second spawn')
  succeedWith(spawnImpl.calls[1].child, SAMPLE_REPORT)
  await until(() => next.writableEnded, 2000, 'second response')
  assert.equal(json(next).ok, true)
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
  assert.deepEqual(json(res), { ok: false, error: 'exit-1' })
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
  assert.deepEqual(json(res), { ok: false, error: 'signal-SIGKILL' })
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
    assert.deepEqual(json(res), { ok: false, error: 'invalid-json' })
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
  assert.deepEqual(json(res), { ok: false, error: 'timeout' })
  assert.deepEqual(spawnImpl.calls[0].child.killSignals, ['SIGTERM'])

  // A late close after the timeout must not rewrite anything.
  assert.equal(res.statusCode, 500)
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
  assert.deepEqual(json(res), { ok: false, error: 'output-too-large' })
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
    assert.deepEqual(json(res), { ok: false, error: 'spawn-error' })
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
  assert.deepEqual(json(res), { ok: false, error: 'spawn-error' })
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
    assert.deepEqual(JSON.parse(allowed.body), { ok: true, version: PKG_VERSION, busy: false })

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
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'exit-3' })

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
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'timeout' })
    const pid = spawnImpl.calls[0].child.pid
    assert.equal(await waitForExit(pid), true, `child ${pid} survived the SIGTERM`)
  } finally {
    await close()
  }
})

test('real HTTP: two concurrent checks yield 200 and 409', async () => {
  const spawnImpl = realSpawn('setTimeout(() => { process.stdout.write("{}") }, 200)')
  const { port, close } = await startServer({ spawn: spawnImpl })
  try {
    const headers = { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }
    const [first, second] = await Promise.all([
      httpRequest(port, { method: 'POST', url: CHECK, headers }),
      httpRequest(port, { method: 'POST', url: CHECK, headers }),
    ])
    const statuses = [first.status, second.status].sort()
    assert.deepEqual(statuses, [200, 409])
    const busy = first.status === 409 ? first : second
    assert.deepEqual(JSON.parse(busy.body), { ok: false, error: 'busy' })
    assert.equal(spawnImpl.calls.length, 1)
  } finally {
    await close()
  }
})
