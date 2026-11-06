/**
 * Module-level state store for the CLI Doctor panel (CONTRACT.md §v2.3).
 *
 * The panel is mounted in the shell's keyed `main` slot, so switching to another
 * sidebar entry unmounts it. Before v0.3 every piece of state (the 150 KB report,
 * the error, the scroll position) lived in component state and a diagnosis was
 * aborted on unmount. This module moves the authoritative state out of the
 * component: a run survives unmount, a completed report survives remounts, and
 * only an explicit user "取消" stops a run.
 *
 * The store intentionally owns the orchestration too — bootstrap (health →
 * snapshot → maybe one automatic check), manual runs, cancellation and the 1 s
 * wait-time ticker — so the panel component stays a pure renderer of this state
 * and the behaviour is unit-testable without React.
 *
 * Lifecycle: `apply()` in index.jsx resets the store when the plugin is disposed.
 * Nothing here starts a timer at import time.
 *
 * @module dsh-cli-doctor/client/store
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cancelCheck, checkStatus, fetchHealth, fetchSnapshot, fetchStatus } from './api.js';

/** Fallback snapshot TTL until the Host reports its own `cache.ttlMs` (12 h). */
export const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

/** How often the running state refreshes its waited time (CONTRACT.md §v2.3.4). */
export const WAIT_TICK_MS = 1000;

/** The state the store starts (and resets) at. */
const INITIAL_STATE = {
  phase: 'idle',
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
  summaryFilter: null,
};

let state = { ...INITIAL_STATE };
const listeners = new Set();
let bootstrapPromise = null;
let runPromise = null;
let waitTimer = null;
// Bumped by resetStore(); every async action checks it so a run that settles
// after the plugin was disposed cannot resurrect state or stop a newer ticker.
let generation = 0;

/** Whether an async action still belongs to the current store generation. */
function isCurrent(gen) {
  return gen === generation;
}

/** Whether a value is a finite number. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Milliseconds since an ISO timestamp, or null when unknown. */
function ageOfTimestamp(value, now = Date.now()) {
  if (typeof value !== 'string' || !value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, now - time);
}

/** The current immutable state snapshot. */
export function getState() {
  return state;
}

/** Subscribe to state changes; returns the unsubscribe function. */
export function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Merge a patch into the state and notify every subscriber. */
export function setState(patch) {
  if (!patch || typeof patch !== 'object') return state;
  state = { ...state, ...patch };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* A broken subscriber must not break the store. */
    }
  }
  return state;
}

/** Stop the 1 s wait ticker if it is running. */
function stopWaitTimer() {
  if (waitTimer !== null) {
    clearInterval(waitTimer);
    waitTimer = null;
  }
}

/** Start the 1 s wait ticker (exactly one; the run owns it). */
function startWaitTimer() {
  stopWaitTimer();
  waitTimer = setInterval(() => {
    if (state.phase !== 'running' || !isFiniteNumber(state.startedAt)) return;
    setState({ waitedMs: Math.max(0, Date.now() - state.startedAt) });
  }, WAIT_TICK_MS);
  // Node (unit tests) returns a Timeout with unref; browsers return a number.
  if (waitTimer && typeof waitTimer.unref === 'function') waitTimer.unref();
}

/** Reset the store to its initial state; the plugin's disposer calls this. */
export function resetStore() {
  generation += 1;
  stopWaitTimer();
  bootstrapPromise = null;
  runPromise = null;
  state = { ...INITIAL_STATE };
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Subscribe a component to the store.
 *
 * Uses `useSyncExternalStore` when the runtime has it (React 18+), and degrades
 * to `useState`/`useEffect` otherwise (CONTRACT.md §v2.3).
 *
 * @returns the current state.
 */
export function useStore() {
  if (typeof useSyncExternalStore === 'function') {
    return useSyncExternalStore(subscribe, getState);
  }
  const [snapshot, setSnapshot] = useState(getState);
  useEffect(() => subscribe(() => setSnapshot(getState())), []);
  return snapshot;
}

/**
 * Start (or join) one diagnosis.
 *
 * A second call while a run is in flight joins the existing promise instead of
 * issuing a second POST; the Host would attach it to the same run anyway.
 *
 * @param options - `reason` (`manual`/`auto`/`attached`/`retry`), `mode`
 *   (`full`/`fast`), `force` (1 = bypass the Host cache) and `presetElapsedMs`
 *   (join a run that already started on the Host).
 * @returns the settled state once the request finishes.
 */
export function startRun(options = {}) {
  if (state.phase === 'running') return runPromise || Promise.resolve(state);
  const reason = typeof options.reason === 'string' ? options.reason : 'manual';
  const mode = options.mode === 'fast' ? 'fast' : 'full';
  const force = options.force === 0 ? 0 : 1;
  const presetElapsedMs = isFiniteNumber(options.presetElapsedMs) ? Math.max(0, options.presetElapsedMs) : 0;
  const startedAt = Date.now() - presetElapsedMs;
  const runGeneration = generation;
  stopWaitTimer();
  setState({
    phase: 'running',
    error: null,
    notice: null,
    cancelling: false,
    attached: reason === 'attached',
    mode,
    runReason: reason,
    startedAt,
    waitedMs: presetElapsedMs,
  });
  startWaitTimer();
  const job = (async () => {
    try {
      const result = await checkStatus({ mode, force });
      if (!isCurrent(runGeneration)) return state;
      const checkedAt = result.checkedAt || new Date().toISOString();
      setState({
        phase: 'done',
        report: result.report,
        checkedAt,
        elapsedMs: result.elapsedMs,
        mode: result.mode || mode,
        busy: false,
        stale: false,
        snapshotAgeMs: 0,
        attached: result.cache === 'attached' || result.shared === true,
        error: null,
        runReason: null,
        waitedMs: 0,
        startedAt: null,
      });
      return state;
    } catch (error) {
      if (!isCurrent(runGeneration)) return state;
      const code = error && typeof error.code === 'string' ? error.code : null;
      if (code === 'cancelled') {
        // CONTRACT.md §v2.3: a cancelled run falls back to idle, keeping the
        // previous report (if any) on screen, and says so once.
        setState({
          phase: 'idle',
          busy: false,
          cancelling: false,
          attached: false,
          runReason: null,
          error: null,
          startedAt: null,
          waitedMs: 0,
          notice: { id: Date.now(), kind: 'cancelled', text: '已取消' },
        });
        return state;
      }
      setState({
        phase: 'error',
        busy: false,
        cancelling: false,
        attached: false,
        runReason: null,
        startedAt: null,
        waitedMs: 0,
        error: {
          message: error && typeof error.message === 'string' && error.message ? error.message : String(error),
          code,
          status: error && isFiniteNumber(error.status) ? error.status : null,
        },
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

/**
 * Toggle/clear the summary-card filter (CONTRACT.md §v2.8).
 *
 * `toolCount` (已发现工具) and a second click on the active card clear the
 * filter; any other field activates it. The selection lives in the store so it
 * survives unmounting the panel and is dropped by `resetStore`.
 *
 * @param field - one of the five summary counter fields.
 * @returns the filter now in effect (null = cleared).
 */
export function setSummaryFilter(field) {
  const next = field && field !== 'toolCount' && field !== state.summaryFilter ? field : null;
  setState({ summaryFilter: next });
  return next;
}

/** Run a diagnosis on explicit user request (full mode, cache bypassed). */
export function runCheck(options = {}) {
  return startRun({ reason: 'manual', mode: 'full', force: 1, ...options });
}

/**
 * Ask the Host to cancel the current run (`POST /check/cancel`).
 *
 * The pending `POST /check` then fails with `error:'cancelled'`, which flips the
 * store back to idle. A Host that reports `cancelled:false` (the run already
 * finished) is left alone so the in-flight result still lands.
 *
 * @returns whether the Host accepted the cancellation.
 */
export async function cancelCurrentCheck() {
  if (state.phase !== 'running' || state.cancelling) return false;
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
        kind: 'error',
        text: `取消失败：${error && typeof error.message === 'string' && error.message ? error.message : String(error)}`,
      },
    });
    return false;
  }
}

/**
 * Run the fixed mount sequence (CONTRACT.md §v2.3): health → snapshot → at most
 * one automatic full check when the cache is missing or stale.
 *
 * Idempotent for the lifetime of one store: the first successful call wins and
 * later mounts reuse its result, so a panel that is switched away and back does
 * not re-probe or re-run anything.
 *
 * @returns the state after bootstrapping.
 */
export function bootstrap() {
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

/** The body of {@link bootstrap}; never throws. */
async function runBootstrap(gen) {
  const health = await fetchHealth();
  if (!isCurrent(gen)) return state;
  if (health) setState({ version: health.version, busy: health.busy === true });
  const payload = await fetchSnapshot();
  if (!isCurrent(gen)) return state;
  const snapshot = payload && payload.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null;
  const cache = payload && payload.cache && typeof payload.cache === 'object' ? payload.cache : null;
  const ttlMs = cache && isFiniteNumber(cache.ttlMs) && cache.ttlMs > 0 ? cache.ttlMs : state.ttlMs;
  const autoCheck = !(cache && cache.autoCheck === false);
  setState({ ttlMs, autoCheck });

  if (!health && !payload) {
    setState({
      bootError: {
        message: '未能连接诊断服务（Host 半体可能未加载或版本过旧）。',
      },
    });
    return state;
  }

  if (snapshot && snapshot.report && typeof snapshot.report === 'object' && !state.report) {
    const checkedAt = typeof snapshot.checkedAt === 'string' && snapshot.checkedAt ? snapshot.checkedAt : null;
    const ageMs = isFiniteNumber(snapshot.ageMs) ? Math.max(0, snapshot.ageMs) : ageOfTimestamp(checkedAt);
    setState({
      phase: 'done',
      report: snapshot.report,
      checkedAt,
      mode: typeof snapshot.mode === 'string' && snapshot.mode ? snapshot.mode : null,
      elapsedMs: isFiniteNumber(snapshot.elapsedMs) ? snapshot.elapsedMs : null,
      snapshotAgeMs: ageMs,
      stale: snapshot.stale === true || (ageMs !== null && ageMs > ttlMs),
    });
  } else if (snapshot && !state.report) {
    const checkedAt = typeof snapshot.checkedAt === 'string' && snapshot.checkedAt ? snapshot.checkedAt : null;
    const ageMs = isFiniteNumber(snapshot.ageMs) ? Math.max(0, snapshot.ageMs) : ageOfTimestamp(checkedAt);
    if (ageMs !== null) setState({ snapshotAgeMs: ageMs, stale: ageMs > ttlMs });
  }

  // A run started by a previous mount is still in flight; it will settle the
  // store itself, so this mount only has to render the running state.
  if (state.phase === 'running') return state;

  const busy = (health && health.busy === true) || (payload && payload.busy === true);
  if (busy) {
    const status = await fetchStatus();
    if (!isCurrent(gen)) return state;
    const running = status && status.running && typeof status.running === 'object' ? status.running : null;
    const mode = running && running.mode === 'fast' ? 'fast' : 'full';
    const elapsedMs = running && isFiniteNumber(running.elapsedMs) ? running.elapsedMs : 0;
    startRun({ reason: 'attached', mode, force: 1, presetElapsedMs: Math.max(0, elapsedMs) });
    return state;
  }

  const ageMs = state.snapshotAgeMs !== null ? state.snapshotAgeMs : ageOfTimestamp(state.checkedAt);
  const missingOrStale = !state.report || (ageMs !== null && ageMs > ttlMs);
  if (autoCheck && !state.autoStarted && missingOrStale) {
    setState({ autoStarted: true });
    startRun({ reason: 'auto', mode: 'full', force: 1 });
  }
  return state;
}

/** Retry the mount sequence after the Host was unreachable. */
export function retryBootstrap() {
  setState({ bootstrapped: false, bootError: null });
  return bootstrap();
}
