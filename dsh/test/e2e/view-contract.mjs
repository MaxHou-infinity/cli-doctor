#!/usr/bin/env node
/**
 * Independent contract check for the pure view layer (`dsh/src/client/view.js`).
 *
 * This file is imported directly (it has no dependencies), so it verifies the
 * status/recommendation semantics and the malformed-input tolerance of CONTRACT
 * §3.4/§4 without going through the panel or the author's tests.
 *
 * Usage: node dsh/test/e2e/view-contract.mjs
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VIEW_PATH = path.resolve(HERE, '..', '..', 'src', 'client', 'view.js')

const view = await import(pathToFileURL(VIEW_PATH).href)

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

function noThrow(label, fn) {
  try {
    const value = fn()
    ok(label, typeof value === 'object' ? 'returned an object' : String(value))
    return value
  } catch (error) {
    bad(label, `threw ${error && error.message ? error.message : String(error)}`)
    return undefined
  }
}

const TOOL = view.KIND_TOOL
const DEP = view.KIND_DEP

process.stdout.write(`---- view.js loaded from ${VIEW_PATH} ----\n`)

/* ------------------------------------------------------------- statusFor --- */

process.stdout.write('\n---- statusFor ----\n')
const statusCases = [
  ['candidate below current -> 版本线异常', { current: '2.0.0', latest: '1.9.0', outdated: true }, TOOL, '版本线异常'],
  ['explicit outdated true -> 有可用更新', { current: '1.0.0', latest: '2.0.0', outdated: true }, TOOL, '有可用更新'],
  ['dependency with any latest -> 有可用更新', { current: '1.0.0', latest: '1.0.0', outdated: null }, DEP, '有可用更新'],
  ['outdated null -> 目标待核验', { current: '1.0.0', latest: '2.0.0', outdated: null }, TOOL, '目标待核验'],
  ['missing latest -> 目标待核验', { current: '1.0.0', latest: null, outdated: false }, TOOL, '目标待核验'],
  ['outdated false with latest -> 未检出更新', { current: '1.0.0', latest: '1.0.0', outdated: false }, TOOL, '未检出更新'],
  ['empty item -> 目标待核验', {}, TOOL, '目标待核验'],
]
for (const [label, item, kind, expected] of statusCases) {
  const result = noThrow(`statusFor ${label}`, () => view.statusFor(item, kind))
  eq(`statusFor ${label}`, expected, Array.isArray(result) ? result[0] : result)
}

/* ----------------------------------------------------- recommendationFor --- */

process.stdout.write('\n---- recommendationFor ----\n')
const recCases = [
  ['candidate below current -> 暂不建议', { current: '2.0.0', latest: '1.9.0', outdated: true }, TOOL, '暂不建议'],
  ['no target version -> 无法判断', { current: '1.0.0', latest: null, outdated: null }, TOOL, '无法判断'],
  ['outdated false -> 无需更新', { current: '1.0.0', latest: '1.0.0', outdated: false }, TOOL, '无需更新'],
  ['impact unchecked -> 影响待核验', { current: '1.0.0', latest: '2.0.0', outdated: true }, TOOL, '影响待核验'],
  ['declared conflicts -> 暂不建议', { current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, conflicts: [{ name: 'x' }] } }, TOOL, '暂不建议'],
  ['clean impact -> 建议更新', { current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] } }, TOOL, '建议更新'],
]
for (const [label, item, kind, expected] of recCases) {
  const result = noThrow(`recommendationFor ${label}`, () => view.recommendationFor(item, kind))
  eq(`recommendationFor ${label}`, expected, Array.isArray(result) ? result[0] : result)
}

/* ------------------------------------------------------- groupReport/misc --- */

process.stdout.write('\n---- grouping and counters ----\n')

const goodReport = {
  generated_at: '2026-10-13T07:00:00.000Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 1234,
  skipped: ['brew services'],
  managers: {
    homebrew: {
      tools: [
        { name: 'a', current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, conflicts: [], dependents: [], indirect: [] } },
        { name: 'b', current: '1.0.0', latest: null, outdated: null },
      ],
      deps: [{ name: 'd1', current: '1.0.0', latest: '1.1.0', outdated: null }],
    },
    npm_global: { tools: [], deps: [] },
    python_pip: { tools: [{ name: 'c', current: '3.0.0', latest: '2.0.0', outdated: true }], deps: [] },
    rust_bun_uv: { tools: [], deps: [] },
    self_updating: { tools: [], deps: [] },
  },
}

const blocks = noThrow('groupReport(goodReport)', () => view.groupReport(goodReport)) ?? []
eq('groupReport keeps contract order and skips empty managers', 'homebrew,python_pip', blocks.map((block) => block.key).join(','))
eq('groupReport keeps both layers', true, Array.isArray(blocks[0]?.tools) && Array.isArray(blocks[0]?.deps))

const summary = noThrow('summarize(goodReport)', () => view.summarize(goodReport)) ?? {}
eq('toolCount counts tools only', 3, summary.toolCount)
eq('unknownCount counts 目标待核验/版本线异常 tools', 2, summary.unknownCount)
eq('recommendedCount counts 建议更新 tools', 1, summary.recommendedCount)
eq('reviewCount counts 需核验或暂缓 tools', 1, summary.reviewCount)
eq('skippedChecks drops non-strings', 1, view.skippedChecks({ skipped: ['a', 42, null, ''] }).length)

/* --------------------------------------------------- malformed tolerance --- */

process.stdout.write('\n---- malformed reports must never throw ----\n')
const malformed = [
  ['null', null],
  ['undefined', undefined],
  ['empty object', {}],
  ['managers null', { managers: null }],
  ['managers array', { managers: [] }],
  ['manager tools null / deps string', { managers: { homebrew: { tools: null, deps: 'nope' } } }],
  ['tool entries are primitives', { managers: { homebrew: { tools: [null, 1, 'x', []], deps: [{}] } } }],
  ['impact is a string', { managers: { npm_global: { tools: [{ name: 'x', current: '1.0.0', latest: '2.0.0', outdated: true, impact: 'broken' }], deps: [] } } }],
  ['impact arrays hold primitives', { managers: { python_pip: { tools: [{ name: 7, current: {}, latest: [], outdated: 'yes', impact: { checked: true, dependents: [1, null], conflicts: ['x'], uncertain: [{}], indirect: [2] } }], deps: [] } } }],
  ['skipped is an object', { skipped: { a: 1 } }],
  ['weird versions', { managers: { rust_bun_uv: { tools: [{ name: 'v', current: 'v1.2.3-beta', latest: 'not-a-version', outdated: true }], deps: [] } } }],
]

for (const [label, report] of malformed) {
  const result = noThrow(`summarize tolerates ${label}`, () => view.summarize(report))
  if (result !== undefined) {
    const numeric = ['toolCount', 'updateCount', 'recommendedCount', 'reviewCount', 'unknownCount']
      .every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]))
    eq(`counters are finite numbers for ${label}`, true, numeric)
  }
  noThrow(`groupReport tolerates ${label}`, () => view.groupReport(report))
}

/* ------------------------------------------------------- display helpers --- */

process.stdout.write('\n---- display helpers stay readable ----\n')
for (const value of [null, undefined, '', 'garbage', 42, {}, '2026-10-13T07:00:00.000Z']) {
  const text = noThrow(`formatTimestamp(${JSON.stringify(value)})`, () => view.formatTimestamp(value))
  eq(`formatTimestamp(${JSON.stringify(value)}) is a non-empty string`, true, typeof text === 'string' && text.length > 0)
}
for (const value of [null, undefined, '', -1, 'x', 0, 999, 61000]) {
  const text = noThrow(`formatDuration(${JSON.stringify(value)})`, () => view.formatDuration(value))
  eq(`formatDuration(${JSON.stringify(value)}) is a non-empty string`, true, typeof text === 'string' && text.length > 0)
}
for (const value of [null, {}, { scope: 7 }, { scope: 'x' }]) {
  const text = noThrow(`formatScope(${JSON.stringify(value)})`, () => view.formatScope(value))
  eq(`formatScope(${JSON.stringify(value)}) is a non-empty string`, true, typeof text === 'string' && text.length > 0)
}

/* -------------------------------------------------------------- summary --- */

process.stdout.write(`\n---- view-contract: pass=${pass} fail=${fail} ----\n`)
if (fail > 0) {
  for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  process.exit(1)
}
