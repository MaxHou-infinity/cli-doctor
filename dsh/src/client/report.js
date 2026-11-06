/**
 * Report export builders (CONTRACT.md §v2.8).
 *
 * Pure functions only — no React, no DOM — so the panel can copy a report and
 * the unit tests can prove the exported text without rendering anything:
 *
 * - {@link buildMarkdownReport} produces the AI-friendly Markdown export: an
 *   overview of the check, the five summary counters plus dependency risk, the
 *   actionable tool details per ecosystem (status/recommendation/command/impact
 *   summary/note), dependency conflicts and unverified dependencies, the
 *   already-up-to-date tool names, skipped/degraded notes, the status semantics
 *   and the read-only policy.
 * - {@link buildJsonReport} is the untouched `check.js` report, pretty-printed.
 *
 * The read-only boundary is part of the exported text: commands are shown for
 * human review only, and the document never instructs the reader (or an agent)
 * to execute an upgrade. The plugin has no execution path at all.
 *
 * @module dsh-cli-doctor/client/report
 */
import {
  KIND_DEP,
  KIND_TOOL,
  SUMMARY_FIELDS,
  formatDuration,
  formatScope,
  formatTimestamp,
  groupReport,
  modeCaveat,
  modeLabel,
  recommendationFor,
  relativeTime,
  skippedChecks,
  statusFor,
  summarize,
} from './view.js';

/** Placeholder for a missing note/scope/value, so table cells never go blank. */
const PLACEHOLDER = '未标注';

/** Text of a possibly missing field, or null. */
function textOf(value) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** `current → latest` version line, or a placeholder. */
function versionLine(item) {
  const current = textOf(item && item.current) || '未核验';
  const latest = textOf(item && item.latest) || '目标待核验';
  return `${current} → ${latest}`;
}

/** One-line dependency impact summary for a tool/dep entry. */
function impactSummary(item) {
  const tool = item && typeof item === 'object' ? item : {};
  const impact = tool.impact && typeof tool.impact === 'object' ? tool.impact : null;
  if (!impact || impact.checked !== true) return '依赖检查：未完成或该生态暂不支持。';
  const dependents = Array.isArray(impact.dependents) ? impact.dependents.length : 0;
  const indirect = Array.isArray(impact.indirect) ? impact.indirect.length : 0;
  const uncertain = Array.isArray(impact.uncertain) ? impact.uncertain.length : 0;
  const scope = textOf(impact.scope) || PLACEHOLDER;
  return `直接依赖 ${dependents} 个 · 间接依赖 ${indirect} 个 · 待核验 ${uncertain} 项；范围：${scope}。`;
}

/** Readable text for a `degraded` entry (string, record or anything else). */
function degradedText(entry) {
  if (typeof entry === 'string' && entry) return entry;
  const record = entry && typeof entry === 'object' ? entry : null;
  if (!record) return null;
  const manager = textOf(record.manager);
  const message = textOf(record.message) || textOf(record.reason);
  if (manager && message) return `${manager}：${message}`;
  if (message) return message;
  if (manager) return manager;
  try {
    return JSON.stringify(entry);
  } catch {
    return null;
  }
}

/** Appended lines for one tool in the actionable section. */
function toolDetailLines(item) {
  const [status] = statusFor(item, KIND_TOOL);
  const [recommendation, , explanation] = recommendationFor(item, KIND_TOOL);
  const lines = [
    `- 当前版本：${textOf(item && item.current) || '未核验'}`,
    `- 目标版本：${textOf(item && item.latest) || '目标待核验'}`,
    `- 状态：${status}`,
    `- 建议：${recommendation}${explanation ? ` — ${explanation}` : ''}`,
  ];
  const command = textOf(item && item.upgrade_cmd);
  if (command) lines.push(`- 升级命令（本插件不执行，仅供人工核对）：\`${command}\``);
  const anomaly = textOf(item && item.version_line_anomaly);
  if (anomaly && anomaly !== 'true' && anomaly !== 'false') lines.push(`- 版本线提示：${anomaly}`);
  lines.push(`- 依赖影响：${impactSummary(item)}`);
  const note = textOf(item && item.note);
  if (note) lines.push(`- 备注：${note}`);
  return lines;
}

/**
 * Build the AI-friendly Markdown export of one diagnosis report.
 *
 * @param report - the Host report (CONTRACT.md §4; missing/null tolerated).
 * @param meta - panel-side context: `pluginVersion`, `checkedAt`, `mode`,
 *   `elapsedMs`, `stale` and an optional `now` epoch (for deterministic
 *   relative-time text in tests). Omitted fields fall back to the report.
 * @returns the Markdown document.
 */
export function buildMarkdownReport(report, meta = {}) {
  const safeReport = report && typeof report === 'object' ? report : {};
  const safeMeta = meta && typeof meta === 'object' ? meta : {};
  const now = typeof safeMeta.now === 'number' && Number.isFinite(safeMeta.now) ? safeMeta.now : Date.now();
  const counts = summarize(safeReport);
  const checkedAt = textOf(safeMeta.checkedAt) || textOf(safeReport.generated_at);
  const mode = textOf(safeMeta.mode);
  const elapsedMs = Number.isFinite(safeMeta.elapsedMs)
    ? safeMeta.elapsedMs
    : (Number.isFinite(safeReport.elapsed_ms) ? safeReport.elapsed_ms : null);
  const pluginVersion = textOf(safeMeta.pluginVersion);
  const stale = safeMeta.stale === true;
  const blocks = groupReport(safeReport);
  const lines = [];

  lines.push('# CLI Doctor 诊断报告', '');
  lines.push('> 本插件只做只读检查，不执行、也不代为执行任何升级动作；插件不提供自动执行入口，命令仅供人工核对。', '');

  lines.push('## 基本信息', '');
  lines.push(`- 插件版本：${pluginVersion || '未标注'}`);
  lines.push(`- 生成时间：${formatTimestamp(safeReport.generated_at)}`);
  lines.push(`- 检查时间：${checkedAt ? `${formatTimestamp(checkedAt)}（${relativeTime(checkedAt, now)}）` : '时间未知'}`);
  lines.push(`- 检查模式：${modeLabel(mode) || '未标注'}`);
  lines.push(`- 耗时：${formatDuration(elapsedMs)}`);
  lines.push(`- 检查范围：${formatScope(safeReport)}`);
  lines.push(`- 数据状态：${stale ? '已过期（上次检查距今可能已不准确，建议重新诊断）' : '有效（来自最近一次成功检查）'}`);
  if (modeCaveat(mode)) lines.push(`- 模式提示：${modeCaveat(mode)}`);
  lines.push('');

  lines.push('## 汇总计数', '');
  lines.push('| 指标 | 数量 |', '| --- | ---: |');
  for (const [field, label] of SUMMARY_FIELDS) lines.push(`| ${label} | ${counts[field]} |`);
  lines.push(`| 依赖包 | ${counts.depCount} |`);
  lines.push(`| 依赖冲突 | ${counts.conflictCount} |`);
  lines.push(`| 依赖待核验 | ${counts.uncertainCount} |`);
  lines.push('', '> 前五项只统计工具层，与面板顶部计数一致；依赖数字单独统计。', '');

  lines.push('## 可行动工具明细', '');
  let actionableCount = 0;
  for (const block of blocks) {
    const actionable = block.tools.filter((tool) => statusFor(tool, KIND_TOOL)[1] !== 'steady');
    if (!actionable.length) continue;
    lines.push(`### ${block.title}`, '');
    for (const tool of actionable) {
      actionableCount += 1;
      const name = textOf(tool && tool.name) || '未知工具';
      lines.push(`#### ${name}`, '');
      for (const line of toolDetailLines(tool)) lines.push(line);
      lines.push('');
    }
  }
  if (!actionableCount) lines.push('- 本次未发现需要处理的可行动工具。', '');

  lines.push('## 依赖冲突与待核验', '');
  const conflictLines = [];
  const uncertainLines = [];
  for (const block of blocks) {
    for (const dep of block.deps) {
      const name = textOf(dep && dep.name) || '未知依赖';
      const impact = dep && dep.impact && typeof dep.impact === 'object' ? dep.impact : {};
      for (const entry of Array.isArray(impact.conflicts) ? impact.conflicts : []) {
        const target = entry && typeof entry === 'object' ? entry : {};
        const conflictName = textOf(target.name) || '未知依赖';
        const requirement = textOf(target.requirement);
        conflictLines.push(`- ${name}（${versionLine(dep)}）：${conflictName}${requirement ? ` · ${requirement}` : ''}`);
      }
      for (const entry of Array.isArray(impact.uncertain) ? impact.uncertain : []) {
        const target = entry && typeof entry === 'object' ? entry : {};
        const uncertainName = textOf(target.name) || '未知依赖';
        const requirement = textOf(target.requirement);
        const reason = textOf(target.reason) || '待核验';
        uncertainLines.push(`- ${name}（${versionLine(dep)}）：${uncertainName}${requirement ? ` · ${requirement}` : ''} · ${reason}`);
      }
    }
  }
  lines.push(`### 依赖冲突（${conflictLines.length} 条）`, '');
  if (conflictLines.length) lines.push(...conflictLines);
  else lines.push('- 未发现依赖冲突。');
  lines.push('');
  lines.push(`### 依赖待核验（${uncertainLines.length} 条）`, '');
  if (uncertainLines.length) lines.push(...uncertainLines);
  else lines.push('- 未发现待核验依赖。');
  lines.push('');

  lines.push('## 已是最新工具', '');
  let steadyCount = 0;
  for (const block of blocks) {
    const steady = block.tools
      .filter((tool) => statusFor(tool, KIND_TOOL)[1] === 'steady')
      .map((tool) => textOf(tool && tool.name))
      .filter(Boolean);
    if (!steady.length) continue;
    steadyCount += steady.length;
    lines.push(`- ${block.title}（${steady.length}）：${steady.join('、')}`);
  }
  if (!steadyCount) lines.push('- 未发现已是最新的工具。');
  lines.push('');

  lines.push('## 未检查项与降级说明', '');
  const skipped = skippedChecks(safeReport);
  if (skipped.length) {
    for (const entry of skipped) lines.push(`- 未检查：${entry}`);
  }
  const degraded = Array.isArray(safeReport.degraded) ? safeReport.degraded : [];
  for (const entry of degraded) {
    const text = degradedText(entry);
    if (text) lines.push(`- 降级：${text}`);
  }
  if (!skipped.length && !degraded.length) lines.push('- 本次未报告跳过项或降级项。');
  lines.push('');

  lines.push('## 状态与建议语义', '');
  lines.push('- 有可用更新：存在可比较的候选新版本（或需进一步核验），不代表可以直接升级。');
  lines.push('- 建议更新：依赖影响检查完成且未发现声明冲突，命令仍需人工在终端决定是否执行。');
  lines.push('- 需核验或暂缓：存在未确认的可选依赖、版本约束冲突、大版本跨越或未完成的依赖检查。');
  lines.push('- 目标待核验：缺少可靠的目标版本，无法判断是否需要升级。');
  lines.push('- 版本线异常：候选版本低于已装版本，应先核对发布频道和版本线。');
  lines.push('- 候选更新 · 待核验：依赖条目没有过期标记，只能作为候选更新看待。');
  lines.push('');

  lines.push('## 只读说明', '');
  lines.push('- 插件只读取本机 CLI 工具与依赖的版本信息，不执行、不代为执行任何升级动作，也不提供自动执行入口。');
  lines.push('- 升级命令只用于人工核对；是否执行、何时执行由用户自行决定。');
  lines.push('');

  lines.push('## 数据来源', '');
  lines.push('- 数据来源：本机 CLI Doctor 只读检查（`check.js --json --no-update`），未扫描其他项目目录或虚拟环境。');
  lines.push(`- 检查时间：${checkedAt ? formatTimestamp(checkedAt) : '时间未知'}；报告生成时间：${formatTimestamp(safeReport.generated_at)}。`);
  lines.push('');

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

/**
 * Build the untouched, pretty-printed JSON export of one report.
 *
 * @param report - the Host report (anything; `null` stringifies as `null`).
 * @returns the exact `check.js` JSON with two-space indentation.
 */
export function buildJsonReport(report) {
  return JSON.stringify(report ?? null, null, 2);
}
