#!/usr/bin/env node
/**
 * Independent contract check for the pure view layer (`dsh/src/client/view.js`).
 *
 * This file is imported directly (it has no dependencies), so it verifies the
 * status/recommendation semantics and the malformed-input tolerance of CONTRACT
 * §3.4/§4 **and the v2 dependency semantics of CONTRACT §v2.3** without going
 * through the panel or the author's tests:
 *
 *   - tool-layer status/recommendation semantics are unchanged from v1;
 *   - a dependency whose `outdated` field was never reported is
 *     「候选更新 · 待核验」, never 「有可用更新」, and its recommendation is
 *     「依赖更新需人工核验」 — the v1 「有可用更新」+「无法判断」pair must be gone;
 *   - `summarize()` keeps the five tool-layer counters and adds the v2
 *     dependency counters (`depCount`, `conflictCount`, `uncertainCount`).
 *
 * Usage: node dsh/test/e2e/view-contract.mjs
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VIEW_PATH = path.resolve(HERE, '..', '..', 'src', 'client', 'view.js')

const view = await import(pathToFileURL(VIEW_PATH).href)
const reportModule = await import(pathToFileURL(path.resolve(HERE, '..', '..', 'src', 'client', 'report.js')).href)
const clipboardModule = await import(pathToFileURL(path.resolve(HERE, '..', '..', 'src', 'client', 'clipboard.js')).href)
const { buildMarkdownReport, buildJsonReport } = reportModule
const { copyText, COPY_FEEDBACK_MS, CLIPBOARD_UNAVAILABLE_TEXT, CLIPBOARD_FAILED_TEXT } = clipboardModule

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

function truthy(label, value, detail = '') {
  if (value) ok(label, detail)
  else bad(label, detail)
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

/** statusFor/recommendationFor return `[label, tone, ...]`; tolerate a bare label too. */
function labelOf(result) {
  return Array.isArray(result) ? result[0] : result
}

function toneOf(result) {
  return Array.isArray(result) ? result[1] : undefined
}

const TOOL = view.KIND_TOOL
const DEP = view.KIND_DEP

process.stdout.write(`---- view.js loaded from ${VIEW_PATH} ----\n`)

/* ------------------------------------------------------------- statusFor --- */

process.stdout.write('\n---- statusFor ----\n')
const statusCases = [
  ['candidate below current -> 版本线异常', { current: '2.0.0', latest: '1.9.0', outdated: true }, TOOL, '版本线异常'],
  ['explicit outdated true -> 有可用更新', { current: '1.0.0', latest: '2.0.0', outdated: true }, TOOL, '有可用更新'],
  ['outdated null -> 目标待核验', { current: '1.0.0', latest: '2.0.0', outdated: null }, TOOL, '目标待核验'],
  ['missing latest -> 目标待核验', { current: '1.0.0', latest: null, outdated: false }, TOOL, '目标待核验'],
  ['outdated false with latest -> 未检出更新', { current: '1.0.0', latest: '1.0.0', outdated: false }, TOOL, '未检出更新'],
  ['empty item -> 目标待核验', {}, TOOL, '目标待核验'],
  // v2 dependency semantics (CONTRACT §v2.3): "any latest" alone no longer
  // promotes a dependency to 有可用更新.
  ['dependency without outdated -> 候选更新 · 待核验', { current: '1.0.0', latest: '1.1.0', outdated: null }, DEP, '候选更新 · 待核验'],
  ['dependency with latest but no outdated field -> 候选更新 · 待核验', { current: '1.0.0', latest: '1.1.0' }, DEP, '候选更新 · 待核验'],
  ['dependency with outdated true -> 有可用更新', { current: '1.0.0', latest: '1.1.0', outdated: true }, DEP, '有可用更新'],
  ['dependency with no target -> 目标待核验', { current: '1.0.0', latest: null, outdated: null }, DEP, '目标待核验'],
]
for (const [label, item, kind, expected] of statusCases) {
  const result = noThrow(`statusFor ${label}`, () => view.statusFor(item, kind))
  eq(`statusFor ${label}`, expected, labelOf(result))
}

eq('dependency 候选更新 carries the review tone', 'review', toneOf(view.statusFor(statusCases[6][1], DEP)))
eq('dependency 有可用更新 keeps the update tone', 'update', toneOf(view.statusFor(statusCases[8][1], DEP)))

/* ----------------------------------------------------- recommendationFor --- */

process.stdout.write('\n---- recommendationFor ----\n')
const recCases = [
  ['candidate below current -> 暂不建议', { current: '2.0.0', latest: '1.9.0', outdated: true }, TOOL, '暂不建议'],
  ['no target version -> 无法判断', { current: '1.0.0', latest: null, outdated: null }, TOOL, '无法判断'],
  ['outdated false -> 无需更新', { current: '1.0.0', latest: '1.0.0', outdated: false }, TOOL, '无需更新'],
  ['impact unchecked -> 影响待核验', { current: '1.0.0', latest: '2.0.0', outdated: true }, TOOL, '影响待核验'],
  ['declared conflicts -> 暂不建议', { current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, conflicts: [{ name: 'x' }] } }, TOOL, '暂不建议'],
  ['clean impact -> 建议更新', { current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] } }, TOOL, '建议更新'],
  // v2: a dependency without an outdated verdict never says 无法判断. Impact
  // state keeps its precedence (unchecked impact is stronger advice), and the
  // plain manual-review label is the clean-impact fallback.
  ['dependency without outdated + unchecked impact -> 影响待核验', { current: '1.0.0', latest: '1.1.0', outdated: null }, DEP, '影响待核验'],
  ['dependency without outdated + clean checked impact -> 依赖更新需人工核验', { current: '1.0.0', latest: '1.1.0', outdated: null, impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] } }, DEP, '依赖更新需人工核验'],
  ['dependency no target -> 无法判断', { current: '1.0.0', latest: null, outdated: null }, DEP, '无法判断'],
]
for (const [label, item, kind, expected] of recCases) {
  const result = noThrow(`recommendationFor ${label}`, () => view.recommendationFor(item, kind))
  eq(`recommendationFor ${label}`, expected, labelOf(result))
}

eq('dependency manual review carries the review tone', 'review', toneOf(view.recommendationFor(recCases[7][1], DEP)))

/* ----------------------------------------------- dependency consistency ---- */

process.stdout.write('\n---- dependency semantics must never contradict themselves ----\n')
const depItems = [
  { name: 'dep-null-outdated', current: '1.0.0', latest: '1.1.0', outdated: null },
  { name: 'dep-missing-outdated', current: '1.0.0', latest: '1.1.0' },
  { name: 'dep-true', current: '1.0.0', latest: '1.1.0', outdated: true },
  { name: 'dep-false', current: '1.0.0', latest: '1.0.0', outdated: false },
  { name: 'dep-no-latest', current: '1.0.0', latest: null, outdated: null },
  { name: 'dep-below-current', current: '2.0.0', latest: '1.0.0', outdated: true },
  { name: 'dep-clean-impact', current: '1.0.0', latest: '1.1.0', outdated: null, impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] } },
]
for (const item of depItems) {
  const status = view.statusFor(item, DEP)
  const recommendation = view.recommendationFor(item, DEP)
  const statusLabel = labelOf(status)
  const recLabel = labelOf(recommendation)
  if (statusLabel === '有可用更新' && recLabel === '无法判断') {
    bad(`v1 contradiction gone for ${item.name}`, 'still renders 有可用更新 + 无法判断')
  } else {
    ok(`v1 contradiction gone for ${item.name}`, `${statusLabel} / ${recLabel}`)
  }
  if (item.outdated == null && item.latest) {
    if (String(statusLabel).includes('候选更新')) ok(`${item.name} is labelled 候选更新`)
    else bad(`${item.name} is not labelled 候选更新: ${statusLabel}`)
    eq(`${item.name} never says 无法判断`, false, recLabel === '无法判断')
    eq(`${item.name} never promises a safe update`, false, recLabel === '建议更新')
  }
  if (item.name === 'dep-clean-impact') {
    eq('clean-impact dependency advice', '依赖更新需人工核验', recLabel)
  }
  if (item.outdated === true && !view.candidateBelowCurrent(item)) eq(`${item.name} keeps 有可用更新`, '有可用更新', statusLabel)
  if (item.outdated === true && view.candidateBelowCurrent(item)) eq(`${item.name} stays a version-line anomaly`, '版本线异常', statusLabel)
  if (item.latest && item.latest !== null && item.outdated !== true && item.outdated != null) {
    eq(`${item.name} no longer claims 有可用更新 without a verdict`, false, statusLabel === '有可用更新')
  }
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
      deps: [
        {
          name: 'd1',
          current: '1.0.0',
          latest: '1.1.0',
          outdated: null,
          impact: { checked: true, dependents: [], indirect: [], conflicts: [{ name: 'a', requirement: '<2' }], uncertain: [] },
        },
        {
          name: 'd2',
          current: '1.0.0',
          latest: '1.1.0',
          outdated: null,
          impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [{ name: 'a' }] },
        },
      ],
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
const summaryDetail = JSON.stringify(summary).slice(0, 400)
eq('toolCount counts tools only', 3, summary.toolCount)
eq('unknownCount counts 目标待核验/版本线异常 tools', 2, summary.unknownCount)
eq('recommendedCount counts 建议更新 tools', 1, summary.recommendedCount)
eq('reviewCount counts 需核验或暂缓 tools', 1, summary.reviewCount)
// v2 counters (CONTRACT §v2.2/§v2.3): dependency layer is counted separately and
// never changes the five tool-layer counters above.
eq('depCount counts the dependency layer', 2, summary.depCount)
eq('conflictCount counts dependency conflicts', 1, summary.conflictCount)
eq('uncertainCount counts dependency uncertain entries', 1, summary.uncertainCount)
for (const key of ['toolCount', 'updateCount', 'recommendedCount', 'reviewCount', 'unknownCount', 'depCount', 'conflictCount', 'uncertainCount']) {
  eq(`summary.${key} is a finite number`, true, typeof summary[key] === 'number' && Number.isFinite(summary[key]))
}
if (Array.isArray(view.SUMMARY_FIELDS)) {
  eq('SUMMARY_FIELDS still lists the five tool counters in order',
    'toolCount,updateCount,recommendedCount,reviewCount,unknownCount',
    view.SUMMARY_FIELDS.map((entry) => (Array.isArray(entry) ? entry[0] : entry)).join(','))
} else {
  bad('SUMMARY_FIELDS missing', 'view.SUMMARY_FIELDS is not an array')
}
eq('DEP_RISK_FIELDS lists the two dependency cells',
  'conflictCount,uncertainCount',
  (view.DEP_RISK_FIELDS || []).map((entry) => entry[0]).join(','))
eq('skippedChecks drops non-strings', 1, view.skippedChecks({ skipped: ['a', 42, null, ''] }).length)
process.stdout.write(`  summarize() detail: ${summaryDetail}…\n`)

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
  ['dependency entries are primitives', { managers: { homebrew: { tools: [], deps: [null, 3, 'dep', []] } } }],
  ['dependency impact arrays hold primitives', { managers: { homebrew: { tools: [], deps: [{ name: 'd', current: '1', latest: '2', outdated: null, impact: { checked: true, conflicts: [null, 1], uncertain: ['x', {}] } }] } } }],
  ['skipped is an object', { skipped: { a: 1 } }],
  ['weird versions', { managers: { rust_bun_uv: { tools: [{ name: 'v', current: 'v1.2.3-beta', latest: 'not-a-version', outdated: true }], deps: [] } } }],
]

for (const [label, report] of malformed) {
  const result = noThrow(`summarize tolerates ${label}`, () => view.summarize(report))
  if (result !== undefined) {
    const numeric = ['toolCount', 'updateCount', 'recommendedCount', 'reviewCount', 'unknownCount', 'depCount', 'conflictCount', 'uncertainCount']
      .every((key) => typeof result[key] === 'number' && Number.isFinite(result[key]))
    eq(`counters are finite numbers for ${label}`, true, numeric)
  }
  noThrow(`groupReport tolerates ${label}`, () => view.groupReport(report))
  noThrow(`dependency status tolerates ${label}`, () => view.statusFor(report?.managers?.homebrew?.deps?.[0], DEP))
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
/* ----------------------------------- v2 freshness helpers (CONTRACT §v2.3) --- */

process.stdout.write('\n---- v2 freshness / mode helpers ----\n')
eq('dependency status label constant', '候选更新 · 待核验', view.DEP_CANDIDATE_LABEL)
eq('dependency review label constant', '依赖更新需人工核验', view.DEP_REVIEW_LABEL)
eq('dependency risk fields', 'conflictCount:依赖冲突,uncertainCount:依赖待核验',
  (view.DEP_RISK_FIELDS || []).map((entry) => (Array.isArray(entry) ? entry.join(':') : entry)).join(','))
for (const [label, value, expected] of [
  ['刚刚', new Date(Date.now() - 5 * 1000).toISOString(), '刚刚'],
  ['minutes ago', new Date(Date.now() - 5 * 60 * 1000).toISOString(), '分钟前'],
  ['hours ago', new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), '小时前'],
  ['days ago', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), '天前'],
]) {
  const text = noThrow(`relativeTime(${label})`, () => view.relativeTime(value))
  truthy(`relativeTime renders ${label}`, typeof text === 'string' && text.includes(expected), String(text))
}
eq('relativeTime tolerates garbage', '时间未知', view.relativeTime('not-a-date'))
eq('relativeTime tolerates null', '时间未知', view.relativeTime(null))
eq('timestampAgeMs returns a number for an ISO timestamp', true,
  typeof view.timestampAgeMs(new Date(Date.now() - 1000).toISOString()) === 'number')
eq('timestampAgeMs returns null for garbage', null, view.timestampAgeMs('garbage'))
eq('isStale: age below ttl', false, view.isStale(1000, 12 * 60 * 60 * 1000))
eq('isStale: age above ttl', true, view.isStale(13 * 60 * 60 * 1000, 12 * 60 * 60 * 1000))
eq('isStale: missing values are not stale', false, view.isStale(null, null))
eq('modeLabel(full)', '全量档', view.modeLabel('full'))
eq('modeLabel(fast)', '快速档', view.modeLabel('fast'))
eq('modeLabel(unknown) is null', null, view.modeLabel('what'))
eq('modeCaveat(full) is null', null, view.modeCaveat('full'))
truthy('modeCaveat(fast) explains the missing comparisons', typeof view.modeCaveat('fast') === 'string' && view.modeCaveat('fast').includes('快速档'), String(view.modeCaveat('fast')))


/* ------------------------------------------- 汇总卡片筛选判定（CONTRACT §v2.8） --- */

process.stdout.write('\n---- summary-card filter parity (v2.8) ----\n')

/** Tools covering every summary bucket, for the filter/count equality proof. */
const FILTER_REPORT = {
  generated_at: '2026-11-06T00:00:00.000Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 1234,
  skipped: ['brew services'],
  managers: {
    homebrew: {
      tools: [
        { name: 'update-tool', current: '1.0.0', latest: '1.1.0', outdated: true },
        { name: 'steady-tool', current: '2.0.0', latest: '2.0.0', outdated: false },
        { name: 'unknown-tool', current: '3.0.0', latest: null, outdated: null },
        { name: 'anomaly-tool', current: '5.0.0', latest: '4.0.0', outdated: true },
      ],
      deps: [{ name: 'dep-a', current: '1.0.0', latest: '1.1.0', outdated: null }],
    },
    npm_global: {
      tools: [
        { name: 'recommended-tool', current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, dependents: [], indirect: [], conflicts: [], uncertain: [] } },
        { name: 'review-tool', current: '1.0.0', latest: '2.0.0', outdated: true },
        { name: 'blocked-tool', current: '1.0.0', latest: '2.0.0', outdated: true, impact: { checked: true, conflicts: [{ name: 'x' }], dependents: [], indirect: [], uncertain: [] } },
      ],
      deps: [],
    },
    python_pip: { tools: [], deps: [] },
    rust_bun_uv: { tools: [], deps: [] },
    self_updating: { tools: [], deps: [] },
  },
}
const filterFields = ['toolCount', 'updateCount', 'recommendedCount', 'reviewCount', 'unknownCount']
eq('toolMatchesSummaryFilter is exported', 'function', typeof view.toolMatchesSummaryFilter)
const filterSummary = view.summarize(FILTER_REPORT)
const allFilterTools = FILTER_REPORT.managers.homebrew.tools.concat(
  FILTER_REPORT.managers.npm_global.tools,
  FILTER_REPORT.managers.python_pip.tools,
  FILTER_REPORT.managers.rust_bun_uv.tools,
  FILTER_REPORT.managers.self_updating.tools,
)
eq('fixture tool total', 7, allFilterTools.length)
eq('fixture toolCount', 7, filterSummary.toolCount)
for (const field of filterFields) {
  const selected = allFilterTools.filter((item) => view.toolMatchesSummaryFilter(item, field))
  eq(`filter(${field}) tool count === summarize().${field}`, filterSummary[field], selected.length)
}
// Hard-coded expected buckets prove the semantic mapping, not just self-consistency.
eq('hard-coded updateCount bucket', 4, view.summarize(FILTER_REPORT).updateCount)
eq('hard-coded recommendedCount bucket', 1, view.summarize(FILTER_REPORT).recommendedCount)
eq('hard-coded reviewCount bucket', 4, view.summarize(FILTER_REPORT).reviewCount)
eq('hard-coded unknownCount bucket', 2, view.summarize(FILTER_REPORT).unknownCount)
eq('updateCount bucket includes update-tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'update-tool'), 'updateCount'))
for (const name of ['steady-tool', 'unknown-tool', 'anomaly-tool']) {
  eq(`updateCount bucket excludes ${name}`, false, view.toolMatchesSummaryFilter(allFilterTools.find((tool) => tool.name === name), 'updateCount'))
}
eq('recommendedCount bucket selects only recommended-tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'recommended-tool'), 'recommendedCount'))
eq('recommendedCount bucket excludes review-tool', false, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'review-tool'), 'recommendedCount'))
eq('reviewCount bucket includes review-tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'review-tool'), 'reviewCount'))
eq('reviewCount bucket includes blocked-tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'blocked-tool'), 'reviewCount'))
eq('unknownCount bucket includes anomaly-tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'anomaly-tool'), 'unknownCount'))
eq('toolCount (clear) selects every tool', true, view.toolMatchesSummaryFilter(allFilterTools.find((t) => t.name === 'steady-tool'), 'toolCount'))
eq('toolMatchesSummaryFilter tolerates garbage', true, view.toolMatchesSummaryFilter(null, 'toolCount'))
for (const field of filterFields) {
  const blockParity = view.groupReport(FILTER_REPORT)
    .every((block) => block.tools.filter((item) => view.toolMatchesSummaryFilter(item, field)).length !== undefined)
  eq(`groupReport filter parity is computable for ${field}`, true, blockParity)
}
const updateBucketPerBlock = view.groupReport(FILTER_REPORT).map((block) => block.updateCount)
const filterBucketPerBlock = view.groupReport(FILTER_REPORT).map(
  (block) => block.tools.filter((item) => view.toolMatchesSummaryFilter(item, 'updateCount')).length,
)
eq('groupBlock.updateCount uses the same judgment', filterBucketPerBlock.join(','), updateBucketPerBlock.join(','))

/* ------------------------------- Markdown / JSON report builders (v2.8) --- */

process.stdout.write('\n---- report export builders (v2.8) ----\n')
const EXPORT_REPORT = {
  generated_at: '2026-11-06T00:00:00.000Z',
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  elapsed_ms: 1234,
  skipped: ['brew services'],
  degraded: [{ manager: 'python_pip', message: 'PATH 缺少 pip' }],
  managers: {
    homebrew: {
      tools: [
        {
          name: 'ripgrep',
          current: '14.0.0',
          latest: '14.1.1',
          outdated: true,
          upgrade_cmd: 'brew upgrade ripgrep',
          note: '先看 release notes',
          impact: { checked: true, scope: '已安装 Homebrew formula', dependents: [], indirect: [], conflicts: [], uncertain: [] },
        },
        { name: 'steady-tool', current: '2.0.0', latest: '2.0.0', outdated: false },
        { name: 'unknown-tool', current: '3.0.0', latest: null, outdated: null },
      ],
      deps: [
        {
          name: 'openssl@3',
          current: '3.0.0',
          latest: '3.1.0',
          outdated: null,
          impact: { checked: true, dependents: [], indirect: [], conflicts: [{ name: 'ripgrep', requirement: '<3.1' }], uncertain: [{ name: 'curl', requirement: '>=1', reason: '可选依赖' }] },
        },
      ],
    },
    npm_global: { tools: [], deps: [] },
    python_pip: { tools: [], deps: [] },
    rust_bun_uv: { tools: [], deps: [] },
    self_updating: { tools: [], deps: [] },
  },
}
const meta = { pluginVersion: '0.2.0', checkedAt: '2026-11-06T00:01:00.000Z', mode: 'fast', elapsedMs: 1234, stale: false, now: Date.parse('2026-11-06T00:02:00.000Z') }
const markdown = noThrow('buildMarkdownReport(EXPORT_REPORT)', () => buildMarkdownReport(EXPORT_REPORT, meta)) ?? ''
for (const [label, needle] of [
  ['title', '# CLI Doctor 诊断报告'],
  ['basic info section', '## 基本信息'],
  ['plugin version meta', '插件版本：0.2.0'],
  ['generated meta', '生成时间：'],
  ['checked meta', '检查时间：'],
  ['mode meta', '检查模式：快速档'],
  ['elapsed meta', '耗时：1.2 秒'],
  ['scope meta', '检查范围：'],
  ['summary section', '## 汇总计数'],
  ['tool counter row', '| 已发现工具 | 3 |'],
  ['dep counter row', '| 依赖包 | 1 |'],
  ['conflict counter row', '| 依赖冲突 | 1 |'],
  ['uncertain counter row', '| 依赖待核验 | 1 |'],
  ['actionable section', '## 可行动工具明细'],
  ['actionable tool name', '#### ripgrep'],
  ['current version row', '- 当前版本：14.0.0'],
  ['target version row', '- 目标版本：14.1.1'],
  ['status row', '- 状态：有可用更新'],
  ['recommendation row', '- 建议：建议更新'],
  ['upgrade command row', '- 升级命令（本插件不执行，仅供人工核对）：`brew upgrade ripgrep`'],
  ['impact summary row', '- 依赖影响：'],
  ['note row', '- 备注：先看 release notes'],
  ['dependency section', '## 依赖冲突与待核验'],
  ['dependency conflict detail', 'openssl@3'],
  ['dependency conflict requirement', 'ripgrep · <3.1'],
  ['dependency uncertain detail', 'curl'],
  ['steady section', '## 已是最新工具'],
  ['steady tool name', 'steady-tool'],
  ['skipped section', '## 未检查项与降级说明'],
  ['skipped check', '未检查：brew services'],
  ['degraded note', '降级：python_pip：PATH 缺少 pip'],
  ['semantics section', '## 状态与建议语义'],
  ['read-only section', '## 只读说明'],
  ['source section', '## 数据来源'],
  ['source data note', 'check.js --json --no-update'],
]) {
  if (markdown.includes(needle)) ok(`markdown contains ${label}`)
  else bad(`markdown is missing ${label}`, `looked for ${JSON.stringify(needle)}`)
}
for (const forbidden of ['请运行', '请执行', '建议执行', '立即执行', '自动执行升级']) {
  if (new RegExp(forbidden).test(markdown)) bad(`markdown must not induce execution`, `found ${JSON.stringify(forbidden)}`)
  else ok(`markdown does not induce execution (${forbidden})`)
}
truthy('markdown explains the read-only boundary', markdown.includes('不执行') && markdown.includes('只读'), '')
truthy('markdown is deterministic for the same input+now', buildMarkdownReport(EXPORT_REPORT, meta) === markdown, '')
noThrow('buildMarkdownReport tolerates null', () => buildMarkdownReport(null))
noThrow('buildMarkdownReport tolerates undefined', () => buildMarkdownReport(undefined))
noThrow('buildMarkdownReport tolerates garbage', () => buildMarkdownReport('broken'))
noThrow('buildMarkdownReport tolerates garbage meta', () => buildMarkdownReport(EXPORT_REPORT, { mode: 7, elapsedMs: 'x', stale: 'yes' }))

const jsonText = noThrow('buildJsonReport(EXPORT_REPORT)', () => buildJsonReport(EXPORT_REPORT)) ?? ''
eq('JSON export is pretty-printed check.js JSON', JSON.stringify(EXPORT_REPORT, null, 2), jsonText)
eq('JSON export parses back to the original report', true, JSON.stringify(JSON.parse(jsonText)) === JSON.stringify(EXPORT_REPORT))
eq('JSON export of null is "null"', 'null', buildJsonReport(null))

/* --------------------------------------- clipboard seam (CONTRACT v2.8) --- */

process.stdout.write('\n---- clipboard seam (v2.8) ----\n')
eq('copy feedback window is 2s', 2000, COPY_FEEDBACK_MS)
let copied = null
const okCopy = await copyText('# CLI Doctor', { clipboard: { writeText: async (value) => { copied = value } } })
eq('copyText success ok', true, okCopy.ok)
eq('copyText success reason', null, okCopy.reason)
eq('copyText wrote the exact text', '# CLI Doctor', copied)
const failedCopy = await copyText('x', { clipboard: { writeText: async () => { throw new Error('denied') } } })
eq('copyText failure ok', false, failedCopy.ok)
eq('copyText failure reason', 'failed', failedCopy.reason)
truthy('copyText failure carries the message', String(failedCopy.message).includes('denied'), String(failedCopy.message))
eq('copyText unavailable (null seam)', 'unavailable', (await copyText('x', { clipboard: null })).reason)
eq('copyText unavailable (no writeText)', 'unavailable', (await copyText('x', { clipboard: {} })).reason)
eq('unavailable copy text is readable', true, CLIPBOARD_UNAVAILABLE_TEXT.includes('不支持剪贴板'))
eq('failed copy text is readable', true, CLIPBOARD_FAILED_TEXT.includes('剪贴板写入失败'))
let neverThrew = true
try { await copyText(null, { clipboard: null }); await copyText(undefined, { clipboard: { writeText: async () => {} } }) } catch { neverThrew = false }
eq('copyText never throws', true, neverThrew)

/* -------------------------------------------------------------- summary --- */

process.stdout.write(`\n---- view-contract: pass=${pass} fail=${fail} ----\n`)
if (fail > 0) {
  for (const entry of failures) process.stdout.write(`  - ${entry}\n`)
  process.exit(1)
}
