#!/usr/bin/env node
/**
 * Real-browser layout probe for the CLI Doctor panel (UI-1 closure).
 *
 * jsdom cannot compute layout, so this harness drives the actual DSH Web GUI in
 * headless Chrome over the DevTools protocol and measures the panel the way a
 * user's browser does:
 *
 *   1. open the authenticated Web GUI URL (the `?token=` handoff sets the cookie);
 *   2. wait for the shell to boot and click the "CLI Doctor" sidebar row;
 *   3. assert the panel landed in a flex-column parent with a resolved height,
 *      that exactly one scroll container exists, and that the header is pinned;
 *   4. click 「一键诊断当前状态」 and let the REAL Host diagnosis finish;
 *   5. assert the report is actually scrollable (scrollHeight > clientHeight),
 *      that scrolling to the bottom works (scrollTop advances) while the header
 *      stays in place, and that the read-only footer is reachable at the bottom.
 *
 * Usage: node dsh/test/e2e/browser-layout-probe.mjs "<http://127.0.0.1:PORT/?token=...>"
 *        node dsh/test/e2e/browser-layout-probe.mjs --url "<url>" [--keep-chrome]
 *
 * Chrome is launched with a throwaway --user-data-dir under /tmp; the user's own
 * browser profile is never touched.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

let url = null
let keepChrome = false
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--url') url = argv[++i]
  else if (argv[i] === '--keep-chrome') keepChrome = true
  else if (url === null && /^https?:/.test(argv[i])) url = argv[i]
}

let pass = 0
let fail = 0
const failures = []
const metrics = {}

function ok(label, detail = '') {
  pass += 1
  process.stdout.write(`PASS: ${label}${detail ? ` (${detail})` : ''}\n`)
}

function bad(label, detail = '') {
  fail += 1
  failures.push(`${label}${detail ? `: ${detail}` : ''}`)
  process.stdout.write(`FAIL: ${label}${detail ? `: ${detail}` : ''}\n`)
}

function truthy(label, value, detail = '') {
  if (value) ok(label, String(detail))
  else bad(label, String(detail))
}

if (!url) {
  process.stdout.write('usage: browser-layout-probe.mjs "<authenticated web url>"\n')
  process.exit(2)
}
if (!existsSync(CHROME)) {
  process.stdout.write(`SKIP: no Chrome at ${CHROME}\n`)
  process.exit(3)
}

/* ------------------------------------------------------------------ chrome --- */

const profileDir = mkdtempSync(path.join(tmpdir(), 'dsh-cli-doctor-chrome-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--window-size=1440,900',
  '--hide-scrollbars=false',
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let chromeStderr = ''
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk })

function stopChrome() {
  try { chrome.kill('SIGKILL') } catch { /* already gone */ }
  if (!keepChrome) rmSync(profileDir, { recursive: true, force: true })
}

async function devtoolsPort() {
  const portFile = path.join(profileDir, 'DevToolsActivePort')
  for (let i = 0; i < 60; i += 1) {
    if (existsSync(portFile)) return readFileSync(portFile, 'utf8').split('\n')[0].trim()
    if (chrome.exitCode !== null) throw new Error(`chrome exited early (${chrome.exitCode}): ${chromeStderr.slice(0, 400)}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`chrome never wrote DevToolsActivePort: ${chromeStderr.slice(0, 400)}`)
}

let socket = null
let nextId = 1
const pending = new Map()

function send(method, params = {}) {
  const id = nextId++
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }
    }, 180000)
  })
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) {
    throw new Error(`evaluate failed: ${response.exceptionDetails.text} ${response.exceptionDetails.exception?.description ?? ''}`)
  }
  return response.result?.value
}

async function waitFor(expression, { timeoutMs = 60000, intervalMs = 500, label = expression } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression)
      if (last) return last
    } catch (error) {
      last = `error: ${error.message}`
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`timed out waiting for ${label} (last=${JSON.stringify(last)})`)
}

/* ---------------------------------------------------------------- measure --- */

const MEASURE = `(() => {
  const root = document.querySelector('[data-dsh-cli-doctor]');
  const body = document.querySelector('[data-dsh-cli-doctor-scroll]');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  // The panel's own subtree must expose exactly one scroller; the shell around it
  // has its own (sidebar list, conversation column), which are not our business.
  const panelScrollers = root ? [...root.querySelectorAll('*')].filter((el) => cs(el).overflowY === 'auto') : [];
  const documentScrollers = [...document.querySelectorAll('*')]
    .filter((el) => cs(el).overflowY === 'auto')
    .map((el) => el.tagName + (el.className ? '.' + String(el.className).slice(0, 40) : ''));
  // Slot hosts can be layout-transparent (display:contents); the element that
  // actually lays the panel out is the nearest ancestor that generates a box.
  let effectiveParent = root ? root.parentElement : null;
  const chain = [];
  while (effectiveParent) {
    chain.push({ tag: effectiveParent.tagName, cls: String(effectiveParent.className).slice(0, 40), display: cs(effectiveParent).display });
    if (cs(effectiveParent).display !== 'contents') break;
    effectiveParent = effectiveParent.parentElement;
  }
  const header = root ? root.querySelector('header') : null;
  return {
    hasRoot: Boolean(root),
    hasBody: Boolean(body),
    panelScrollerCount: panelScrollers.length,
    panelScrollerIsBody: panelScrollers.length === 1 && panelScrollers[0] === body,
    documentScrollerCount: documentScrollers.length,
    documentScrollers,
    parentChain: chain,
    directParentDisplay: root && root.parentElement ? cs(root.parentElement).display : null,
    parentTag: effectiveParent ? effectiveParent.tagName : null,
    parentClass: effectiveParent ? String(effectiveParent.className) : null,
    parentDisplay: effectiveParent ? cs(effectiveParent).display : null,
    parentFlexDir: effectiveParent ? cs(effectiveParent).flexDirection : null,
    parentClientH: effectiveParent ? effectiveParent.clientHeight : null,
    parentOverflow: effectiveParent ? cs(effectiveParent).overflow : null,
    rootClientH: root ? root.clientHeight : null,
    rootScrollH: root ? root.scrollHeight : null,
    rootComputedH: root ? cs(root).height : null,
    rootComputedFlex: root ? cs(root).flex : null,
    bodyClientH: body ? body.clientHeight : null,
    bodyScrollH: body ? body.scrollHeight : null,
    bodyOverflowY: body ? cs(body).overflowY : null,
    headerShrink: header ? cs(header).flexShrink : null,
    headerInsideBody: Boolean(header && body && body.contains(header)),
    headerTop: header ? Math.round(header.getBoundingClientRect().top) : null,
    hasReport: Boolean(body && /生成时间/.test(body.textContent || '')),
    hasFooter: Boolean(body && /未执行任何升级/.test(body.textContent || '')),
    textLength: body ? (body.textContent || '').length : 0,
  };
})()`

/* ------------------------------------------------------------------- main --- */

try {
  const port = await devtoolsPort()
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('no page target in Chrome')

  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(`${message.error.message}`))
    else entry.resolve(message.result)
  }

  await send('Page.enable')
  await send('Runtime.enable')

  process.stdout.write(`navigating: ${url.replace(/token=[^&]+/, 'token=***')}\n`)
  await send('Page.navigate', { url })

  const shellReady = await waitFor(
    `Boolean(document.querySelector('[data-dsh-panel-entry="cli-doctor"]'))`,
    { timeoutMs: 120000, label: 'cli-doctor sidebar entry' },
  )
  truthy('real DSH shell boots and renders the CLI Doctor sidebar entry', shellReady !== false)

  // Click the shell-owned row that wraps our icon.
  await evaluate(`(() => {
    const icon = document.querySelector('[data-dsh-panel-entry="cli-doctor"]');
    const clickable = icon.closest('button, [role="button"], a, li') || icon.parentElement;
    clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    clickable.click();
    return true;
  })()`)

  await waitFor(`Boolean(document.querySelector('[data-dsh-cli-doctor]'))`, { timeoutMs: 60000, label: 'panel mount' })
  const before = await evaluate(MEASURE)
  metrics.beforeDiagnosis = before
  process.stdout.write(`measured (empty panel): ${JSON.stringify(before)}\n`)

  truthy('panel root mounted in a real browser', before.hasRoot)
  truthy('exactly one scroll container inside the panel subtree', before.panelScrollerCount === 1 && before.panelScrollerIsBody, JSON.stringify({ count: before.panelScrollerCount, documentCount: before.documentScrollerCount, documentScrollers: before.documentScrollers }))
  truthy('the slot host above the panel is layout-transparent (display:contents)', before.directParentDisplay === 'contents', `directParentDisplay=${before.directParentDisplay}`)
  truthy('the box-generating parent is a flex column (shell centre column)', before.parentDisplay === 'flex' && before.parentFlexDir === 'column', `${before.parentDisplay}/${before.parentFlexDir} chain=${JSON.stringify(before.parentChain)}`)
  truthy('the box-generating parent has a resolved height', Number(before.parentClientH) > 0, `parentClientH=${before.parentClientH} class=${before.parentClass}`)
  truthy('panel root has a resolved height (non-zero)', Number(before.rootClientH) > 0, `rootClientH=${before.rootClientH} computed=${before.rootComputedH} flex=${before.rootComputedFlex}`)
  truthy('scroll container has a resolved height (non-zero)', Number(before.bodyClientH) > 0, `bodyClientH=${before.bodyClientH}`)
  truthy('header is pinned by flex-shrink 0 and is outside the scroll container', before.headerShrink === '0' && before.headerInsideBody === false, `shrink=${before.headerShrink} inside=${before.headerInsideBody}`)

  // Run the real diagnosis through the real UI.
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('[data-dsh-cli-doctor] button')].find((el) => el.textContent.includes('一键诊断当前状态'));
    if (!button) throw new Error('diagnosis button not found');
    button.click();
    return true;
  })()`)
  process.stdout.write('clicked 「一键诊断当前状态」; waiting for the real report (up to 6 minutes)…\n')

  await waitFor(
    `(() => { const b = document.querySelector('[data-dsh-cli-doctor-scroll]'); return Boolean(b && /生成时间/.test(b.textContent || '')) })()`,
    { timeoutMs: 360000, intervalMs: 2000, label: 'real report rendered in the panel' },
  )

  const after = await evaluate(MEASURE)
  metrics.afterDiagnosis = after
  process.stdout.write(`measured (after report): ${JSON.stringify(after)}\n`)

  truthy('real report rendered inside the panel', after.hasReport)
  truthy('report content is long enough to need scrolling', after.bodyScrollH > after.bodyClientH, `scrollH=${after.bodyScrollH} clientH=${after.bodyClientH}`)
  truthy('read-only footer reachable in the scroll container', after.hasFooter)

  const scrolled = await evaluate(`(() => {
    const b = document.querySelector('[data-dsh-cli-doctor-scroll]');
    const header = document.querySelector('[data-dsh-cli-doctor] header');
    const headerTopBefore = Math.round(header.getBoundingClientRect().top);
    b.scrollTop = b.scrollHeight;
    const headerTopAfter = Math.round(header.getBoundingClientRect().top);
    return {
      scrollTop: Math.round(b.scrollTop),
      maxScroll: Math.round(b.scrollHeight - b.clientHeight),
      headerTopBefore,
      headerTopAfter,
      footerVisible: (() => {
        const footer = [...b.querySelectorAll('p')].find((el) => el.textContent.includes('未执行任何升级'));
        if (!footer) return null;
        const r = footer.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return r.bottom <= br.bottom + 2 && r.top >= br.top - 2;
      })(),
    };
  })()`)
  metrics.scroll = scrolled
  process.stdout.write(`scroll probe: ${JSON.stringify(scrolled)}\n`)

  truthy('scrolling actually moves the content', scrolled.scrollTop > 0, `scrollTop=${scrolled.scrollTop} max=${scrolled.maxScroll}`)
  truthy('scrolled to the very bottom', Math.abs(scrolled.scrollTop - scrolled.maxScroll) <= 2, `${scrolled.scrollTop}/${scrolled.maxScroll}`)
  truthy('pinned header does not move while scrolling', scrolled.headerTopBefore === scrolled.headerTopAfter, `${scrolled.headerTopBefore} -> ${scrolled.headerTopAfter}`)
  truthy('last block (read-only footer) is visible after scrolling to the bottom', scrolled.footerVisible === true)

  process.stdout.write(`\n---- browser-layout-probe: pass=${pass} fail=${fail} ----\n`)
  process.stdout.write(`metrics: ${JSON.stringify(metrics)}\n`)
  if (fail > 0) {
    for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  }
} catch (error) {
  bad('probe threw', error && error.message ? error.message : String(error))
  process.stdout.write(`chrome stderr (tail): ${chromeStderr.slice(-500)}\n`)
} finally {
  if (socket) { try { socket.close() } catch { /* already closed */ } }
  stopChrome()
}

process.exit(fail > 0 ? 1 : 0)
