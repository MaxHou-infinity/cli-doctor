#!/usr/bin/env node
/**
 * cli-doctor — 本机 CLI 工具 / 依赖包版本现状检查器（只报不升）
 *
 * 用法:
 *   cli-doctor                 # 默认: 人类可读的分类 Markdown 报告
 *   cli-doctor --json         # 输出完整结构化 JSON（供 AI/Agent 解读）
 *   cli-doctor --no-update    # 跳过 brew update / 慢速刷新，只做查询
 *   cli-doctor --fast         # 快速模式: 各管理器均跳过耗时网络刷新
 *   cli-doctor --pypi-index <url>   # 指定 pip 镜像(默认 pypi.org, 失败自动切 tuna)
 *   cli-doctor install [--to <dir>] # 把配套 SKILL 安装进 agent skills 目录
 *
 * 设计: 无第三方依赖，Node >= 18。全部检查只读；升级永远由用户决定。
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ---------------------------------- 基础工具 ---------------------------------- */

function sh(cmd, args = [], opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), signal: r.signal };
}

function shOut(cmd, args, opts) {
  const r = sh(cmd, args, opts);
  return r.code === 0 ? r.out : '';
}

function which(bin) {
  const r = sh('sh', ['-lc', `command -v "${bin}"`], { timeout: 5000 });
  return r.code === 0 && r.out ? r.out.split('\n')[0] : null;
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function home() { return os.homedir(); }

function expand(p) { return p.replace(/^~/, home()); }

async function fetchText(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

function parseVersions(max) { // 简单数值/预发布友好的版本排序
  return (max || '0').split('.').map((s) => parseInt(s, 10) || 0);
}
function gtVer(a, b) {
  const A = parseVersions(a), B = parseVersions(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = A[i] || 0, y = B[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}
function normalizePackageName(name) {
  return String(name || '').trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/* ---------------------------------- 常量配置 ---------------------------------- */

const TUNA_PYPI = 'https://pypi.tuna.tsinghua.edu.cn/simple';
const PYPI = 'https://pypi.org/simple';

// 无统一升级渠道、自带更新机制的工具（探测到才列出；可被用户配置扩展）
const SELF_UPDATING = [
  { name: 'hermes',    hint: '仓库内自带更新（upstream pull + venv 安装）' },
  { name: 'agy',       hint: '官方安装脚本重装' },
  { name: 'bsk',       hint: '官方安装脚本/自更新' },
  { name: 'browse-now', hint: 'nowledge-mem 自带更新' },
  { name: 'luckin',    hint: 'luckin 自带 update 命令' },
];

/* ---------------------------------- 参数解析 ---------------------------------- */

const argv = process.argv.slice(2);
const FLAGS = {
  json: argv.includes('--json'),
  noUpdate: argv.includes('--no-update') || argv.includes('--fast'),
  fast: argv.includes('--fast'),
  pypiIndex: (() => {
    const i = argv.indexOf('--pypi-index');
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    return process.env.CLICHR_PYPI_INDEX || null;
  })(),
};

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`cli-doctor — 检查本机 CLI 工具与依赖包版本（只报不升）

用法:
  cli-doctor                         输出 Markdown 报告
  cli-doctor --json                  输出结构化 JSON
  cli-doctor --fast                  跳过网络刷新与版本比对
  cli-doctor --no-update             跳过 brew update
  cli-doctor --pypi-index <url>      指定 pip 镜像
  cli-doctor install --to <目录>     安装自包含 Skill（SKILL.md + bin/check.js）`);
  process.exit(0);
}

if (argv.includes('--version') || argv.includes('-v')) {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (argv[0] === 'install') return installCmd();

/* ---------------------------------- 各管理器采集 ---------------------------------- */

const report = {
  generated_at: new Date().toISOString(),
  scope: '本机 CLI 工具与依赖包版本现状（只读检查）',
  managers: {},
  skipped: [],
};

/* ---- Homebrew ---- */
function collectHomebrew() {
  const brew = which('brew');
  if (!brew) { report.skipped.push('Homebrew: 未安装'); return; }
  if (!FLAGS.noUpdate) {
    process.stderr.write('[brew] 刷新 formula 索引（可能 30~90s）...\n');
    sh('brew', ['update'], { timeout: 150000 }); // 失败不影响
  }
  const leavesRaw = shOut('brew', ['leaves']);
  const leaves = new Set(leavesRaw.split('\n').filter(Boolean).map((s) => s.trim()));

  // name (cur) < latest  或  name cur < latest
  const outdatedRaw = shOut('brew', ['outdated', '--verbose'], { timeout: 60000 });
  const outdated = {}; // name -> {current, latest}
  for (const line of outdatedRaw.split('\n')) {
    let m = line.match(/^(\S+)\s+\(([^)]+)\)\s*<\s*(.+)$/) || line.match(/^(\S+)\s+([^\s<]+)\s*<\s*(.+)$/);
    if (m) outdated[m[1]] = { current: m[2].trim(), latest: m[3].trim() };
  }

  const versions = {}; // name -> current installed version
  for (const line of shOut('brew', ['list', '--versions'], { timeout: 30000 }).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) versions[parts[0]] = parts[parts.length - 1];
  }

  const tools = [];
  for (const name of leaves) {
    const o = outdated[name];
    tools.push({
      name, current: o ? o.current : (versions[name] || '未知'),
      latest: o ? o.latest : null,
      outdated: !!o,
      upgrade_cmd: o ? `brew upgrade ${name}` : null,
    });
  }
  const deps = [];
  for (const name of Object.keys(outdated)) {
    if (leaves.has(name)) continue;
    const o = outdated[name];
    deps.push({ name, current: o.current, latest: o.latest, upgrade_cmd: `brew upgrade ${name}`, note: '由工具类包拖入的依赖库，通常随 brew upgrade 连带升级' });
  }
  report.managers.homebrew = {
    tools: tools.sort((a, b) => (b.outdated - a.outdated) || a.name.localeCompare(b.name)),
    deps,
    tool_count: tools.length,
    dep_count: deps.length,
    outdated_tool_count: tools.filter((t) => t.outdated).length,
    outdated_dep_count: deps.length,
    upgrade_all_cmd: 'brew upgrade',
    note: '依赖库无需单独升，brew upgrade 会自动连带。升级后如 postgresql 等服务在跑，需 brew services restart 对应项。',
  };
}

/* ---- npm 全局 ---- */
function collectNpm() {
  const npm = which('npm');
  if (!npm) { report.skipped.push('npm: 未安装'); return; }
  const root = shOut('npm', ['root', '-g'], { timeout: 10000 }); // 如 /opt/homebrew/lib/node_modules
  if (!root) { report.skipped.push('npm: 无法取得 global root'); return; }
  const tools = [];
  const lsRaw = shOut('npm', ['ls', '-g', '--depth=0', '--json=true'], { timeout: 30000 });
  let installed = {};
  try { installed = (JSON.parse(lsRaw).dependencies) || {}; } catch {}

  let outdatedRaw = '';
  if (!FLAGS.fast) {
    const r = sh('npm', ['outdated', '-g', '--json=true'], { timeout: 60000 });
    outdatedRaw = r.out; // npm outdated 退出码为 1 表示"有可升级"，stdout 仍有 JSON
  }
  let outdated = {};
  try { outdated = JSON.parse(outdatedRaw) || {}; } catch {}

  for (const name of Object.keys(installed)) {
    let ver = null;
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8'));
      ver = pj.version;
    } catch {}
    if (!ver) continue;
    const o = outdated[name];
    tools.push({
      name,
      current: ver,
      latest: o ? o.latest : null,
      outdated: !!o,
      major_jump: o ? (parseVersions(o.latest)[0] > parseVersions(ver)[0]) : false,
      upgrade_cmd: o ? `npm i -g ${name}@latest` : null,
    });
  }
  tools.sort((a, b) => (b.outdated - a.outdated) || a.name.localeCompare(b.name));
  report.managers.npm_global = {
    tools,
    deps: [],
    tool_count: tools.length,
    outdated_tool_count: tools.filter((t) => t.outdated).length,
    latest_checked: !FLAGS.fast,
    upgrade_all_cmd: 'npm i -g <需要升级的包>@latest（逐个）',
    note: 'npm 12+ 默认拦截 install 脚本；如升级后工具报错，按提示运行 npm i -g --allow-scripts=<pkg>。正在运行的 CLI（如 dsh 自身）建议避开运行期升级。',
  };
}

/* ---- Python / pip ---- */
function pythonBin() {
  const p3 = which('python3');
  if (!p3) return null;
  const r = sh(p3, ['-m', 'pip', '--version'], { timeout: 15000 });
  if (r.code !== 0) return null;
  // 返回真实解释器可执行文件路径（穿透 shim / 符号链接）
  const exe = shOut(p3, ['-c', 'import sys; print(sys.executable)'], { timeout: 8000 });
  return exe || p3;
}

function collectPython() {
  const py = pythonBin();
  if (!py) { report.skipped.push('Python/pip: python3 -m pip 不可用'); return; }

  // 已装包 + 是否提供 CLI（console_scripts 反查）
  const probe = sh(py, ['-c', `
import json, re
from importlib import metadata

def normalize(name):
    return re.sub(r'[-_.]+', '-', (name or '').strip().lower())

inst = {}
cli = {}
for dist in metadata.distributions():
    raw_name = dist.metadata.get('Name') or dist.name
    key = normalize(raw_name)
    inst[key] = {'name': raw_name, 'version': dist.version}
    for ep in dist.entry_points:
        if ep.group == 'console_scripts':
            cli.setdefault(key, []).append(ep.name)
print(json.dumps({'installed': inst, 'cli': cli}))
`], { timeout: 60000 });
  let envInfo = { installed: {}, cli: {} };
  try { envInfo = JSON.parse(probe.out || '{}'); } catch {}

  const cliDists = new Set(Object.keys(envInfo.cli || {}));

  // outdated（网络，较慢：逐包查版本；--fast 跳过）
  const index = FLAGS.pypiIndex || PYPI;
  let outdated = [];
  let mirrorUsed = index;
  if (FLAGS.fast) {
    mirrorUsed = '未检查(--fast，需联网核对)';
  } else {
    process.stderr.write('[pip] 正在比对已装包与镜像上的最新版本（241+ 包，需 1~3 分钟）...\n');
    const runOutdated = (idx) => {
      const r = sh(py, ['-m', 'pip', 'list', '--outdated', '--format=json', '-i', idx, '--timeout', '20', '--retries', '0'], { timeout: 300000 });
      if (r.code !== 0) return null;
      try { return JSON.parse(r.out); } catch { return null; }
    };
    outdated = runOutdated(index);
    if (!outdated && index !== TUNA_PYPI) {
      process.stderr.write('[pip] 主源失败，切换清华镜像重试...\n');
      mirrorUsed = TUNA_PYPI;
      outdated = runOutdated(TUNA_PYPI);
    }
    if (!outdated) outdated = [];
  }

  const byName = {};
  for (const o of outdated) byName[normalizePackageName(o.name)] = { current: o.version, latest: o.latest_version };

  const tools = [];
  const deps = [];
  for (const name of Object.keys(envInfo.installed)) {
    const info = envInfo.installed[name] || {};
    const cur = typeof info === 'string' ? info : info.version;
    const displayName = typeof info === 'string' ? name : (info.name || name);
    const o = byName[name];
    if (!cliDists.has(name)) continue; // 只枚举提供 CLI 的包进"工具类"
    tools.push({
      name: displayName,
      current: cur,
      latest: o ? o.latest : null,
      outdated: !!o,
      major_jump: o ? (parseVersions(o.latest)[0] > parseVersions(cur)[0]) : false,
      upgrade_cmd: o ? `pip3 install -U ${displayName} -i ${mirrorUsed}` : null,
      bin: (envInfo.cli[name] || []).join(','),
    });
  }
  for (const name of Object.keys(byName)) {
    if (cliDists.has(name)) continue;
    const o = byName[name];
    deps.push({
      name, current: o.current, latest: o.latest,
      upgrade_cmd: `pip3 install -U ${name} -i ${mirrorUsed}`,
      note: '库依赖；升级前注意其使用方(Requires-Dist)的版本锁定，避免"升 A 拆 B"',
    });
  }
  tools.sort((a, b) => (b.outdated - a.outdated) || a.name.localeCompare(b.name));
  report.managers.python_pip = {
    python: py,
    mirror_used: mirrorUsed,
    latest_checked: !FLAGS.fast,
    tools,
    deps: deps.sort((a, b) => a.name.localeCompare(b.name)),
    tool_count: tools.length,
    dep_total_installed: Object.keys(envInfo.installed).length,
    outdated_tool_count: tools.filter((t) => t.outdated).length,
    outdated_dep_count: deps.length,
    note: '分类依据: 提供 console_scripts 的包=工具类；其余=依赖类。锁链风险高（如 markitdown→magika、sympy→mpmath、openapi→jsonschema-path），勿无脑全升。',
  };
}

/* ---- Rust / Bun / uv ---- */
async function collectRustBunUv() {
  const m = { tools: [], deps: [], tool_count: 0, outdated_tool_count: 0, latest_checked: !FLAGS.fast };

  const rustc = which('rustc');
  if (rustc) {
    const raw = shOut('rustc', ['--version'], { timeout: 8000 });
    const v = (raw.match(/^rustc\s+([\d.]+[^\s]*)/) || [])[1] || raw;
    const active = shOut('rustup', ['show', 'active-toolchain'], { timeout: 8000 });
    m.tools.push({
      name: 'rustc/工具链', current: v || '未知', latest: null, outdated: null,
      upgrade_cmd: 'rustup update', category: 'rustup',
      note: `active: ${active || 'n/a'}；工具链更新走 rustup，组件无需单独升`,
    });
    const cargoList = shOut('cargo', ['install', '--list'], { timeout: 15000 });
    for (const line of cargoList.split('\n')) {
      const mm = line.match(/^(\S+)\s+v([\d.]+[^\s]*):/);
      if (!mm) continue;
      m.tools.push({
        name: `cargo:${mm[1]}`, current: mm[2], latest: null, outdated: null,
        upgrade_cmd: `cargo install ${mm[1]} --force`, category: 'cargo install',
        note: '最新版本未自动探测；可 cargo search <name> 或使用 cargo-install-update',
      });
    }
  } else {
    report.skipped.push('Rust: 未安装');
  }

  const bun = which('bun');
  if (bun) {
    const cur = shOut('bun', ['--version'], { timeout: 8000 });
    let latest = null;
    if (!FLAGS.fast) {
      const t = await fetchText('https://registry.npmjs.org/bun/latest', 6000);
      if (t) { try { latest = JSON.parse(t).version; } catch {} }
    }
    m.tools.push({
      name: 'bun', current: cur || '未知', latest, outdated: latest ? gtVer(latest, cur || '0') : null,
      upgrade_cmd: 'bun upgrade', category: 'bun',
    });
  } else {
    report.skipped.push('Bun: 未安装');
  }

  const uv = which('uv');
  if (uv) {
    const curRaw = shOut('uv', ['--version'], { timeout: 8000 });
    const cur = (curRaw.match(/uv ([\d.]+)/) || [])[1] || curRaw;
    let latest = FLAGS.fast ? null : await latestFromMirror('uv');
    m.tools.push({
      name: 'uv', current: cur || '未知', latest, outdated: latest ? gtVer(latest, cur || '0') : null,
      upgrade_cmd: 'uv self update', category: 'uv',
    });
    const toolRaw = shOut('uv', ['tool', 'list'], { timeout: 15000 });
    for (const line of toolRaw.split('\n')) {
      const mm = line.match(/^(\S+)\s+v([\d.]+[^\s]*)/);
      if (!mm) continue;
      let latest2 = FLAGS.fast ? null : await latestFromMirror(mm[1]);
      m.tools.push({
        name: `uv-tool:${mm[1]}`, current: mm[2], latest: latest2,
        outdated: latest2 ? gtVer(latest2, mm[2]) : null,
        upgrade_cmd: `uv tool upgrade ${mm[1]}`, category: 'uv tools',
      });
    }
  } else {
    report.skipped.push('uv: 未安装');
  }

  m.tool_count = m.tools.length;
  m.outdated_tool_count = m.tools.filter((t) => t.outdated).length;
  m.note = 'rustc 走 rustup update；bun 走 bun upgrade；uv 走 uv self update；uv 工具逐个 uv tool upgrade <name>。';
  report.managers.rust_bun_uv = m;
}

async function latestFromMirror(pkg) {
  // 优先 PyPI 主源，其次清华镜像
  for (const base of [PYPI, TUNA_PYPI]) {
    const html = await fetchText(`${base}/${pkg}/`, 7000);
    if (!html) continue;
    const vers = new Set();
    const re = new RegExp(pkg.replace(/[-_]/g, '[-_]') + '[-_](\\d+\\.\\d+[\\d.]*(?:[ab]\\d+|\\.post\\d+)?)', 'g');
    let mm;
    while ((mm = re.exec(html))) vers.add(mm[1]);
    if (vers.size) {
      let max = null;
      for (const v of vers) if (!max || gtVer(v, max)) max = v;
      return max;
    }
  }
  return null;
}

/* ---- 无统一升级渠道的 CLI ---- */
function collectSelfUpdating() {
  const found = [];
  const searchPaths = [path.join(home(), '.local', 'bin'), path.join(home(), '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const item of SELF_UPDATING) {
    let exe = which(item.name);
    if (!exe) {
      for (const p of searchPaths) {
        const f = path.join(p, item.name);
        if (exists(f)) { exe = f; break; }
      }
    }
    if (!exe) continue;
    let current = null;
    for (const flag of ['--version', '-v', 'version', '--help']) {
      const r = sh(exe, [flag], { timeout: 4000 });
      if (r.code === 0 && r.out) {
        current = r.out.split('\n')[0].slice(0, 80);
        break;
      }
      if (r.code === 0 && r.err) { current = r.err.split('\n')[0].slice(0, 80); break; }
    }
    found.push({
      name: item.name, current: current || '未知', latest: null, outdated: null,
      upgrade_cmd: '按官方渠道更新', note: item.hint,
    });
  }
  // 用户自定义扩展
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home(), '.config', 'cli-doctor', 'self-updating.json'), 'utf8'));
    for (const it of cfg.tools || []) {
      if (found.some((f) => f.name === it.name)) continue;
      const exe = which(it.name);
      if (!exe) continue;
      found.push({ name: it.name, current: '未知', latest: null, outdated: null, upgrade_cmd: it.upgrade || '按官方渠道更新', note: it.hint || '用户自定义' });
    }
  } catch {}
  report.managers.self_updating = {
    tools: found, deps: [], tool_count: found.length, outdated_tool_count: 0,
    note: '这类工具无统一升级渠道，通常自带 update 或需重装官方安装脚本；最新版本需各自确认。可在 ~/.config/cli-doctor/self-updating.json 扩展名单。',
  };
}

/* ---------------------------------- 输出 ---------------------------------- */

function fmtVer(v) { return v || '—'; }

function mdTable(rows) {
  if (!rows.length) return '  （无）';
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const heads = ['工具/包', '当前', '最新', '升级命令', '备注'];
  const lines = [['| ' + heads.join(' | ') + ' |', '|---|---|---|---|---|']];
  for (const r of rows) {
    lines.push(['| ' + [r.name, fmtVer(r.current), fmtVer(r.latest), esc(r.upgrade_cmd || '—'), esc(r.note || r.bin || '')].join(' | ') + ' |']);
  }
  return lines.map((l) => l.join('\n')).join('\n');
}

function markdown() {
  const L = [];
  const now = new Date(report.generated_at).toLocaleString('zh-CN');
  L.push(`# CLI 版本采集摘要（${now}）`);
  L.push('');
  L.push(`> 只读检查，未做任何升级。升级请逐项人工确认。`);
  L.push(`> 配套 Agent Skill 会读取 \`--json\`，补充作用、耦合与风险后再生成七字段最终报告。`);

  const toolSections = [];
  const depSections = [];

  /* ---- 工具类 ---- */
  const mHomebrew = report.managers.homebrew;
  const mNpm = report.managers.npm_global;
  const mPip = report.managers.python_pip;
  const mRust = report.managers.rust_bun_uv;
  const mSelf = report.managers.self_updating;

  if (mHomebrew) {
    const upd = mHomebrew.tools.filter((t) => t.outdated);
    const ok = mHomebrew.tools.filter((t) => !t.outdated);
    let s = '### Homebrew（工具 ' + mHomebrew.tool_count + ' 个';
    s += upd.length ? '，**' + upd.length + ' 个可升级**）' : '，全部最新 ✅）';
    toolSections.push([s, mdTable(upd), ok.length ? '已最新：' + ok.map((t) => t.name).join('、') : '']);
  }
  if (mNpm) {
    const upd = mNpm.tools.filter((t) => t.outdated);
    const ok = mNpm.tools.filter((t) => !t.outdated);
    let s = `### npm 全局（工具 ${mNpm.tool_count} 个`;
    s += upd.length ? `，**${upd.length} 个可升级**）` : (mNpm.latest_checked === false ? '，未联网核对）' : '，全部最新 ✅）');
    toolSections.push([s, mdTable(upd.map((t) => ({ ...t, note: t.major_jump ? '⚠️ 大版本跳跃' : (t.note || '') }))), ok.length ? (mNpm.latest_checked === false ? `已安装（未核对最新版本）：${ok.map((t) => t.name).join('、')}` : `已最新：${ok.map((t) => t.name).join('、')}`) : '']);
  }
  if (mPip) {
    const upd = mPip.tools.filter((t) => t.outdated);
    const ok = mPip.tools.filter((t) => !t.outdated);
    let s = `### Python/pip — ${mPip.python || 'python3'}（工具 ${mPip.tool_count} 个`;
    s += upd.length ? `，**${upd.length} 个可升级**；镜像: ${mPip.mirror_used}）` : (mPip.latest_checked === false ? `，未联网核对；镜像: ${mPip.mirror_used}）` : `，全部最新 ✅；镜像: ${mPip.mirror_used}）`);
    toolSections.push([s, mdTable(upd.map((t) => ({ ...t, note: (t.major_jump ? '⚠️ 大版本跳跃 ' : '') + '命令: ' + (t.bin || '') }))), ok.length ? (mPip.latest_checked === false ? `已安装（CLI 类，未核对最新版本）：${ok.map((t) => t.name).join('、')}` : `已最新（CLI 类）：${ok.map((t) => t.name).join('、')}`) : '']);
  }
  if (mRust) {
    const upd = mRust.tools.filter((t) => t.outdated);
    const unk = mRust.tools.filter((t) => t.outdated === null);
    toolSections.push([`### Rust / Bun / uv（工具 ${mRust.tool_count} 个${upd.length ? `，**${upd.length} 个可升级**` : ''}${unk.length ? `，${unk.length} 个需自查` : ''}）`, mdTable(mRust.tools)]);
  }
  if (mSelf) {
    toolSections.push([`### 无统一升级渠道的 CLI（${mSelf.tool_count} 个，需各自自查）`, mdTable(mSelf.tools)]);
  }

  /* ---- 依赖包类 ---- */
  if (mHomebrew && mHomebrew.dep_count) {
    depSections.push([`### Homebrew 依赖库（${mHomebrew.dep_count} 个可升级）`, mdTable(mHomebrew.deps.slice(0, 12)) + (mHomebrew.dep_count > 12 ? `\n…共 ${mHomebrew.dep_count} 项（` + mHomebrew.deps.map((d) => d.name).join('、') + '）' : '')]);
  }
  if (mPip && mPip.outdated_dep_count) {
    depSections.push([`### Python/pip 依赖库（${mPip.outdated_dep_count} 个可升级）`, mdTable(mPip.deps.slice(0, 12)) + (mPip.outdated_dep_count > 12 ? `\n…共 ${mPip.outdated_dep_count} 项，完整见 --json` : '')]);
  }
  if (mPip && !mPip.outdated_dep_count) {
    depSections.push(['### Python/pip 依赖库', mPip.latest_checked === false ? '  未联网核对，完整状态请去掉 `--fast` 后复查。' : '  全部最新 ✅']);
  }

  L.push('## 一、工具类');
  L.push('');
  if (toolSections.length === 0) L.push('（未探测到已安装的包管理器）');
  for (const [head, body, extra] of toolSections) {
    L.push(head); L.push(''); L.push(body); if (extra) { L.push(''); L.push(extra); } L.push('');
  }
  L.push('## 二、依赖包类');
  L.push('');
  if (depSections.length === 0) L.push('（无可升级依赖）');
  for (const [head, body] of depSections) { L.push(head); L.push(''); L.push(body); L.push(''); }

  L.push('## 三、升级前须知');
  L.push('');
  L.push('- 升级决定权在你：本报告不执行任何升级。可让 AI 对每个待升项补充「作用说明 / 耦合关系 / 风险」后再决定。');
  L.push('- 常见风险：⚠️ 大版本跳跃（配置/命令可能变化）；锁版本链（某工具把共享库锁死在旧版）；正在运行的 CLI 自身（避开运行期升级）；npm 12+ 的 install 脚本拦截；升级 brew 服务类（如 postgresql）后需重启服务。');
  L.push(`- 跳过项：${report.skipped.length ? report.skipped.join('；') : '无'}`);
  L.push('');
  return L.join('\n');
}

/* ---------------------------------- install 子命令 ---------------------------------- */

function installCmd() {
  let to = null;
  const i = argv.indexOf('--to');
  if (i >= 0 && argv[i + 1]) to = expand(argv[i + 1]);
  if (!to) {
    const cands = [
      path.join(home(), '.claude', 'skills'),
      path.join(home(), '.hermes', 'skills'),
      path.join(home(), '.config', 'skills'),
    ];
    for (const c of cands) { if (exists(c)) { to = c; break; } }
    if (!to) to = path.join(home(), '.claude', 'skills');
  }
  const src = path.join(__dirname, '..');
  const dst = path.join(to, 'cli-doctor');
  fs.mkdirSync(dst, { recursive: true });
  const files = ['SKILL.md', path.join('bin', 'check.js'), 'package.json'];
  for (const f of files) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (!exists(s)) { console.error(`缺少文件: ${s}`); process.exit(1); }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
  }
  console.log(`✅ Skill 已安装到 ${dst}`);
  console.log('包含: ' + files.join(', '));
  console.log('若你的 agent 使用其它 skills 目录，请用 --to <目录> 重装。');
  process.exit(0);
}

/* ---------------------------------- 主流程 ---------------------------------- */

(async () => {
  const t0 = Date.now();
  collectHomebrew();
  collectNpm();
  collectPython();
  await collectRustBunUv();
  collectSelfUpdating();
  report.elapsed_ms = Date.now() - t0;

  if (FLAGS.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(markdown() + `\n（耗时 ${(report.elapsed_ms / 1000).toFixed(1)}s）\n`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('运行出错: ' + (e && e.stack || e));
  process.exit(1);
});
