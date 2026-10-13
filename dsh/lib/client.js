window.__ModuleLoader__.load({ id: "dsh-cli-doctor", factory: (require) => {
	var module = { exports: {} };
	var exports = module.exports;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __export = (target, all) => {
	  for (var name in all)
	    __defProp(target, name, { get: all[name], enumerable: true });
	};
	var __copyProps = (to, from, except, desc) => {
	  if (from && typeof from === "object" || typeof from === "function") {
	    for (let key of __getOwnPropNames(from))
	      if (!__hasOwnProp.call(to, key) && key !== except)
	        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
	  }
	  return to;
	};
	var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

	// src/client/index.jsx
	var index_exports = {};
	__export(index_exports, {
	  CliDoctorIcon: () => CliDoctorIcon,
	  CliDoctorPanel: () => CliDoctorPanel,
	  PANEL_ID: () => PANEL_ID,
	  PANEL_LABEL: () => PANEL_LABEL,
	  PANEL_ORDER: () => PANEL_ORDER,
	  apply: () => apply,
	  inject: () => inject
	});
	module.exports = __toCommonJS(index_exports);

	// src/client/icon.jsx
	var import_jsx_runtime = require("react/jsx-runtime");
	function CliDoctorIcon({ size = 16, active = false } = {}) {
	  const edge = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 16;
	  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
	    "svg",
	    {
	      "data-dsh-panel-entry": "cli-doctor",
	      viewBox: "0 0 16 16",
	      width: edge,
	      height: edge,
	      fill: "none",
	      stroke: "currentColor",
	      strokeWidth: active ? 1.6 : 1.3,
	      strokeLinecap: "round",
	      strokeLinejoin: "round",
	      "aria-hidden": "true",
	      focusable: "false",
	      children: [
	        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("rect", { x: "1.75", y: "2.25", width: "12.5", height: "11.5", rx: "2" }),
	        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M4.5 6.25l2 1.75-2 1.75" }),
	        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8.5 10.25h3" })
	      ]
	    }
	  );
	}

	// src/client/panel.jsx
	var import_react = require("react");

	// src/client/api.js
	var CHECK_ENDPOINT = "/api/cli-doctor/check";
	var HEALTH_ENDPOINT = "/api/cli-doctor/health";
	var CliDoctorRequestError = class extends Error {
	  /**
	   * @param message - user-facing reason.
	   * @param options - `code` (machine branch), `status` (HTTP status if any) and
	   *   `hostCode` (the Host's own `error` short code, verbatim).
	   */
	  constructor(message, options = {}) {
	    super(message);
	    this.name = "CliDoctorRequestError";
	    this.code = options.code || "error";
	    this.status = typeof options.status === "number" ? options.status : null;
	    this.hostCode = typeof options.hostCode === "string" && options.hostCode ? options.hostCode : null;
	  }
	};
	function resolveFetch(override) {
	  if (typeof override === "function") return override;
	  const impl = globalThis.fetch;
	  if (typeof impl !== "function") {
	    throw new CliDoctorRequestError("当前环境不支持 fetch，无法连接诊断服务。", { code: "no-fetch" });
	  }
	  return impl;
	}
	async function readJson(response) {
	  if (!response || typeof response.json !== "function") return null;
	  try {
	    const payload = await response.json();
	    return payload && typeof payload === "object" ? payload : null;
	  } catch {
	    return null;
	  }
	}
	function errorText(error) {
	  if (error && typeof error.message === "string" && error.message) return error.message;
	  return String(error);
	}
	var HOST_ERROR_TEXT = {
	  forbidden: "请求被拒绝：面板未获得本机授权，请从本机 DSH 界面重试。",
	  method: "诊断服务不接受该请求方法。",
	  "not-found": "未找到诊断服务：Host 半体可能没有加载。",
	  busy: "已有一次诊断正在进行中，请稍候再试。",
	  timeout: "诊断超时（超过 8 分钟仍未结束），请稍后重试。",
	  "output-too-large": "诊断输出超过安全上限，已被中止。",
	  "invalid-json": "诊断返回的内容不是合法 JSON，无法解析。",
	  "spawn-error": "无法启动诊断子进程（check.js 可能缺失或不可执行）。"
	};
	function failureMessage(status, reason) {
	  const code = typeof reason === "string" ? reason.trim() : "";
	  if (code && Object.prototype.hasOwnProperty.call(HOST_ERROR_TEXT, code)) return HOST_ERROR_TEXT[code];
	  if (/^exit-\d+$/.test(code)) return `诊断进程以退出码 ${code.slice("exit-".length)} 结束。`;
	  if (/^signal-[A-Za-z0-9]+$/.test(code)) return `诊断进程被信号 ${code.slice("signal-".length)} 终止。`;
	  if (code) return `诊断失败：${code}`;
	  if (status === 409) return HOST_ERROR_TEXT.busy;
	  if (status === 403) return HOST_ERROR_TEXT.forbidden;
	  if (status === 404) return HOST_ERROR_TEXT["not-found"];
	  if (status === 405) return HOST_ERROR_TEXT.method;
	  if (status >= 500) return "诊断服务内部错误，请查看 DSH 日志后重试。";
	  if (status > 0) return `诊断请求失败（HTTP ${status}）。`;
	  return "诊断请求失败。";
	}
	function failureCode(status, reason) {
	  const code = typeof reason === "string" ? reason.trim() : "";
	  if (status === 409 || code === "busy") return "busy";
	  return code ? "host" : "http";
	}
	async function checkStatus(options = {}) {
	  const send = resolveFetch(options.fetch);
	  let response;
	  try {
	    response = await send(CHECK_ENDPOINT, {
	      method: "POST",
	      headers: { Accept: "application/json" },
	      signal: options.signal
	    });
	  } catch (error) {
	    if (error && error.name === "AbortError") throw error;
	    throw new CliDoctorRequestError(`无法连接诊断服务：${errorText(error)}`, { code: "network" });
	  }
	  const payload = await readJson(response);
	  const status = response && typeof response.status === "number" ? response.status : 0;
	  const reason = payload ? payload.error : null;
	  if (response && response.ok === false) {
	    throw new CliDoctorRequestError(failureMessage(status, reason), {
	      code: failureCode(status, reason),
	      status,
	      hostCode: typeof reason === "string" ? reason : null
	    });
	  }
	  if (payload && payload.ok === false) {
	    throw new CliDoctorRequestError(failureMessage(status, reason), {
	      code: failureCode(status, reason),
	      status,
	      hostCode: typeof reason === "string" ? reason : null
	    });
	  }
	  const report = payload ? payload.report : null;
	  if (!report || typeof report !== "object" || Array.isArray(report)) {
	    throw new CliDoctorRequestError("诊断服务返回的数据无法识别（report 缺失或不是对象）。", { code: "malformed", status });
	  }
	  return {
	    report,
	    checkedAt: payload && typeof payload.checkedAt === "string" ? payload.checkedAt : null
	  };
	}
	async function fetchHealth(options = {}) {
	  let send;
	  try {
	    send = resolveFetch(options.fetch);
	  } catch {
	    return null;
	  }
	  try {
	    const response = await send(HEALTH_ENDPOINT, {
	      method: "GET",
	      headers: { Accept: "application/json" },
	      signal: options.signal
	    });
	    const payload = await readJson(response);
	    if (!payload) return null;
	    return {
	      ok: payload.ok === true,
	      version: typeof payload.version === "string" && payload.version ? payload.version : null,
	      busy: payload.busy === true
	    };
	  } catch {
	    return null;
	  }
	}

	// src/client/view.js
	var MANAGERS = [
	  { key: "homebrew", title: "Homebrew" },
	  { key: "npm_global", title: "npm 全局" },
	  { key: "python_pip", title: "Python / pip" },
	  { key: "rust_bun_uv", title: "Rust / Bun / uv" },
	  { key: "self_updating", title: "独立更新工具" }
	];
	var KIND_TOOL = "工具";
	var KIND_DEP = "依赖";
	var SUMMARY_FIELDS = [
	  ["toolCount", "已发现工具"],
	  ["updateCount", "有可用更新"],
	  ["recommendedCount", "建议更新"],
	  ["reviewCount", "需核验或暂缓"],
	  ["unknownCount", "目标待核验"]
	];
	function versionHead(value) {
	  if (typeof value !== "string" && typeof value !== "number") return null;
	  const match = String(value).match(/^\d+(?:\.\d+){1,3}/);
	  return match ? match[0] : null;
	}
	function asArray(value) {
	  return Array.isArray(value) ? value : [];
	}
	function asRecord(value) {
	  return value && typeof value === "object" ? value : {};
	}
	function candidateBelowCurrent(item) {
	  const tool = asRecord(item);
	  const current = versionHead(tool.current);
	  const latest = versionHead(tool.latest);
	  if (!current || !latest) return false;
	  const left = current.split(".").map(Number);
	  const right = latest.split(".").map(Number);
	  for (let i = 0; i < Math.max(left.length, right.length); i++) {
	    if ((right[i] || 0) !== (left[i] || 0)) return (right[i] || 0) < (left[i] || 0);
	  }
	  return false;
	}
	function statusFor(item, kind) {
	  const tool = asRecord(item);
	  if (candidateBelowCurrent(tool)) return ["版本线异常", "anomaly"];
	  if (tool.outdated === true || kind === KIND_DEP && tool.latest) return ["有可用更新", "update"];
	  if (tool.outdated == null || !tool.latest) return ["目标待核验", "unknown"];
	  return ["未检出更新", "steady"];
	}
	function recommendationFor(item, kind) {
	  const tool = asRecord(item);
	  const impact = asRecord(tool.impact);
	  const hasImpact = tool.impact != null && typeof tool.impact === "object";
	  const dependents = asArray(impact.dependents).length;
	  const indirect = asArray(impact.indirect).length;
	  const conflicts = asArray(impact.conflicts).length;
	  const uncertain = asArray(impact.uncertain).length;
	  const scope = typeof impact.scope === "string" ? impact.scope : "";
	  const pythonScope = scope.startsWith("当前 Python");
	  if (candidateBelowCurrent(tool)) return ["暂不建议", "blocked", "候选版本低于已装版本，先核对发布频道和版本线。"];
	  if (tool.outdated == null || !tool.latest) return ["无法判断", "unknown", "尚无可靠目标版本，无法判断升级影响。"];
	  if (tool.outdated === false) return ["无需更新", "steady", "本次未检出新版本。"];
	  if (!(hasImpact && impact.checked)) return ["影响待核验", "review", "依赖关系没有完成检查，不能仅凭新版本就建议升级。"];
	  if (conflicts) return ["暂不建议", "blocked", `目标版本不满足 ${conflicts} 个已安装项目的声明约束。`];
	  if (uncertain) return ["需人工核验", "review", "存在无法确认的可选依赖、版本约束或安装方式。"];
	  if (impact.operational_review) return ["需兼容验证", "review", String(impact.operational_review)];
	  if (kind === KIND_DEP && (dependents || indirect)) return ["需人工核验", "review", "共享依赖被其他已安装项目使用，应结合上层工具一起升级。"];
	  if (tool.major_jump && (dependents || indirect)) return ["需兼容验证", "review", "跨大版本且有已安装项目直接或间接依赖它；版本约束通过仍不能证明 API 兼容。"];
	  if (tool.major_jump) return ["需兼容验证", "review", "未发现已装项目的声明依赖冲突；大版本自身的命令、配置和项目用法仍需核验。"];
	  if ((dependents || indirect) && !pythonScope) return ["需兼容验证", "review", "有其他已安装工具依赖它；当前尚未模拟目标版的安装与运行。"];
	  const scopeLabel = pythonScope ? "当前 Python 环境" : "已检查的安装范围";
	  return ["建议更新", "recommended", dependents || indirect ? `${scopeLabel}内的已装项目未发现目标版本约束冲突。请留意工具自身的配置和运行方式。` : `${scopeLabel}内未发现其他已装项目声明依赖此工具。${tool.major_jump ? "这是大版本更新，执行前仍应核对自身配置变化。" : ""}`];
	}
	function impactView(item) {
	  const tool = asRecord(item);
	  const impact = asRecord(tool.impact);
	  const counts = {
	    dependents: asArray(impact.dependents).length,
	    indirect: asArray(impact.indirect).length,
	    uncertain: asArray(impact.uncertain).length
	  };
	  if (!(tool.impact != null && typeof tool.impact === "object" && impact.checked)) {
	    return { checked: false, scope: null, counts, entries: [], hasEntries: false };
	  }
	  const conflictKeys = new Set(asArray(impact.conflicts).map((entry) => asRecord(entry)).map((entry) => `${entry.name}\0${entry.requirement}`));
	  const entries = [];
	  for (const raw of asArray(impact.dependents)) {
	    const entry = asRecord(raw);
	    const conflict = conflictKeys.has(`${entry.name}\0${entry.requirement}`);
	    entries.push({
	      tone: conflict ? "conflict" : "plain",
	      text: `${entry.name ?? "未知依赖"}${entry.version ? ` ${entry.version}` : ""}${entry.requirement ? ` · ${entry.requirement}` : ""}${conflict ? " · 与目标版本冲突" : ""}`
	    });
	  }
	  for (const raw of asArray(impact.indirect)) {
	    const entry = asRecord(raw);
	    entries.push({ tone: "indirect", text: `${entry.name ?? "未知依赖"}${entry.version ? ` ${entry.version}` : ""} · 间接依赖` });
	  }
	  for (const raw of asArray(impact.uncertain)) {
	    const entry = asRecord(raw);
	    entries.push({
	      tone: "uncertain",
	      text: `${entry.name ?? "未知依赖"}${entry.requirement ? ` · ${entry.requirement}` : ""} · ${entry.reason || "待核验"}`
	    });
	  }
	  return {
	    checked: true,
	    scope: typeof impact.scope === "string" && impact.scope ? impact.scope : null,
	    counts,
	    entries,
	    hasEntries: entries.length > 0
	  };
	}
	function groupReport(report) {
	  const managers = asRecord(asRecord(report).managers);
	  const blocks = [];
	  for (const spec of MANAGERS) {
	    const manager = managers[spec.key];
	    if (!manager || typeof manager !== "object") continue;
	    const tools = asArray(manager.tools);
	    const deps = asArray(manager.deps);
	    if (!tools.length && !deps.length) continue;
	    let updateCount = 0;
	    for (const tool of tools) {
	      if (["update", "review"].includes(statusFor(tool, KIND_TOOL)[1])) updateCount += 1;
	    }
	    blocks.push({ key: spec.key, title: spec.title, tools, deps, updateCount });
	  }
	  return blocks;
	}
	function summarize(report) {
	  let toolCount = 0;
	  let updateCount = 0;
	  let unknownCount = 0;
	  let recommendedCount = 0;
	  let reviewCount = 0;
	  const blocks = groupReport(report);
	  for (const block of blocks) {
	    for (const tool of block.tools) {
	      toolCount += 1;
	      if (["update", "review"].includes(statusFor(tool, KIND_TOOL)[1])) updateCount += 1;
	      if (["unknown", "anomaly"].includes(statusFor(tool, KIND_TOOL)[1])) unknownCount += 1;
	      if (recommendationFor(tool, KIND_TOOL)[1] === "recommended") recommendedCount += 1;
	      if (["review", "blocked"].includes(recommendationFor(tool, KIND_TOOL)[1])) reviewCount += 1;
	    }
	  }
	  return { toolCount, updateCount, unknownCount, recommendedCount, reviewCount, blocks };
	}
	function skippedChecks(report) {
	  return asArray(asRecord(report).skipped).filter((entry) => typeof entry === "string" && entry);
	}
	function formatTimestamp(value) {
	  if (value == null || value === "") return "时间未知";
	  const date = new Date(value);
	  if (Number.isNaN(date.getTime())) return "时间未知";
	  try {
	    return date.toLocaleString("zh-CN");
	  } catch {
	    return date.toISOString();
	  }
	}
	function formatDuration(ms) {
	  if (ms == null || ms === "") return "耗时未知";
	  const value = Number(ms);
	  if (!Number.isFinite(value) || value < 0) return "耗时未知";
	  if (value < 1e3) return `${Math.round(value)} 毫秒`;
	  const seconds = value / 1e3;
	  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
	  const minutes = Math.floor(seconds / 60);
	  const rest = Math.round(seconds - minutes * 60);
	  return `${minutes} 分 ${rest} 秒`;
	}
	function formatScope(report) {
	  const scope = asRecord(report).scope;
	  return typeof scope === "string" && scope ? scope : "未标注";
	}

	// src/client/panel.jsx
	var import_jsx_runtime2 = require("react/jsx-runtime");
	var BUILD_VERSION = "0.2.0" ? "0.2.0" : null;
	var TONES = {
	  anomaly: "#b45309",
	  update: "#2563eb",
	  steady: "inherit",
	  unknown: "#a16207",
	  recommended: "#047857",
	  review: "#b45309",
	  blocked: "#b91c1c"
	};
	var STATE_LABELS = {
	  idle: "空闲",
	  running: "诊断中",
	  done: "诊断完成",
	  error: "诊断失败"
	};
	var MUTED = "rgba(127,127,127,0.9)";
	var HAIRLINE = "1px solid rgba(127,127,127,0.28)";
	var S = {
	  // The main slot's occupant must fill the center column itself: the shell's
	  // column is `display:flex; overflow:hidden`, so a panel that only grows with
	  // its content is clipped and can never show a scrollbar. `flex: 1 1 auto` is
	  // kept alongside `height: 100%` so the panel fills the remaining space no
	  // matter how the parent resolves its own height.
	  root: {
	    boxSizing: "border-box",
	    display: "flex",
	    flexDirection: "column",
	    flex: "1 1 auto",
	    height: "100%",
	    minHeight: 0,
	    minWidth: 0,
	    gap: "12px",
	    padding: "16px",
	    width: "100%",
	    color: "var(--dsw-alias-label-primary, inherit)",
	    background: "var(--dsw-alias-bg-base, transparent)",
	    fontSize: "13px",
	    lineHeight: 1.55,
	    fontFamily: "inherit"
	  },
	  header: {
	    flexShrink: 0,
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    justifyContent: "space-between",
	    gap: "10px",
	    paddingBottom: "10px",
	    borderBottom: HAIRLINE
	  },
	  headerMain: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: "160px" },
	  // The only scroll container: everything below the fixed header lives here so
	  // a long report can always be scrolled to its last card. `minHeight: 0` is
	  // what lets a flex child actually shrink and scroll instead of overflowing.
	  body: {
	    flex: "1 1 auto",
	    minHeight: 0,
	    minWidth: 0,
	    display: "flex",
	    flexDirection: "column",
	    gap: "12px",
	    paddingRight: "8px",
	    overflowY: "auto",
	    overflowX: "hidden",
	    overscrollBehavior: "contain"
	  },
	  title: { margin: 0, fontSize: "16px", fontWeight: 600 },
	  version: { color: MUTED, fontSize: "12px" },
	  headerActions: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
	  state: { color: MUTED, fontSize: "12px" },
	  button: {
	    padding: "6px 14px",
	    borderRadius: "6px",
	    border: HAIRLINE,
	    background: "transparent",
	    color: "inherit",
	    fontSize: "13px",
	    fontFamily: "inherit",
	    cursor: "pointer"
	  },
	  buttonBusy: { cursor: "progress", opacity: 0.65 },
	  progress: { color: MUTED, fontSize: "12px" },
	  alert: {
	    border: "1px solid rgba(185,28,28,0.5)",
	    borderRadius: "6px",
	    padding: "10px 12px",
	    color: "#b91c1c",
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    gap: "10px"
	  },
	  hint: { color: MUTED, margin: 0 },
	  summary: {
	    display: "flex",
	    flexWrap: "wrap",
	    gap: "8px"
	  },
	  summaryCell: {
	    flex: "1 1 110px",
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "8px 10px",
	    display: "flex",
	    flexDirection: "column",
	    gap: "2px"
	  },
	  summaryValue: { fontSize: "18px", fontWeight: 600 },
	  summaryLabel: { color: MUTED, fontSize: "12px" },
	  meta: { color: MUTED, fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "12px", margin: 0 },
	  skipped: { color: MUTED, fontSize: "12px", margin: 0 },
	  section: { border: HAIRLINE, borderRadius: "8px", padding: "12px" },
	  sectionHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "10px", marginBottom: "6px" },
	  sectionTitle: { margin: 0, fontSize: "14px", fontWeight: 600 },
	  sectionCount: { color: MUTED, fontSize: "12px" },
	  layerLabel: { fontSize: "12px", color: MUTED, margin: "6px 0 4px" },
	  cards: { display: "flex", flexDirection: "column", gap: "8px" },
	  card: { border: HAIRLINE, borderRadius: "6px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px" },
	  cardHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" },
	  identity: { display: "flex", alignItems: "baseline", gap: "8px" },
	  kind: { color: MUTED, fontSize: "11px", border: HAIRLINE, borderRadius: "4px", padding: "0 5px" },
	  name: { margin: 0, fontSize: "13px", fontWeight: 600 },
	  tag: { border: HAIRLINE, borderRadius: "999px", padding: "1px 9px", fontSize: "12px", whiteSpace: "nowrap" },
	  versions: { display: "flex", flexWrap: "wrap", gap: "16px" },
	  field: { display: "flex", flexDirection: "column", gap: "1px" },
	  fieldLabel: { color: MUTED, fontSize: "11px" },
	  fieldValue: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
	  recommendation: { display: "flex", flexDirection: "column", gap: "2px" },
	  recommendationLabel: { fontSize: "12px", fontWeight: 600 },
	  advice: { margin: 0, fontSize: "12px", color: MUTED },
	  impactScope: { margin: 0, fontSize: "12px", color: MUTED },
	  impactNone: { margin: 0, fontSize: "12px", color: MUTED },
	  details: { fontSize: "12px" },
	  detailsSummary: { cursor: "pointer", color: MUTED },
	  list: { margin: "6px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "2px" },
	  note: { margin: 0, fontSize: "12px", color: MUTED },
	  command: { display: "flex", flexDirection: "column", gap: "1px" },
	  code: {
	    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
	    fontSize: "12px",
	    border: HAIRLINE,
	    borderRadius: "4px",
	    padding: "3px 6px",
	    wordBreak: "break-all",
	    background: "transparent"
	  },
	  deps: { marginTop: "6px" },
	  footer: { color: MUTED, fontSize: "12px", margin: 0, borderTop: HAIRLINE, paddingTop: "8px" },
	  empty: { color: MUTED, margin: 0 }
	};
	function displayVersion(value) {
	  if (typeof value === "string" && value) return value;
	  if (typeof value === "number" && Number.isFinite(value)) return String(value);
	  return "未核验";
	}
	function noteText(value) {
	  if (typeof value === "string" && value) return value;
	  if (typeof value === "number" && Number.isFinite(value)) return String(value);
	  return null;
	}
	function Tag({ label, tone }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...S.tag, color: TONES[tone] || "inherit" }, children: label });
	}
	function Field({ label, value }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: S.field, children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.fieldLabel, children: label }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.fieldValue, children: value })
	  ] });
	}
	function ImpactBlock({ impact }) {
	  if (!impact.checked) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.impactScope, children: "依赖检查：未完成或该生态暂不支持。" });
	  const { counts } = impact;
	  const hasConflict = impact.entries.some((entry) => entry.tone === "conflict");
	  const summary = `直接依赖 ${counts.dependents} 个 · 间接依赖 ${counts.indirect} 个${counts.uncertain ? ` · 待核验 ${counts.uncertain} 项` : ""}`;
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.impactScope, children: `已检查：${impact.scope || "范围未标注"}。未扫描其他项目目录或虚拟环境。` }),
	    impact.hasEntries ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: S.details, open: hasConflict, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: S.detailsSummary, children: summary }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("ul", { style: S.list, children: impact.entries.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	        "li",
	        {
	          style: entry.tone === "conflict" ? { color: TONES.blocked } : entry.tone === "uncertain" ? { color: TONES.review } : void 0,
	          children: entry.text
	        },
	        `${index}-${entry.text}`
	      )) })
	    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.impactNone, children: "未发现已装项目声明依赖此工具。" })
	  ] });
	}
	function ToolCard({ item, kind }) {
	  const tool = item && typeof item === "object" ? item : {};
	  const [status, tone] = statusFor(tool, kind);
	  const [recommendation, recommendationTone, explanation] = recommendationFor(tool, kind);
	  const impact = impactView(tool);
	  const anomaly = candidateBelowCurrent(tool);
	  const name = noteText(tool.name) || "未知工具";
	  const latest = displayVersion(tool.latest);
	  const command = noteText(tool.upgrade_cmd);
	  const note = noteText(tool.note);
	  const versionLineNote = noteText(tool.version_line_anomaly);
	  const showCommand = Boolean(command) && tool.outdated === true && !anomaly && recommendationTone !== "blocked";
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { style: S.card, children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.cardHead, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.identity, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.kind, children: kind }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h4", { style: S.name, children: name })
	      ] }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Tag, { label: status, tone })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.versions, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: "当前版本", value: displayVersion(tool.current) }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Field, { label: "目标版本", value: latest })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { ...S.recommendation, color: TONES[recommendationTone] || "inherit" }, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.recommendationLabel, children: `升级建议 · ${recommendation}` }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.advice, children: explanation })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ImpactBlock, { impact }),
	    anomaly ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.note, children: `仓库 latest 候选：${latest}` }) : null,
	    versionLineNote ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.note, children: `版本线提示：${versionLineNote}` }) : null,
	    note ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.note, children: note }) : null,
	    showCommand ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.command, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.fieldLabel, children: "手动命令" }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { style: S.code, children: command })
	    ] }) : null
	  ] });
	}
	function SummaryBar({ counts }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.summary, children: SUMMARY_FIELDS.map(([field, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.summaryCell, children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: S.summaryValue, children: counts[field] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.summaryLabel, children: label })
	  ] }, field)) });
	}
	function EcosystemBlock({ block }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: S.section, children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.sectionHead, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: S.sectionTitle, children: block.title }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.sectionCount, children: `${block.tools.length} 个工具${block.deps.length ? ` / ${block.deps.length} 个依赖` : ""}` }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...S.sectionCount, color: "inherit" }, children: `有可用更新 ${block.updateCount}` })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.layerLabel, children: "工具类" }),
	    block.tools.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cards, children: block.tools.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ToolCard, { item, kind: KIND_TOOL }, `tool-${index}`)) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.empty, children: "本生态未发现工具。" }),
	    block.deps.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: S.deps, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: S.detailsSummary, children: `依赖包类 · 查看 ${block.deps.length} 个依赖` }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.cards, marginTop: "8px" }, children: block.deps.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ToolCard, { item, kind: KIND_DEP }, `dep-${index}`)) })
	    ] }) : null
	  ] });
	}
	function CliDoctorPanel() {
	  const [phase, setPhase] = (0, import_react.useState)("idle");
	  const [report, setReport] = (0, import_react.useState)(null);
	  const [checkedAt, setCheckedAt] = (0, import_react.useState)(null);
	  const [errorMessage, setErrorMessage] = (0, import_react.useState)(null);
	  const [waitedMs, setWaitedMs] = (0, import_react.useState)(0);
	  const [version, setVersion] = (0, import_react.useState)(BUILD_VERSION);
	  const mountedRef = (0, import_react.useRef)(true);
	  const runningRef = (0, import_react.useRef)(false);
	  const controllerRef = (0, import_react.useRef)(null);
	  const timerRef = (0, import_react.useRef)(null);
	  (0, import_react.useEffect)(() => {
	    mountedRef.current = true;
	    return () => {
	      mountedRef.current = false;
	      if (timerRef.current !== null) {
	        clearInterval(timerRef.current);
	        timerRef.current = null;
	      }
	      if (controllerRef.current && typeof controllerRef.current.abort === "function") {
	        controllerRef.current.abort();
	        controllerRef.current = null;
	      }
	    };
	  }, []);
	  (0, import_react.useEffect)(() => {
	    let cancelled = false;
	    const controller = typeof AbortController === "function" ? new AbortController() : null;
	    fetchHealth(controller ? { signal: controller.signal } : {}).then((health) => {
	      if (cancelled || !health || !health.version) return;
	      setVersion(health.version);
	    });
	    return () => {
	      cancelled = true;
	      if (controller && typeof controller.abort === "function") controller.abort();
	    };
	  }, []);
	  const run = (0, import_react.useCallback)(async () => {
	    if (runningRef.current) return;
	    runningRef.current = true;
	    const controller = typeof AbortController === "function" ? new AbortController() : null;
	    controllerRef.current = controller;
	    const startedAt = Date.now();
	    setPhase("running");
	    setWaitedMs(0);
	    setErrorMessage(null);
	    timerRef.current = setInterval(() => {
	      if (mountedRef.current) setWaitedMs(Date.now() - startedAt);
	    }, 1e3);
	    try {
	      const result = await checkStatus(controller ? { signal: controller.signal } : {});
	      if (!mountedRef.current) return;
	      setReport(result.report);
	      setCheckedAt(result.checkedAt);
	      setPhase("done");
	    } catch (error) {
	      if (!mountedRef.current) return;
	      if (error && error.name === "AbortError") return;
	      const message = error && typeof error.message === "string" && error.message ? error.message : String(error);
	      setErrorMessage(message);
	      setPhase("error");
	    } finally {
	      if (timerRef.current !== null) {
	        clearInterval(timerRef.current);
	        timerRef.current = null;
	      }
	      if (controllerRef.current === controller) controllerRef.current = null;
	      runningRef.current = false;
	    }
	  }, []);
	  const counts = (0, import_react.useMemo)(() => summarize(report), [report]);
	  const blocks = counts.blocks;
	  const skipped = (0, import_react.useMemo)(() => skippedChecks(report), [report]);
	  const running = phase === "running";
	  const stateLabel = STATE_LABELS[phase] || STATE_LABELS.idle;
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.root, "data-dsh-cli-doctor": "", children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { style: S.header, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.headerMain, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: S.title, children: "CLI Doctor" }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.version, children: `插件版本 ${version || "未知"}` })
	      ] }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.headerActions, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.state, "aria-live": "polite", children: `当前状态：${stateLabel}` }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	          "button",
	          {
	            type: "button",
	            style: running ? { ...S.button, ...S.buttonBusy } : S.button,
	            onClick: run,
	            disabled: running,
	            "aria-busy": running ? "true" : "false",
	            children: "一键诊断当前状态"
	          }
	        )
	      ] })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.body, "data-dsh-cli-doctor-scroll": "", children: [
	      running ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.progress, "aria-live": "polite", children: `正在检查，联网查询可能需要几分钟… 已等待 ${formatDuration(waitedMs)}` }) : null,
	      phase === "error" && errorMessage ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.alert, role: "alert", children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `检查未完成：${errorMessage}` }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: run, children: "重试" })
	      ] }) : null,
	      phase === "idle" && !report ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.hint, children: "首次打开不会自动检查。点击「一键诊断当前状态」运行一次只读诊断；结果不会写入任何文件。" }) : null,
	      report ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SummaryBar, { counts }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: S.meta, children: [
	          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `生成时间：${formatTimestamp(report.generated_at)}` }),
	          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `范围：${formatScope(report)}` }),
	          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `耗时：${formatDuration(report.elapsed_ms)}` }),
	          checkedAt ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `本次检查：${formatTimestamp(checkedAt)}` }) : null
	        ] }),
	        skipped.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.skipped, children: `未检查：${skipped.join("；")}` }) : null,
	        blocks.length ? blocks.map((block) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EcosystemBlock, { block }, block.key)) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.empty, children: "没有发现可展示的 CLI 工具。请查看终端环境与 PATH。" }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.footer, children: "只读检查：本插件只读取本机工具与依赖的版本信息，未执行任何升级。" })
	      ] }) : null
	    ] })
	  ] });
	}

	// src/client/index.jsx
	var PANEL_ID = "cli-doctor";
	var PANEL_ORDER = 30;
	var PANEL_LABEL = "CLI Doctor";
	var inject = ["slots"];
	var MISSING_SLOTS = "cli-doctor: client slot service unavailable; panel not registered";
	function apply(ctx) {
	  const slots = ctx && ctx.slots;
	  if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") {
	    if (typeof console !== "undefined" && typeof console.warn === "function") console.warn(MISSING_SLOTS);
	    return () => {
	    };
	  }
	  const disposers = [];
	  let disposed = false;
	  const disposeAll = () => {
	    if (disposed) return;
	    disposed = true;
	    for (const dispose of disposers.splice(0)) {
	      try {
	        if (typeof dispose === "function") dispose();
	      } catch (error) {
	        if (typeof console !== "undefined" && typeof console.warn === "function") {
	          console.warn(`cli-doctor: disposal failed: ${error && error.message ? error.message : String(error)}`);
	        }
	      }
	    }
	  };
	  const register = (seat, options, component) => {
	    try {
	      const dispose = slots.inject(seat, () => slots.register(options, component));
	      if (typeof dispose === "function") disposers.push(dispose);
	    } catch (error) {
	      if (typeof console !== "undefined" && typeof console.warn === "function") {
	        console.warn(`cli-doctor: could not register "${seat}": ${error && error.message ? error.message : String(error)}`);
	      }
	    }
	  };
	  register("sidebar.panellist", { name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL }, CliDoctorIcon);
	  register("main", { name: "main", key: PANEL_ID }, CliDoctorPanel);
	  if (typeof ctx.effect === "function") {
	    try {
	      ctx.effect(() => disposeAll, "cli-doctor: slots");
	    } catch {
	    }
	  }
	  return disposeAll;
	}
	return module.exports;
} });
