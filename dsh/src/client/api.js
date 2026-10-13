/**
 * HTTP client for the CLI Doctor Host half.
 *
 * Both halves of the contract meet here: the Host mounts a prefix route under
 * `/api/cli-doctor` (CONTRACT.md §2) and this module is the only place the
 * browser half talks to it (CONTRACT.md §1 §3.4). Requests are same-origin
 * relative paths, so the desktop shell's panel-forwarding (which rewrites the
 * origin but keeps the path) works unchanged.
 *
 * Errors are normalized into `CliDoctorRequestError` with a `code` the panel can
 * branch on (`busy`, `http`, `network`, `malformed`, `no-fetch`) and a
 * human-readable `message` it can render directly.
 *
 * @module dsh-cli-doctor/client/api
 */

/** Route that runs a read-only diagnosis. */
export const CHECK_ENDPOINT = '/api/cli-doctor/check';
/** Route that reports plugin version and busy state. */
export const HEALTH_ENDPOINT = '/api/cli-doctor/health';

/** Normalized request failure surfaced to the panel. */
export class CliDoctorRequestError extends Error {
  /**
   * @param message - user-facing reason.
   * @param options - `code` (machine branch), `status` (HTTP status if any) and
   *   `hostCode` (the Host's own `error` short code, verbatim).
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliDoctorRequestError';
    this.code = options.code || 'error';
    this.status = typeof options.status === 'number' ? options.status : null;
    this.hostCode = typeof options.hostCode === 'string' && options.hostCode ? options.hostCode : null;
  }
}

/** The fetch implementation to use: an explicit override, else the global one. */
function resolveFetch(override) {
  if (typeof override === 'function') return override;
  const impl = globalThis.fetch;
  if (typeof impl !== 'function') {
    throw new CliDoctorRequestError('当前环境不支持 fetch，无法连接诊断服务。', { code: 'no-fetch' });
  }
  return impl;
}

/** Best-effort JSON body read; a body that is not JSON becomes null. */
async function readJson(response) {
  if (!response || typeof response.json !== 'function') return null;
  try {
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** Short readable form of an arbitrary thrown value. */
function errorText(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

/**
 * Readable copy for the Host's stable short error codes (Lead-provided table,
 * CONTRACT.md §2 does not enumerate them).
 */
export const HOST_ERROR_TEXT = {
  forbidden: '请求被拒绝：面板未获得本机授权，请从本机 DSH 界面重试。',
  method: '诊断服务不接受该请求方法。',
  'not-found': '未找到诊断服务：Host 半体可能没有加载。',
  busy: '已有一次诊断正在进行中，请稍候再试。',
  timeout: '诊断超时（超过 8 分钟仍未结束），请稍后重试。',
  'output-too-large': '诊断输出超过安全上限，已被中止。',
  'invalid-json': '诊断返回的内容不是合法 JSON，无法解析。',
  'spawn-error': '无法启动诊断子进程（check.js 可能缺失或不可执行）。',
};

/**
 * Map an HTTP failure onto a readable sentence.
 *
 * The Host's `error` code wins over the HTTP status; a code this plugin does not
 * know is shown verbatim instead of being swallowed. With no code at all the
 * status decides.
 *
 * @param status - HTTP status (0 when unknown).
 * @param reason - the Host's `error` field, when present.
 * @returns user-facing message.
 */
export function failureMessage(status, reason) {
  const code = typeof reason === 'string' ? reason.trim() : '';
  if (code && Object.prototype.hasOwnProperty.call(HOST_ERROR_TEXT, code)) return HOST_ERROR_TEXT[code];
  if (/^exit-\d+$/.test(code)) return `诊断进程以退出码 ${code.slice('exit-'.length)} 结束。`;
  if (/^signal-[A-Za-z0-9]+$/.test(code)) return `诊断进程被信号 ${code.slice('signal-'.length)} 终止。`;
  if (code) return `诊断失败：${code}`;
  if (status === 409) return HOST_ERROR_TEXT.busy;
  if (status === 403) return HOST_ERROR_TEXT.forbidden;
  if (status === 404) return HOST_ERROR_TEXT['not-found'];
  if (status === 405) return HOST_ERROR_TEXT.method;
  if (status >= 500) return '诊断服务内部错误，请查看 DSH 日志后重试。';
  if (status > 0) return `诊断请求失败（HTTP ${status}）。`;
  return '诊断请求失败。';
}

/** Machine branch for a failure: `busy` when the Host is single-flighting. */
function failureCode(status, reason) {
  const code = typeof reason === 'string' ? reason.trim() : '';
  if (status === 409 || code === 'busy') return 'busy';
  return code ? 'host' : 'http';
}

/**
 * Run one diagnosis.
 *
 * @param options - `signal` (AbortSignal) and `fetch` (test/override seam).
 * @returns `{report, checkedAt}` with the Host's check.js JSON.
 * @throws {CliDoctorRequestError} normalized failure; `AbortError` is rethrown
 *   untouched so a cancelled (unmounted) call is not reported as a failure.
 */
export async function checkStatus(options = {}) {
  const send = resolveFetch(options.fetch);
  let response;
  try {
    response = await send(CHECK_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new CliDoctorRequestError(`无法连接诊断服务：${errorText(error)}`, { code: 'network' });
  }
  const payload = await readJson(response);
  const status = response && typeof response.status === 'number' ? response.status : 0;
  const reason = payload ? payload.error : null;
  if (response && response.ok === false) {
    throw new CliDoctorRequestError(failureMessage(status, reason), {
      code: failureCode(status, reason),
      status,
      hostCode: typeof reason === 'string' ? reason : null,
    });
  }
  if (payload && payload.ok === false) {
    throw new CliDoctorRequestError(failureMessage(status, reason), {
      code: failureCode(status, reason),
      status,
      hostCode: typeof reason === 'string' ? reason : null,
    });
  }
  const report = payload ? payload.report : null;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new CliDoctorRequestError('诊断服务返回的数据无法识别（report 缺失或不是对象）。', { code: 'malformed', status });
  }
  return {
    report,
    checkedAt: payload && typeof payload.checkedAt === 'string' ? payload.checkedAt : null,
  };
}

/**
 * Read the Host's health/version info. Never throws: the panel must render even
 * when the Host half is missing or the request fails.
 *
 * @param options - `signal` (AbortSignal) and `fetch` (test/override seam).
 * @returns `{ok, version, busy}` or null when unavailable.
 */
export async function fetchHealth(options = {}) {
  let send;
  try {
    send = resolveFetch(options.fetch);
  } catch {
    return null;
  }
  try {
    const response = await send(HEALTH_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    const payload = await readJson(response);
    if (!payload) return null;
    return {
      ok: payload.ok === true,
      version: typeof payload.version === 'string' && payload.version ? payload.version : null,
      busy: payload.busy === true,
    };
  } catch {
    return null;
  }
}
