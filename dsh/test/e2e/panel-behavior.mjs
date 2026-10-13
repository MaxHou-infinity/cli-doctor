#!/usr/bin/env node
/**
 * Independent click-through harness for the sidebar panel.
 *
 * Mounts the shipped `dsh/lib/client.js` panel in jsdom with the real React from
 * the package's devDependencies, drives the button, and feeds the panel hostile
 * payloads. This is the interactive counterpart of load-client-bundle.mjs (which
 * only proves the first paint).
 *
 * Checks, in order:
 *   1. mount fires exactly one GET /api/cli-doctor/health and no POST;
 *   2. clicking 「一键诊断当前状态」 fires POST /api/cli-doctor/check;
 *   3. a `report: null` answer and a structurally broken report do not crash the
 *      panel and leave it usable;
 *   4. an HTTP failure surfaces as `role="alert"` with a retry button;
 *   5. a full report renders all five ecosystems, the summary and the read-only
 *      footer;
 *   6. unmounting leaves no pending interval/timeout behind.
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

const nodeRequire = createRequire(path.join(PKG_ROOT, 'package.json'))

/* ------------------------------------------------------------------ jsdom --- */

const { JSDOM } = nodeRequire('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
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

/* ------------------------------------------------------------- fetch stub --- */

// `self-update-probe-9f3` is deliberately unique: the UI-1 regression check
// locates the LAST tool card by that string and asserts it lives inside the
// single scroll container.
const LAST_TOOL_NAME = 'self-update-probe-9f3'

const GOOD_REPORT = {
  generated_at: '2026-10-13T07:00:00.000Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 1234,
  skipped: ['brew services'],
  managers: {
    homebrew: { tools: [{ name: 'ripgrep', current: '14.0.0', latest: '14.1.1', outdated: true, upgrade_cmd: 'brew upgrade ripgrep', impact: { checked: true, conflicts: [], dependents: [], indirect: [] } }], deps: [] },
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

const calls = []
let nextResponse = () => jsonResponse(200, { ok: true, version: '0.2.0', busy: false })

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  calls.push({ url, method: init.method ?? 'GET' })
  return nextResponse(url, init)
}
window.fetch = globalThis.fetch

/* ------------------------------------------------------------------ load --- */

const loaded = new Map()
function bundleRequire(specifier) {
  if (!ALLOWED_REQUIRES.has(specifier)) throw new Error(`browser module table has no module "${specifier}"`)
  if (!loaded.has(specifier)) loaded.set(specifier, nodeRequire(specifier))
  return loaded.get(specifier)
}

const registrations = []
new Function('require', 'window', readFileSync(BUNDLE, 'utf8'))(bundleRequire, {
  __ModuleLoader__: { load: (registration) => registrations.push(registration) },
})
const panelExports = registrations[0].factory(bundleRequire)
const CliDoctorPanel = panelExports.CliDoctorPanel

const React = bundleRequire('react')
const { createRoot } = nodeRequire('react-dom/client')
const act = React.act ?? nodeRequire('react-dom/test-utils').act

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

/* ----------------------------------------------------------------- mount ---- */

const container = document.getElementById('root')
const root = createRoot(container)

try {
  await act(async () => { root.render(React.createElement(CliDoctorPanel)) })

  truthy('panel mounted', container.textContent.includes('CLI Doctor'), container.textContent.slice(0, 200))
  truthy('diagnosis button present', container.textContent.includes('一键诊断当前状态'), container.textContent.slice(0, 200))
  eq('mount sends exactly one request', 1, calls.length)
  eq('mount only GETs health', 'GET /api/cli-doctor/health', `${calls[0]?.method} ${calls[0]?.url}`)
  truthy('mount shows the plugin version', container.textContent.includes('0.2.0'), container.textContent.slice(0, 200))
  truthy('first paint does not auto-diagnose', !calls.some((call) => call.method === 'POST'))

  const findButton = () => [...container.querySelectorAll('button')]
    .find((element) => element.textContent.includes('一键诊断当前状态') && !element.disabled)

  /* ------------------------------------------- UI-1 scrolling contract --- */
  // The shell's centre column is `display:flex; overflow:hidden`, so the panel
  // must fill it and own exactly one scroll container. These assertions encode
  // the task-5/task-6 layout contract.

  const rootEl = container.querySelector('[data-dsh-cli-doctor]')
  const scrollEl = container.querySelector('[data-dsh-cli-doctor-scroll]')
  const scrollers = [...container.querySelectorAll('*')].filter((element) => element.style.overflowY === 'auto')

  truthy('panel root exists', rootEl !== null, 'no [data-dsh-cli-doctor] root')
  eq('exactly one overflow-y:auto element in the whole tree', 1, scrollers.length)
  truthy('the scroll container is [data-dsh-cli-doctor-scroll]', scrollers[0] === scrollEl, 'marker and scroller differ')
  truthy('scroll container is a descendant of the panel root', rootEl !== null && scrollEl !== null && rootEl.contains(scrollEl))
  truthy('scroll container is a direct child of the panel root', scrollEl?.parentElement === rootEl)

  const styleOf = (element) => (element ? element.style : {})
  const rootStyle = styleOf(rootEl)
  eq('root height is 100%', '100%', rootStyle.height)
  eq('root is a flex column', 'flex', rootStyle.display)
  eq('root flexDirection', 'column', rootStyle.flexDirection)
  eq('root minHeight is 0', '0', rootStyle.minHeight)
  eq('root minWidth is 0', '0', rootStyle.minWidth)
  eq('root boxSizing', 'border-box', rootStyle.boxSizing)
  truthy('root flex-grow is non-zero', Number.parseFloat(rootStyle.flexGrow || '0') > 0 || /^1\s/.test(rootStyle.flex || ''), rootStyle.flex || '(no flex)')
  eq('root has no maxWidth any more (UI-1 acceptance)', '', rootStyle.maxWidth)

  const headerEl = rootEl?.querySelector('header')
  truthy('header exists', headerEl !== null)
  eq('header is a direct child of the root', rootEl, headerEl?.parentElement)
  truthy('header is NOT inside the scroll container', headerEl !== null && scrollEl !== null && !scrollEl.contains(headerEl))
  eq('header is pinned with flexShrink 0', '0', styleOf(headerEl).flexShrink)
  eq('root exposes exactly header + scroll body', 2, rootEl ? rootEl.children.length : -1)

  const scrollStyle = styleOf(scrollEl)
  eq('scroll overflowY', 'auto', scrollStyle.overflowY)
  eq('scroll overflowX', 'hidden', scrollStyle.overflowX)
  eq('scroll minHeight is 0', '0', scrollStyle.minHeight)
  truthy('scroll flex-grow is non-zero', Number.parseFloat(scrollStyle.flexGrow || '0') > 0, scrollStyle.flex || '(no flex)')
  eq('scroll overscrollBehavior', 'contain', scrollStyle.overscrollBehavior)
  eq('scroll keeps room for the scrollbar', '8px', scrollStyle.paddingRight)
  truthy('first paint hint lives inside the scroll container', scrollEl !== null && scrollEl.textContent.includes('首次打开不会自动检查'))

  /* ------------------------------------------------- hostile payload #1 --- */

  nextResponse = () => jsonResponse(200, { ok: true, report: null, checkedAt: new Date().toISOString() })
  let button = findButton()
  truthy('button clickable before scenario 1', Boolean(button))
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  eq('click posts to the check route', 'POST /api/cli-doctor/check', `${calls.at(-1)?.method} ${calls.at(-1)?.url}`)
  truthy('report:null does not crash the panel', container.querySelector('div') !== null, 'container lost its tree')
  truthy('panel still offers the button after report:null', Boolean(findButton()), container.textContent.slice(0, 200))

  /* ------------------------------------------------- hostile payload #2 --- */

  nextResponse = () => jsonResponse(200, { ok: true, report: MALFORMED_REPORT, checkedAt: new Date().toISOString() })
  button = findButton()
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  truthy('structurally broken report does not crash the panel', container.querySelector('div') !== null, 'container lost its tree')
  truthy('broken report still renders the read-only footer', container.textContent.includes('未执行任何升级'), container.textContent.slice(0, 300))
  truthy('panel still offers the button after a broken report', Boolean(findButton()), container.textContent.slice(0, 200))

  /* ------------------------------------------------------ HTTP failure ---- */

  nextResponse = () => jsonResponse(500, { ok: false, error: 'exit-1' })
  button = findButton()
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const alert = container.querySelector('[role="alert"]')
  truthy('HTTP failure renders role="alert"', alert !== null, container.textContent.slice(0, 300))
  truthy('alert explains the exit-code failure in readable copy', /退出码\s*1|exit-1/.test(alert?.textContent ?? ''), alert?.textContent ?? '')
  truthy('alert offers a retry button', [...container.querySelectorAll('button')].some((element) => element.textContent.includes('重试')))
  truthy('error block lives inside the scroll container', alert !== null && scrollEl !== null && scrollEl.contains(alert))

  // An unmapped code must survive verbatim instead of being swallowed.
  nextResponse = () => jsonResponse(500, { ok: false, error: 'some-new-code' })
  button = findButton()
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  truthy('unmapped error code is surfaced verbatim', (container.querySelector('[role="alert"]')?.textContent ?? '').includes('some-new-code'), container.querySelector('[role="alert"]')?.textContent ?? '')

  /* --------------------------------------------------------- loading state -- */

  let releasePending = null
  nextResponse = () => new Promise((resolve) => {
    releasePending = () => resolve(jsonResponse(200, { ok: true, report: GOOD_REPORT, checkedAt: new Date().toISOString() }))
  })
  button = findButton()
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const busyButton = [...container.querySelectorAll('button')].find((element) => element.textContent.includes('一键诊断当前状态'))
  eq('loading disables the button', true, busyButton?.disabled === true)
  eq('loading sets aria-busy', 'true', busyButton?.getAttribute('aria-busy'))
  truthy('loading shows the waiting copy', /正在检查|已等待/.test(container.textContent), container.textContent.slice(0, 300))
  const loadingBlock = [...container.querySelectorAll('p')].find((element) => /正在检查|已等待/.test(element.textContent))
  truthy('loading block lives inside the scroll container', loadingBlock !== undefined && scrollEl !== null && scrollEl.contains(loadingBlock))
  const callsBefore = calls.length
  if (busyButton) await act(async () => { busyButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  eq('a disabled button cannot start a second diagnosis', callsBefore, calls.length)
  if (releasePending) await act(async () => { releasePending() })

  /* --------------------------------------------------------- good report --- */

  nextResponse = () => jsonResponse(200, { ok: true, report: GOOD_REPORT, checkedAt: new Date().toISOString() })
  button = findButton()
  if (button) await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const text = container.textContent
  const ORDER = ['Homebrew', 'npm 全局', 'Python / pip', 'Rust / Bun / uv', '独立更新工具']
  for (const title of ORDER) {
    truthy(`good report renders ${title}`, text.includes(title), text.slice(0, 300))
  }
  const positions = ORDER.map((title) => text.indexOf(title))
  truthy('ecosystem blocks keep the contract order', positions.every((value, index) => value >= 0 && (index === 0 || value > positions[index - 1])), positions.join(','))
  truthy('good report renders the five counters', text.includes('已发现工具') && text.includes('有可用更新') && text.includes('建议更新') && text.includes('需核验或暂缓') && text.includes('目标待核验'), text.slice(0, 300))
  truthy('good report shows generated_at/scope/elapsed_ms', text.includes('生成时间') && text.includes('范围') && text.includes('耗时'), text.slice(0, 300))
  truthy('good report lists skipped checks', text.includes('brew services'), text.slice(0, 300))
  truthy('read-only footer present after a report', text.includes('未执行任何升级'), text.slice(0, 300))
  truthy('upgrade command shown for an entry', text.includes('brew upgrade ripgrep'), text.slice(0, 300))
  truthy('entry shows the current version', text.includes('14.0.0'), text.slice(0, 300))
  truthy('entry shows the latest version', text.includes('14.1.1'), text.slice(0, 300))
  truthy('entry shows a status label', /有可用更新|建议更新|目标待核验|未检出更新/.test(text), text.slice(0, 300))
  truthy('panel root is a single inline-styled container', rootEl !== null, 'cluster root missing')

  // UI-1: every piece of report content must be reachable by scrolling, i.e. a
  // descendant of the one scroll container — including the last card.
  const deepestContaining = (needle) => {
    const matches = [...container.querySelectorAll('*')].filter((element) => element.textContent.includes(needle))
    return matches.at(-1)
  }
  for (const [label, needle] of [
    ['summary counters', '已发现工具'],
    ['report meta', '生成时间'],
    ['skipped list', 'brew services'],
    ['first ecosystem block', 'Homebrew'],
    ['read-only footer', '未执行任何升级'],
    ['last tool card', LAST_TOOL_NAME],
    ['last upgrade command', `self-update ${LAST_TOOL_NAME}`],
  ]) {
    const element = deepestContaining(needle)
    truthy(`${label} is inside the scroll container`, element !== undefined && scrollEl !== null && scrollEl.contains(element), `no element matched ${JSON.stringify(needle)}`)
  }
  const lastCard = deepestContaining(LAST_TOOL_NAME)
  const firstCard = deepestContaining('ripgrep')
  truthy('the last card really is below the first card in document order', firstCard !== undefined && lastCard !== undefined && (firstCard.compareDocumentPosition(lastCard) & window.Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
  truthy('no element keeps the removed maxWidth layout', [...container.querySelectorAll('*')].every((element) => element.style.maxWidth === ''))

  /* ------------------------------------------------------------- unmount -- */

  await act(async () => { root.unmount() })
  eq('unmount leaves no live interval', 0, liveIntervals)
  eq('unmount empties the container', '', container.textContent)
} catch (error) {
  bad('panel harness threw', error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error))
} finally {
  globalThis.setInterval = originalSetInterval
  globalThis.setTimeout = originalSetTimeout
  try { dom.window.close() } catch { /* nothing to close */ }
}

process.stdout.write(`\n---- panel-behavior: pass=${pass} fail=${fail} ----\n`)
if (fail > 0) {
  for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  process.exit(1)
}
