#!/usr/bin/env node
/**
 * Independent loader harness for `dsh/lib/client.js`.
 *
 * Executes the shipped bundle exactly the way the DSH Web GUI does — through a
 * fake `window.__ModuleLoader__` — and then checks the two seats, their
 * disposers and the panel's first paint. It deliberately shares no code with
 * the author's `test/client.test.mjs`:
 *
 *   - no jsdom: the bundle registers components, it does not touch the DOM
 *     until render time, and the first paint is produced by `react-dom/server`;
 *   - the `require` passed to the factory is an allowlist: anything other than
 *     `react` / `react/jsx-runtime` throws, which is what proves the bundle only
 *     needs the two modules the contract names;
 *   - the panel component is rendered with the real React from the package's
 *     devDependencies, so hooks and JSX actually run.
 *
 * Usage:
 *   node dsh/test/e2e/load-client-bundle.mjs [bundle-path]
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..', '..')
const BUNDLE = process.argv[2] ?? path.join(PKG_ROOT, 'lib', 'client.js')

/** The only modules the browser module table gives this plugin (CONTRACT §3.2). */
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

function section(title) {
  process.stdout.write(`\n---- ${title} ----\n`)
}

/* ------------------------------------------------------------------ load --- */

const nodeRequire = createRequire(path.join(PKG_ROOT, 'package.json'))

const loadedModules = new Map()
function bundleRequire(specifier) {
  if (!ALLOWED_REQUIRES.has(specifier)) {
    throw new Error(`the browser module table has no module "${specifier}"`)
  }
  if (!loadedModules.has(specifier)) loadedModules.set(specifier, nodeRequire(specifier))
  return loadedModules.get(specifier)
}

const source = readFileSync(BUNDLE, 'utf8')

section('purity: static require() literals in the shipped bundle')
const literalRequires = [...source.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map((match) => match[2])
const uniqueRequires = [...new Set(literalRequires)]
const forbidden = uniqueRequires.filter((id) => !ALLOWED_REQUIRES.has(id))
process.stdout.write(`  require() targets: ${uniqueRequires.map((id) => JSON.stringify(id)).join(', ') || '(none)'}\n`)
if (forbidden.length === 0) ok('every require() literal is inside the browser module table')
else bad('forbidden require() literal(s)', forbidden.join(', '))
if (/\bimport\s*\(/.test(source)) bad('bundle contains a dynamic import()')
else ok('bundle contains no dynamic import()')
if (source.includes('@deepseek-ai')) bad('bundle mentions a @deepseek-ai runtime module')
else ok('bundle never mentions @deepseek-ai')

section('loader shell')
const registrations = []
const fakeWindow = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
// eslint-disable-next-line no-new-func -- the bundle is data under test
new Function('require', 'window', source)(bundleRequire, fakeWindow)

eq('exactly one registration', 1, registrations.length)
const registration = registrations[0]
if (!registration) {
  process.stdout.write('\nfatal: the bundle registered nothing\n')
  process.exit(1)
}
eq('registration id is the package name', 'dsh-cli-doctor', registration.id)
eq('registration carries a factory', 'function', typeof registration.factory)

const moduleExports = registration.factory(bundleRequire)
eq('inject is ["slots"]', 'slots', Array.isArray(moduleExports.inject) ? moduleExports.inject.join(',') : String(moduleExports.inject))
eq('apply is a function', 'function', typeof moduleExports.apply)

/* ------------------------------------------------------------ slot seats --- */

section('slot registrations (CONTRACT §3.3)')
const registrationsSeen = []
const slotDisposers = []
let effectRan = 0

const ctx = {
  slots: {
    inject(seat, callback) {
      registrationsSeen.push({ kind: 'inject', seat })
      const inner = callback()
      slotDisposers.push(inner)
      return () => { registrationsSeen.push({ kind: 'inject-disposed', seat }) }
    },
    register(options, component) {
      registrationsSeen.push({ kind: 'register', options, component })
      return () => { registrationsSeen.push({ kind: 'register-disposed', options }) }
    },
  },
  effect(callback) {
    effectRan += 1
    callback()
  },
}

const returnedDisposer = moduleExports.apply(ctx)
eq('apply returns a disposer', 'function', typeof returnedDisposer)

const injects = registrationsSeen.filter((entry) => entry.kind === 'inject').map((entry) => entry.seat)
eq('injected seats', 'sidebar.panellist,main', injects.join(','))

const sidebar = registrationsSeen.find(
  (entry) => entry.kind === 'register' && entry.options && entry.options.name === 'sidebar.panellist',
)
const main = registrationsSeen.find(
  (entry) => entry.kind === 'register' && entry.options && entry.options.name === 'main',
)

if (!sidebar) bad('sidebar.panellist registration missing')
else {
  eq('sidebar row id', 'cli-doctor', sidebar.options.id)
  eq('sidebar row order', 30, sidebar.options.order)
  eq('sidebar row label', 'CLI Doctor', sidebar.options.label)
  eq('sidebar component is CliDoctorIcon', true, sidebar.component === moduleExports.CliDoctorIcon)
}

if (!main) bad('main registration missing')
else {
  eq('main slot key', 'cli-doctor', main.options.key)
  eq('main component is CliDoctorPanel', true, main.component === moduleExports.CliDoctorPanel)
}

eq('registers bound to ctx.effect', 1, effectRan)

section('disposal')
// Shipped DSH client plugins (e.g. dsh-client-ui-attachment, dsh-client-locale)
// call `ctx.slots.inject(seat, () => ctx.slots.register(...))` and rely on the
// inject handle alone: in cordis that callback runs in a child scope whose
// disposal releases what it registered. The harness therefore checks the two
// inject handles, not a retained `register` disposer.
returnedDisposer()
const disposedInjects = registrationsSeen.filter((entry) => entry.kind === 'inject-disposed').length
eq('both inject handles disposed', 2, disposedInjects)
let secondDisposeThrew = false
try { returnedDisposer() } catch { secondDisposeThrew = true }
eq('disposal is idempotent', false, secondDisposeThrew)

/* ----------------------------------------------------------- first paint --- */

section('panel first paint (real React, react-dom/server)')
try {
  const React = bundleRequire('react')
  const { renderToStaticMarkup } = nodeRequire('react-dom/server')
  const html = renderToStaticMarkup(React.createElement(moduleExports.CliDoctorPanel))
  eq('panel renders markup', true, html.length > 0)
  const hasButton = html.includes('一键诊断当前状态')
  if (hasButton) ok('panel shows the "一键诊断当前状态" button')
  else bad('panel does not show the diagnosis button', html.slice(0, 400))
  if (/<button[^>]*type="button"/.test(html)) ok('button carries type="button"')
  else bad('no <button type="button"> in the first paint', html.slice(0, 400))
  if (html.includes('首次打开不会自动检查')) ok('first paint states that no automatic diagnosis runs')
  else bad('first paint does not state that no automatic diagnosis runs', html.slice(0, 400))
  // The footer text is rendered together with a report, so the static bundle
  // check below is the right evidence for it; the click-through harness
  // (panel-behavior.mjs) proves it appears once a report is on screen.
  if (source.includes('未执行任何升级')) ok('bundle carries the read-only footer copy')
  else bad('bundle does not carry the read-only footer copy')
  if (html.includes('CLI Doctor')) ok('panel shows the CLI Doctor title')
  else bad('panel does not show the CLI Doctor title', html.slice(0, 400))
} catch (error) {
  bad('panel render threw', error && error.message ? error.message : String(error))
}

/* ------------------------------------------------------------ icon props --- */

section('icon component')
try {
  const React = bundleRequire('react')
  const { renderToStaticMarkup } = nodeRequire('react-dom/server')
  const html = renderToStaticMarkup(React.createElement(moduleExports.CliDoctorIcon, { size: 20, active: true }))
  eq('icon renders with {size, active}', true, html.length > 0)
} catch (error) {
  bad('icon render threw', error && error.message ? error.message : String(error))
}

process.stdout.write(`\n---- load-client-bundle: pass=${pass} fail=${fail} ----\n`)
if (fail > 0) {
  for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  process.exit(1)
}
