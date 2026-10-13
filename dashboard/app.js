'use strict';

const button = document.getElementById('check-button');
const runState = document.getElementById('run-state');
const summary = document.getElementById('summary');
const ecosystems = document.getElementById('ecosystems');
const errorBox = document.getElementById('error');

const ECOSYSTEMS = [
  { title: 'Homebrew', key: 'homebrew', tools: (m) => m.tools || [], deps: (m) => m.deps || [] },
  { title: 'npm 全局', key: 'npm_global', tools: (m) => m.tools || [] },
  { title: 'Python / pip', key: 'python_pip', tools: (m) => m.tools || [], deps: (m) => m.deps || [] },
  { title: 'Rust', key: 'rust_bun_uv', tools: (m) => (m.tools || []).filter((t) => t.category === 'rustup' || t.category === 'cargo install') },
  { title: 'Bun', key: 'rust_bun_uv', tools: (m) => (m.tools || []).filter((t) => t.category === 'bun') },
  { title: 'uv', key: 'rust_bun_uv', tools: (m) => (m.tools || []).filter((t) => t.category === 'uv' || t.category === 'uv tools') },
  { title: '独立更新工具', key: 'self_updating', tools: (m) => m.tools || [] },
];

function node(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value != null) el.textContent = String(value);
  return el;
}

function candidateBelowCurrent(tool) {
  const current = String(tool.current || '').match(/^\d+(?:\.\d+){1,3}/)?.[0];
  const latest = String(tool.latest || '').match(/^\d+(?:\.\d+){1,3}/)?.[0];
  if (!current || !latest) return false;
  const left = current.split('.').map(Number);
  const right = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((right[i] || 0) !== (left[i] || 0)) return (right[i] || 0) < (left[i] || 0);
  }
  return false;
}

function statusFor(tool, kind) {
  if (candidateBelowCurrent(tool)) return ['版本线异常', 'anomaly'];
  if (tool.outdated === true || (kind === '依赖' && tool.latest)) {
    return ['有可用更新', 'update'];
  }
  if (tool.outdated === null || !tool.latest) return ['目标待核验', 'unknown'];
  return ['未检出更新', 'steady'];
}

function recommendationFor(tool, kind) {
  const impact = tool.impact;
  if (candidateBelowCurrent(tool)) return ['暂不建议', 'blocked', '候选版本低于已装版本，先核对发布频道和版本线。'];
  if (tool.outdated === null || !tool.latest) return ['无法判断', 'unknown', '尚无可靠目标版本，无法判断升级影响。'];
  if (tool.outdated === false) return ['无需更新', 'steady', '本次未检出新版本。'];
  if (!impact?.checked) return ['影响待核验', 'review', '依赖关系没有完成检查，不能仅凭新版本就建议升级。'];
  if (impact.conflicts?.length) return ['暂不建议', 'blocked', `目标版本不满足 ${impact.conflicts.length} 个已安装项目的声明约束。`];
  if (impact.uncertain?.length) return ['需人工核验', 'review', '存在无法确认的可选依赖、版本约束或安装方式。'];
  if (impact.operational_review) return ['需兼容验证', 'review', impact.operational_review];
  if (kind === '依赖' && (impact.dependents?.length || impact.indirect?.length)) return ['需人工核验', 'review', '共享依赖被其他已安装项目使用，应结合上层工具一起升级。'];
  if (tool.major_jump && (impact.dependents?.length || impact.indirect?.length)) return ['需兼容验证', 'review', '跨大版本且有已安装项目直接或间接依赖它；版本约束通过仍不能证明 API 兼容。'];
  if (tool.major_jump) return ['需兼容验证', 'review', '未发现已装项目的声明依赖冲突；大版本自身的命令、配置和项目用法仍需核验。'];
  if ((impact.dependents?.length || impact.indirect?.length) && !impact.scope?.startsWith('当前 Python')) return ['需兼容验证', 'review', '有其他已安装工具依赖它；当前尚未模拟目标版的安装与运行。'];
  const scope = impact.scope?.startsWith('当前 Python') ? '当前 Python 环境' : '已检查的安装范围';
  return ['建议更新', 'recommended', (impact.dependents?.length || impact.indirect?.length)
    ? `${scope}内的已装项目未发现目标版本约束冲突。请留意工具自身的配置和运行方式。`
    : `${scope}内未发现其他已装项目声明依赖此工具。${tool.major_jump ? '这是大版本更新，执行前仍应核对自身配置变化。' : ''}`];
}

function impactDetails(tool) {
  const impact = tool.impact;
  if (!impact?.checked) return node('p', 'impact-scope', '依赖检查：未完成或该生态暂不支持。');
  const block = node('div', 'impact-block');
  block.append(node('p', 'impact-scope', `已检查：${impact.scope}。未扫描其他项目目录或虚拟环境。`));
  const dependents = impact.dependents || [];
  const indirect = impact.indirect || [];
  const uncertain = impact.uncertain || [];
  if (!dependents.length && !indirect.length && !uncertain.length) {
    block.append(node('p', 'impact-none', '未发现已装项目声明依赖此工具。'));
    return block;
  }
  const details = node('details', 'impact-list');
  details.open = !!impact.conflicts?.length;
  details.append(node('summary', '', `直接依赖 ${dependents.length} 个 · 间接依赖 ${indirect.length} 个${uncertain.length ? ` · 待核验 ${uncertain.length} 项` : ''}`));
  const list = node('ul', 'impact-items');
  const conflictKeys = new Set((impact.conflicts || []).map((item) => `${item.name}\u0000${item.requirement}`));
  for (const item of dependents) {
    const conflict = conflictKeys.has(`${item.name}\u0000${item.requirement}`);
    const message = `${item.name}${item.version ? ` ${item.version}` : ''}${item.requirement ? ` · ${item.requirement}` : ''}${conflict ? ' · 与目标版本冲突' : ''}`;
    list.append(node('li', conflict ? 'impact-conflict' : '', message));
  }
  for (const item of indirect) list.append(node('li', '', `${item.name}${item.version ? ` ${item.version}` : ''} · 间接依赖`));
  for (const item of uncertain) list.append(node('li', 'impact-uncertain', `${item.name}${item.requirement ? ` · ${item.requirement}` : ''} · ${item.reason || '待核验'}`));
  details.append(list);
  block.append(details);
  return block;
}

function field(label, value) {
  const wrap = node('div', 'version-field');
  wrap.append(node('span', 'field-label', label), node('strong', '', value || '未核验'));
  return wrap;
}

function card(tool, kind) {
  const [status, tone] = statusFor(tool, kind);
  const [recommendation, recommendationTone, explanation] = recommendationFor(tool, kind);
  const anomaly = candidateBelowCurrent(tool);
  const article = node('article', `tool-card ${tone}`);
  const head = node('div', 'card-head');
  const identity = node('div', 'identity');
  identity.append(node('span', 'kind', kind), node('h3', '', tool.name || '未知工具'));
  head.append(identity, node('span', `status ${tone}`, status));
  const versions = node('div', 'versions');
  versions.append(field('当前版本', tool.current), field('目标版本', anomaly ? null : tool.latest));
  const recommendationBox = node('div', `recommendation ${recommendationTone}`);
  recommendationBox.append(node('span', 'recommendation-label', `升级建议 · ${recommendation}`), node('p', 'advice', explanation));
  article.append(head, versions, recommendationBox, impactDetails(tool));
  if (anomaly) article.append(node('p', 'tool-note', `仓库 latest 候选：${tool.latest}`));
  if (tool.note) article.append(node('p', 'tool-note', tool.note));
  if (tool.upgrade_cmd && tool.outdated === true && !anomaly && recommendationTone !== 'blocked') {
    const command = node('div', 'command');
    command.append(node('span', 'field-label', '手动命令'), node('code', '', tool.upgrade_cmd));
    article.append(command);
  }
  return article;
}

function renderReport(report) {
  ecosystems.replaceChildren();
  let toolCount = 0;
  let updateCount = 0;
  let unknownCount = 0;
  let recommendedCount = 0;
  let reviewCount = 0;
  for (const item of ECOSYSTEMS) {
    const manager = report.managers?.[item.key];
    if (!manager) continue;
    const tools = item.tools(manager);
    const deps = item.deps ? item.deps(manager) : [];
    if (!tools.length && !deps.length) continue;
    toolCount += tools.length;
    updateCount += tools.filter((t) => ['update', 'review'].includes(statusFor(t, '工具')[1])).length;
    unknownCount += tools.filter((t) => ['unknown', 'anomaly'].includes(statusFor(t, '工具')[1])).length;
    recommendedCount += tools.filter((t) => recommendationFor(t, '工具')[1] === 'recommended').length;
    reviewCount += tools.filter((t) => ['review', 'blocked'].includes(recommendationFor(t, '工具')[1])).length;
    const section = node('section', 'ecosystem');
    const header = node('div', 'section-head');
    header.append(node('h2', '', item.title), node('span', 'section-count', `${tools.length} 个工具${deps.length ? ` / ${deps.length} 个依赖` : ''}`));
    section.append(header);
    const grid = node('div', 'card-grid');
    for (const tool of tools) grid.append(card(tool, '工具'));
    section.append(grid);
    if (deps.length) {
      const disclosure = node('details', 'dependencies');
      disclosure.append(node('summary', '', `查看 ${deps.length} 个依赖包`));
      const dependencyGrid = node('div', 'card-grid');
      for (const dep of deps) dependencyGrid.append(card(dep, '依赖'));
      disclosure.append(dependencyGrid);
      section.append(disclosure);
    }
    ecosystems.append(section);
  }
  if (!ecosystems.children.length) ecosystems.append(node('p', 'no-result', '没有发现可展示的 CLI 工具。请查看终端环境与 PATH。'));
  const date = new Date(report.generated_at);
  const checkedAt = Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN');
  summary.replaceChildren();
  for (const [value, label] of [[toolCount, '已发现工具'], [updateCount, '有可用更新'], [recommendedCount, '建议更新'], [reviewCount, '需核验或暂缓'], [unknownCount, '目标待核验']]) {
    const cell = node('div', 'summary-cell');
    cell.append(node('strong', '', value), node('span', '', label));
    summary.append(cell);
  }
  summary.append(node('p', 'summary-time', `检查时间：${checkedAt}。目标版本未显示时，不代表已经是最新。`));
  if (report.skipped?.length) {
    const skipped = node('p', 'skipped', `未检查：${report.skipped.join('；')}`);
    ecosystems.prepend(skipped);
  }
  summary.hidden = false;
}

async function loadReport() {
  if (typeof window.cliDoctorCheck === 'function') return window.cliDoctorCheck();
  const response = await fetch('/api/check', { method: 'POST', headers: { Accept: 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  errorBox.hidden = true;
  runState.textContent = '正在检查，联网查询可能需要几分钟…';
  try {
    renderReport(await loadReport());
    runState.textContent = '检查完成';
  } catch (error) {
    errorBox.textContent = `检查未完成：${error.message}`;
    errorBox.hidden = false;
    runState.textContent = '检查失败，可重试';
  } finally {
    button.disabled = false;
  }
});
