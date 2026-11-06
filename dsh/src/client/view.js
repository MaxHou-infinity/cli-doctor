/**
 * Pure view model for the CLI Doctor panel.
 *
 * The status/recommendation semantics started as a deliberate port of the
 * repository's `dashboard/app.js` (`candidateBelowCurrent` / `statusFor` /
 * `recommendationFor` / the five summary counters), rewritten as side-effect-free
 * helpers so the React panel and the unit tests share exactly one implementation.
 * The dashboard file itself is never imported by the DSH plugin.
 *
 * v0.3 fixes the dependency-layer semantics (CONTRACT.md §v2.3): dependency
 * entries carry no `outdated` flag, so v1 rendered them as「有可用更新」while the
 * recommendation said「无法判断」for the same card. Dependencies now expose a
 * single honest state —「候选更新 · 待核验」— and the summary gains dependency-level
 * `conflictCount`/`uncertainCount` without changing the five tool-only counters.
 *
 * Everything here is defensive: the only input contract is CONTRACT.md §4, and
 * any missing/null/unknown field must degrade to a readable label instead of
 * throwing.
 *
 * @module dsh-cli-doctor/client/view
 */

/** Ecosystem blocks, in the order the contract fixes. */
export const MANAGERS = [
  { key: 'homebrew', title: 'Homebrew' },
  { key: 'npm_global', title: 'npm 全局' },
  { key: 'python_pip', title: 'Python / pip' },
  { key: 'rust_bun_uv', title: 'Rust / Bun / uv' },
  { key: 'self_updating', title: '独立更新工具' },
];

/** Item kind labels, matching the dashboard's `kind` argument. */
export const KIND_TOOL = '工具';
export const KIND_DEP = '依赖';

/** Status tag for a dependency that has a candidate version but no `outdated` flag. */
export const DEP_CANDIDATE_LABEL = '候选更新 · 待核验';

/** Recommendation label for the same dependency entry. */
export const DEP_REVIEW_LABEL = '依赖更新需人工核验';

/** The five summary counters, in display order (tool layer only, per v1 §3.4). */
export const SUMMARY_FIELDS = [
  ['toolCount', '已发现工具'],
  ['updateCount', '有可用更新'],
  ['recommendedCount', '建议更新'],
  ['reviewCount', '需核验或暂缓'],
  ['unknownCount', '目标待核验'],
];

/** The two dependency-risk cells added by CONTRACT.md §v2.3 (rendered only when N > 0). */
export const DEP_RISK_FIELDS = [
  ['conflictCount', '依赖冲突'],
  ['uncertainCount', '依赖待核验'],
];

/** Human labels for the check modes (CONTRACT.md §v2.2). */
export const MODE_LABELS = {
  full: '全量档',
  fast: '快速档',
};

/** Leading `1.2.3`-style version head, or null when the value carries none. */
function versionHead(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).match(/^\d+(?:\.\d+){1,3}/);
  return match ? match[0] : null;
}

/** Array view of a possibly missing/foreign field. */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Plain-object view of a possibly missing/foreign record. */
function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Whether `impact` is a real object that the Host marked as checked. */
function isImpactChecked(item) {
  const tool = asRecord(item);
  return tool.impact != null && typeof tool.impact === 'object' && tool.impact.checked === true;
}

/**
 * True when the reported target version sorts below the installed one, i.e. the
 * repository "latest" candidate is not a real upgrade. Verbatim port of the
 * dashboard comparison.
 *
 * @param item - one report entry (may be null).
 * @returns whether the candidate line sits below the current version.
 */
export function candidateBelowCurrent(item) {
  const tool = asRecord(item);
  const current = versionHead(tool.current);
  const latest = versionHead(tool.latest);
  if (!current || !latest) return false;
  const left = current.split('.').map(Number);
  const right = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((right[i] || 0) !== (left[i] || 0)) return (right[i] || 0) < (left[i] || 0);
  }
  return false;
}

/**
 * Status tag for one entry: `[label, tone]`.
 *
 * Tools keep the dashboard port (an explicit `outdated === true` outranks a
 * missing `latest`). Dependencies have no `outdated` field in the report shape,
 * so v1's "any `latest` means an update" branch produced a state tag that
 * contradicted the recommendation; v2 maps the dependency layer to
 * {@link DEP_CANDIDATE_LABEL} instead (CONTRACT.md §v2.3).
 *
 * @param item - one report entry (may be null).
 * @param kind - KIND_TOOL or KIND_DEP.
 * @returns tuple of the visible label and its tone token.
 */
export function statusFor(item, kind) {
  const tool = asRecord(item);
  if (candidateBelowCurrent(tool)) return ['版本线异常', 'anomaly'];
  if (kind === KIND_DEP) {
    if (tool.outdated === true) return ['有可用更新', 'update'];
    if (tool.outdated === false) return tool.latest ? ['未检出更新', 'steady'] : ['目标待核验', 'unknown'];
    if (tool.latest) return [DEP_CANDIDATE_LABEL, 'review'];
    return ['目标待核验', 'unknown'];
  }
  if (tool.outdated === true) return ['有可用更新', 'update'];
  if (tool.outdated == null || !tool.latest) return ['目标待核验', 'unknown'];
  return ['未检出更新', 'steady'];
}

/**
 * Upgrade recommendation for one entry: `[label, tone, explanation]`.
 *
 * Tools keep the dashboard port, check order included: version-line anomaly,
 * unknown target, no update, unfinished impact check, declared conflicts,
 * uncertain dependencies, operational review, big-jump / dependents review, and
 * finally the "safe to update" advice. Dependencies without `outdated` are never
 * reported as a plain "updated"; they resolve to {@link DEP_REVIEW_LABEL} or a
 * more specific review/blocked branch, so the pair「有可用更新 + 无法判断」cannot
 * appear on the same card (CONTRACT.md §v2.3).
 *
 * @param item - one report entry (may be null).
 * @param kind - KIND_TOOL or KIND_DEP.
 * @returns tuple of label, tone token and the one-sentence rationale.
 */
export function recommendationFor(item, kind) {
  const tool = asRecord(item);
  const impact = asRecord(tool.impact);
  const checked = isImpactChecked(tool);
  const dependents = asArray(impact.dependents).length;
  const indirect = asArray(impact.indirect).length;
  const conflicts = asArray(impact.conflicts).length;
  const uncertain = asArray(impact.uncertain).length;
  const scope = typeof impact.scope === 'string' ? impact.scope : '';
  const pythonScope = scope.startsWith('当前 Python');

  if (candidateBelowCurrent(tool)) return ['暂不建议', 'blocked', '候选版本低于已装版本，先核对发布频道和版本线。'];
  if (kind === KIND_DEP && tool.outdated == null) {
    if (!tool.latest) return ['无法判断', 'unknown', '尚无可靠目标版本，无法判断升级影响。'];
    if (!checked) return ['影响待核验', 'review', '依赖关系没有完成检查，不能仅凭候选版本就建议升级。'];
    if (conflicts) return ['暂不建议', 'blocked', `目标版本不满足 ${conflicts} 个已安装项目的声明约束。`];
    if (uncertain) return ['需人工核验', 'review', '存在无法确认的可选依赖、版本约束或安装方式。'];
    return [DEP_REVIEW_LABEL, 'review', '依赖条目没有过期标记，无法确认是否确需升级；升级前请对照上层工具的版本约束。'];
  }
  if (tool.outdated == null || !tool.latest) return ['无法判断', 'unknown', '尚无可靠目标版本，无法判断升级影响。'];
  if (tool.outdated === false) return ['无需更新', 'steady', '本次未检出新版本。'];
  if (!checked) return ['影响待核验', 'review', '依赖关系没有完成检查，不能仅凭新版本就建议升级。'];
  if (conflicts) return ['暂不建议', 'blocked', `目标版本不满足 ${conflicts} 个已安装项目的声明约束。`];
  if (uncertain) return ['需人工核验', 'review', '存在无法确认的可选依赖、版本约束或安装方式。'];
  if (impact.operational_review) return ['需兼容验证', 'review', String(impact.operational_review)];
  if (kind === KIND_DEP && (dependents || indirect)) return ['需人工核验', 'review', '共享依赖被其他已安装项目使用，应结合上层工具一起升级。'];
  if (tool.major_jump && (dependents || indirect)) return ['需兼容验证', 'review', '跨大版本且有已安装项目直接或间接依赖它；版本约束通过仍不能证明 API 兼容。'];
  if (tool.major_jump) return ['需兼容验证', 'review', '未发现已装项目的声明依赖冲突；大版本自身的命令、配置和项目用法仍需核验。'];
  if ((dependents || indirect) && !pythonScope) return ['需兼容验证', 'review', '有其他已安装工具依赖它；当前尚未模拟目标版的安装与运行。'];
  const scopeLabel = pythonScope ? '当前 Python 环境' : '已检查的安装范围';
  return ['建议更新', 'recommended', (dependents || indirect)
    ? `${scopeLabel}内的已装项目未发现目标版本约束冲突。请留意工具自身的配置和运行方式。`
    : `${scopeLabel}内未发现其他已装项目声明依赖此工具。${tool.major_jump ? '这是大版本更新，执行前仍应核对自身配置变化。' : ''}`];
}

/**
 * Impact block for one entry, as plain data (the dashboard builds DOM here).
 *
 * @param item - one report entry (may be null).
 * @returns `{checked, scope, counts, entries, hasEntries}`; `entries` carries
 *   `{text, tone}` where tone is `conflict`, `indirect`, `uncertain` or `plain`.
 */
export function impactView(item) {
  const tool = asRecord(item);
  const impact = asRecord(tool.impact);
  const counts = {
    dependents: asArray(impact.dependents).length,
    indirect: asArray(impact.indirect).length,
    uncertain: asArray(impact.uncertain).length,
  };
  if (!isImpactChecked(tool)) {
    return { checked: false, scope: null, counts, entries: [], hasEntries: false };
  }
  const conflictKeys = new Set(asArray(impact.conflicts)
    .map((entry) => asRecord(entry))
    .map((entry) => `${entry.name}\u0000${entry.requirement}`));
  const entries = [];
  for (const raw of asArray(impact.dependents)) {
    const entry = asRecord(raw);
    const conflict = conflictKeys.has(`${entry.name}\u0000${entry.requirement}`);
    entries.push({
      tone: conflict ? 'conflict' : 'plain',
      text: `${entry.name ?? '未知依赖'}${entry.version ? ` ${entry.version}` : ''}${entry.requirement ? ` · ${entry.requirement}` : ''}${conflict ? ' · 与目标版本冲突' : ''}`,
    });
  }
  for (const raw of asArray(impact.indirect)) {
    const entry = asRecord(raw);
    entries.push({ tone: 'indirect', text: `${entry.name ?? '未知依赖'}${entry.version ? ` ${entry.version}` : ''} · 间接依赖` });
  }
  for (const raw of asArray(impact.uncertain)) {
    const entry = asRecord(raw);
    entries.push({
      tone: 'uncertain',
      text: `${entry.name ?? '未知依赖'}${entry.requirement ? ` · ${entry.requirement}` : ''} · ${entry.reason || '待核验'}`,
    });
  }
  return {
    checked: true,
    scope: typeof impact.scope === 'string' && impact.scope ? impact.scope : null,
    counts,
    entries,
    hasEntries: entries.length > 0,
  };
}

/**
 * Tool-layer predicate shared by the five summary counters and the summary-card
 * filter (CONTRACT.md §v2.8).
 *
 * This single function is what guarantees that a card's number equals the number
 * of tools that card filters to: {@link summarize} counts with it and the panel
 * filters with it. Conditions must not be duplicated anywhere else.
 *
 * @param item - one tool entry (anything; null tolerated).
 * @param field - summary counter field (`toolCount` clears the filter).
 * @returns whether the tool belongs to that summary bucket.
 */
export function toolMatchesSummaryFilter(item, field) {
  switch (field) {
    case 'updateCount':
      return ['update', 'review'].includes(statusFor(item, KIND_TOOL)[1]);
    case 'unknownCount':
      return ['unknown', 'anomaly'].includes(statusFor(item, KIND_TOOL)[1]);
    case 'recommendedCount':
      return recommendationFor(item, KIND_TOOL)[1] === 'recommended';
    case 'reviewCount':
      return ['review', 'blocked'].includes(recommendationFor(item, KIND_TOOL)[1]);
    case 'toolCount':
    default:
      return true;
  }
}

/**
 * Group a report into the five ordered ecosystem blocks, each with its tool and
 * dependency layers. Managers the report does not carry, or that hold nothing,
 * are skipped exactly like the dashboard's `renderReport`.
 *
 * @param report - the Host report (anything; null tolerated).
 * @returns blocks `{key, title, tools, deps, updateCount}`; `updateCount`
 *   counts tools whose status tone is `update`, so the per-block badges sum to
 *   the top-level 「有可用更新」 counter (dashboard parity: tools only).
 */
export function groupReport(report) {
  const managers = asRecord(asRecord(report).managers);
  const blocks = [];
  for (const spec of MANAGERS) {
    const manager = managers[spec.key];
    if (!manager || typeof manager !== 'object') continue;
    const tools = asArray(manager.tools);
    const deps = asArray(manager.deps);
    if (!tools.length && !deps.length) continue;
    let updateCount = 0;
    for (const tool of tools) {
      if (toolMatchesSummaryFilter(tool, 'updateCount')) updateCount += 1;
    }
    blocks.push({ key: spec.key, title: spec.title, tools, deps, updateCount });
  }
  return blocks;
}

/**
 * The five dashboard counters (tool layer only), counted through
 * {@link toolMatchesSummaryFilter} so the summary cards and the card-triggered
 * filter can never drift apart (CONTRACT.md §v2.8). Plus dependency-layer totals:
 * `depCount`, `conflictCount` (deps whose `impact.conflicts` is non-empty) and
 * `uncertainCount` (deps whose `impact.uncertain` is non-empty). The dependency
 * numbers are additive and do not change the v1 counter semantics
 * (CONTRACT.md §v2.2/§v2.3).
 *
 * @param report - the Host report (anything; null tolerated).
 * @returns counters and `blocks`.
 */
export function summarize(report) {
  let toolCount = 0;
  let updateCount = 0;
  let unknownCount = 0;
  let recommendedCount = 0;
  let reviewCount = 0;
  let depCount = 0;
  let conflictCount = 0;
  let uncertainCount = 0;
  const blocks = groupReport(report);
  for (const block of blocks) {
    for (const tool of block.tools) {
      toolCount += 1;
      for (const field of ['updateCount', 'unknownCount', 'recommendedCount', 'reviewCount']) {
        if (!toolMatchesSummaryFilter(tool, field)) continue;
        if (field === 'updateCount') updateCount += 1;
        else if (field === 'unknownCount') unknownCount += 1;
        else if (field === 'recommendedCount') recommendedCount += 1;
        else reviewCount += 1;
      }
    }
    for (const dep of block.deps) {
      depCount += 1;
      const impact = asRecord(asRecord(dep).impact);
      if (asArray(impact.conflicts).length) conflictCount += 1;
      if (asArray(impact.uncertain).length) uncertainCount += 1;
    }
  }
  return { toolCount, updateCount, unknownCount, recommendedCount, reviewCount, depCount, conflictCount, uncertainCount, blocks };
}

/** Skipped-check labels from the report, as a flat string array. */
export function skippedChecks(report) {
  return asArray(asRecord(report).skipped).filter((entry) => typeof entry === 'string' && entry);
}

/**
 * Localized report timestamp, or a stable placeholder for missing/bad input.
 *
 * @param value - ISO-ish timestamp.
 * @returns display string, never empty.
 */
export function formatTimestamp(value) {
  if (value == null || value === '') return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return date.toLocaleString('zh-CN');
  } catch {
    return date.toISOString();
  }
}

/**
 * Human duration for `elapsed_ms` / the live wait counter.
 *
 * @param ms - milliseconds (anything; null tolerated).
 * @returns display string, never empty.
 */
export function formatDuration(ms) {
  if (ms == null || ms === '') return '耗时未知';
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '耗时未知';
  if (value < 1000) return `${Math.round(value)} 毫秒`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes} 分 ${rest} 秒`;
}

/**
 * Relative freshness label for the last diagnosis (CONTRACT.md §v2.3).
 *
 * @param value - ISO timestamp (or anything; null tolerated).
 * @param now - epoch milliseconds to compare against (defaults to `Date.now()`).
 * @returns `刚刚` / `N 分钟前` / `N 小时前` / `N 天前` / `时间未知`.
 */
export function relativeTime(value, now = Date.now()) {
  if (value == null || value === '') return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const nowMs = Number(now);
  if (!Number.isFinite(nowMs)) return '时间未知';
  const diff = nowMs - date.getTime();
  if (diff <= 45 * 1000) return '刚刚';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/**
 * Age of a timestamp in milliseconds, or null when unknown.
 *
 * @param value - ISO timestamp.
 * @param now - epoch milliseconds (defaults to `Date.now()`).
 * @returns non-negative milliseconds or null.
 */
export function timestampAgeMs(value, now = Date.now()) {
  if (value == null || value === '') return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Number(now) - time);
}

/**
 * Whether a snapshot age exceeds the Host's TTL.
 *
 * @param ageMs - snapshot age in milliseconds (null tolerated).
 * @param ttlMs - cache TTL in milliseconds (null tolerated).
 * @returns whether the data should be treated as stale.
 */
export function isStale(ageMs, ttlMs) {
  return typeof ageMs === 'number' && Number.isFinite(ageMs)
    && typeof ttlMs === 'number' && Number.isFinite(ttlMs)
    && ttlMs > 0
    && ageMs > ttlMs;
}

/**
 * Report scope, or a placeholder.
 *
 * @param report - the Host report.
 * @returns display string, never empty.
 */
export function formatScope(report) {
  const scope = asRecord(report).scope;
  return typeof scope === 'string' && scope ? scope : '未标注';
}

/**
 * Human label for a check mode.
 *
 * @param mode - `full`, `fast` or anything.
 * @returns `全量档` / `快速档` / null.
 */
export function modeLabel(mode) {
  return MODE_LABELS[mode] || null;
}

/**
 * Caveat that must accompany a `fast` result (CONTRACT.md §v2.2: the UI must not
 * present a fast run as a complete update verdict).
 *
 * @param mode - check mode.
 * @returns the caveat sentence, or null for full mode.
 */
export function modeCaveat(mode) {
  if (mode !== 'fast') return null;
  return '快速档：npm 全局 / Python / Rust / Bun / uv 未比对最新版本，本结果不能作为升级结论。';
}
