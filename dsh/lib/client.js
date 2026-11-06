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
	var import_react2 = require("react");

	// src/client/store.js
	var import_react = require("react");

	// src/client/api.js
	var CHECK_ENDPOINT = "/api/cli-doctor/check";
	var HEALTH_ENDPOINT = "/api/cli-doctor/health";
	var SNAPSHOT_ENDPOINT = "/api/cli-doctor/snapshot";
	var STATUS_ENDPOINT = "/api/cli-doctor/status";
	var CANCEL_ENDPOINT = "/api/cli-doctor/check/cancel";
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
	  cancelled: "诊断已取消。",
	  timeout: "诊断超时（超过 Host 允许的最长时间仍未结束），请稍后重试。",
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
	  if (code === "cancelled") return "cancelled";
	  if (status === 409 || code === "busy") return "busy";
	  return code ? "host" : "http";
	}
	function envelopeError(payload, status) {
	  const reason = payload ? payload.error : null;
	  return new CliDoctorRequestError(failureMessage(status, reason), {
	    code: failureCode(status, reason),
	    status,
	    hostCode: typeof reason === "string" ? reason : null
	  });
	}
	function finiteNumber(value) {
	  return typeof value === "number" && Number.isFinite(value) ? value : null;
	}
	async function checkStatus(options = {}) {
	  const send = resolveFetch(options.fetch);
	  const params = [];
	  if (options.mode === "fast" || options.mode === "full") params.push(`mode=${options.mode}`);
	  if (options.force === 0 || options.force === false) params.push("force=0");
	  else if (options.force === 1 || options.force === true) params.push("force=1");
	  const url = params.length ? `${CHECK_ENDPOINT}?${params.join("&")}` : CHECK_ENDPOINT;
	  let response;
	  try {
	    response = await send(url, {
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
	  if (response && response.ok === false) throw envelopeError(payload, status);
	  if (payload && payload.ok === false) throw envelopeError(payload, status);
	  const report = payload ? payload.report : null;
	  if (!report || typeof report !== "object" || Array.isArray(report)) {
	    throw new CliDoctorRequestError("诊断服务返回的数据无法识别（report 缺失或不是对象）。", { code: "malformed", status });
	  }
	  return {
	    report,
	    checkedAt: payload && typeof payload.checkedAt === "string" ? payload.checkedAt : null,
	    mode: payload && typeof payload.mode === "string" && payload.mode ? payload.mode : null,
	    elapsedMs: payload ? finiteNumber(payload.elapsedMs) : null,
	    cache: payload && typeof payload.cache === "string" && payload.cache ? payload.cache : null,
	    shared: Boolean(payload && payload.shared === true)
	  };
	}
	async function fetchSnapshot(options = {}) {
	  let send;
	  try {
	    send = resolveFetch(options.fetch);
	  } catch {
	    return null;
	  }
	  try {
	    const response = await send(`${SNAPSHOT_ENDPOINT}?full=1`, {
	      method: "GET",
	      headers: { Accept: "application/json" },
	      signal: options.signal
	    });
	    if (response && response.ok === false) return null;
	    const payload = await readJson(response);
	    if (!payload || payload.ok === false) return null;
	    const snapshot = payload.snapshot && typeof payload.snapshot === "object" && !Array.isArray(payload.snapshot) ? payload.snapshot : null;
	    const cache = payload.cache && typeof payload.cache === "object" ? payload.cache : null;
	    return {
	      snapshot,
	      busy: payload.busy === true,
	      cache: cache ? {
	        ttlMs: finiteNumber(cache.ttlMs),
	        autoCheck: cache.autoCheck !== false
	      } : null
	    };
	  } catch {
	    return null;
	  }
	}
	async function fetchStatus(options = {}) {
	  let send;
	  try {
	    send = resolveFetch(options.fetch);
	  } catch {
	    return null;
	  }
	  try {
	    const response = await send(STATUS_ENDPOINT, {
	      method: "GET",
	      headers: { Accept: "application/json" },
	      signal: options.signal
	    });
	    if (response && response.ok === false) return null;
	    const payload = await readJson(response);
	    if (!payload || payload.ok === false) return null;
	    const running = payload.running && typeof payload.running === "object" && !Array.isArray(payload.running) ? payload.running : null;
	    const lastCheck = payload.lastCheck && typeof payload.lastCheck === "object" ? payload.lastCheck : null;
	    const cache = payload.cache && typeof payload.cache === "object" ? payload.cache : null;
	    return {
	      busy: payload.busy === true,
	      running,
	      lastCheck,
	      cache
	    };
	  } catch {
	    return null;
	  }
	}
	async function cancelCheck(options = {}) {
	  const send = resolveFetch(options.fetch);
	  let response;
	  try {
	    response = await send(CANCEL_ENDPOINT, {
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
	  if (response && response.ok === false) throw envelopeError(payload, status);
	  if (payload && payload.ok === false) throw envelopeError(payload, status);
	  if (!payload) {
	    throw new CliDoctorRequestError("取消请求返回的数据无法识别。", { code: "malformed", status });
	  }
	  return { cancelled: payload.cancelled === true };
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

	// src/client/store.js
	var DEFAULT_TTL_MS = 12 * 60 * 60 * 1e3;
	var WAIT_TICK_MS = 1e3;
	var INITIAL_STATE = {
	  phase: "idle",
	  report: null,
	  checkedAt: null,
	  mode: null,
	  elapsedMs: null,
	  error: null,
	  autoStarted: false,
	  version: null,
	  busy: false,
	  bootstrapped: false,
	  bootstrapping: false,
	  bootError: null,
	  ttlMs: DEFAULT_TTL_MS,
	  autoCheck: true,
	  stale: false,
	  snapshotAgeMs: null,
	  waitedMs: 0,
	  startedAt: null,
	  runReason: null,
	  notice: null,
	  cancelling: false,
	  attached: false,
	  // Active summary-card filter (CONTRACT.md §v2.8); null = show everything.
	  summaryFilter: null
	};
	var state = { ...INITIAL_STATE };
	var listeners = /* @__PURE__ */ new Set();
	var bootstrapPromise = null;
	var runPromise = null;
	var waitTimer = null;
	var generation = 0;
	function isCurrent(gen) {
	  return gen === generation;
	}
	function isFiniteNumber(value) {
	  return typeof value === "number" && Number.isFinite(value);
	}
	function ageOfTimestamp(value, now = Date.now()) {
	  if (typeof value !== "string" || !value) return null;
	  const time = new Date(value).getTime();
	  if (Number.isNaN(time)) return null;
	  return Math.max(0, now - time);
	}
	function getState() {
	  return state;
	}
	function subscribe(listener) {
	  if (typeof listener !== "function") return () => {
	  };
	  listeners.add(listener);
	  return () => listeners.delete(listener);
	}
	function setState(patch) {
	  if (!patch || typeof patch !== "object") return state;
	  state = { ...state, ...patch };
	  for (const listener of [...listeners]) {
	    try {
	      listener();
	    } catch {
	    }
	  }
	  return state;
	}
	function stopWaitTimer() {
	  if (waitTimer !== null) {
	    clearInterval(waitTimer);
	    waitTimer = null;
	  }
	}
	function startWaitTimer() {
	  stopWaitTimer();
	  waitTimer = setInterval(() => {
	    if (state.phase !== "running" || !isFiniteNumber(state.startedAt)) return;
	    setState({ waitedMs: Math.max(0, Date.now() - state.startedAt) });
	  }, WAIT_TICK_MS);
	  if (waitTimer && typeof waitTimer.unref === "function") waitTimer.unref();
	}
	function resetStore() {
	  generation += 1;
	  stopWaitTimer();
	  bootstrapPromise = null;
	  runPromise = null;
	  state = { ...INITIAL_STATE };
	  for (const listener of [...listeners]) {
	    try {
	      listener();
	    } catch {
	    }
	  }
	}
	function useStore() {
	  if (typeof import_react.useSyncExternalStore === "function") {
	    return (0, import_react.useSyncExternalStore)(subscribe, getState);
	  }
	  const [snapshot, setSnapshot] = (0, import_react.useState)(getState);
	  (0, import_react.useEffect)(() => subscribe(() => setSnapshot(getState())), []);
	  return snapshot;
	}
	function startRun(options = {}) {
	  if (state.phase === "running") return runPromise || Promise.resolve(state);
	  const reason = typeof options.reason === "string" ? options.reason : "manual";
	  const mode = options.mode === "fast" ? "fast" : "full";
	  const force = options.force === 0 ? 0 : 1;
	  const presetElapsedMs = isFiniteNumber(options.presetElapsedMs) ? Math.max(0, options.presetElapsedMs) : 0;
	  const startedAt = Date.now() - presetElapsedMs;
	  const runGeneration = generation;
	  stopWaitTimer();
	  setState({
	    phase: "running",
	    error: null,
	    notice: null,
	    cancelling: false,
	    attached: reason === "attached",
	    mode,
	    runReason: reason,
	    startedAt,
	    waitedMs: presetElapsedMs
	  });
	  startWaitTimer();
	  const job = (async () => {
	    try {
	      const result = await checkStatus({ mode, force });
	      if (!isCurrent(runGeneration)) return state;
	      const checkedAt = result.checkedAt || (/* @__PURE__ */ new Date()).toISOString();
	      setState({
	        phase: "done",
	        report: result.report,
	        checkedAt,
	        elapsedMs: result.elapsedMs,
	        mode: result.mode || mode,
	        busy: false,
	        stale: false,
	        snapshotAgeMs: 0,
	        attached: result.cache === "attached" || result.shared === true,
	        error: null,
	        runReason: null,
	        waitedMs: 0,
	        startedAt: null
	      });
	      return state;
	    } catch (error) {
	      if (!isCurrent(runGeneration)) return state;
	      const code = error && typeof error.code === "string" ? error.code : null;
	      if (code === "cancelled") {
	        setState({
	          phase: "idle",
	          busy: false,
	          cancelling: false,
	          attached: false,
	          runReason: null,
	          error: null,
	          startedAt: null,
	          waitedMs: 0,
	          notice: { id: Date.now(), kind: "cancelled", text: "已取消" }
	        });
	        return state;
	      }
	      setState({
	        phase: "error",
	        busy: false,
	        cancelling: false,
	        attached: false,
	        runReason: null,
	        startedAt: null,
	        waitedMs: 0,
	        error: {
	          message: error && typeof error.message === "string" && error.message ? error.message : String(error),
	          code,
	          status: error && isFiniteNumber(error.status) ? error.status : null
	        }
	      });
	      return state;
	    } finally {
	      if (isCurrent(runGeneration)) {
	        stopWaitTimer();
	        if (runPromise === job) runPromise = null;
	      }
	    }
	  })();
	  runPromise = job;
	  return job;
	}
	function setSummaryFilter(field) {
	  const next = field && field !== "toolCount" && field !== state.summaryFilter ? field : null;
	  setState({ summaryFilter: next });
	  return next;
	}
	function runCheck(options = {}) {
	  return startRun({ reason: "manual", mode: "full", force: 1, ...options });
	}
	async function cancelCurrentCheck() {
	  if (state.phase !== "running" || state.cancelling) return false;
	  const cancelGeneration = generation;
	  setState({ cancelling: true });
	  try {
	    const result = await cancelCheck();
	    if (!isCurrent(cancelGeneration)) return false;
	    if (!result || result.cancelled !== true) {
	      setState({ cancelling: false });
	      return false;
	    }
	    return true;
	  } catch (error) {
	    if (!isCurrent(cancelGeneration)) return false;
	    setState({
	      cancelling: false,
	      notice: {
	        id: Date.now(),
	        kind: "error",
	        text: `取消失败：${error && typeof error.message === "string" && error.message ? error.message : String(error)}`
	      }
	    });
	    return false;
	  }
	}
	function bootstrap() {
	  if (state.bootstrapped) return Promise.resolve(state);
	  if (bootstrapPromise) return bootstrapPromise;
	  const bootGeneration = generation;
	  setState({ bootstrapping: true, bootError: null });
	  const promise = (async () => {
	    try {
	      return await runBootstrap(bootGeneration);
	    } finally {
	      if (isCurrent(bootGeneration)) setState({ bootstrapped: true, bootstrapping: false });
	      if (bootstrapPromise === promise) bootstrapPromise = null;
	    }
	  })();
	  bootstrapPromise = promise;
	  return promise;
	}
	async function runBootstrap(gen) {
	  const health = await fetchHealth();
	  if (!isCurrent(gen)) return state;
	  if (health) setState({ version: health.version, busy: health.busy === true });
	  const payload = await fetchSnapshot();
	  if (!isCurrent(gen)) return state;
	  const snapshot = payload && payload.snapshot && typeof payload.snapshot === "object" ? payload.snapshot : null;
	  const cache = payload && payload.cache && typeof payload.cache === "object" ? payload.cache : null;
	  const ttlMs = cache && isFiniteNumber(cache.ttlMs) && cache.ttlMs > 0 ? cache.ttlMs : state.ttlMs;
	  const autoCheck = !(cache && cache.autoCheck === false);
	  setState({ ttlMs, autoCheck });
	  if (!health && !payload) {
	    setState({
	      bootError: {
	        message: "未能连接诊断服务（Host 半体可能未加载或版本过旧）。"
	      }
	    });
	    return state;
	  }
	  if (snapshot && snapshot.report && typeof snapshot.report === "object" && !state.report) {
	    const checkedAt = typeof snapshot.checkedAt === "string" && snapshot.checkedAt ? snapshot.checkedAt : null;
	    const ageMs2 = isFiniteNumber(snapshot.ageMs) ? Math.max(0, snapshot.ageMs) : ageOfTimestamp(checkedAt);
	    setState({
	      phase: "done",
	      report: snapshot.report,
	      checkedAt,
	      mode: typeof snapshot.mode === "string" && snapshot.mode ? snapshot.mode : null,
	      elapsedMs: isFiniteNumber(snapshot.elapsedMs) ? snapshot.elapsedMs : null,
	      snapshotAgeMs: ageMs2,
	      stale: snapshot.stale === true || ageMs2 !== null && ageMs2 > ttlMs
	    });
	  } else if (snapshot && !state.report) {
	    const checkedAt = typeof snapshot.checkedAt === "string" && snapshot.checkedAt ? snapshot.checkedAt : null;
	    const ageMs2 = isFiniteNumber(snapshot.ageMs) ? Math.max(0, snapshot.ageMs) : ageOfTimestamp(checkedAt);
	    if (ageMs2 !== null) setState({ snapshotAgeMs: ageMs2, stale: ageMs2 > ttlMs });
	  }
	  if (state.phase === "running") return state;
	  const busy = health && health.busy === true || payload && payload.busy === true;
	  if (busy) {
	    const status = await fetchStatus();
	    if (!isCurrent(gen)) return state;
	    const running = status && status.running && typeof status.running === "object" ? status.running : null;
	    const mode = running && running.mode === "fast" ? "fast" : "full";
	    const elapsedMs = running && isFiniteNumber(running.elapsedMs) ? running.elapsedMs : 0;
	    startRun({ reason: "attached", mode, force: 1, presetElapsedMs: Math.max(0, elapsedMs) });
	    return state;
	  }
	  const ageMs = state.snapshotAgeMs !== null ? state.snapshotAgeMs : ageOfTimestamp(state.checkedAt);
	  const missingOrStale = !state.report || ageMs !== null && ageMs > ttlMs;
	  if (autoCheck && !state.autoStarted && missingOrStale) {
	    setState({ autoStarted: true });
	    startRun({ reason: "auto", mode: "full", force: 1 });
	  }
	  return state;
	}
	function retryBootstrap() {
	  setState({ bootstrapped: false, bootError: null });
	  return bootstrap();
	}

	// src/client/clipboard.js
	var COPY_FEEDBACK_MS = 2e3;
	var CLIPBOARD_UNAVAILABLE_TEXT = "当前环境不支持剪贴板写入，请在下方文本框手动复制。";
	var CLIPBOARD_FAILED_TEXT = "剪贴板写入失败，请在下方文本框手动复制。";
	function errorText2(error) {
	  if (error && typeof error.message === "string" && error.message) return error.message;
	  return String(error);
	}
	function resolveClipboard(override) {
	  if (override !== void 0) return override;
	  try {
	    if (typeof navigator !== "undefined" && navigator && navigator.clipboard) return navigator.clipboard;
	  } catch {
	  }
	  return null;
	}
	async function copyText(text, options = {}) {
	  const value = typeof text === "string" ? text : String(text ?? "");
	  const clipboard = resolveClipboard(options && options.clipboard);
	  if (!clipboard || typeof clipboard.writeText !== "function") {
	    return { ok: false, reason: "unavailable", message: null };
	  }
	  try {
	    await clipboard.writeText(value);
	    return { ok: true, reason: null, message: null };
	  } catch (error) {
	    return { ok: false, reason: "failed", message: errorText2(error) };
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
	var DEP_CANDIDATE_LABEL = "候选更新 · 待核验";
	var DEP_REVIEW_LABEL = "依赖更新需人工核验";
	var SUMMARY_FIELDS = [
	  ["toolCount", "已发现工具"],
	  ["updateCount", "有可用更新"],
	  ["recommendedCount", "建议更新"],
	  ["reviewCount", "需核验或暂缓"],
	  ["unknownCount", "目标待核验"]
	];
	var DEP_RISK_FIELDS = [
	  ["conflictCount", "依赖冲突"],
	  ["uncertainCount", "依赖待核验"]
	];
	var MODE_LABELS = {
	  full: "全量档",
	  fast: "快速档"
	};
	function versionHead(value) {
	  if (typeof value !== "string" && typeof value !== "number") return null;
	  const match = String(value).match(/^\d+(?:\.\d+){1,3}/);
	  return match ? match[0] : null;
	}
	function asArray(value) {
	  return Array.isArray(value) ? value : [];
	}
	function asRecord(value) {
	  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	}
	function isImpactChecked(item) {
	  const tool = asRecord(item);
	  return tool.impact != null && typeof tool.impact === "object" && tool.impact.checked === true;
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
	  if (kind === KIND_DEP) {
	    if (tool.outdated === true) return ["有可用更新", "update"];
	    if (tool.outdated === false) return tool.latest ? ["未检出更新", "steady"] : ["目标待核验", "unknown"];
	    if (tool.latest) return [DEP_CANDIDATE_LABEL, "review"];
	    return ["目标待核验", "unknown"];
	  }
	  if (tool.outdated === true) return ["有可用更新", "update"];
	  if (tool.outdated == null || !tool.latest) return ["目标待核验", "unknown"];
	  return ["未检出更新", "steady"];
	}
	function recommendationFor(item, kind) {
	  const tool = asRecord(item);
	  const impact = asRecord(tool.impact);
	  const checked = isImpactChecked(tool);
	  const dependents = asArray(impact.dependents).length;
	  const indirect = asArray(impact.indirect).length;
	  const conflicts = asArray(impact.conflicts).length;
	  const uncertain = asArray(impact.uncertain).length;
	  const scope = typeof impact.scope === "string" ? impact.scope : "";
	  const pythonScope = scope.startsWith("当前 Python");
	  if (candidateBelowCurrent(tool)) return ["暂不建议", "blocked", "候选版本低于已装版本，先核对发布频道和版本线。"];
	  if (kind === KIND_DEP && tool.outdated == null) {
	    if (!tool.latest) return ["无法判断", "unknown", "尚无可靠目标版本，无法判断升级影响。"];
	    if (!checked) return ["影响待核验", "review", "依赖关系没有完成检查，不能仅凭候选版本就建议升级。"];
	    if (conflicts) return ["暂不建议", "blocked", `目标版本不满足 ${conflicts} 个已安装项目的声明约束。`];
	    if (uncertain) return ["需人工核验", "review", "存在无法确认的可选依赖、版本约束或安装方式。"];
	    return [DEP_REVIEW_LABEL, "review", "依赖条目没有过期标记，无法确认是否确需升级；升级前请对照上层工具的版本约束。"];
	  }
	  if (tool.outdated == null || !tool.latest) return ["无法判断", "unknown", "尚无可靠目标版本，无法判断升级影响。"];
	  if (tool.outdated === false) return ["无需更新", "steady", "本次未检出新版本。"];
	  if (!checked) return ["影响待核验", "review", "依赖关系没有完成检查，不能仅凭新版本就建议升级。"];
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
	  if (!isImpactChecked(tool)) {
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
	function toolMatchesSummaryFilter(item, field) {
	  switch (field) {
	    case "updateCount":
	      return ["update", "review"].includes(statusFor(item, KIND_TOOL)[1]);
	    case "unknownCount":
	      return ["unknown", "anomaly"].includes(statusFor(item, KIND_TOOL)[1]);
	    case "recommendedCount":
	      return recommendationFor(item, KIND_TOOL)[1] === "recommended";
	    case "reviewCount":
	      return ["review", "blocked"].includes(recommendationFor(item, KIND_TOOL)[1]);
	    case "toolCount":
	    default:
	      return true;
	  }
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
	      if (toolMatchesSummaryFilter(tool, "updateCount")) updateCount += 1;
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
	  let depCount = 0;
	  let conflictCount = 0;
	  let uncertainCount = 0;
	  const blocks = groupReport(report);
	  for (const block of blocks) {
	    for (const tool of block.tools) {
	      toolCount += 1;
	      for (const field of ["updateCount", "unknownCount", "recommendedCount", "reviewCount"]) {
	        if (!toolMatchesSummaryFilter(tool, field)) continue;
	        if (field === "updateCount") updateCount += 1;
	        else if (field === "unknownCount") unknownCount += 1;
	        else if (field === "recommendedCount") recommendedCount += 1;
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
	function relativeTime(value, now = Date.now()) {
	  if (value == null || value === "") return "时间未知";
	  const date = new Date(value);
	  if (Number.isNaN(date.getTime())) return "时间未知";
	  const nowMs = Number(now);
	  if (!Number.isFinite(nowMs)) return "时间未知";
	  const diff = nowMs - date.getTime();
	  if (diff <= 45 * 1e3) return "刚刚";
	  const minutes = Math.floor(diff / 6e4);
	  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
	  const hours = Math.floor(minutes / 60);
	  if (hours < 24) return `${hours} 小时前`;
	  return `${Math.floor(hours / 24)} 天前`;
	}
	function timestampAgeMs(value, now = Date.now()) {
	  if (value == null || value === "") return null;
	  const time = new Date(value).getTime();
	  if (Number.isNaN(time)) return null;
	  return Math.max(0, Number(now) - time);
	}
	function isStale(ageMs, ttlMs) {
	  return typeof ageMs === "number" && Number.isFinite(ageMs) && typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0 && ageMs > ttlMs;
	}
	function formatScope(report) {
	  const scope = asRecord(report).scope;
	  return typeof scope === "string" && scope ? scope : "未标注";
	}
	function modeLabel(mode) {
	  return MODE_LABELS[mode] || null;
	}
	function modeCaveat(mode) {
	  if (mode !== "fast") return null;
	  return "快速档：npm 全局 / Python / Rust / Bun / uv 未比对最新版本，本结果不能作为升级结论。";
	}

	// src/client/report.js
	var PLACEHOLDER = "未标注";
	function textOf(value) {
	  if (typeof value === "string" && value) return value;
	  if (typeof value === "number" && Number.isFinite(value)) return String(value);
	  return null;
	}
	function versionLine(item) {
	  const current = textOf(item && item.current) || "未核验";
	  const latest = textOf(item && item.latest) || "目标待核验";
	  return `${current} → ${latest}`;
	}
	function impactSummary(item) {
	  const tool = item && typeof item === "object" ? item : {};
	  const impact = tool.impact && typeof tool.impact === "object" ? tool.impact : null;
	  if (!impact || impact.checked !== true) return "依赖检查：未完成或该生态暂不支持。";
	  const dependents = Array.isArray(impact.dependents) ? impact.dependents.length : 0;
	  const indirect = Array.isArray(impact.indirect) ? impact.indirect.length : 0;
	  const uncertain = Array.isArray(impact.uncertain) ? impact.uncertain.length : 0;
	  const scope = textOf(impact.scope) || PLACEHOLDER;
	  return `直接依赖 ${dependents} 个 · 间接依赖 ${indirect} 个 · 待核验 ${uncertain} 项；范围：${scope}。`;
	}
	function degradedText(entry) {
	  if (typeof entry === "string" && entry) return entry;
	  const record = entry && typeof entry === "object" ? entry : null;
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
	function toolDetailLines(item) {
	  const [status] = statusFor(item, KIND_TOOL);
	  const [recommendation, , explanation] = recommendationFor(item, KIND_TOOL);
	  const lines = [
	    `- 当前版本：${textOf(item && item.current) || "未核验"}`,
	    `- 目标版本：${textOf(item && item.latest) || "目标待核验"}`,
	    `- 状态：${status}`,
	    `- 建议：${recommendation}${explanation ? ` — ${explanation}` : ""}`
	  ];
	  const command = textOf(item && item.upgrade_cmd);
	  if (command) lines.push(`- 升级命令（本插件不执行，仅供人工核对）：\`${command}\``);
	  const anomaly = textOf(item && item.version_line_anomaly);
	  if (anomaly && anomaly !== "true" && anomaly !== "false") lines.push(`- 版本线提示：${anomaly}`);
	  lines.push(`- 依赖影响：${impactSummary(item)}`);
	  const note = textOf(item && item.note);
	  if (note) lines.push(`- 备注：${note}`);
	  return lines;
	}
	function buildMarkdownReport(report, meta = {}) {
	  const safeReport = report && typeof report === "object" ? report : {};
	  const safeMeta = meta && typeof meta === "object" ? meta : {};
	  const now = typeof safeMeta.now === "number" && Number.isFinite(safeMeta.now) ? safeMeta.now : Date.now();
	  const counts = summarize(safeReport);
	  const checkedAt = textOf(safeMeta.checkedAt) || textOf(safeReport.generated_at);
	  const mode = textOf(safeMeta.mode);
	  const elapsedMs = Number.isFinite(safeMeta.elapsedMs) ? safeMeta.elapsedMs : Number.isFinite(safeReport.elapsed_ms) ? safeReport.elapsed_ms : null;
	  const pluginVersion = textOf(safeMeta.pluginVersion);
	  const stale = safeMeta.stale === true;
	  const blocks = groupReport(safeReport);
	  const lines = [];
	  lines.push("# CLI Doctor 诊断报告", "");
	  lines.push("> 本插件只做只读检查，不执行、也不代为执行任何升级动作；插件不提供自动执行入口，命令仅供人工核对。", "");
	  lines.push("## 基本信息", "");
	  lines.push(`- 插件版本：${pluginVersion || "未标注"}`);
	  lines.push(`- 生成时间：${formatTimestamp(safeReport.generated_at)}`);
	  lines.push(`- 检查时间：${checkedAt ? `${formatTimestamp(checkedAt)}（${relativeTime(checkedAt, now)}）` : "时间未知"}`);
	  lines.push(`- 检查模式：${modeLabel(mode) || "未标注"}`);
	  lines.push(`- 耗时：${formatDuration(elapsedMs)}`);
	  lines.push(`- 检查范围：${formatScope(safeReport)}`);
	  lines.push(`- 数据状态：${stale ? "已过期（上次检查距今可能已不准确，建议重新诊断）" : "有效（来自最近一次成功检查）"}`);
	  if (modeCaveat(mode)) lines.push(`- 模式提示：${modeCaveat(mode)}`);
	  lines.push("");
	  lines.push("## 汇总计数", "");
	  lines.push("| 指标 | 数量 |", "| --- | ---: |");
	  for (const [field, label] of SUMMARY_FIELDS) lines.push(`| ${label} | ${counts[field]} |`);
	  lines.push(`| 依赖包 | ${counts.depCount} |`);
	  lines.push(`| 依赖冲突 | ${counts.conflictCount} |`);
	  lines.push(`| 依赖待核验 | ${counts.uncertainCount} |`);
	  lines.push("", "> 前五项只统计工具层，与面板顶部计数一致；依赖数字单独统计。", "");
	  lines.push("## 可行动工具明细", "");
	  let actionableCount = 0;
	  for (const block of blocks) {
	    const actionable = block.tools.filter((tool) => statusFor(tool, KIND_TOOL)[1] !== "steady");
	    if (!actionable.length) continue;
	    lines.push(`### ${block.title}`, "");
	    for (const tool of actionable) {
	      actionableCount += 1;
	      const name = textOf(tool && tool.name) || "未知工具";
	      lines.push(`#### ${name}`, "");
	      for (const line of toolDetailLines(tool)) lines.push(line);
	      lines.push("");
	    }
	  }
	  if (!actionableCount) lines.push("- 本次未发现需要处理的可行动工具。", "");
	  lines.push("## 依赖冲突与待核验", "");
	  const conflictLines = [];
	  const uncertainLines = [];
	  for (const block of blocks) {
	    for (const dep of block.deps) {
	      const name = textOf(dep && dep.name) || "未知依赖";
	      const impact = dep && dep.impact && typeof dep.impact === "object" ? dep.impact : {};
	      for (const entry of Array.isArray(impact.conflicts) ? impact.conflicts : []) {
	        const target = entry && typeof entry === "object" ? entry : {};
	        const conflictName = textOf(target.name) || "未知依赖";
	        const requirement = textOf(target.requirement);
	        conflictLines.push(`- ${name}（${versionLine(dep)}）：${conflictName}${requirement ? ` · ${requirement}` : ""}`);
	      }
	      for (const entry of Array.isArray(impact.uncertain) ? impact.uncertain : []) {
	        const target = entry && typeof entry === "object" ? entry : {};
	        const uncertainName = textOf(target.name) || "未知依赖";
	        const requirement = textOf(target.requirement);
	        const reason = textOf(target.reason) || "待核验";
	        uncertainLines.push(`- ${name}（${versionLine(dep)}）：${uncertainName}${requirement ? ` · ${requirement}` : ""} · ${reason}`);
	      }
	    }
	  }
	  lines.push(`### 依赖冲突（${conflictLines.length} 条）`, "");
	  if (conflictLines.length) lines.push(...conflictLines);
	  else lines.push("- 未发现依赖冲突。");
	  lines.push("");
	  lines.push(`### 依赖待核验（${uncertainLines.length} 条）`, "");
	  if (uncertainLines.length) lines.push(...uncertainLines);
	  else lines.push("- 未发现待核验依赖。");
	  lines.push("");
	  lines.push("## 已是最新工具", "");
	  let steadyCount = 0;
	  for (const block of blocks) {
	    const steady = block.tools.filter((tool) => statusFor(tool, KIND_TOOL)[1] === "steady").map((tool) => textOf(tool && tool.name)).filter(Boolean);
	    if (!steady.length) continue;
	    steadyCount += steady.length;
	    lines.push(`- ${block.title}（${steady.length}）：${steady.join("、")}`);
	  }
	  if (!steadyCount) lines.push("- 未发现已是最新的工具。");
	  lines.push("");
	  lines.push("## 未检查项与降级说明", "");
	  const skipped = skippedChecks(safeReport);
	  if (skipped.length) {
	    for (const entry of skipped) lines.push(`- 未检查：${entry}`);
	  }
	  const degraded = Array.isArray(safeReport.degraded) ? safeReport.degraded : [];
	  for (const entry of degraded) {
	    const text = degradedText(entry);
	    if (text) lines.push(`- 降级：${text}`);
	  }
	  if (!skipped.length && !degraded.length) lines.push("- 本次未报告跳过项或降级项。");
	  lines.push("");
	  lines.push("## 状态与建议语义", "");
	  lines.push("- 有可用更新：存在可比较的候选新版本（或需进一步核验），不代表可以直接升级。");
	  lines.push("- 建议更新：依赖影响检查完成且未发现声明冲突，命令仍需人工在终端决定是否执行。");
	  lines.push("- 需核验或暂缓：存在未确认的可选依赖、版本约束冲突、大版本跨越或未完成的依赖检查。");
	  lines.push("- 目标待核验：缺少可靠的目标版本，无法判断是否需要升级。");
	  lines.push("- 版本线异常：候选版本低于已装版本，应先核对发布频道和版本线。");
	  lines.push("- 候选更新 · 待核验：依赖条目没有过期标记，只能作为候选更新看待。");
	  lines.push("");
	  lines.push("## 只读说明", "");
	  lines.push("- 插件只读取本机 CLI 工具与依赖的版本信息，不执行、不代为执行任何升级动作，也不提供自动执行入口。");
	  lines.push("- 升级命令只用于人工核对；是否执行、何时执行由用户自行决定。");
	  lines.push("");
	  lines.push("## 数据来源", "");
	  lines.push("- 数据来源：本机 CLI Doctor 只读检查（`check.js --json --no-update`），未扫描其他项目目录或虚拟环境。");
	  lines.push(`- 检查时间：${checkedAt ? formatTimestamp(checkedAt) : "时间未知"}；报告生成时间：${formatTimestamp(safeReport.generated_at)}。`);
	  lines.push("");
	  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}`;
	}
	function buildJsonReport(report) {
	  return JSON.stringify(report ?? null, null, 2);
	}

	// src/client/panel.jsx
	var import_jsx_runtime2 = require("react/jsx-runtime");
	var BUILD_VERSION = "0.3.0" ? "0.3.0" : null;
	var TONES = {
	  anomaly: "var(--dsw-alias-state-warn-primary, #b45309)",
	  update: "var(--dsw-alias-brand-primary, #2563eb)",
	  steady: "inherit",
	  unknown: "var(--dsw-alias-state-warn-primary, #a16207)",
	  recommended: "var(--dsw-alias-state-success-primary, #047857)",
	  review: "var(--dsw-alias-state-warn-primary, #b45309)",
	  blocked: "var(--dsw-alias-state-error-primary, #b91c1c)"
	};
	var STATE_LABELS = {
	  idle: "空闲",
	  running: "诊断中",
	  done: "诊断完成",
	  error: "诊断失败"
	};
	var RUN_REASON_TEXT = {
	  auto: "数据已过期或尚未诊断，正在自动做一次只读诊断（可取消）。",
	  attached: "已连接本机正在进行的诊断，等待结果。",
	  manual: "正在检查，联网查询可能需要几分钟…",
	  retry: "正在重新检查，联网查询可能需要几分钟…"
	};
	var MUTED = "var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))";
	var HAIRLINE = "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))";
	var CARD_BG = "var(--dsw-alias-bg-layer-1, transparent)";
	var WARN_COLOR = "var(--dsw-alias-state-warn-primary, #b45309)";
	var DANGER_COLOR = "var(--dsw-alias-state-error-primary, #b91c1c)";
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
	    borderBottom: HAIRLINE,
	    position: "relative"
	  },
	  headerMain: { display: "flex", alignItems: "baseline", gap: "8px", minWidth: "160px", flexWrap: "wrap" },
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
	  freshness: { color: MUTED, fontSize: "12px" },
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
	  dangerButton: {
	    padding: "6px 14px",
	    borderRadius: "6px",
	    border: `1px solid ${DANGER_COLOR}`,
	    background: "transparent",
	    color: DANGER_COLOR,
	    fontSize: "13px",
	    fontFamily: "inherit",
	    cursor: "pointer"
	  },
	  progress: { color: MUTED, fontSize: "12px", margin: 0 },
	  alert: {
	    border: `1px solid ${DANGER_COLOR}`,
	    borderRadius: "6px",
	    padding: "10px 12px",
	    color: DANGER_COLOR,
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    gap: "10px"
	  },
	  warnBanner: {
	    border: `1px solid ${WARN_COLOR}`,
	    borderRadius: "6px",
	    padding: "8px 12px",
	    color: WARN_COLOR,
	    fontSize: "12px",
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    gap: "10px"
	  },
	  notice: {
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "8px 12px",
	    color: MUTED,
	    fontSize: "12px",
	    margin: 0
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
	  riskBar: {
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    gap: "8px"
	  },
	  riskCell: {
	    display: "flex",
	    alignItems: "baseline",
	    gap: "6px",
	    border: `1px solid ${DANGER_COLOR}`,
	    borderRadius: "6px",
	    padding: "4px 10px",
	    color: DANGER_COLOR,
	    fontSize: "12px"
	  },
	  riskValue: { fontSize: "14px", fontWeight: 600 },
	  riskNote: { color: MUTED, fontSize: "11px" },
	  meta: { color: MUTED, fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "12px", margin: 0 },
	  modeNote: {
	    color: WARN_COLOR,
	    fontSize: "12px",
	    margin: 0
	  },
	  expired: {
	    color: WARN_COLOR,
	    fontSize: "12px",
	    margin: 0,
	    border: `1px solid ${WARN_COLOR}`,
	    borderRadius: "6px",
	    padding: "6px 10px"
	  },
	  skipped: { color: MUTED, fontSize: "12px", margin: 0 },
	  section: { border: HAIRLINE, borderRadius: "8px", padding: "12px", background: CARD_BG },
	  sectionHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "10px", marginBottom: "6px" },
	  sectionTitle: { margin: 0, fontSize: "14px", fontWeight: 600 },
	  sectionCount: { color: MUTED, fontSize: "12px" },
	  layerLabel: { fontSize: "12px", color: MUTED, margin: "6px 0 4px" },
	  cards: { display: "flex", flexDirection: "column", gap: "8px" },
	  card: { border: HAIRLINE, borderRadius: "6px", padding: "10px", display: "flex", flexDirection: "column", gap: "6px", background: CARD_BG },
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
	  empty: { color: MUTED, margin: 0 },
	  // Visually hidden live region: it only exists so phase changes (and one-shot
	  // notices) are announced; the 1 s wait ticker never writes here.
	  summaryButton: {
	    flex: "1 1 110px",
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "8px 10px",
	    display: "flex",
	    flexDirection: "column",
	    gap: "2px",
	    textAlign: "left",
	    font: "inherit",
	    color: "inherit",
	    background: "transparent",
	    cursor: "pointer"
	  },
	  summaryCellActive: {
	    border: "1px solid var(--dsw-alias-brand-primary, #2563eb)",
	    color: "var(--dsw-alias-brand-primary, #2563eb)",
	    background: "var(--dsw-alias-bg-layer-2, transparent)"
	  },
	  filterNote: {
	    display: "flex",
	    flexWrap: "wrap",
	    alignItems: "center",
	    gap: "10px",
	    margin: 0,
	    color: MUTED,
	    fontSize: "12px",
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "8px 12px"
	  },
	  emptyState: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" },
	  copyFeedback: { margin: 0, fontSize: "12px", color: "var(--dsw-alias-state-success-primary, #047857)" },
	  copyFeedbackError: { margin: 0, fontSize: "12px", color: DANGER_COLOR },
	  copyPanel: {
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "10px 12px",
	    display: "flex",
	    flexDirection: "column",
	    gap: "8px"
	  },
	  copyHint: { margin: 0, fontSize: "12px", color: MUTED },
	  copyArea: {
	    width: "100%",
	    boxSizing: "border-box",
	    minHeight: "160px",
	    resize: "vertical",
	    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
	    fontSize: "12px",
	    lineHeight: 1.5,
	    border: HAIRLINE,
	    borderRadius: "6px",
	    padding: "8px",
	    background: "transparent",
	    color: "inherit"
	  },
	  copyActions: { display: "flex", flexWrap: "wrap", gap: "8px" },
	  copyPrimary: {
	    padding: "6px 14px",
	    borderRadius: "6px",
	    border: "1px solid var(--dsw-alias-brand-primary, #2563eb)",
	    background: "transparent",
	    color: "var(--dsw-alias-brand-primary, #2563eb)",
	    fontSize: "13px",
	    fontFamily: "inherit",
	    cursor: "pointer"
	  },
	  srOnly: {
	    position: "absolute",
	    width: "1px",
	    height: "1px",
	    padding: 0,
	    margin: "-1px",
	    overflow: "hidden",
	    clip: "rect(0 0 0 0)",
	    whiteSpace: "nowrap",
	    border: 0
	  }
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
	function SummaryBar({ counts, filter, onSelect }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.summary, role: "group", "aria-label": "汇总计数，点击卡片可筛选工具列表", children: SUMMARY_FIELDS.map(([field, label]) => {
	      const active = field === "toolCount" ? filter === null : filter === field;
	      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
	        "button",
	        {
	          type: "button",
	          "aria-pressed": active ? "true" : "false",
	          style: active ? { ...S.summaryButton, ...S.summaryCellActive } : S.summaryButton,
	          onClick: () => onSelect(field),
	          children: [
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: S.summaryValue, children: counts[field] }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.summaryLabel, children: label })
	          ]
	        },
	        field
	      );
	    }) }),
	    DEP_RISK_FIELDS.some(([field]) => counts[field] > 0) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.riskBar, children: [
	      DEP_RISK_FIELDS.filter(([field]) => counts[field] > 0).map(([field, label]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.riskCell, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: S.riskValue, children: counts[field] }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: label })
	      ] }, field)),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.riskNote, children: "依赖层风险（不计入上方工具计数）" })
	    ] }) : null
	  ] });
	}
	function EcosystemBlock({ block, filterActive }) {
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { style: S.section, children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.sectionHead, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { style: S.sectionTitle, children: block.title }),
	      filterActive ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.sectionCount, children: `匹配 ${block.tools.length} / 共 ${block.totalToolCount} 个工具` }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.sectionCount, children: `${block.tools.length} 个工具${block.deps.length ? ` / ${block.deps.length} 个依赖` : ""}` }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: { ...S.sectionCount, color: "inherit" }, children: `有可用更新 ${block.updateCount}` })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.layerLabel, children: "工具类" }),
	    block.tools.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.cards, children: block.tools.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ToolCard, { item, kind: KIND_TOOL }, `tool-${index}`)) }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.empty, children: "本生态未发现工具。" }),
	    !filterActive && block.deps.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { style: S.deps, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: S.detailsSummary, children: `依赖包类 · 查看 ${block.deps.length} 个依赖` }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { ...S.cards, marginTop: "8px" }, children: block.deps.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ToolCard, { item, kind: KIND_DEP }, `dep-${index}`)) })
	    ] }) : null
	  ] });
	}
	function ModeNote({ mode }) {
	  const caveat = modeCaveat(mode);
	  if (!caveat) return null;
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.modeNote, children: caveat });
	}
	function CliDoctorPanel() {
	  const state2 = useStore();
	  const {
	    phase,
	    report,
	    checkedAt,
	    mode,
	    error,
	    waitedMs,
	    version,
	    bootstrapping,
	    bootstrapped,
	    bootError,
	    autoCheck,
	    autoStarted,
	    stale,
	    snapshotAgeMs,
	    ttlMs,
	    notice,
	    cancelling,
	    runReason,
	    summaryFilter
	  } = state2;
	  const [copyFeedback, setCopyFeedback] = (0, import_react2.useState)(null);
	  const [copyFallback, setCopyFallback] = (0, import_react2.useState)(null);
	  const mountedRef = (0, import_react2.useRef)(true);
	  (0, import_react2.useEffect)(() => {
	    void bootstrap();
	  }, []);
	  (0, import_react2.useEffect)(() => {
	    mountedRef.current = true;
	    return () => {
	      mountedRef.current = false;
	    };
	  }, []);
	  (0, import_react2.useEffect)(() => {
	    if (!copyFeedback || copyFeedback.kind !== "ok") return void 0;
	    const timer = setTimeout(() => setCopyFeedback(null), COPY_FEEDBACK_MS);
	    return () => clearTimeout(timer);
	  }, [copyFeedback]);
	  const counts = (0, import_react2.useMemo)(() => summarize(report), [report]);
	  const skipped = (0, import_react2.useMemo)(() => skippedChecks(report), [report]);
	  const blocks = (0, import_react2.useMemo)(() => {
	    if (!summaryFilter) return counts.blocks;
	    return counts.blocks.map((block) => ({
	      ...block,
	      tools: block.tools.filter((tool) => toolMatchesSummaryFilter(tool, summaryFilter)),
	      totalToolCount: block.tools.length
	    })).filter((block) => block.tools.length > 0);
	  }, [counts.blocks, summaryFilter]);
	  const filterLabel = (0, import_react2.useMemo)(() => {
	    const found = SUMMARY_FIELDS.find(([field]) => field === summaryFilter);
	    return found ? found[1] : null;
	  }, [summaryFilter]);
	  const running = phase === "running";
	  const stateLabel = STATE_LABELS[phase] || STATE_LABELS.idle;
	  const effectiveCheckedAt = checkedAt || (report && typeof report.generated_at === "string" ? report.generated_at : null);
	  const ageMs = snapshotAgeMs !== null ? snapshotAgeMs : timestampAgeMs(effectiveCheckedAt);
	  const expired = Boolean(report) && (stale === true || isStale(ageMs, ttlMs));
	  const freshness = report ? `上次诊断 ${relativeTime(effectiveCheckedAt)}${expired ? " · 数据已过期" : ""}` : bootstrapping ? "正在读取上次诊断…" : "尚未诊断";
	  const waitPrefix = RUN_REASON_TEXT[runReason] || RUN_REASON_TEXT.manual;
	  const announcement = notice ? notice.text : `当前状态：${stateLabel}`;
	  const showAutoHint = !report && !running && bootstrapped && !bootError && phase === "idle";
	  const autoHintText = autoCheck ? autoStarted ? "本次打开已自动检查过一次，结果缓存在本机；点击「一键诊断当前状态」可再检查一次。" : "首次打开会自动做一次只读诊断，结果缓存在本机；随时可以取消。" : "首次打开不会自动检查。点击「一键诊断当前状态」运行一次只读诊断；结果缓存在本机。";
	  const copyMeta = {
	    pluginVersion: version || BUILD_VERSION || null,
	    checkedAt,
	    mode,
	    elapsedMs: report && Number.isFinite(report.elapsed_ms) ? report.elapsed_ms : null,
	    stale: expired,
	    now: Date.now()
	  };
	  const onCopy = async (kind) => {
	    if (!report) return;
	    const text = kind === "json" ? buildJsonReport(report) : buildMarkdownReport(report, copyMeta);
	    const result = await copyText(text);
	    if (!mountedRef.current) return;
	    if (result.ok) {
	      setCopyFallback(null);
	      setCopyFeedback({ id: Date.now(), kind: "ok", message: "已复制" });
	      return;
	    }
	    const reason = result.reason === "unavailable" ? CLIPBOARD_UNAVAILABLE_TEXT : `${CLIPBOARD_FAILED_TEXT}${result.message ? `（${result.message}）` : ""}`;
	    setCopyFeedback({ id: Date.now(), kind: "error", message: reason });
	    setCopyFallback({ id: Date.now(), kind, text });
	  };
	  const onPrimary = () => {
	    void runCheck({ reason: "manual", force: 1 });
	  };
	  const onCancel = () => {
	    void cancelCurrentCheck();
	  };
	  const onRetryBootstrap = () => {
	    void retryBootstrap();
	  };
	  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.root, "data-dsh-cli-doctor": "", children: [
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { style: S.header, children: [
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.headerMain, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { style: S.title, children: "CLI Doctor" }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.version, children: `插件版本 ${version || BUILD_VERSION || "未知"}` })
	      ] }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.headerActions, children: [
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.freshness, children: freshness }),
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { style: S.state, children: `当前状态：${stateLabel}` }),
	        report ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
	          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	            "button",
	            {
	              type: "button",
	              style: S.copyPrimary,
	              onClick: () => void onCopy("markdown"),
	              "aria-label": "复制 Markdown 诊断报告（可直接粘贴给 AI）",
	              children: "复制报告"
	            }
	          ),
	          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	            "button",
	            {
	              type: "button",
	              style: S.button,
	              onClick: () => void onCopy("json"),
	              "aria-label": "复制原始 JSON 诊断报告",
	              children: "复制原始 JSON"
	            }
	          ),
	          copyFeedback ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	            "span",
	            {
	              "data-dsh-cli-doctor-copy-feedback": "",
	              style: copyFeedback.kind === "ok" ? S.copyFeedback : S.copyFeedbackError,
	              role: "status",
	              "aria-live": "polite",
	              children: copyFeedback.message
	            }
	          ) : null
	        ] }) : null,
	        running ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	          "button",
	          {
	            type: "button",
	            style: cancelling ? { ...S.dangerButton, ...S.buttonBusy } : S.dangerButton,
	            onClick: onCancel,
	            disabled: cancelling,
	            children: cancelling ? "取消中…" : "取消"
	          }
	        ) : null,
	        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	          "button",
	          {
	            type: "button",
	            style: running ? { ...S.button, ...S.buttonBusy } : S.button,
	            onClick: onPrimary,
	            disabled: running,
	            children: "一键诊断当前状态"
	          }
	        )
	      ] }),
	      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { role: "status", "aria-live": "polite", "aria-atomic": "true", style: S.srOnly, children: announcement })
	    ] }),
	    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
	      "div",
	      {
	        style: S.body,
	        "data-dsh-cli-doctor-scroll": "",
	        "aria-busy": running ? "true" : "false",
	        children: [
	          bootError ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.warnBanner, role: "status", children: [
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: bootError.message }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: onRetryBootstrap, children: "重试连接" })
	          ] }) : null,
	          running ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.progress, "aria-live": "off", children: `${waitPrefix} 已等待 ${formatDuration(waitedMs)}${cancelling ? " · 正在取消…" : ""}` }) : null,
	          notice ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: notice.kind === "error" ? S.warnBanner : S.notice, role: "status", children: notice.kind === "cancelled" ? "已取消。上次结果（如有）仍显示在下方。" : notice.text }) : null,
	          copyFallback ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.copyPanel, "data-dsh-cli-doctor-copy": "", children: [
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.copyHint, children: `${copyFeedback ? `${copyFeedback.message} ` : ""}下方是${copyFallback.kind === "json" ? "原始 JSON" : "Markdown 报告"}全文，可全选手动复制（只读，不会修改报告）。` }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
	              "textarea",
	              {
	                style: S.copyArea,
	                readOnly: true,
	                value: copyFallback.text,
	                "aria-label": "手动复制诊断报告",
	                rows: 10,
	                autoFocus: true,
	                onFocus: (event) => {
	                  try {
	                    event.currentTarget.select();
	                  } catch {
	                  }
	                }
	              }
	            ),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: S.copyActions, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: () => setCopyFallback(null), children: "关闭" }) })
	          ] }) : null,
	          phase === "error" && error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.alert, role: "alert", children: [
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `检查未完成：${error.message}` }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: onPrimary, children: "重试" })
	          ] }) : null,
	          !report && bootstrapping ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.hint, children: "正在读取上次诊断结果…" }) : null,
	          !report && !running && !bootstrapping && !bootstrapped ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.hint, children: "正在准备诊断面板…" }) : null,
	          showAutoHint ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.hint, children: autoHintText }) : null,
	          report ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SummaryBar, { counts, filter: summaryFilter, onSelect: setSummaryFilter }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ModeNote, { mode }),
	            expired ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.expired, role: "status", children: `数据已过期（上次诊断 ${relativeTime(effectiveCheckedAt)}），建议重新诊断。` }) : null,
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { style: S.meta, children: [
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `生成时间：${formatTimestamp(report.generated_at)}` }),
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `范围：${formatScope(report)}` }),
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `耗时：${formatDuration(report.elapsed_ms)}` }),
	              modeLabel(mode) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `检查档位：${modeLabel(mode)}` }) : null,
	              checkedAt ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `检查时间：${formatTimestamp(checkedAt)}（${relativeTime(checkedAt)}）` }) : null
	            ] }),
	            skipped.length ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.skipped, children: `未检查：${skipped.join("；")}` }) : null,
	            summaryFilter ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.filterNote, role: "status", children: [
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: `正在按「${filterLabel || summaryFilter}」筛选工具：只显示匹配的工具卡，依赖层已隐藏（依赖计数仍见上方汇总）。` }),
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: () => setSummaryFilter(summaryFilter), children: "清除筛选" })
	            ] }) : null,
	            blocks.length ? blocks.map((block) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EcosystemBlock, { block, filterActive: Boolean(summaryFilter) }, block.key)) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: S.emptyState, children: [
	              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.empty, children: summaryFilter ? `没有符合「${filterLabel || summaryFilter}」筛选的工具。` : "没有发现可展示的 CLI 工具。请查看终端环境与 PATH。" }),
	              summaryFilter ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", style: S.button, onClick: () => setSummaryFilter(summaryFilter), children: "清除筛选" }) : null
	            ] }),
	            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: S.footer, children: "只读检查：本插件只读取本机工具与依赖的版本信息，未执行任何升级；结果缓存在本机，过期后重新诊断。" })
	          ] }) : null
	        ]
	      }
	    )
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
	    resetStore();
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
