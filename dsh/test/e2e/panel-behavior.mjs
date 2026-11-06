#!/usr/bin/env node
/**
 * Independent click-through harness for the sidebar panel (CONTRACT v2).
 *
 * Mounts the shipped `dsh/lib/client.js` panel in jsdom with the real React from
 * the package's devDependencies, drives the buttons and the Host responses, and
 * feeds the panel hostile payloads. The bundle is evaluated through a fresh
 * `window.__ModuleLoader__` per scenario, so each module-level store starts from
 * a clean slate exactly like a page reload.
 *
 * Checks, in order (v2 additions marked):
 *   1. v1 UI-1 layout contract on first paint: one scroll container, pinned
 *      header, resolved root height, content reachable by scrolling;
 *   2. *v2* mount boot order: health -> snapshot?full=1, and **no** POST when
 *      `cache.autoCheck` is false;
 *   3. *v2* auto check runs exactly once when the snapshot is missing and
 *      `autoCheck` is true — and a remount does not trigger it again;
 *   4. *v2* a restored snapshot renders immediately (no POST) with the relative
 *      time / staleness copy;
 *   5. *v2* a stale snapshot (`stale: true`) triggers one auto check and the
 *      fresh result replaces the restored one;
 *   6. *v2* fast-mode results are labelled as fast;
 *   7. manual diagnosis: loading state, one request, disable guard;
 *   8. *v2* cancel calls POST /check/cancel and a `cancelled` failure is
 *      explained without crashing;
 *   9. hostile payloads: `report: null`, a structurally broken report, HTTP
 *      failures (mapped + unmapped codes), all leaving the panel usable;
 *  10. the full report renders the five ecosystems, counters, meta, skipped
 *      checks, the read-only footer, the v2 dependency semantics
 *      (「候选更新 · 待核验」 + dependency conflict/uncertain counters) and the
 *      dependency conflict counters, and everything lives in the one scroller;
 *  11. *v2* unmount -> remount keeps the finished report (flat-page state is
 *      preserved) while intervals are disposed.
 *
 * Usage: node dsh/test/e2e/panel-behavior.mjs
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..', '..')
const BUNDLE = path.join(PKG_ROOT, 'lib', 'client.js')
const ALLOWED_REQUIRES = new Set(['react', 'react/jsx-runtime'])

let pass = 0
let fail = 0
const failures = []

function ok(label, detail = '') {
  pass += 1
  process.stdout.write(`PASS: ${label}${detail ? ` (${detail})` : ''}\n`)
}

function bad(label, detail = '') {
  fail += 1
  failures.push(`${label}${detail ? `: ${detail}` : ''}`)
  process.stdout.write(`FAIL: ${label}${detail ? `: ${detail}` : ''}\n`)
}

function eq(label, expected, actual) {
  if (Object.is(expected, actual)) ok(label, String(actual))
  else bad(label, `expected ${JSON.stringify(expected)} actual ${JSON.stringify(actual)}`)
}

function truthy(label, value, detail = '') {
  if (value) ok(label)
  else bad(label, detail)
}

function section(title) {
  process.stdout.write(`\n---- ${title} ----\n`)
}

const nodeRequire = createRequire(path.join(PKG_ROOT, 'package.json'))

/* ------------------------------------------------------------------ jsdom --- */

const { JSDOM } = nodeRequire('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:19390/',
  pretendToBeVisual: true,
})
const { window } = dom

globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.Event = window.Event
globalThis.MouseEvent = window.MouseEvent
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* ------------------------------------------------------------- fixtures ---- */

const LAST_TOOL_NAME = 'self-update-probe-9f3'

const GOOD_REPORT = {
  generated_at: '2026-10-13T07:00:00.000Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 1234,
  skipped: ['brew services'],
  managers: {
    homebrew: {
      tools: [
        { name: 'ripgrep', current: '14.0.0', latest: '14.1.1', outdated: true, upgrade_cmd: 'brew upgrade ripgrep', impact: { checked: true, conflicts: [], dependents: [], indirect: [] } },
      ],
      deps: [
        {
          name: 'openssl@3',
          current: '3.0.0',
          latest: '3.1.0',
          outdated: null,
          upgrade_cmd: 'brew upgrade openssl@3',
          impact: { checked: true, dependents: [], indirect: [], conflicts: [{ name: 'ripgrep', requirement: '<3.1' }], uncertain: [] },
        },
        {
          name: 'ca-certificates',
          current: '2024-01',
          latest: '2024-02',
          outdated: null,
          impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [{ name: 'curl' }] },
        },
        {
          name: 'clean-dep',
          current: '1.0.0',
          latest: '1.1.0',
          outdated: null,
          impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] },
        },
      ],
    },
    npm_global: { tools: [{ name: 'typescript', current: '5.4.0', latest: '5.6.0', outdated: true, upgrade_cmd: 'npm i -g typescript' }], deps: [] },
    python_pip: { tools: [{ name: 'pip', current: '24.0', latest: null, outdated: null }], deps: [] },
    rust_bun_uv: { tools: [{ name: 'uv', current: '0.4.0', latest: '0.5.0', outdated: true }], deps: [] },
    self_updating: { tools: [{ name: LAST_TOOL_NAME, current: '1.0.0', latest: '2.0.0', outdated: true, upgrade_cmd: `self-update ${LAST_TOOL_NAME}` }], deps: [] },
  },
}

const MALFORMED_REPORT = {
  managers: { homebrew: { tools: null, deps: 'nope' }, npm_global: 7 },
  skipped: 42,
  generated_at: 1700000000,
  elapsed_ms: 'soon',
}

const TTL_MS = 12 * 60 * 60 * 1000

function summaryOf(report, mode = 'full') {
  return {
    toolCount: 6,
    depCount: 2,
    updateCount: 4,
    recommendedCount: 2,
    reviewCount: 1,
    unknownCount: 1,
    conflictCount: 1,
    uncertainCount: 1,
    degraded: [],
    generatedAt: report.generated_at,
    checkedAt: '2026-11-06T00:00:00.000Z',
    mode,
    stale: false,
  }
}

/* ------------------------------------------------------------- fetch stub --- */

const calls = []
let routes = []
let nextResponse = () => jsonResponse(200, { ok: true })

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function pathOf(input) {
  const url = typeof input === 'string' ? input : input?.url
  try {
    return new URL(url, 'http://127.0.0.1:19390/').pathname + new URL(url, 'http://127.0.0.1:19390/').search
  } catch {
    return String(url)
  }
}

function route(method, pathStarts, handler) {
  routes.push({ method: method.toUpperCase(), path: pathStarts, handler })
}

function resetRoutes() {
  routes = []
  calls.length = 0
  nextResponse = () => jsonResponse(200, { ok: true })
}

globalThis.fetch = async (input, init = {}) => {
  const method = (init.method ?? 'GET').toUpperCase()
  const fullPath = pathOf(input)
  calls.push({ method, path: fullPath })
  const match = routes.find((entry) => entry.method === method && (fullPath === entry.path || fullPath.startsWith(`${entry.path}?`)))
  if (match) return await match.handler(fullPath, init)
  return await nextResponse(fullPath, init)
}
window.fetch = globalThis.fetch

/* ------------------------------------------------------- clipboard stub ---- */

// CONTRACT v2.8: the panel resolves `navigator.clipboard` at copy time, so the
// jsdom window is the seam. `setClipboard(null)` simulates an unavailable API;
// a throwing writeText simulates a denied one.
let clipboardCaptured = null
function clipboardSuccess() {
  return { writeText: async (text) => { clipboardCaptured = text } }
}
function setClipboard(implementation) {
  Object.defineProperty(window.navigator, 'clipboard', { value: implementation, configurable: true })
}
setClipboard(clipboardSuccess())

/** Visible tool cards, identified by the kind label the card renders. */
function visibleToolNames(container) {
  return [...container.querySelectorAll('article')]
    .filter((article) => (article.querySelector('span')?.textContent ?? '') === '工具')
    .map((article) => article.querySelector('h4')?.textContent ?? '')
    .filter(Boolean)
}

function summaryButtons(container) {
  return [...container.querySelectorAll('[role="group"] button')]
}

function summaryButton(container, label) {
  return summaryButtons(container).find((button) => (button.textContent ?? '').includes(label))
}

function filterNote(container) {
  return [...container.querySelectorAll('[role="status"]')]
    .find((element) => (element.textContent ?? '').includes('筛选工具'))
}

function copyButton(container, pattern) {
  return [...container.querySelectorAll('button')]
    .find((button) => pattern.test(button.getAttribute('aria-label') ?? ''))
}



function callsTo(method, pathStarts) {
  return calls.filter((call) => call.method === method && call.path.startsWith(pathStarts))
}

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function waitUntil(label, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await settle(1)
  }
  bad(`timed out waiting for ${label}`, '')
  return false
}

/* ------------------------------------------------------------------ load --- */

const source = readFileSync(BUNDLE, 'utf8')

const { createRoot } = nodeRequire('react-dom/client')
const React = nodeRequire('react')
const act = React.act ?? nodeRequire('react-dom/test-utils').act

const loaded = new Map()
function bundleRequire(specifier) {
  if (!ALLOWED_REQUIRES.has(specifier)) throw new Error(`browser module table has no module "${specifier}"`)
  if (!loaded.has(specifier)) loaded.set(specifier, nodeRequire(specifier))
  return loaded.get(specifier)
}

/** Evaluate the bundle exactly like the Web GUI: fresh __ModuleLoader__ per load. */
function loadBundleModule() {
  const registrations = []
  const fakeWindow = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  new Function('require', 'window', source)(bundleRequire, fakeWindow)
  if (registrations.length !== 1) throw new Error(`bundle registered ${registrations.length} modules`)
  return registrations[0].factory(bundleRequire)
}

/* ------------------------------------------------------- interval tracking --- */

const originalSetInterval = globalThis.setInterval
const originalSetTimeout = globalThis.setTimeout
let liveIntervals = 0
globalThis.setInterval = (...args) => {
  liveIntervals += 1
  const handle = originalSetInterval(...args)
  const clear = globalThis.clearInterval
  globalThis.clearInterval = (value) => {
    if (value === handle) liveIntervals -= 1
    return clear(value)
  }
  return handle
}

/* -------------------------------------------------------------- mounting ---- */

const containers = []

async function mountPanel(moduleExports) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  await act(async () => { root.render(React.createElement(moduleExports.CliDoctorPanel)) })
  return {
    container,
    root,
    async unmount() {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

function findButton(container, pattern) {
  return [...container.querySelectorAll('button')]
    .find((element) => pattern.test(element.textContent ?? '') && !element.disabled)
}

function findAnyButton(container, pattern) {
  return [...container.querySelectorAll('button')]
    .find((element) => pattern.test(element.textContent ?? ''))
}

async function click(element) {
  if (!element) return false
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  return true
}

const DIAGNOSE_BUTTON = /一键诊断当前状态|重新诊断|诊断当前状态/

function assertUi1Layout(container, phaseLabel) {
  const rootEl = container.querySelector('[data-dsh-cli-doctor]')
  const scrollEl = container.querySelector('[data-dsh-cli-doctor-scroll]')
  const scrollers = [...container.querySelectorAll('*')].filter((element) => element.style.overflowY === 'auto')

  truthy(`${phaseLabel}: panel root exists`, rootEl !== null, 'no [data-dsh-cli-doctor] root')
  eq(`${phaseLabel}: exactly one overflow-y:auto element in the whole tree`, 1, scrollers.length)
  truthy(`${phaseLabel}: the scroll container is [data-dsh-cli-doctor-scroll]`, scrollers[0] === scrollEl, 'marker and scroller differ')
  truthy(`${phaseLabel}: scroll container is a descendant of the panel root`, rootEl !== null && scrollEl !== null && rootEl.contains(scrollEl))
  truthy(`${phaseLabel}: scroll container is a direct child of the panel root`, scrollEl?.parentElement === rootEl)

  const styleOf = (element) => (element ? element.style : {})
  const rootStyle = styleOf(rootEl)
  eq(`${phaseLabel}: root height is 100%`, '100%', rootStyle.height)
  eq(`${phaseLabel}: root is a flex column`, 'flex', rootStyle.display)
  eq(`${phaseLabel}: root flexDirection`, 'column', rootStyle.flexDirection)
  eq(`${phaseLabel}: root minHeight is 0`, '0', rootStyle.minHeight)
  eq(`${phaseLabel}: root minWidth is 0`, '0', rootStyle.minWidth)
  eq(`${phaseLabel}: root boxSizing`, 'border-box', rootStyle.boxSizing)
  truthy(
    `${phaseLabel}: root flex-grow is non-zero`,
    Number.parseFloat(rootStyle.flexGrow || '0') > 0 || /^1\s/.test(rootStyle.flex || ''),
    rootStyle.flex || '(no flex)',
  )
  eq(`${phaseLabel}: root has no maxWidth any more (UI-1 acceptance)`, '', rootStyle.maxWidth)

  const headerEl = rootEl?.querySelector('header')
  truthy(`${phaseLabel}: header exists`, headerEl !== null)
  eq(`${phaseLabel}: header is a direct child of the root`, rootEl, headerEl?.parentElement)
  truthy(`${phaseLabel}: header is NOT inside the scroll container`, headerEl !== null && scrollEl !== null && !scrollEl.contains(headerEl))
  eq(`${phaseLabel}: header is pinned with flexShrink 0`, '0', styleOf(headerEl).flexShrink)
  truthy(
    `${phaseLabel}: root has no third-party layout child`,
    rootEl ? [...rootEl.children].every((child) => child === headerEl || child === scrollEl || child.tagName === 'DIV') : false,
  )

  const scrollStyle = styleOf(scrollEl)
  eq(`${phaseLabel}: scroll overflowY`, 'auto', scrollStyle.overflowY)
  eq(`${phaseLabel}: scroll overflowX`, 'hidden', scrollStyle.overflowX)
  eq(`${phaseLabel}: scroll minHeight is 0`, '0', scrollStyle.minHeight)
  truthy(`${phaseLabel}: scroll flex-grow is non-zero`, Number.parseFloat(scrollStyle.flexGrow || '0') > 0, scrollStyle.flex || '(no flex)')
  eq(`${phaseLabel}: scroll overscrollBehavior`, 'contain', scrollStyle.overscrollBehavior)
  eq(`${phaseLabel}: scroll keeps room for the scrollbar`, '8px', scrollStyle.paddingRight)

  const deepestContaining = (needle) => [...container.querySelectorAll('*')]
    .filter((element) => (element.textContent ?? '').includes(needle))
    .at(-1)
  return { rootEl, scrollEl, deepestContaining }
}

/* -------------------------------------------------------------- scenarios --- */

try {
  /* ============ 1. first paint + v2 mount boot order (autoCheck off) ====== */
  section('1. first paint: health -> snapshot, no POST when autoCheck=false')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: null,
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: false },
  }))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(200, { ok: true, report: GOOD_REPORT, checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1000, cache: 'fresh', shared: false }))

  let moduleA = loadBundleModule()
  let panel = await mountPanel(moduleA)
  await settle()

  truthy('panel mounted', panel.container.textContent.includes('CLI Doctor'), panel.container.textContent.slice(0, 200))
  truthy('diagnosis button present', Boolean(findButton(panel.container, DIAGNOSE_BUTTON)), panel.container.textContent.slice(0, 200))
  eq('mount boot asks health first', 'GET /api/cli-doctor/health', `${calls[0]?.method} ${calls[0]?.path}`)
  truthy('mount boot asks the full snapshot', callsTo('GET', '/api/cli-doctor/snapshot').length >= 1, JSON.stringify(calls))
  const snapshotCalls = callsTo('GET', '/api/cli-doctor/snapshot')
  truthy('the boot snapshot request asks for full=1', snapshotCalls.some((call) => call.path.includes('full=1')), JSON.stringify(snapshotCalls))
  eq('autoCheck=false means no POST on mount', 0, callsTo('POST', '/api/cli-doctor/check').length)

  let ui = assertUi1Layout(panel.container, 'first paint')
  truthy('first paint renders the empty-state inside the scroll container', ui.scrollEl !== null && (ui.scrollEl.textContent ?? '').trim().length > 0, ui.scrollEl?.textContent ?? '')
  truthy('first paint shows the plugin version', panel.container.textContent.includes('0.3.0'), panel.container.textContent.slice(0, 200))

  /* ============ 2. auto check exactly once + remount keeps state ========= */
  section('2. autoCheck=true triggers exactly one auto run; remount does not repeat it')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: null,
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: true },
  }))
  let releaseAuto = null
  route('POST', '/api/cli-doctor/check', () => new Promise((resolve) => {
    releaseAuto = () => resolve(jsonResponse(200, {
      ok: true,
      report: GOOD_REPORT,
      checkedAt: new Date().toISOString(),
      mode: 'full',
      elapsedMs: 1234,
      cache: 'fresh',
      shared: false,
    }))
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await waitUntil('automatic check POST', () => callsTo('POST', '/api/cli-doctor/check').length === 1)
  await settle()
  eq('exactly one automatic POST on mount', 1, callsTo('POST', '/api/cli-doctor/check').length)
  truthy('automatic run shows the waiting copy', /正在检查|已等待|诊断中/.test(panel.container.textContent), panel.container.textContent.slice(0, 300))
  const cancelButton = findAnyButton(panel.container, /取消/)
  truthy('a running check offers a cancel button', Boolean(cancelButton), panel.container.textContent.slice(0, 300))
  if (releaseAuto) await act(async () => { releaseAuto() })
  await settle()
  truthy('the automatic report renders', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 300))

  // remount within the same module lifetime: state survives, no second POST.
  const postsBeforeRemount = callsTo('POST', '/api/cli-doctor/check').length
  await panel.unmount()
  panel = await mountPanel(moduleA)
  await settle()
  eq('remount does not start another automatic run', postsBeforeRemount, callsTo('POST', '/api/cli-doctor/check').length)
  truthy('remount restores the finished report from the module store', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 300))
  truthy('remount keeps the read-only footer', panel.container.textContent.includes('未执行任何升级'), panel.container.textContent.slice(0, 300))
  await panel.unmount()

  /* ============ 3. restored snapshot renders immediately, no POST ======== */
  section('3. snapshot restore: report renders on mount without any POST')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: {
      checkedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      mode: 'full',
      elapsedMs: 67890,
      ageMs: 5 * 60 * 1000,
      stale: false,
      summary: summaryOf(GOOD_REPORT),
      report: GOOD_REPORT,
    },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: true },
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  eq('a fresh snapshot never triggers an auto POST', 0, callsTo('POST', '/api/cli-doctor/check').length)
  truthy('the restored report renders immediately', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 300))
  truthy('the restored report shows a relative last-check time', /上次诊断|分钟前|刚刚|前/.test(panel.container.textContent), panel.container.textContent.slice(0, 400))
  truthy('a fresh snapshot does not show the stale warning', !/数据已过期/.test(panel.container.textContent), panel.container.textContent.slice(0, 400))
  await panel.unmount()

  /* ============ 4. stale snapshot triggers one auto check ================ */
  section('4. stale snapshot triggers one auto check and the fresh result wins')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: {
      checkedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
      mode: 'full',
      elapsedMs: 67890,
      ageMs: 13 * 60 * 60 * 1000,
      stale: true,
      summary: summaryOf(GOOD_REPORT),
      report: GOOD_REPORT,
    },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: true },
  }))
  let releaseStaleRefresh = null
  route('POST', '/api/cli-doctor/check', () => new Promise((resolve) => {
    releaseStaleRefresh = () => resolve(jsonResponse(200, {
      ok: true,
      report: { ...GOOD_REPORT, generated_at: '2026-11-06T00:00:00.000Z' },
      checkedAt: new Date().toISOString(),
      mode: 'full',
      elapsedMs: 70000,
      cache: 'fresh',
      shared: false,
    }))
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  truthy('a stale snapshot is visible while the refresh runs', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 300))
  truthy('a stale snapshot shows the expired copy', /数据已过期|已过期/.test(panel.container.textContent), panel.container.textContent.slice(0, 400))
  await waitUntil('auto refresh POST for the stale snapshot', () => callsTo('POST', '/api/cli-doctor/check').length === 1)
  await settle()
  eq('a stale snapshot triggers exactly one auto check', 1, callsTo('POST', '/api/cli-doctor/check').length)
  if (releaseStaleRefresh) await act(async () => { releaseStaleRefresh() })
  await settle()
  truthy('the refreshed report renders after the auto check', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 300))
  await panel.unmount()

  /* ============ 5. manual loading state and double-click guard ============ */
  section('5. manual diagnosis: loading state and double-click guard')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  let releaseManual = null
  route('POST', '/api/cli-doctor/check', () => new Promise((resolve) => {
    releaseManual = () => resolve(jsonResponse(200, {
      ok: true,
      report: GOOD_REPORT,
      checkedAt: new Date().toISOString(),
      mode: 'full',
      elapsedMs: 1234,
      cache: 'fresh',
      shared: false,
    }))
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  const button = findButton(panel.container, DIAGNOSE_BUTTON)
  truthy('manual diagnose button available', Boolean(button))
  await click(button)
  await settle()
  eq('manual click posts to the check route', 1, callsTo('POST', '/api/cli-doctor/check').length)
  const busyButton = findAnyButton(panel.container, DIAGNOSE_BUTTON)
  eq('loading disables the diagnose button', true, busyButton?.disabled === true)
  const busyRegion = panel.container.querySelector('[data-dsh-cli-doctor-scroll][aria-busy="true"]')
  truthy('loading marks the result region aria-busy="true"', busyRegion !== null, 'no [data-dsh-cli-doctor-scroll][aria-busy=true]')
  truthy('loading shows the waiting copy', /正在检查|已等待|诊断中/.test(panel.container.textContent), panel.container.textContent.slice(0, 300))
  const callsBefore = calls.length
  if (busyButton) await click(busyButton)
  eq('a disabled button cannot start a second diagnosis', 1, callsTo('POST', '/api/cli-doctor/check').length)
  eq('disabled click adds no request at all', callsBefore, calls.length)
  if (releaseManual) await act(async () => { releaseManual() })
  await settle()

  /* ============ 6. full report rendering (v1 coverage + v2 semantics) ===== */
  section('6. full report rendering: v1 coverage + v2 dependency semantics')
  const text = panel.container.textContent
  const ORDER = ['Homebrew', 'npm 全局', 'Python / pip', 'Rust / Bun / uv', '独立更新工具']
  for (const title of ORDER) {
    truthy(`good report renders ${title}`, text.includes(title), text.slice(0, 300))
  }
  const positions = ORDER.map((title) => text.indexOf(title))
  truthy('ecosystem blocks keep the contract order', positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])), positions.join(','))
  truthy(
    'good report renders the five tool counters',
    text.includes('已发现工具') && text.includes('有可用更新') && text.includes('建议更新') && text.includes('需核验或暂缓') && text.includes('目标待核验'),
    text.slice(0, 300),
  )
  truthy('good report shows generated_at/scope/elapsed_ms', text.includes('生成时间') && text.includes('范围') && text.includes('耗时'), text.slice(0, 300))
  truthy('good report lists skipped checks', text.includes('brew services'), text.slice(0, 300))
  truthy('read-only footer present after a report', text.includes('未执行任何升级'), text.slice(0, 300))
  truthy('upgrade command shown for an entry', text.includes('brew upgrade ripgrep'), text.slice(0, 300))
  truthy('entry shows the current version', text.includes('14.0.0'), text.slice(0, 300))
  truthy('entry shows the latest version', text.includes('14.1.1'), text.slice(0, 300))
  truthy('entry shows a status label', /有可用更新|建议更新|目标待核验|未检出更新|候选更新/.test(text), text.slice(0, 300))
  truthy('dependency without an outdated verdict is labelled 候选更新 · 待核验', text.includes('候选更新 · 待核验'), text.slice(0, 500))
  truthy('dependency recommendation says the update needs manual review', text.includes('依赖更新需人工核验'), text.slice(0, 500))
  truthy('dependency-layer counters appear when non-zero', /1\s*依赖冲突/.test(text) && /1\s*依赖待核验/.test(text), text.slice(0, 500))

  ui = assertUi1Layout(panel.container, 'report')
  for (const [label, needle] of [
    ['summary counters', '已发现工具'],
    ['report meta', '生成时间'],
    ['skipped list', 'brew services'],
    ['first ecosystem block', 'Homebrew'],
    ['read-only footer', '未执行任何升级'],
    ['last tool card', LAST_TOOL_NAME],
    ['last upgrade command', `self-update ${LAST_TOOL_NAME}`],
  ]) {
    const element = ui.deepestContaining(needle)
    truthy(`${label} is inside the scroll container`, element !== undefined && ui.scrollEl !== null && ui.scrollEl.contains(element), `no element matched ${JSON.stringify(needle)}`)
  }
  const lastCard = ui.deepestContaining(LAST_TOOL_NAME)
  const firstCard = ui.deepestContaining('ripgrep')
  truthy(
    'the last card really is below the first card in document order',
    firstCard !== undefined && lastCard !== undefined && (firstCard.compareDocumentPosition(lastCard) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  )
  truthy('no element keeps the removed maxWidth layout', [...panel.container.querySelectorAll('*')].every((element) => element.style.maxWidth === ''))
  await panel.unmount()


  /* ============ 6b. copy report + summary-card filter (v2.8) =========== */

  section('6b. copy report + summary-card filter (v2.8)')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: {
      checkedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      mode: 'full',
      elapsedMs: 1234,
      ageMs: 2 * 60 * 1000,
      stale: false,
      summary: summaryOf(GOOD_REPORT),
      report: GOOD_REPORT,
    },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: false },
  }))
  setClipboard(clipboardSuccess())
  clipboardCaptured = null
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  eq('restored report mount sends no POST', 0, callsTo('POST', '/api/cli-doctor/check').length)
  truthy('report panel renders before the copy assertions', panel.container.textContent.includes('Homebrew'), panel.container.textContent.slice(0, 200))

  const markdownButton = copyButton(panel.container, /复制 Markdown 诊断报告/)
  const jsonButton = copyButton(panel.container, /复制原始 JSON 诊断报告/)
  truthy('"复制报告" action is discoverable', markdownButton !== undefined && markdownButton.textContent.includes('复制报告'), panel.container.textContent.slice(0, 300))
  truthy('"复制原始 JSON" action is discoverable', jsonButton !== undefined && jsonButton.textContent.includes('复制原始 JSON'), panel.container.textContent.slice(0, 300))
  eq('both copy actions are type=button', 'button,button', `${markdownButton?.getAttribute('type')},${jsonButton?.getAttribute('type')}`)

  const callsBeforeCopy = calls.length
  await click(markdownButton)
  await settle()
  const markdownCopied = String(clipboardCaptured ?? '')
  truthy('copy report writes Markdown to the clipboard seam', markdownCopied.includes('# CLI Doctor 诊断报告'), markdownCopied.slice(0, 120))
  truthy('copied Markdown includes the summary section', markdownCopied.includes('## 汇总计数'), '')
  truthy('copied Markdown includes actionable details', markdownCopied.includes('## 可行动工具明细') && markdownCopied.includes('#### ripgrep'), '')
  truthy('copied Markdown includes dependency risk', markdownCopied.includes('## 依赖冲突与待核验'), '')
  truthy('copied Markdown includes the read-only policy', markdownCopied.includes('## 只读说明') && markdownCopied.includes('不执行'), '')
  truthy('copied Markdown includes the data source', markdownCopied.includes('## 数据来源'), '')
  eq('copying sends no network request', callsBeforeCopy, calls.length)
  truthy('copying does not mutate the rendered report', panel.container.textContent.includes('Homebrew'), '')
  const copyFeedback = panel.container.querySelector('[data-dsh-cli-doctor-copy-feedback]')
  truthy('a copy success surfaces "已复制"', copyFeedback !== null && copyFeedback.textContent.includes('已复制'), copyFeedback?.textContent ?? '')
  eq('copy feedback is a polite live region', 'polite', copyFeedback?.getAttribute('aria-live'))
  eq('copy feedback is a status region', 'status', copyFeedback?.getAttribute('role'))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 2150)) })
  eq('copy success feedback disappears after ~2s', null, panel.container.querySelector('[data-dsh-cli-doctor-copy-feedback]'))

  clipboardCaptured = null
  await click(copyButton(panel.container, /复制原始 JSON 诊断报告/))
  await settle()
  const jsonCopied = String(clipboardCaptured ?? '')
  let jsonRoundTrip = null
  try { jsonRoundTrip = JSON.parse(jsonCopied) } catch { jsonRoundTrip = null }
  truthy('copy raw JSON writes parseable JSON', jsonRoundTrip !== null, jsonCopied.slice(0, 120))
  eq('raw JSON round-trips to the original report', JSON.stringify(GOOD_REPORT), JSON.stringify(jsonRoundTrip))

  // --- summary cards: five toggle buttons, one shared judgment -----------
  const cards = summaryButtons(panel.container)
  eq('five summary cards are buttons', 5, cards.length)
  eq('all summary cards carry aria-pressed', 5, cards.filter((button) => button.hasAttribute('aria-pressed')).length)
  eq('「已发现工具」 is pressed when no filter is active', 'true', summaryButton(panel.container, '已发现工具')?.getAttribute('aria-pressed'))
  const unfilteredTools = visibleToolNames(panel.container)
  eq('unfiltered view renders every tool card', 5, unfilteredTools.length)
  truthy('unfiltered view renders the dependency layer', panel.container.textContent.includes('openssl@3'), panel.container.textContent.slice(0, 400))

  await click(summaryButton(panel.container, '有可用更新'))
  await settle()
  const updateFiltered = visibleToolNames(panel.container)
  eq('「有可用更新」 filter shows exactly the matching tools', 'ripgrep,typescript,uv,' + LAST_TOOL_NAME, updateFiltered.join(','))
  eq('the active card is aria-pressed=true', 'true', summaryButton(panel.container, '有可用更新')?.getAttribute('aria-pressed'))
  eq('the clear card is not pressed while filtered', 'false', summaryButton(panel.container, '已发现工具')?.getAttribute('aria-pressed'))
  truthy('a filter explanation line is shown', filterNote(panel.container) !== null, panel.container.textContent.slice(0, 400))
  truthy('the filter note says the dependency layer is hidden', (filterNote(panel.container)?.textContent ?? '').includes('依赖层已隐藏'), '')
  truthy('the dependency layer is hidden while filtering', !panel.container.textContent.includes('openssl@3'), panel.container.textContent.slice(0, 400))
  const matchHeaders = [...panel.container.querySelectorAll('*')]
    .map((element) => element.textContent ?? '')
    .filter((text) => /匹配 \d+ \/ 共 \d+ 个工具/.test(text))
  truthy('block heads show 「匹配 N / 共 M」', matchHeaders.length >= 4, String(matchHeaders.length))
  truthy('a 「清除筛选」 control is offered', Boolean([...panel.container.querySelectorAll('button')].find((button) => button.textContent.includes('清除筛选'))), '')

  await click(summaryButton(panel.container, '有可用更新'))
  await settle()
  eq('clicking the active card restores the full list', unfilteredTools.join(','), visibleToolNames(panel.container).join(','))
  truthy('clearing the filter restores the dependency layer', panel.container.textContent.includes('openssl@3'), '')
  eq('clearing restores the pressed state of 「已发现工具」', 'true', summaryButton(panel.container, '已发现工具')?.getAttribute('aria-pressed'))

  await click(summaryButton(panel.container, '建议更新'))
  await settle()
  eq('「建议更新」 filter selects recommended tools only', 'ripgrep', visibleToolNames(panel.container).join(','))
  await click([...panel.container.querySelectorAll('button')].find((button) => button.textContent.includes('清除筛选')))
  await settle()
  eq('「清除筛选」 button restores the full list', unfilteredTools.join(','), visibleToolNames(panel.container).join(','))

  await click(summaryButton(panel.container, '需核验或暂缓'))
  await settle()
  eq('「需核验或暂缓」 filter shows exactly the matching tools', 'typescript,uv,' + LAST_TOOL_NAME, visibleToolNames(panel.container).join(','))
  await click(summaryButton(panel.container, '目标待核验'))
  await settle()
  eq('「目标待核验」 filter shows exactly the matching tools', 'pip', visibleToolNames(panel.container).join(','))
  await click(summaryButton(panel.container, '已发现工具'))
  await settle()
  eq('「已发现工具」 clears an active filter', unfilteredTools.join(','), visibleToolNames(panel.container).join(','))

  await click(summaryButton(panel.container, '需核验或暂缓'))
  await settle()
  await panel.unmount()
  panel = await mountPanel(moduleA)
  await settle()
  eq('the filter survives an unmount/remount', 'true', summaryButton(panel.container, '需核验或暂缓')?.getAttribute('aria-pressed'))
  eq('the filtered cards survive an unmount/remount', 'typescript,uv,' + LAST_TOOL_NAME, visibleToolNames(panel.container).join(','))
  await click(summaryButton(panel.container, '需核验或暂缓'))
  await settle()
  await panel.unmount()

  /* ============ 6c. empty filter result offers a clear action =========== */
  section('6c. empty filter result offers a clear action')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  const STEADY_ONLY = {
    generated_at: '2026-11-06T00:00:00.000Z',
    scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
    elapsed_ms: 10,
    managers: {
      homebrew: { tools: [{ name: 'steady-only', current: '1.0.0', latest: '1.0.0', outdated: false }], deps: [] },
      npm_global: { tools: [], deps: [] },
      python_pip: { tools: [], deps: [] },
      rust_bun_uv: { tools: [], deps: [] },
      self_updating: { tools: [], deps: [] },
    },
  }
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: { checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 10, ageMs: 0, stale: false, summary: summaryOf(STEADY_ONLY), report: STEADY_ONLY },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: false },
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(summaryButton(panel.container, '有可用更新'))
  await settle()
  truthy('an empty filter result explains itself', panel.container.textContent.includes('没有符合'), panel.container.textContent.slice(0, 400))
  const emptyClear = [...panel.container.querySelectorAll('button')].find((button) => button.textContent.includes('清除筛选'))
  truthy('an empty filter result offers a clear action', Boolean(emptyClear), panel.container.textContent.slice(0, 400))
  await click(emptyClear)
  await settle()
  eq('clearing the empty filter restores the only tool', 'steady-only', visibleToolNames(panel.container).join(','))
  await panel.unmount()

  /* ============ 6d. clipboard failure falls back to a textarea ========== */
  section('6d. clipboard failure falls back to a read-only textarea')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: { checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1234, ageMs: 0, stale: false, summary: summaryOf(GOOD_REPORT), report: GOOD_REPORT },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: false },
  }))
  setClipboard({ writeText: async () => { throw new Error('denied') } })
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(copyButton(panel.container, /复制 Markdown 诊断报告/))
  await settle()
  const fallback = panel.container.querySelector('[data-dsh-cli-doctor-copy]')
  truthy('a failed copy renders the in-place fallback', fallback !== null, panel.container.textContent.slice(0, 400))
  const fallbackArea = fallback?.querySelector('textarea')
  truthy('the fallback renders a read-only textarea', fallbackArea !== null && fallbackArea.readOnly === true, '')
  truthy('the fallback carries the full Markdown', String(fallbackArea?.value ?? '').includes('# CLI Doctor 诊断报告'), String(fallbackArea?.value ?? '').slice(0, 120))
  truthy('the fallback explains the failure', (fallback?.textContent ?? '').includes('剪贴板写入失败') && (fallback?.textContent ?? '').includes('denied'), fallback?.textContent ?? '')
  await click([...fallback.querySelectorAll('button')].find((button) => button.textContent.includes('关闭')))
  await settle()
  eq('the fallback can be closed', null, panel.container.querySelector('[data-dsh-cli-doctor-copy]'))
  await panel.unmount()

  /* ============ 6e. unavailable clipboard falls back too ================ */
  section('6e. unavailable clipboard falls back too')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, {
    ok: true,
    snapshot: { checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1234, ageMs: 0, stale: false, summary: summaryOf(GOOD_REPORT), report: GOOD_REPORT },
    busy: false,
    cache: { ttlMs: TTL_MS, autoCheck: false },
  }))
  setClipboard(undefined)
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(copyButton(panel.container, /复制原始 JSON 诊断报告/))
  await settle()
  const unavailableFallback = panel.container.querySelector('[data-dsh-cli-doctor-copy]')
  truthy('an unavailable clipboard renders the textarea fallback', unavailableFallback !== null, panel.container.textContent.slice(0, 400))
  truthy('the fallback explains the unavailable API', (unavailableFallback?.textContent ?? '').includes('当前环境不支持剪贴板写入'), unavailableFallback?.textContent ?? '')
  const jsonFallbackArea = unavailableFallback?.querySelector('textarea')
  let fallbackJson = null
  try { fallbackJson = JSON.parse(String(jsonFallbackArea?.value ?? '')) } catch { fallbackJson = null }
  truthy('the fallback textarea carries the raw JSON', fallbackJson !== null && JSON.stringify(fallbackJson) === JSON.stringify(GOOD_REPORT), '')
  setClipboard(clipboardSuccess())
  await panel.unmount()

  /* ============ 7. cancel =============================================== */
  section('7. cancel: POST /check/cancel + cancelled failure copy')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  let releaseCancelled = null
  route('POST', '/api/cli-doctor/check', () => new Promise((resolve) => {
    releaseCancelled = () => resolve(jsonResponse(500, { ok: false, error: 'cancelled' }))
  }))
  route('POST', '/api/cli-doctor/check/cancel', () => jsonResponse(200, { ok: true, cancelled: true }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(findButton(panel.container, DIAGNOSE_BUTTON))
  await settle()
  const cancel = findAnyButton(panel.container, /取消/)
  truthy('cancel button appears while running', Boolean(cancel), panel.container.textContent.slice(0, 300))
  await click(cancel)
  await settle()
  eq('cancel calls POST /check/cancel', 1, callsTo('POST', '/api/cli-doctor/check/cancel').length)
  if (releaseCancelled) await act(async () => { releaseCancelled() })
  await settle()
  const cancelledNotice = panel.container.querySelector('[data-dsh-cli-doctor-scroll] [role="status"]')
  truthy('cancelled run explains itself in a status notice', cancelledNotice !== null, panel.container.textContent.slice(0, 400))
  truthy('cancelled copy is readable', /已取消|取消|cancelled/.test(panel.container.textContent), panel.container.textContent.slice(0, 400))
  truthy('cancelled run is not treated as a fatal error', panel.container.querySelector('[role="alert"]') === null, panel.container.innerHTML.slice(0, 400))
  truthy('cancel leaves the diagnose path available again', Boolean(findButton(panel.container, DIAGNOSE_BUTTON)), panel.container.textContent.slice(0, 300))
  await panel.unmount()

  /* ============ 8. hostile payloads ===================================== */
  section('8. hostile payloads never crash the panel')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(200, { ok: true, report: null, checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1, cache: 'fresh', shared: false }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(findButton(panel.container, DIAGNOSE_BUTTON))
  await settle()
  truthy('report:null does not crash the panel', panel.container.querySelector('div') !== null, 'container lost its tree')
  truthy('panel still offers the button after report:null', Boolean(findButton(panel.container, DIAGNOSE_BUTTON)), panel.container.textContent.slice(0, 300))
  await panel.unmount()

  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(200, { ok: true, report: MALFORMED_REPORT, checkedAt: new Date().toISOString(), mode: 'full', elapsedMs: 1, cache: 'fresh', shared: false }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(findButton(panel.container, DIAGNOSE_BUTTON))
  await settle()
  truthy('structurally broken report does not crash the panel', panel.container.querySelector('div') !== null, 'container lost its tree')
  truthy('broken report still renders the read-only footer', panel.container.textContent.includes('未执行任何升级'), panel.container.textContent.slice(0, 300))
  truthy('panel still offers the button after a broken report', Boolean(findButton(panel.container, DIAGNOSE_BUTTON)), panel.container.textContent.slice(0, 300))
  await panel.unmount()

  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(500, { ok: false, error: 'exit-1' }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(findButton(panel.container, DIAGNOSE_BUTTON))
  await settle()
  const exitAlert = panel.container.querySelector('[role="alert"]')
  truthy('HTTP failure renders role="alert"', exitAlert !== null, panel.container.textContent.slice(0, 300))
  truthy('alert explains the exit-code failure in readable copy', /退出码\s*1|exit-1/.test(exitAlert?.textContent ?? ''), exitAlert?.textContent ?? '')
  truthy('alert offers a retry button', Boolean(findAnyButton(panel.container, /重试/)))
  truthy('error block lives inside the scroll container', exitAlert !== null && panel.container.querySelector('[data-dsh-cli-doctor-scroll]')?.contains(exitAlert), '')

  // Replace the POST response (a pushed route would lose to the earlier one).
  routes = routes.filter((entry) => !(entry.method === 'POST' && entry.path === '/api/cli-doctor/check'))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(500, { ok: false, error: 'some-new-code' }))
  await click(findButton(panel.container, /重试|一键诊断当前状态|重新诊断/))
  await settle()
  truthy(
    'unmapped error code is surfaced verbatim',
    (panel.container.querySelector('[role="alert"]')?.textContent ?? '').includes('some-new-code'),
    panel.container.querySelector('[role="alert"]')?.textContent ?? '',
  )
  await panel.unmount()

  /* ============ 9. fast mode labelling ================================== */
  section('9. fast-mode results are labelled')
  resetRoutes()
  route('GET', '/api/cli-doctor/health', () => jsonResponse(200, { ok: true, version: '0.3.0', busy: false }))
  route('GET', '/api/cli-doctor/snapshot', () => jsonResponse(200, { ok: true, snapshot: null, busy: false, cache: { ttlMs: TTL_MS, autoCheck: false } }))
  route('POST', '/api/cli-doctor/check', () => jsonResponse(200, {
    ok: true,
    report: GOOD_REPORT,
    checkedAt: new Date().toISOString(),
    mode: 'fast',
    elapsedMs: 9000,
    cache: 'fresh',
    shared: false,
  }))
  moduleA = loadBundleModule()
  panel = await mountPanel(moduleA)
  await settle()
  await click(findButton(panel.container, DIAGNOSE_BUTTON))
  await settle()
  truthy('fast-mode result carries a visible fast label', /快速|fast/i.test(panel.container.textContent), panel.container.textContent.slice(0, 400))
  await panel.unmount()

  /* ============ 10. unmount leaves no timers ============================ */
  section('10. unmount leaves no live interval')
  await settle()
  eq('unmount leaves no live interval', 0, liveIntervals)
} catch (error) {
  bad('panel harness threw', error && error.stack ? error.stack.split('\n').slice(0, 5).join(' | ') : String(error))
} finally {
  globalThis.setInterval = originalSetInterval
  globalThis.setTimeout = originalSetTimeout
  for (const container of containers) {
    try { container.remove() } catch { /* already removed */ }
  }
  try { dom.window.close() } catch { /* nothing to close */ }
}

process.stdout.write(`\n---- panel-behavior: pass=${pass} fail=${fail} ----\n`)
if (fail > 0) {
  for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  process.exit(1)
}
