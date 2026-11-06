/**
 * Client-half acceptance tests (CONTRACT.md §3, §v2.3, §6, §v2.5).
 *
 * The committed `lib/client.js` is executed exactly the way the Web GUI executes
 * it: a fake `window.__ModuleLoader__` captures the loader call, the factory is
 * invoked with the two modules this plugin is allowed to require, and the panel
 * is then rendered imperatively with react-dom into jsdom.
 *
 * v2 adds coverage for the module store workflow: bootstrap order
 * (health → snapshot → stale-gate auto check), snapshot restore, attach to a
 * running diagnosis, cancellation, unmount/remount survival (no abort anymore),
 * dependency-layer semantics, theme tokens and the phase-only live region.
 *
 * Store unit tests import `src/client/store.js` directly; panel tests go through
 * the committed bundle and always dispose the fake context, which resets the
 * bundle's store between tests.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as api from '../src/client/api.js';
import * as clientClipboard from '../src/client/clipboard.js';
import * as clientReport from '../src/client/report.js';
import * as clientStore from '../src/client/store.js';
import * as view from '../src/client/view.js';

const require_ = createRequire(import.meta.url);
const React = require_('react');
const jsxRuntime = require_('react/jsx-runtime');
const { createRoot } = require_('react-dom/client');

const CODE = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/* ------------------------------------------------------------------ jsdom -- */

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://127.0.0.1:19387/',
  pretendToBeVisual: true,
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'CustomEvent',
  'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'SVGElement',
  'DocumentFragment', 'Text', 'DOMParser', 'MutationObserver', 'CSSStyleDeclaration', 'localStorage', 'history',
]) {
  if (!(key in dom.window)) continue;
  try {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  } catch {
    /* Non-configurable globals in newer Node releases are not needed by React DOM here. */
  }
}

const act = React.act;

/* --------------------------------------------------------- bundle loading -- */

/** Run the committed bundle behind a capture-only module loader. */
function loadBundle() {
  const loaded = [];
  const windowStub = { __ModuleLoader__: { load: (spec) => loaded.push(spec) } };
  new Function('window', CODE)(windowStub);
  assert.equal(loaded.length, 1, 'the bundle must call __ModuleLoader__.load exactly once');
  const spec = loaded[0];
  const requested = [];
  const moduleExports = spec.factory((id) => {
    requested.push(id);
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`the bundle required a module outside the browser table: ${id}`);
  });
  return { spec, moduleExports, requested };
}

const bundle = loadBundle();

/* ----------------------------------------------------------------- helpers -- */

/** Fake Cordis client context with a slot registry recorder. */
function createFakeCtx({ withEffect = true } = {}) {
  const injectCalls = [];
  const registerCalls = [];
  const effects = [];
  const ctx = {
    slots: {
      inject(key, callback) {
        const record = { key, callback, disposed: false };
        injectCalls.push(record);
        const dispose = callback();
        record.inner = dispose;
        return () => {
          if (record.disposed) return;
          record.disposed = true;
          if (typeof dispose === 'function') dispose();
        };
      },
      register(options, component) {
        const record = { options, component, disposed: false };
        registerCalls.push(record);
        return () => {
          record.disposed = true;
        };
      },
    },
  };
  if (withEffect) {
    ctx.effect = (callback, label) => {
      const dispose = callback();
      effects.push({ label, dispose });
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    };
  }
  return { ctx, injectCalls, registerCalls, effects };
}

/** JSON response double for the fetch stub. */
function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/** Install a request-routing fetch stub; always restore in a finally block. */
function installFetch(route) {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const record = { url: String(url), init };
    calls.push(record);
    return route(record.url, init, calls.length);
  };
  return {
    calls,
    restore() {
      if (previous === undefined) delete globalThis.fetch;
      else globalThis.fetch = previous;
    },
  };
}

/** Install a clipboard implementation on the shared jsdom navigator; restore it in finally. */
function installClipboard(implementation) {
  const nav = dom.window.navigator;
  const had = Object.prototype.hasOwnProperty.call(nav, 'clipboard');
  const previous = nav.clipboard;
  Object.defineProperty(nav, 'clipboard', { value: implementation, configurable: true });
  return {
    restore() {
      if (had) Object.defineProperty(nav, 'clipboard', { value: previous, configurable: true });
      else delete nav.clipboard;
    },
  };
}

/** The summary-card button whose caption matches `label` exactly. */
function summaryButton(container, label) {
  const caption = [...container.querySelectorAll('button span')].find((element) => element.textContent === label);
  assert.ok(caption, `summary card "${label}" not found`);
  const button = caption.closest('button');
  assert.ok(button, `summary card "${label}" is not a button`);
  return button;
}

/** Tool names rendered as cards (dependency cards only exist without a filter). */
function toolCardNames(container) {
  return [...container.querySelectorAll('article h4')].map((element) => element.textContent);
}

/** A report with one tool per summary bucket, plus one conflicting dependency. */
function filterReport() {
  return {
    generated_at: '2026-10-13T07:30:00.000Z',
    scope: '筛选范围',
    elapsed_ms: 1000,
    skipped: [],
    managers: {
      homebrew: {
        tools: [
          {
            name: 'up-recommended', current: '1.0.0', latest: '1.1.0', outdated: true, upgrade_cmd: 'brew upgrade up-recommended',
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], conflicts: [], uncertain: [], indirect: [] },
          },
          {
            name: 'up-review', current: '1.0.0', latest: '1.1.0', outdated: true,
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], conflicts: [], uncertain: [{ name: 'u', reason: '可选' }], indirect: [] },
          },
          { name: 'up-blocked', current: '2.0.0', latest: '1.5.0', outdated: false },
          {
            name: 'up-steady', current: '1.0.0', latest: '1.0.0', outdated: false,
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], conflicts: [], uncertain: [], indirect: [] },
          },
          { name: 'up-unknown', current: '1.0.0', latest: null, outdated: null },
        ],
        deps: [
          {
            name: 'dep-conflict', current: '1.0.0', latest: '2.0.0',
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], conflicts: [{ name: 'z', requirement: '<2' }], uncertain: [], indirect: [] },
          },
        ],
      },
      npm_global: {
        tools: [
          {
            name: 'npm-recommended', current: '3.0.0', latest: '3.1.0', outdated: true,
            impact: { checked: true, scope: 'npm 全局依赖', dependents: [], conflicts: [], uncertain: [], indirect: [] },
          },
        ],
        deps: [],
      },
    },
  };
}

/** Render into a detached jsdom container inside act. */
async function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Let pending promises and timers settle inside act. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Flush the sequential bootstrap chain a few times. */
async function settle(times = 4) {
  for (let index = 0; index < times; index += 1) await flush();
}

/** Mount the registered panel with a fresh fake context and fetch route. */
async function mountPanel(route) {
  const fetchStub = installFetch(route);
  const fake = createFakeCtx();
  const dispose = bundle.moduleExports.apply(fake.ctx);
  const Panel = fake.registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  return {
    ...fake,
    fetchStub,
    mounted,
    container: mounted.container,
    async cleanup() {
      await mounted.unmount();
      dispose();
      fetchStub.restore();
    },
  };
}

/** The button whose visible text is exactly `label`. */
function buttonByText(container, label) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
}

/** Read one summary counter by its caption. */
function summaryValue(container, label) {
  const caption = [...container.querySelectorAll('span')].find((element) => element.textContent === label);
  assert.ok(caption, `summary caption "${label}" not found`);
  const value = caption.parentElement.querySelector('strong');
  assert.ok(value, `summary value for "${label}" not found`);
  return value.textContent;
}

/** POST calls across a fetch stub. */
function posts(fetchStub) {
  return fetchStub.calls.filter((call) => (call.init.method || 'GET').toUpperCase() === 'POST');
}

/** GET calls across a fetch stub. */
function gets(fetchStub) {
  return fetchStub.calls.filter((call) => (call.init.method || 'GET').toUpperCase() === 'GET');
}

/** A report in the shape of CONTRACT.md §4, covering the interesting branches. */
function sampleReport() {
  return {
    generated_at: '2026-10-13T07:30:00.000Z',
    scope: '当前 PATH 与全局环境',
    elapsed_ms: 12345,
    skipped: ['winget（当前系统不适用）'],
    managers: {
      homebrew: {
        tools: [
          {
            name: 'ripgrep', current: '14.1.0', latest: '14.2.0', outdated: true, upgrade_cmd: 'brew upgrade ripgrep',
            impact: {
              checked: true, scope: 'Homebrew 已装依赖',
              dependents: [{ name: 'fd', version: '10.2.0', requirement: '>=14' }],
              conflicts: [], uncertain: [], indirect: [],
            },
          },
          { name: 'bat', current: '0.24.0', latest: null, outdated: null, upgrade_cmd: null },
          { name: 'weird-tool', current: '2.0.0', latest: '1.5.0', outdated: false },
        ],
        deps: [
          {
            name: 'openssl@3', current: '3.3.0', latest: '3.4.0',
            impact: {
              checked: true, scope: 'Homebrew 已装依赖',
              dependents: [], conflicts: [], uncertain: [], indirect: [{ name: 'curl' }],
            },
          },
        ],
      },
      npm_global: {
        tools: [
          {
            name: 'typescript', current: '5.6.0', latest: '5.7.2', outdated: true, upgrade_cmd: 'npm i -g typescript',
            impact: { checked: false },
          },
        ],
        deps: [],
      },
      python_pip: { tools: [], deps: [] },
      rust_bun_uv: {
        tools: [
          {
            name: 'cargo-nextest', current: '0.9.80', latest: '0.9.85', outdated: true, major_jump: true,
            impact: { checked: true, scope: 'cargo install 已装包', dependents: [], conflicts: [], uncertain: [], indirect: [] },
          },
        ],
      },
      self_updating: {
        tools: [
          {
            name: 'claude-code', current: '1.0.0', latest: '1.0.2', outdated: true, upgrade_cmd: 'claude update',
            impact: { checked: true, scope: '全局安装目录', dependents: [], conflicts: [], uncertain: [], indirect: [], operational_review: null },
          },
        ],
      },
    },
  };
}

/** Healthy `/health` payload. */
function healthPayload(overrides = {}) {
  return { ok: true, version: '0.3.0', busy: false, capabilities: { snapshot: true, history: true, cancel: true }, lastCheck: null, ...overrides };
}

/** A `/snapshot` envelope for a cached report. */
function snapshotPayload(report, { ageMs = 0, ttlMs = 12 * 60 * 60 * 1000, autoCheck = true, checkedAt, mode = 'full', busy = false } = {}) {
  const timestamp = checkedAt || new Date().toISOString();
  return {
    ok: true,
    busy,
    cache: { ttlMs, autoCheck },
    snapshot: report
      ? {
        checkedAt: timestamp,
        mode,
        elapsedMs: 12345,
        ageMs,
        stale: ageMs > ttlMs,
        summary: {},
        report,
      }
      : null,
  };
}

/** A `/check` success envelope. */
function checkPayload(report = sampleReport(), { mode = 'full', elapsedMs = 12345, cache = 'fresh', shared = false } = {}) {
  return { ok: true, report, checkedAt: new Date().toISOString(), mode, elapsedMs, cache, shared };
}

/** Route table for the common "fresh cached snapshot" host. */
function snapshotRoute(report = sampleReport(), opts = {}) {
  return (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(report, opts));
    if (url.includes('/status')) return jsonResponse({ ok: true, busy: false, running: null, lastCheck: null, cache: { ttlMs: opts.ttlMs || 43200000 } });
    throw new Error(`unexpected request: ${url}`);
  };
}

/** Route table for a "new install" host: no snapshot and a settable check answer. */
function freshHostRoute(checkAnswer = () => jsonResponse(checkPayload()), { autoCheck = true } = {}) {
  return (url, init) => {
    if (url.includes('/check/cancel')) return jsonResponse({ ok: true, cancelled: true });
    if (url.includes('/check')) return checkAnswer(url, init);
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck }));
    if (url.includes('/status')) return jsonResponse({ ok: true, busy: false, running: null, lastCheck: null, cache: { ttlMs: 43200000 } });
    throw new Error(`unexpected request: ${url}`);
  };
}

/* ------------------------------------------------------------ bundle shell -- */

test('bundle shell: loader id, factory shape and module table purity', () => {
  assert.equal(bundle.spec.id, 'dsh-cli-doctor');
  assert.equal(bundle.spec.id, MANIFEST.name, 'loader id must be the package name');
  assert.equal(typeof bundle.spec.factory, 'function');
  assert.equal(bundle.spec.factory.length, 1, 'factory receives the require function');
  for (const id of bundle.requested) {
    assert.ok(['react', 'react/jsx-runtime'].includes(id), `unexpected require target: ${id}`);
  }
  const literals = [...CODE.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map((match) => match[2]);
  const forbidden = [...new Set(literals)].filter((id) => !['react', 'react/jsx-runtime'].includes(id));
  assert.deepEqual(forbidden, [], 'lib/client.js must only require react and react/jsx-runtime');
  assert.equal(/\bimport\s*\(/.test(CODE), false, 'the bundle must not use dynamic import()');
});

test('bundle exports: inject=[slots], apply() is callable, store module is bundled', () => {
  assert.deepEqual(bundle.moduleExports.inject, ['slots']);
  assert.equal(typeof bundle.moduleExports.apply, 'function');
  assert.match(CODE, /\/api\/cli-doctor\/snapshot/, 'the store route for /snapshot is bundled');
  assert.match(CODE, /\/api\/cli-doctor\/check\/cancel/, 'the store route for cancellation is bundled');
});

/* ------------------------------------------------------------- registration -- */

test('apply: registers the sidebar row and the main panel, both disposable', () => {
  const { ctx, injectCalls, registerCalls, effects } = createFakeCtx();
  const dispose = bundle.moduleExports.apply(ctx);

  assert.deepEqual(injectCalls.map((call) => call.key), ['sidebar.panellist', 'main']);
  assert.equal(registerCalls.length, 2);

  assert.deepEqual(registerCalls[0].options, {
    name: 'sidebar.panellist',
    id: 'cli-doctor',
    order: 30,
    label: 'CLI Doctor',
  });
  assert.equal(typeof registerCalls[0].component, 'function');

  assert.deepEqual(registerCalls[1].options, { name: 'main', key: 'cli-doctor' });
  assert.equal(typeof registerCalls[1].component, 'function');

  assert.deepEqual(effects.map((effect) => effect.label), ['cli-doctor: slots']);

  assert.equal(typeof dispose, 'function');
  dispose();
  assert.equal(registerCalls[0].disposed, true, 'sidebar row registration must be disposable');
  assert.equal(registerCalls[1].disposed, true, 'main panel registration must be disposable');
  assert.equal(injectCalls[0].disposed, true, 'slots.inject disposer must run');
  assert.equal(injectCalls[1].disposed, true, 'slots.inject disposer must run');
  dispose();
  assert.equal(registerCalls[0].disposed, true, 'disposal must be idempotent');
});

test('apply: also releases the seats on a runtime without ctx.effect', () => {
  const { ctx, registerCalls } = createFakeCtx({ withEffect: false });
  const dispose = bundle.moduleExports.apply(ctx);
  assert.equal(typeof dispose, 'function');
  dispose();
  assert.equal(registerCalls[0].disposed, true);
  assert.equal(registerCalls[1].disposed, true);
});

test('apply: a host without a slot service degrades instead of throwing', () => {
  const warnings = [];
  const previous = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const dispose = bundle.moduleExports.apply({});
    assert.equal(typeof dispose, 'function');
    dispose();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /slot service unavailable/);
  } finally {
    console.warn = previous;
  }
});

test('icon: draws a size-aware glyph for the sidebar row', async () => {
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Icon = registerCalls[0].component;
  const mounted = await mount(React.createElement(Icon, { size: 20, active: true }));
  try {
    const svg = mounted.container.querySelector('svg');
    assert.ok(svg, 'icon must render an svg');
    assert.equal(svg.getAttribute('width'), '20');
    assert.equal(svg.getAttribute('height'), '20');
    assert.equal(svg.getAttribute('data-dsh-panel-entry'), 'cli-doctor');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
  } finally {
    await mounted.unmount();
  }
});

/* -------------------------------------------------- mount bootstrap (v2.3) -- */

test('mount: probes health then snapshot?full=1, renders the cached report and does not run a check', async () => {
  const panel = await mountPanel(snapshotRoute());
  try {
    await settle();
    const calls = panel.fetchStub.calls;
    assert.equal(calls[0].url, '/api/cli-doctor/health', 'health must be probed first');
    assert.equal(calls[1].url, '/api/cli-doctor/snapshot?full=1', 'the snapshot probe must request the full report');
    assert.equal(posts(panel.fetchStub).length, 0, 'a fresh cached snapshot must not trigger an automatic check');
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
    assert.match(panel.container.textContent, /上次诊断 刚刚/);
    assert.ok(panel.container.textContent.includes('插件版本 0.3.0'), 'health version must be shown');
    assert.ok(panel.container.textContent.includes('ripgrep'), 'the cached report must render');
    assert.match(panel.container.textContent, /检查档位：全量档/);
  } finally {
    await panel.cleanup();
  }
});

test('mount: no snapshot + autoCheck runs exactly one full check, and a remount never re-runs it', async () => {
  const panel = await mountPanel(freshHostRoute(() => jsonResponse(checkPayload())));
  try {
    await settle();
    const checks = posts(panel.fetchStub);
    assert.equal(checks.length, 1, 'the automatic check runs exactly once');
    assert.match(checks[0].url, /^\/api\/cli-doctor\/check\?/);
    assert.match(checks[0].url, /mode=full/);
    assert.match(checks[0].url, /force=1/);
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
    assert.ok(panel.container.textContent.includes('ripgrep'));

    const before = panel.fetchStub.calls.length;
    await panel.mounted.unmount();
    const remounted = await mount(React.createElement(panel.registerCalls[1].component));
    try {
      await settle(2);
      assert.equal(posts(panel.fetchStub).length, 1, 'a remount must not start a second automatic check');
      assert.equal(panel.fetchStub.calls.length, before, 'a remount reuses the already bootstrapped store');
      assert.ok(remounted.container.textContent.includes('ripgrep'), 'the report survives the remount');
      assert.match(remounted.container.textContent, /当前状态：诊断完成/);
    } finally {
      await remounted.unmount();
    }
    // The first mount is already unmounted; cleanup must not double-unmount it.
    panel.mounted.unmount = async () => {};
  } finally {
    await panel.cleanup();
  }
});

test('mount: a stale snapshot triggers one automatic full check and replaces the cached report', async () => {
  const staleAgeMs = 13 * 60 * 60 * 1000;
  let checkCalls = 0;
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport(), { ageMs: staleAgeMs }));
    if (url.includes('/check')) {
      checkCalls += 1;
      return jsonResponse(checkPayload({ ...sampleReport(), scope: '刷新后的范围' }));
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    assert.equal(checkCalls, 1, 'a stale snapshot triggers exactly one check');
    assert.match(panel.container.textContent, /范围：刷新后的范围/);
    assert.equal(panel.container.textContent.includes('数据已过期'), false, 'a fresh run clears the expired marker');
  } finally {
    await panel.cleanup();
  }
});

test('mount: autoCheck=false skips the automatic run and explains the opt-out', async () => {
  const panel = await mountPanel(freshHostRoute(() => jsonResponse(checkPayload()), { autoCheck: false }));
  try {
    await settle();
    assert.equal(posts(panel.fetchStub).length, 0, 'autoCheck=false must not POST /check');
    assert.match(panel.container.textContent, /当前状态：空闲/);
    assert.match(panel.container.textContent, /首次打开不会自动检查/);
  } finally {
    await panel.cleanup();
  }
});

test('mount: a busy host attaches the running diagnosis and seeds the waited time from /status', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload({ busy: true }));
    if (url.includes('/snapshot')) return jsonResponse({ ok: true, busy: true, snapshot: null, cache: { ttlMs: 43200000, autoCheck: true } });
    if (url.includes('/status')) return jsonResponse({ ok: true, busy: true, running: { startedAt: new Date().toISOString(), elapsedMs: 65000, mode: 'full', waiters: 1 }, lastCheck: null, cache: { ttlMs: 43200000 } });
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    const checks = posts(panel.fetchStub);
    assert.equal(checks.length, 1, 'attaching issues one POST that joins the running check');
    assert.match(panel.container.textContent, /已连接本机正在进行的诊断/);
    assert.match(panel.container.textContent, /已等待 1 分 5 秒/);
    assert.equal(panel.container.querySelector('[data-dsh-cli-doctor-scroll]').getAttribute('aria-busy'), 'true');
    resolveCheck(jsonResponse(checkPayload()));
    await settle(2);
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
  } finally {
    await panel.cleanup();
  }
});

test('panel: a v1 Host without /snapshot still runs one automatic check from the empty cache', async () => {
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse({ ok: true, version: '0.2.0', busy: false });
    if (url.includes('/snapshot')) return jsonResponse({ ok: false, error: 'not-found' }, 404);
    if (url.includes('/check')) return jsonResponse({ ok: true, report: sampleReport(), checkedAt: new Date().toISOString() });
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    assert.equal(posts(panel.fetchStub).length, 1, 'the missing snapshot route degrades to one automatic check');
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
    assert.ok(panel.container.textContent.includes('ripgrep'));
    assert.match(panel.container.textContent, /检查档位：全量档/, 'the client knows which mode it requested');
  } finally {
    await panel.cleanup();
  }
});

test('mount: an unreachable Host shows a boot banner and can be retried', async () => {
  let hostDown = true;
  const route = (url) => {
    if (hostDown) throw new Error('ECONNREFUSED');
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport()));
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    assert.match(panel.container.textContent, /未能连接诊断服务/);
    assert.equal(posts(panel.fetchStub).length, 0, 'no check is started while the Host is unreachable');
    const retry = buttonByText(panel.container, '重试连接');
    assert.ok(retry, 'a reconnect button must be offered');
    hostDown = false;
    await act(async () => {
      retry.click();
    });
    await settle();
    assert.ok(panel.container.textContent.includes('ripgrep'), 'the retried bootstrap renders the snapshot');
  } finally {
    await panel.cleanup();
  }
});

/* ------------------------------------------------------------ panel states -- */

test('panel: clicking the button runs a full, forced check and renders the report', async () => {
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return jsonResponse(checkPayload());
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    const button = buttonByText(panel.container, '一键诊断当前状态');
    assert.ok(button, 'the panel must offer 「一键诊断当前状态」');
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.disabled, false);

    await act(async () => {
      button.click();
    });
    await settle();

    const checks = posts(panel.fetchStub);
    assert.equal(checks.length, 1, 'one click runs exactly one diagnosis');
    assert.equal(checks[0].url, '/api/cli-doctor/check?mode=full&force=1');
    assert.equal(checks[0].init.headers.Accept, 'application/json');

    const text = panel.container.textContent;
    assert.match(text, /当前状态：诊断完成/);
    assert.match(text, /生成时间：/);
    assert.match(text, /范围：当前 PATH 与全局环境/);
    assert.match(text, /耗时：12\.3 秒/);
    assert.match(text, /未检查：winget（当前系统不适用）/);
    assert.match(text, /只读检查/);
    assert.match(text, /未执行任何升级/);

    // Ecosystem blocks: fixed order, empty managers skipped, both layers shown.
    const titles = [...panel.container.querySelectorAll('h3')].map((element) => element.textContent);
    assert.deepEqual(titles, ['Homebrew', 'npm 全局', 'Rust / Bun / uv', '独立更新工具']);
    assert.ok(!text.includes('Python / pip'), 'a manager with no items is skipped');

    // Tool and dependency layers, names, versions, commands and status labels.
    assert.ok(text.includes('工具类'));
    assert.ok(text.includes('依赖包类 · 查看 1 个依赖'));
    assert.ok(text.includes('ripgrep'));
    assert.ok(text.includes('14.1.0') && text.includes('14.2.0'));
    assert.ok(text.includes('brew upgrade ripgrep'));
    assert.ok(text.includes('openssl@3'));

    // Dashboard status/recommendation semantics survived the port.
    assert.ok(text.includes('版本线异常'), 'candidate below current is an anomaly');
    assert.ok(text.includes('目标待核验'), 'missing latest is unknown');
    assert.ok(text.includes('影响待核验'), 'unchecked impact is a review');
    assert.ok(text.includes('升级建议 · 建议更新'));
    assert.ok(text.includes('与目标版本冲突') === false, 'no conflict was reported');
    assert.ok(text.includes('间接依赖'));

    // The five dashboard counters, computed over tools only.
    for (const [label, expected] of [
      ['已发现工具', '6'], ['有可用更新', '4'], ['建议更新', '1'], ['需核验或暂缓', '4'], ['目标待核验', '2'],
    ]) {
      assert.equal(summaryValue(panel.container, label), expected);
    }
    const counts = view.summarize(sampleReport());
    assert.equal(summaryValue(panel.container, '已发现工具'), String(counts.toolCount));
    assert.equal(summaryValue(panel.container, '有可用更新'), String(counts.updateCount));
    assert.equal(summaryValue(panel.container, '建议更新'), String(counts.recommendedCount));
    assert.equal(summaryValue(panel.container, '需核验或暂缓'), String(counts.reviewCount));
    assert.equal(summaryValue(panel.container, '目标待核验'), String(counts.unknownCount));
  } finally {
    await panel.cleanup();
  }
});

test('panel: failures keep the previous report and offer a retry; a v1 409 busy is still explained', async () => {
  let mode = 'ok';
  let payload = checkPayload();
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport(), { autoCheck: false }));
    if (url.includes('/check')) {
      if (mode === 'error') return jsonResponse({ ok: false, error: 'spawn check.js ENOENT' }, 500);
      if (mode === 'busy') return jsonResponse({ ok: false, error: 'busy' }, 409);
      return jsonResponse(payload);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    assert.ok(panel.container.textContent.includes('ripgrep'), 'the cached report is visible before the failure');

    mode = 'error';
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();
    const alert = panel.container.querySelector('[role="alert"]');
    assert.ok(alert, 'failures must be announced with role=alert');
    assert.match(alert.textContent, /spawn check\.js ENOENT/);
    assert.match(panel.container.textContent, /当前状态：诊断失败/);
    assert.ok(panel.container.textContent.includes('ripgrep'), 'the previous report stays readable after a failure');
    assert.ok(buttonByText(panel.container, '重试'), 'a retry button must be offered');

    mode = 'busy';
    await act(async () => {
      buttonByText(panel.container, '重试').click();
    });
    await settle();
    assert.match(panel.container.querySelector('[role="alert"]').textContent, /已有一次诊断正在进行中/);

    mode = 'ok';
    payload = checkPayload(sampleReport());
    await act(async () => {
      buttonByText(panel.container, '重试').click();
    });
    await settle();
    assert.equal(panel.container.querySelector('[role="alert"]'), null, 'a recovered run clears the alert');
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
  } finally {
    await panel.cleanup();
  }
});

test('panel: a 200 envelope with a missing report becomes a readable alert', async () => {
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return jsonResponse({ ok: true, report: null, checkedAt: null });
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();
    assert.match(panel.container.querySelector('[role="alert"]').textContent, /无法识别/);
    assert.match(panel.container.textContent, /当前状态：诊断失败/);
  } finally {
    await panel.cleanup();
  }
});

test('panel: cancel posts /check/cancel, falls back to idle, says 已取消 and keeps the old report', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport(), { autoCheck: false }));
    if (url.includes('/check/cancel')) return jsonResponse({ ok: true, cancelled: true });
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle(2);
    assert.match(panel.container.textContent, /当前状态：诊断中/);
    const cancel = buttonByText(panel.container, '取消');
    assert.ok(cancel, 'a running check must offer a cancel button');

    await act(async () => {
      cancel.click();
    });
    await settle(1);
    const cancels = posts(panel.fetchStub).filter((call) => call.url.includes('/check/cancel'));
    assert.equal(cancels.length, 1, 'cancel posts to the cancellation route');
    assert.equal(cancels[0].url, '/api/cli-doctor/check/cancel');

    resolveCheck(jsonResponse({ ok: false, error: 'cancelled' }, 500));
    await settle(2);
    assert.match(panel.container.textContent, /当前状态：空闲/);
    assert.match(panel.container.textContent, /已取消/);
    assert.equal(panel.container.querySelector('[role="alert"]'), null, 'a cancellation is not an error alert');
    assert.ok(panel.container.textContent.includes('ripgrep'), 'the previous report stays readable after cancel');
  } finally {
    await panel.cleanup();
  }
});

test('panel: a failed cancellation is reported and the run keeps going', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check/cancel')) return jsonResponse({ ok: false, error: 'not-found' }, 404);
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle(2);
    await act(async () => {
      buttonByText(panel.container, '取消').click();
    });
    await settle(1);
    assert.match(panel.container.textContent, /取消失败/);
    assert.match(panel.container.textContent, /当前状态：诊断中/, 'the run stays in flight after a failed cancel');
    resolveCheck(jsonResponse(checkPayload()));
    await settle(2);
    assert.match(panel.container.textContent, /当前状态：诊断完成/);
  } finally {
    await panel.cleanup();
  }
});

test('panel: unmount does not abort the in-flight check; the remount shows it and receives the result', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle(1);
    const check = posts(panel.fetchStub)[0];
    assert.ok(check);
    assert.equal(check.init.signal, undefined, 'the check request carries no abort signal (v2.3)');

    await panel.mounted.unmount();
    assert.equal(check.init.signal, undefined, 'unmount must not create/abort a signal');

    const remounted = await mount(React.createElement(panel.registerCalls[1].component));
    try {
      await settle(1);
      assert.match(remounted.container.textContent, /当前状态：诊断中/, 'the store keeps the run across mounts');
      resolveCheck(jsonResponse(checkPayload()));
      await settle(2);
      assert.match(remounted.container.textContent, /当前状态：诊断完成/);
      assert.ok(remounted.container.textContent.includes('ripgrep'));
    } finally {
      await remounted.unmount();
    }
    panel.mounted.unmount = async () => {};
  } finally {
    await panel.cleanup();
  }
});

test('panel: the 1 s wait ticker updates the wait line but never the live region', async () => {
  const callbacks = new Map();
  let nextId = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => {
    callbacks.delete(id);
  };
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle(1);
    assert.equal(callbacks.size, 1, 'the running store owns exactly one wait ticker');
    const liveRegion = panel.container.querySelector('header [role="status"][aria-live="polite"]');
    assert.ok(liveRegion, 'the phase live region must exist');
    assert.match(liveRegion.textContent, /当前状态：诊断中/);
    const liveBefore = liveRegion.textContent;
    for (const callback of [...callbacks.values()]) {
      await act(async () => {
        callback();
      });
    }
    assert.match(panel.container.textContent, /已等待 1\.0 秒|已等待 [0-9]/, 'the wait line reflects the ticker');
    assert.equal(liveRegion.textContent, liveBefore, 'the live region must not be rewritten by the wait ticker');
    const waitLine = [...panel.container.querySelectorAll('p')].find((element) => element.textContent.includes('已等待'));
    assert.equal(waitLine.getAttribute('aria-live'), 'off', 'the wait line itself is not a live region');
    assert.equal(panel.container.querySelector('[data-dsh-cli-doctor-scroll]').getAttribute('aria-busy'), 'true');

    resolveCheck(jsonResponse(checkPayload()));
    await settle(2);
    assert.equal(callbacks.size, 0, 'the wait ticker stops when the run settles');
    assert.equal(panel.container.querySelector('[data-dsh-cli-doctor-scroll]').getAttribute('aria-busy'), 'false');
  } finally {
    await panel.cleanup();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('panel: a second click while running does not start a second diagnosis', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const panel = await mountPanel(freshHostRoute(() => pending, { autoCheck: false }));
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle(1);
    const button = buttonByText(panel.container, '一键诊断当前状态');
    assert.equal(button.disabled, true, 'the action button is disabled while running');
    await act(async () => {
      button.click();
    });
    await settle(1);
    assert.equal(posts(panel.fetchStub).length, 1, 'the store joins the existing run');
  } finally {
    resolveCheck(jsonResponse(checkPayload()));
    await settle(1);
    await panel.cleanup();
  }
});

test('panel: tolerates an empty or malformed report without crashing', async () => {
  const malformed = {
    ok: true,
    checkedAt: null,
    report: {
      generated_at: null,
      scope: null,
      elapsed_ms: null,
      skipped: ['noop', 42, null],
      managers: { homebrew: { tools: [null, 42, { name: null }], deps: 'not-an-array' }, bogus: { tools: [{ name: 'x' }] } },
    },
  };
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return jsonResponse(malformed);
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();
    const text = panel.container.textContent;
    assert.match(text, /时间未知/);
    assert.match(text, /耗时未知/);
    assert.match(text, /未标注/);
    assert.match(text, /未检查：noop/);
    assert.match(text, /未知工具/);
    assert.equal(panel.container.querySelectorAll('h3').length, 1, 'only the known manager is rendered');
  } finally {
    await panel.cleanup();
  }
});

test('panel: an empty report shows the no-tools message', async () => {
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return jsonResponse({ ok: true, report: {}, checkedAt: null, mode: 'full' });
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();
    assert.match(panel.container.textContent, /没有发现可展示的 CLI 工具/);
    assert.equal(summaryValue(panel.container, '已发现工具'), '0');
  } finally {
    await panel.cleanup();
  }
});

/* --------------------------------------------------- dependency semantics -- */

test('panel: dependency cards never pair 「有可用更新」 with 「无法判断」 and show the risk cells', async () => {
  const report = {
    generated_at: '2026-10-13T07:30:00.000Z',
    scope: '全局',
    elapsed_ms: 1000,
    skipped: [],
    managers: {
      homebrew: {
        tools: [],
        deps: [
          {
            name: 'libcandidate', current: '1.0.0', latest: '1.1.0',
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], indirect: [], conflicts: [], uncertain: [] },
          },
          {
            name: 'libconflict', current: '2.0.0', latest: '3.0.0',
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], indirect: [], conflicts: [{ name: 'fd', requirement: '<3' }], uncertain: [] },
          },
          {
            name: 'libuncertain', current: '1.0.0', latest: '1.2.0',
            impact: { checked: true, scope: 'Homebrew 依赖', dependents: [], indirect: [], conflicts: [], uncertain: [{ name: 'x', requirement: '>=1', reason: '可选依赖' }] },
          },
        ],
      },
    },
  };
  const panel = await mountPanel(snapshotRoute(report));
  try {
    await settle();
    const text = panel.container.textContent;
    assert.ok(text.includes('候选更新 · 待核验'), 'dependencies without outdated render the candidate label');
    assert.ok(text.includes('依赖更新需人工核验'), 'the dependency recommendation is explicit');
    assert.equal(/有可用更新[^]{0,120}?无法判断/.test(text), false, 'the contradictory pair must not survive');
    assert.equal(summaryValue(panel.container, '依赖冲突'), '1');
    assert.equal(summaryValue(panel.container, '依赖待核验'), '1');
    assert.match(text, /依赖层风险（不计入上方工具计数）/);
  } finally {
    await panel.cleanup();
  }
});

test('panel: the dependency-risk cells stay hidden when there is no dependency risk', async () => {
  const panel = await mountPanel(snapshotRoute(sampleReport()));
  try {
    await settle();
    const text = panel.container.textContent;
    const captions = [...panel.container.querySelectorAll('span')].map((element) => element.textContent);
    assert.equal(captions.includes('依赖冲突'), false, 'no dependency-conflict cell without conflicts');
    assert.equal(captions.includes('依赖待核验'), false, 'no dependency-uncertain cell without uncertain entries');
  } finally {
    await panel.cleanup();
  }
});

/* ------------------------------------------------------------ theme tokens -- */

test('panel: semantic colours come from --dsw-alias tokens with the v1 hex only as fallback', async () => {
  const panel = await mountPanel(snapshotRoute());
  try {
    await settle();
    const root = panel.container.firstElementChild;
    assert.match(root.style.color, /var\(--dsw-alias-label-primary,/);
    assert.match(root.style.background, /var\(--dsw-alias-bg-base,/);
    const coloured = [...panel.container.querySelectorAll('*')]
      .map((element) => element.style && element.style.color)
      .filter(Boolean);
    assert.ok(coloured.some((value) => value.includes('var(--dsw-alias-brand-primary,')), 'the update tone uses the brand token');
    assert.ok(coloured.some((value) => value.includes('var(--dsw-alias-state-warn-primary,')), 'review/anomaly use the warn token');
    assert.ok(coloured.some((value) => value.includes('var(--dsw-alias-state-error-primary,')), 'blocked uses the error token');
    // No bare v1 hex may survive as the live colour value.
    assert.equal(coloured.some((value) => /^#[0-9a-f]{6}$/i.test(value.trim())), false, 'no bare hex colour values');
  } finally {
    await panel.cleanup();
  }
});

test('panel: a fast-mode report is explicitly labelled as incomplete', async () => {
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport(), { mode: 'fast' }));
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    assert.match(panel.container.textContent, /检查档位：快速档/);
    assert.match(panel.container.textContent, /未比对最新版本/);
  } finally {
    await panel.cleanup();
  }
});

/* ------------------------------------------------------------------ layout -- */

/**
 * Assert the fill-the-main-slot contract that keeps the panel scrollable.
 *
 * The shell's center column is `display:flex; overflow:hidden`, so the panel
 * itself must own a definite height and the single scroll container below its
 * fixed header; jsdom cannot measure layout, so the style contract is asserted.
 */
function assertPanelLayout(container) {
  const root = container.firstElementChild;
  assert.ok(root, 'the panel must render a root element');
  assert.equal(root.getAttribute('data-dsh-cli-doctor'), '');
  assert.equal(root.style.height, '100%');
  assert.equal(root.style.display, 'flex');
  assert.equal(root.style.flexDirection, 'column');
  assert.equal(root.style.minHeight, '0');
  assert.equal(root.style.minWidth, '0');
  assert.equal(root.style.boxSizing, 'border-box');
  assert.notEqual(root.style.flexGrow, '', 'the root must declare a flex shorthand or flex-grow');
  assert.notEqual(root.style.flexGrow, '0', 'the root must grow into the remaining column space');

  const header = root.querySelector('header');
  assert.ok(header, 'the panel must keep its header');
  assert.equal(header.style.flexShrink, '0', 'the header must stay fixed while the body scrolls');

  const scrollers = [...root.querySelectorAll('*')].filter((element) => element.style.overflowY === 'auto');
  assert.equal(scrollers.length, 1, 'the panel must own exactly one vertical scroll container');
  const body = scrollers[0];
  assert.equal(body.getAttribute('data-dsh-cli-doctor-scroll'), '');
  assert.equal(body.style.minHeight, '0');
  assert.equal(body.style.overflowX, 'hidden');
  assert.equal(body.style.overscrollBehavior, 'contain');
  assert.notEqual(body.style.flexGrow, '', 'the scroll container must declare a flex shorthand or flex-grow');
  assert.notEqual(body.style.flexGrow, '0', 'the scroll container must take the remaining height');
  assert.equal(body.contains(header), false, 'the header must not scroll out of view');
  return { root, header, body };
}

/** A report long enough that it could only be reached by scrolling. */
function longReport(count = 40) {
  return {
    generated_at: '2026-10-13T07:30:00.000Z',
    scope: '全局',
    elapsed_ms: 2000,
    skipped: [],
    managers: {
      homebrew: {
        tools: Array.from({ length: count }, (_, index) => ({
          name: `tool-${index}`,
          current: '1.0.0',
          latest: '1.1.0',
          outdated: true,
          upgrade_cmd: `brew upgrade tool-${index}`,
          impact: { checked: true, scope: '全局', dependents: [], conflicts: [], uncertain: [], indirect: [] },
        })),
        deps: [{ name: 'dep-a', current: '1.0.0', latest: '1.1.0', outdated: true }],
      },
      self_updating: { tools: [{ name: 'last-tool', current: '1.0.0', latest: '1.1.0', outdated: true }] },
    },
  };
}

test('layout: the root fills the main slot and the idle hint stays inside the scroll container', async () => {
  const panel = await mountPanel(freshHostRoute(() => jsonResponse(checkPayload()), { autoCheck: false }));
  try {
    await settle();
    const { body } = assertPanelLayout(panel.container);
    assert.match(body.textContent, /首次打开不会自动检查/, 'the idle hint lives in the scroll container');
    assert.equal(body.getAttribute('aria-busy'), 'false');
    assert.equal(buttonByText(panel.container, '复制报告'), undefined, 'copy actions only exist when a report exists');
  } finally {
    await panel.cleanup();
  }
});

test('layout: every tool card of a long report is inside the single scroll container', async () => {
  const panel = await mountPanel(freshHostRoute(() => jsonResponse(checkPayload(longReport(40))), { autoCheck: false }));
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();

    const { root, body } = assertPanelLayout(panel.container);
    const cards = [...root.querySelectorAll('article')];
    assert.equal(cards.length, 42, '40 tools + 1 dependency + the last tool');
    for (const card of cards) {
      assert.ok(body.contains(card), `card "${card.textContent.slice(0, 24)}" must be a descendant of the scroll container`);
    }
    const last = cards[cards.length - 1];
    assert.match(last.textContent, /last-tool/, 'the final block is the last rendered card');
    assert.ok(body.contains(last), 'the last card of the report must be reachable by scrolling');

    assert.ok(body.contains(root.querySelector('section')), 'ecosystem blocks scroll');
    assert.ok([...body.querySelectorAll('p')].some((element) => element.textContent.includes('未执行任何升级')), 'the footer scrolls');
    assert.ok([...body.querySelectorAll('span')].some((element) => element.textContent === '已发现工具'), 'the summary scrolls');
  } finally {
    await panel.cleanup();
  }
});

test('layout: loading and error states keep the same scroll contract', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  let failing = false;
  const route = (url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) {
      if (failing) return jsonResponse({ ok: false, error: 'timeout' }, 500);
      return pending;
    }
    throw new Error(`unexpected request: ${url}`);
  };
  const panel = await mountPanel(route);
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    const loading = assertPanelLayout(panel.container);
    assert.match(loading.body.textContent, /已等待/, 'the wait indicator lives in the scroll container');

    resolveCheck(jsonResponse({ ok: true, report: {}, checkedAt: null, mode: 'full' }));
    await settle(2);

    failing = true;
    await act(async () => {
      buttonByText(panel.container, '一键诊断当前状态').click();
    });
    await settle();
    const errored = assertPanelLayout(panel.container);
    const alert = errored.body.querySelector('[role="alert"]');
    assert.ok(alert, 'the failure alert lives in the scroll container');
    assert.match(alert.textContent, /诊断超时/);
    assert.equal(errored.header.querySelector('button').disabled, false, 'the action button stays in the fixed header');
  } finally {
    await panel.cleanup();
  }
});

/* --------------------------------------------------------- store unit tests -- */

test('store: bootstrap restores a snapshot, records the cache policy and skips the auto run', async () => {
  const fetchStub = installFetch((url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(sampleReport(), { ageMs: 5000, ttlMs: 3600000 }));
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    clientStore.resetStore();
    await clientStore.bootstrap();
    const state = clientStore.getState();
    assert.equal(state.phase, 'done');
    assert.equal(state.version, '0.3.0');
    assert.equal(state.ttlMs, 3600000);
    assert.equal(state.autoCheck, true);
    assert.equal(state.autoStarted, false);
    assert.ok(state.report && state.report.managers);
    assert.equal(posts(fetchStub).length, 0);
  } finally {
    clientStore.resetStore();
    fetchStub.restore();
  }
});

test('store: autoCheck fires at most once per store lifetime and a manual run bypasses the cache', async () => {
  const fetchStub = installFetch((url, init) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null));
    if (url.includes('/check')) return jsonResponse(checkPayload());
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    clientStore.resetStore();
    await clientStore.bootstrap();
    if (clientStore.getState().phase === 'running') await clientStore.startRun();
    await clientStore.bootstrap();
    const checks = fetchStub.calls.filter((call) => call.url.includes('/check'));
    assert.equal(checks.length, 1, 'bootstrap is idempotent and auto-runs once');
    assert.equal(clientStore.getState().autoStarted, true);
    assert.equal(clientStore.getState().phase, 'done');

    await clientStore.runCheck();
    const afterManual = fetchStub.calls.filter((call) => call.url.includes('/check'));
    assert.equal(afterManual.length, 2, 'a manual run always issues a new check');
    assert.match(afterManual[1].url, /mode=full/);
    assert.match(afterManual[1].url, /force=1/);
  } finally {
    clientStore.resetStore();
    fetchStub.restore();
  }
});

test('store: cancel flips a running store back to idle with a one-shot notice', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const fetchStub = installFetch((url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check/cancel')) return jsonResponse({ ok: true, cancelled: true });
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    clientStore.resetStore();
    await clientStore.bootstrap();
    const running = clientStore.runCheck();
    assert.equal(clientStore.getState().phase, 'running');
    const accepted = await clientStore.cancelCurrentCheck();
    assert.equal(accepted, true);
    resolveCheck(jsonResponse({ ok: false, error: 'cancelled' }, 500));
    await running;
    const state = clientStore.getState();
    assert.equal(state.phase, 'idle');
    assert.equal(state.notice.kind, 'cancelled');
    assert.match(state.notice.text, /已取消/);
    assert.equal(state.error, null);
  } finally {
    clientStore.resetStore();
    fetchStub.restore();
  }
});

test('store: a run settling after reset cannot resurrect state or stop the newer ticker', async () => {
  const callbacks = new Map();
  let nextId = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => {
    callbacks.delete(id);
  };
  let resolveFirst;
  let resolveSecond;
  const firstPending = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const secondPending = new Promise((resolve) => {
    resolveSecond = resolve;
  });
  let checkCount = 0;
  const fetchStub = installFetch((url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) {
      checkCount += 1;
      return checkCount === 1 ? firstPending : secondPending;
    }
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    clientStore.resetStore();
    await clientStore.bootstrap();
    const first = clientStore.runCheck();
    assert.equal(callbacks.size, 1);
    clientStore.resetStore();
    assert.equal(callbacks.size, 0, 'the disposer stops the old ticker');
    const second = clientStore.runCheck();
    assert.equal(callbacks.size, 1, 'the new run owns its own ticker');

    resolveFirst(jsonResponse(checkPayload({ ...sampleReport(), scope: '过期的第一个结果' })));
    await first;
    assert.equal(clientStore.getState().phase, 'running', 'a stale run must not settle the store');
    assert.equal(callbacks.size, 1, 'a stale run must not stop the newer ticker');

    resolveSecond(jsonResponse(checkPayload({ ...sampleReport(), scope: '第二个结果' })));
    await second;
    assert.equal(clientStore.getState().phase, 'done');
    assert.match(clientStore.getState().report.scope, /第二个结果/);
    assert.equal(callbacks.size, 0, 'the current run clears its ticker when it settles');
  } finally {
    clientStore.resetStore();
    fetchStub.restore();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('store: reset — the disposer path — clears the wait ticker while a run is in flight', async () => {
  const callbacks = new Map();
  let nextId = 1;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.clearInterval = (id) => {
    callbacks.delete(id);
  };
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const fetchStub = installFetch((url) => {
    if (url.includes('/health')) return jsonResponse(healthPayload());
    if (url.includes('/snapshot')) return jsonResponse(snapshotPayload(null, { autoCheck: false }));
    if (url.includes('/check')) return pending;
    throw new Error(`unexpected request: ${url}`);
  });
  try {
    clientStore.resetStore();
    await clientStore.bootstrap();
    const run = clientStore.runCheck();
    assert.equal(callbacks.size, 1, 'the running store owns a wait ticker');
    clientStore.resetStore();
    assert.equal(callbacks.size, 0, 'the disposer reset stops the wait ticker');
    assert.equal(clientStore.getState().phase, 'idle');
    assert.equal(clientStore.getState().report, null);
    resolveCheck(jsonResponse({ ok: false, error: 'cancelled' }, 500));
    await run;
  } finally {
    clientStore.resetStore();
    fetchStub.restore();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
});

test('store: dispose/reset erases the report so a new plugin instance starts clean', async () => {
  const first = await mountPanel(snapshotRoute(sampleReport()));
  try {
    await settle();
    assert.ok(first.container.textContent.includes('ripgrep'));
  } finally {
    await first.cleanup();
  }
  const otherReport = { ...sampleReport(), scope: '第二个实例的范围' };
  const second = await mountPanel(snapshotRoute(otherReport));
  try {
    await settle();
    assert.ok(second.container.textContent.includes('第二个实例的范围'));
  } finally {
    await second.cleanup();
  }
});

/* ------------------------------------------------------------ pure helpers -- */

test('view.candidateBelowCurrent: compares version heads only', () => {
  assert.equal(view.candidateBelowCurrent({ current: '2.0.0', latest: '1.5.0' }), true);
  assert.equal(view.candidateBelowCurrent({ current: '1.0.0', latest: '1.2.0' }), false);
  assert.equal(view.candidateBelowCurrent({ current: '1.2.0', latest: '1.2.0' }), false);
  assert.equal(view.candidateBelowCurrent({ current: '1.2.0', latest: '1.2.0-beta' }), false);
  assert.equal(view.candidateBelowCurrent({ current: '1.2', latest: '1.2.0.1' }), false);
  assert.equal(view.candidateBelowCurrent({ current: '1.10.0', latest: '1.9.0' }), true);
  assert.equal(view.candidateBelowCurrent({ current: null, latest: '1.0.0' }), false);
  assert.equal(view.candidateBelowCurrent({}), false);
  assert.equal(view.candidateBelowCurrent(null), false);
});

test('view.statusFor: tools keep v1 semantics, dependencies get the candidate label', () => {
  assert.deepEqual(view.statusFor({ outdated: true, latest: '2.0.0' }, '工具'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor({ outdated: null, latest: '2.0.0' }, '工具'), ['目标待核验', 'unknown']);
  assert.deepEqual(view.statusFor({ outdated: true, latest: null }, '工具'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor({ outdated: false, latest: null }, '工具'), ['目标待核验', 'unknown']);
  assert.deepEqual(view.statusFor({ outdated: false, latest: '1.0.0' }, '工具'), ['未检出更新', 'steady']);
  assert.deepEqual(view.statusFor({ current: '2.0.0', latest: '1.0.0', outdated: true }, '工具'), ['版本线异常', 'anomaly']);
  assert.deepEqual(view.statusFor(null, '工具'), ['目标待核验', 'unknown']);

  // CONTRACT.md §v2.3: a dependency without `outdated` is a candidate, not an update.
  assert.deepEqual(view.statusFor({ latest: '1.1.0' }, '依赖'), [view.DEP_CANDIDATE_LABEL, 'review']);
  assert.deepEqual(view.statusFor({ outdated: null, latest: '1.1.0' }, '依赖'), [view.DEP_CANDIDATE_LABEL, 'review']);
  assert.deepEqual(view.statusFor({ outdated: true, latest: '1.1.0' }, '依赖'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor({ outdated: false, latest: '1.1.0' }, '依赖'), ['未检出更新', 'steady']);
  assert.deepEqual(view.statusFor({}, '依赖'), ['目标待核验', 'unknown']);
});

test('view.recommendationFor: every contract branch maps to its label', () => {
  const base = { outdated: true, latest: '2.0.0' };
  assert.equal(view.recommendationFor({ current: '2.0.0', latest: '1.0.0', outdated: true }, '工具')[0], '暂不建议');
  assert.equal(view.recommendationFor({ outdated: null, latest: '2.0.0' }, '工具')[0], '无法判断');
  assert.equal(view.recommendationFor({ outdated: false, latest: '2.0.0' }, '工具')[0], '无需更新');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: false } }, '工具')[0], '影响待核验');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, conflicts: [{ name: 'fd' }] } }, '工具')[0], '暂不建议');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, uncertain: [{ name: 'x' }] } }, '工具')[0], '需人工核验');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, operational_review: '需要重启服务' } }, '工具')[2], '需要重启服务');
  assert.equal(view.recommendationFor({ ...base, major_jump: true, impact: { checked: true } }, '工具')[0], '需兼容验证');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, dependents: [{ name: 'fd' }] } }, '工具')[0], '需兼容验证');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, dependents: [{ name: 'fd' }] } }, '依赖')[0], '需人工核验');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, scope: '当前 Python 环境' } }, '工具')[0], '建议更新');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, scope: '当前 Python 环境', dependents: [{ name: 'x' }] } }, '工具')[0], '建议更新');
  assert.equal(view.recommendationFor({ ...base, impact: { checked: true, scope: 'Homebrew' } }, '工具')[0], '建议更新');
  assert.equal(view.recommendationFor(null, '工具')[0], '无法判断');

  // Dependencies without `outdated`: never "无法判断" while the status says update.
  const dep = (overrides) => ({ latest: '2.0.0', impact: { checked: true, conflicts: [], uncertain: [], dependents: [], indirect: [] }, ...overrides });
  assert.equal(view.recommendationFor(dep({}), '依赖')[0], view.DEP_REVIEW_LABEL);
  assert.equal(view.recommendationFor(dep({ impact: { checked: true, conflicts: [{ name: 'x' }], uncertain: [] } }), '依赖')[0], '暂不建议');
  assert.equal(view.recommendationFor(dep({ impact: { checked: true, conflicts: [], uncertain: [{ name: 'y' }] } }), '依赖')[0], '需人工核验');
  assert.equal(view.recommendationFor(dep({ impact: { checked: false } }), '依赖')[0], '影响待核验');
  assert.equal(view.recommendationFor({ }, '依赖')[0], '无法判断');
});

test('view: dependency status/recommendation pairs are never contradictory', () => {
  const impact = (overrides = {}) => ({ checked: true, conflicts: [], uncertain: [], dependents: [], indirect: [], ...overrides });
  const entries = [
    { name: 'a', current: '1.0.0', latest: '2.0.0', impact: impact() },
    { name: 'b', current: '1.0.0', latest: '2.0.0', impact: impact({ conflicts: [{ name: 'x', requirement: '<2' }] }) },
    { name: 'c', current: '1.0.0', latest: '2.0.0', impact: impact({ uncertain: [{ name: 'y' }] }) },
    { name: 'd', current: '1.0.0', latest: '2.0.0', impact: impact({ checked: false }) },
    { name: 'e', current: '1.0.0', latest: null, outdated: null },
    { name: 'f', current: '1.0.0', latest: '2.0.0', outdated: true, impact: impact() },
    { name: 'g', current: '1.0.0', latest: '2.0.0', outdated: false, impact: impact() },
  ];
  for (const entry of entries) {
    const [status] = view.statusFor(entry, '依赖');
    const [recommendation] = view.recommendationFor(entry, '依赖');
    assert.equal(
      status === '有可用更新' && recommendation === '无法判断',
      false,
      `contradictory pair for ${entry.name}: ${status} + ${recommendation}`,
    );
  }
});

test('view.impactView: checked flag, conflict marking and counts', () => {
  const unchecked = view.impactView({ impact: { checked: false, scope: 'x' } });
  assert.equal(unchecked.checked, false);
  assert.deepEqual(unchecked.entries, []);
  assert.equal(view.impactView({}).checked, false);
  assert.equal(view.impactView(null).checked, false);

  const checked = view.impactView({
    impact: {
      checked: true,
      scope: 'Homebrew 已装依赖',
      dependents: [{ name: 'fd', version: '10.2.0', requirement: '>=14' }],
      indirect: [{ name: 'curl' }],
      uncertain: [{ name: 'pkg-config', requirement: '^0.29', reason: '可选依赖' }],
      conflicts: [{ name: 'fd', requirement: '>=14' }],
    },
  });
  assert.equal(checked.checked, true);
  assert.equal(checked.scope, 'Homebrew 已装依赖');
  assert.deepEqual(checked.counts, { dependents: 1, indirect: 1, uncertain: 1 });
  assert.equal(checked.hasEntries, true);
  assert.equal(checked.entries.length, 3);
  assert.equal(checked.entries[0].tone, 'conflict');
  assert.match(checked.entries[0].text, /与目标版本冲突/);
  assert.equal(checked.entries[1].tone, 'indirect');
  assert.equal(checked.entries[2].tone, 'uncertain');
  assert.match(checked.entries[2].text, /可选依赖/);

  const bare = view.impactView({ impact: { checked: true } });
  assert.equal(bare.hasEntries, false);
  assert.deepEqual(bare.counts, { dependents: 0, indirect: 0, uncertain: 0 });
  assert.equal(bare.scope, null);
});

test('view.groupReport/summarize: fixed order, tool-only counters and the dependency totals', () => {
  assert.deepEqual(view.groupReport(null), []);
  assert.deepEqual(view.groupReport({}), []);
  assert.deepEqual(view.groupReport({ managers: { homebrew: null } }), []);
  assert.deepEqual(view.summarize(undefined).blocks, []);

  const reordered = {
    managers: {
      self_updating: { tools: [{ name: 'a', outdated: true, latest: '2.0.0' }] },
      homebrew: { tools: [{ name: 'b', outdated: true, latest: '2.0.0' }], deps: [{ name: 'c', latest: '1.0.0' }] },
      npm_global: { tools: [] },
    },
  };
  const blocks = view.groupReport(reordered);
  assert.deepEqual(blocks.map((block) => block.key), ['homebrew', 'self_updating']);
  assert.equal(blocks[0].tools.length, 1);
  assert.equal(blocks[0].deps.length, 1);
  assert.equal(blocks[0].updateCount, 1);

  const counts = view.summarize(reordered);
  assert.equal(counts.toolCount, 2);
  assert.equal(counts.updateCount, 2);
  assert.equal(counts.unknownCount, 0);
  assert.equal(counts.recommendedCount, 0, 'an unchecked impact can never be a recommendation');
  assert.equal(counts.reviewCount, 2);
  assert.equal(counts.depCount, 1);
  assert.equal(counts.conflictCount, 0);
  assert.equal(counts.uncertainCount, 0);
  const blockSum = blocks.reduce((total, block) => total + block.updateCount, 0);
  assert.equal(blockSum, counts.updateCount, 'per-block badges must sum to the summary counter');

  const risky = view.summarize({
    managers: {
      homebrew: {
        tools: [],
        deps: [
          { name: 'x', latest: '2.0.0', impact: { checked: true, conflicts: [{ name: 'a' }], uncertain: [] } },
          { name: 'y', latest: '2.0.0', impact: { checked: true, conflicts: [], uncertain: [{ name: 'b' }] } },
          { name: 'z', latest: '2.0.0', impact: { checked: true, conflicts: [], uncertain: [] } },
        ],
      },
    },
  });
  assert.equal(risky.depCount, 3);
  assert.equal(risky.conflictCount, 1);
  assert.equal(risky.uncertainCount, 1);

  const junk = view.summarize({ managers: { homebrew: { tools: [null, 1, 'x'], deps: {} } } });
  assert.equal(junk.toolCount, 3);
  assert.equal(junk.unknownCount, 3);
  assert.equal(junk.blocks[0].deps.length, 0);
});

test('view: timestamp, duration, scope, skipped and relative-time formatting', () => {
  assert.equal(view.formatTimestamp(null), '时间未知');
  assert.equal(view.formatTimestamp(''), '时间未知');
  assert.equal(view.formatTimestamp('not-a-date'), '时间未知');
  assert.notEqual(view.formatTimestamp('2026-10-13T07:30:00.000Z'), '时间未知');

  assert.equal(view.formatDuration(null), '耗时未知');
  assert.equal(view.formatDuration(-1), '耗时未知');
  assert.equal(view.formatDuration(0), '0 毫秒');
  assert.equal(view.formatDuration(999), '999 毫秒');
  assert.equal(view.formatDuration(1000), '1.0 秒');
  assert.equal(view.formatDuration(12345), '12.3 秒');
  assert.equal(view.formatDuration(65000), '1 分 5 秒');

  assert.equal(view.formatScope({ scope: '全局' }), '全局');
  assert.equal(view.formatScope({}), '未标注');
  assert.equal(view.formatScope(null), '未标注');

  assert.deepEqual(view.skippedChecks({ skipped: ['a', '', 3, null, 'b'] }), ['a', 'b']);
  assert.deepEqual(view.skippedChecks({}), []);
  assert.deepEqual(view.skippedChecks(null), []);

  const now = Date.parse('2026-11-06T12:00:00.000Z');
  assert.equal(view.relativeTime(null, now), '时间未知');
  assert.equal(view.relativeTime('not-a-date', now), '时间未知');
  assert.equal(view.relativeTime('2026-11-06T11:59:40.000Z', now), '刚刚');
  assert.equal(view.relativeTime('2026-11-06T11:55:00.000Z', now), '5 分钟前');
  assert.equal(view.relativeTime('2026-11-06T09:00:00.000Z', now), '3 小时前');
  assert.equal(view.relativeTime('2026-11-04T12:00:00.000Z', now), '2 天前');
  assert.equal(view.relativeTime('2026-11-06T12:00:10.000Z', now), '刚刚', 'future timestamps clamp to 刚刚');

  assert.equal(view.timestampAgeMs(null, now), null);
  assert.equal(view.timestampAgeMs('not-a-date', now), null);
  assert.equal(view.timestampAgeMs('2026-11-06T11:00:00.000Z', now), 60 * 60 * 1000);
  assert.equal(view.isStale(1000, 500), true);
  assert.equal(view.isStale(500, 1000), false);
  assert.equal(view.isStale(null, 1000), false);
  assert.equal(view.isStale(1000, null), false);
});

test('view: declared schema constants match the contract', () => {
  assert.deepEqual(view.MANAGERS.map((manager) => manager.key), [
    'homebrew', 'npm_global', 'python_pip', 'rust_bun_uv', 'self_updating',
  ]);
  assert.deepEqual(view.SUMMARY_FIELDS.map(([field, label]) => [field, label]), [
    ['toolCount', '已发现工具'],
    ['updateCount', '有可用更新'],
    ['recommendedCount', '建议更新'],
    ['reviewCount', '需核验或暂缓'],
    ['unknownCount', '目标待核验'],
  ]);
  assert.deepEqual(view.DEP_RISK_FIELDS.map(([field, label]) => [field, label]), [
    ['conflictCount', '依赖冲突'],
    ['uncertainCount', '依赖待核验'],
  ]);
  assert.equal(view.modeLabel('full'), '全量档');
  assert.equal(view.modeLabel('fast'), '快速档');
  assert.equal(view.modeLabel(undefined), null);
  assert.equal(view.modeCaveat('full'), null);
  assert.match(view.modeCaveat('fast'), /未比对最新版本/);
});

test('view: the panel is null-tolerant for every sample entry shape', () => {
  for (const item of [null, undefined, {}, 0, '', { impact: null }, { latest: '' }, { current: 5, latest: null }]) {
    assert.doesNotThrow(() => {
      view.statusFor(item, '工具');
      view.statusFor(item, '依赖');
      view.recommendationFor(item, '工具');
      view.recommendationFor(item, '依赖');
      view.impactView(item);
      view.candidateBelowCurrent(item);
    });
  }
});

/* --------------------------------------------------------- Host error codes -- */

test('api.failureMessage: the Host short-code table maps to readable copy', () => {
  assert.match(api.failureMessage(403, 'forbidden'), /未获得本机授权/);
  assert.match(api.failureMessage(405, 'method'), /不接受该请求方法/);
  assert.match(api.failureMessage(404, 'not-found'), /Host 半体可能没有加载/);
  assert.match(api.failureMessage(409, 'busy'), /已有一次诊断正在进行中/);
  assert.match(api.failureMessage(500, 'cancelled'), /诊断已取消/);
  assert.match(api.failureMessage(500, 'timeout'), /诊断超时/);
  assert.match(api.failureMessage(500, 'output-too-large'), /安全上限/);
  assert.match(api.failureMessage(500, 'invalid-json'), /不是合法 JSON/);
  assert.match(api.failureMessage(500, 'spawn-error'), /无法启动诊断子进程/);
  assert.match(api.failureMessage(500, 'exit-3'), /退出码 3/);
  assert.match(api.failureMessage(500, 'signal-SIGTERM'), /信号 SIGTERM/);

  assert.equal(api.failureMessage(500, 'totally-new-code'), '诊断失败：totally-new-code');
  assert.match(api.failureMessage(500, null), /内部错误/);
  assert.match(api.failureMessage(403, null), /未获得本机授权/);
  assert.match(api.failureMessage(418, null), /HTTP 418/);
  assert.match(api.failureMessage(0, null), /诊断请求失败/);
});

test('api.checkStatus: rejects a missing/non-object report and surfaces the v2 metadata', async () => {
  for (const report of [null, undefined, 'nope', 42, [], true]) {
    await assert.rejects(
      () => api.checkStatus({ fetch: async () => jsonResponse({ ok: true, report, checkedAt: null }) }),
      (error) => {
        assert.equal(error.code, 'malformed');
        assert.match(error.message, /无法识别/);
        return true;
      },
    );
  }
  const ok = await api.checkStatus({
    fetch: async () => jsonResponse({ ok: true, report: { managers: {} }, checkedAt: '2026-10-13T07:31:02.000Z', mode: 'full', elapsedMs: 70000, cache: 'fresh', shared: true }),
  });
  assert.deepEqual(ok.report, { managers: {} });
  assert.equal(ok.checkedAt, '2026-10-13T07:31:02.000Z');
  assert.equal(ok.mode, 'full');
  assert.equal(ok.elapsedMs, 70000);
  assert.equal(ok.cache, 'fresh');
  assert.equal(ok.shared, true);

  const attached = await api.checkStatus({ fetch: async () => jsonResponse({ ok: true, report: {}, cache: 'attached' }) });
  assert.equal(attached.cache, 'attached');
  assert.equal(attached.mode, null);
  assert.equal(attached.elapsedMs, null);
});

test('api.checkStatus: encodes the v2 mode/force flags in the request URL', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return jsonResponse({ ok: true, report: {} });
  };
  await api.checkStatus({ fetch: fetchImpl });
  assert.equal(seen[0], '/api/cli-doctor/check');
  await api.checkStatus({ fetch: fetchImpl, mode: 'full', force: 1 });
  assert.equal(seen[1], '/api/cli-doctor/check?mode=full&force=1');
  await api.checkStatus({ fetch: fetchImpl, mode: 'fast', force: 0 });
  assert.equal(seen[2], '/api/cli-doctor/check?mode=fast&force=0');
  await api.checkStatus({ fetch: fetchImpl, mode: 'weird' });
  assert.equal(seen[3], '/api/cli-doctor/check');
});

test('api.checkStatus: host codes surface on the error object, including cancelled', async () => {
  for (const [status, code, pattern] of [[500, 'timeout', /诊断超时/], [409, 'busy', /已有一次诊断正在进行中/], [500, 'exit-7', /退出码 7/], [500, 'cancelled', /诊断已取消/]]) {
    await assert.rejects(
      () => api.checkStatus({ fetch: async () => jsonResponse({ ok: false, error: code }, status) }),
      (error) => {
        assert.equal(error.hostCode, code);
        assert.equal(error.status, status);
        assert.match(error.message, pattern);
        return true;
      },
    );
  }
  await assert.rejects(
    () => api.checkStatus({ fetch: async () => jsonResponse({ ok: false, error: 'cancelled' }) }),
    (error) => {
      assert.equal(error.code, 'cancelled');
      return true;
    },
  );
  await assert.rejects(
    () => api.checkStatus({ fetch: async () => { throw new Error('offline'); } }),
    (error) => {
      assert.equal(error.code, 'network');
      assert.match(error.message, /无法连接诊断服务/);
      return true;
    },
  );
  const aborted = new Error('aborted');
  aborted.name = 'AbortError';
  await assert.rejects(
    () => api.checkStatus({ fetch: async () => { throw aborted; } }),
    (error) => error.name === 'AbortError',
  );
});

test('api.fetchHealth: never throws, tolerates junk and missing fields', async () => {
  assert.deepEqual(
    await api.fetchHealth({ fetch: async () => jsonResponse({ ok: true, version: '9.9.9', busy: true }) }),
    { ok: true, version: '9.9.9', busy: true },
  );
  assert.deepEqual(
    await api.fetchHealth({ fetch: async () => jsonResponse({ ok: true }) }),
    { ok: true, version: null, busy: false },
  );
  assert.equal(await api.fetchHealth({ fetch: async () => { throw new Error('down'); } }), null);
  assert.equal(await api.fetchHealth({ fetch: async () => jsonResponse(null, 500) }), null);
  assert.equal(await api.fetchHealth({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) }), null);
});

test('api.fetchSnapshot: parses the v2 envelope, never throws and tolerates a null snapshot', async () => {
  const seen = [];
  const ok = await api.fetchSnapshot({
    fetch: async (url) => {
      seen.push(url);
      return jsonResponse({
        ok: true,
        snapshot: { checkedAt: '2026-10-13T07:31:02.000Z', mode: 'full', elapsedMs: 1000, ageMs: 5000, stale: false, report: { managers: {} } },
        busy: true,
        cache: { ttlMs: 43200000, autoCheck: false },
      });
    },
  });
  assert.equal(seen[0], '/api/cli-doctor/snapshot?full=1');
  assert.equal(ok.snapshot.mode, 'full');
  assert.equal(ok.busy, true);
  assert.deepEqual(ok.cache, { ttlMs: 43200000, autoCheck: false });

  const empty = await api.fetchSnapshot({ fetch: async () => jsonResponse({ ok: true, snapshot: null, busy: false, cache: { ttlMs: 1, autoCheck: true } }) });
  assert.equal(empty.snapshot, null);
  assert.deepEqual(empty.cache, { ttlMs: 1, autoCheck: true });

  assert.equal(await api.fetchSnapshot({ fetch: async () => jsonResponse({ ok: false, error: 'forbidden' }, 403) }), null);
  assert.equal(await api.fetchSnapshot({ fetch: async () => { throw new Error('down'); } }), null);
  assert.equal(await api.fetchSnapshot({ fetch: async () => jsonResponse(null) }), null);
});

test('api.fetchStatus: parses the running diagnosis and never throws', async () => {
  const status = await api.fetchStatus({
    fetch: async () => jsonResponse({
      ok: true,
      busy: true,
      running: { startedAt: '2026-10-13T07:30:00.000Z', elapsedMs: 65000, mode: 'full', waiters: 2 },
      lastCheck: { checkedAt: '2026-10-13T06:00:00.000Z', mode: 'full', ageMs: 5400000 },
      cache: { ttlMs: 43200000 },
    }),
  });
  assert.equal(status.busy, true);
  assert.equal(status.running.elapsedMs, 65000);
  assert.equal(status.lastCheck.mode, 'full');
  assert.equal(await api.fetchStatus({ fetch: async () => { throw new Error('down'); } }), null);
  assert.equal(await api.fetchStatus({ fetch: async () => jsonResponse({ ok: false, error: 'forbidden' }, 403) }), null);
  assert.deepEqual(
    await api.fetchStatus({ fetch: async () => jsonResponse({ ok: true }) }),
    { busy: false, running: null, lastCheck: null, cache: null },
  );
});

test('api.cancelCheck: posts to the cancel route and maps failures', async () => {
  const seen = [];
  const ok = await api.cancelCheck({ fetch: async (url, init) => { seen.push({ url, init }); return jsonResponse({ ok: true, cancelled: true }); } });
  assert.equal(ok.cancelled, true);
  assert.equal(seen[0].url, '/api/cli-doctor/check/cancel');
  assert.equal(seen[0].init.method, 'POST');

  const nothing = await api.cancelCheck({ fetch: async () => jsonResponse({ ok: true, cancelled: false }) });
  assert.equal(nothing.cancelled, false);

  await assert.rejects(
    () => api.cancelCheck({ fetch: async () => jsonResponse({ ok: false, error: 'not-found' }, 404) }),
    (error) => {
      assert.equal(error.code, 'host');
      assert.equal(error.hostCode, 'not-found');
      return true;
    },
  );
  await assert.rejects(
    () => api.cancelCheck({ fetch: async () => { throw new Error('offline'); } }),
    (error) => error.code === 'network',
  );
  await assert.rejects(
    () => api.cancelCheck({ fetch: async () => ({ ok: true, status: 200, json: async () => null }) }),
    (error) => error.code === 'malformed',
  );
});

/* --------------------------------------------------- report export (§v2.8) -- */

/** A report with one entry per interesting export branch. */
function reportFixture() {
  const report = filterReport();
  report.skipped = ['winget（当前系统不适用）'];
  report.managers.homebrew.tools[0].note = '本次只读检查提示';
  report.managers.homebrew.deps.push({
    name: 'dep-uncertain',
    current: '1.0.0',
    latest: '1.1.0',
    impact: {
      checked: true, scope: 'Homebrew 依赖', dependents: [], conflicts: [],
      uncertain: [{ name: 'q', requirement: '>=1', reason: '可选 extra' }], indirect: [],
    },
  });
  return report;
}

test('report.buildJsonReport: round-trips the exact report with two-space indentation', () => {
  const report = reportFixture();
  const json = clientReport.buildJsonReport(report);
  assert.deepEqual(JSON.parse(json), report);
  assert.match(json, /\n  "generated_at"/, 'the JSON export must be indented');
  assert.equal(clientReport.buildJsonReport(null), 'null');
});

test('report.buildMarkdownReport: carries every required section and field', () => {
  const fixture = reportFixture();
  const markdown = clientReport.buildMarkdownReport(fixture, {
    pluginVersion: '0.3.0',
    checkedAt: '2026-10-13T07:31:02.000Z',
    mode: 'full',
    elapsedMs: 12345,
    stale: false,
    now: Date.parse('2026-10-13T07:32:00.000Z'),
  });

  // Title + basic info (CONTRACT.md §v2.8).
  assert.ok(markdown.startsWith('# CLI Doctor 诊断报告'));
  for (const expected of [
    '## 基本信息', '插件版本：0.3.0', '生成时间：', '检查时间：', '检查模式：全量档',
    '耗时：12.3 秒', '检查范围：筛选范围', '数据状态：有效',
  ]) {
    assert.ok(markdown.includes(expected), `markdown must contain "${expected}"`);
  }

  // Summary counters incl. dependency risk.
  assert.ok(markdown.includes('## 汇总计数'));
  assert.ok(markdown.includes('| 已发现工具 | 6 |'));
  assert.ok(markdown.includes('| 依赖包 | 2 |'));
  assert.ok(markdown.includes('| 依赖冲突 | 1 |'));
  assert.ok(markdown.includes('| 依赖待核验 | 1 |'));

  // Actionable tool details per ecosystem.
  assert.ok(markdown.includes('## 可行动工具明细'));
  assert.ok(markdown.includes('### Homebrew'));
  assert.ok(markdown.includes('#### up-recommended'));
  for (const expected of [
    '- 当前版本：1.0.0', '- 目标版本：1.1.0', '- 状态：有可用更新', '- 建议：建议更新',
    '- 升级命令（本插件不执行，仅供人工核对）：`brew upgrade up-recommended`',
    '- 依赖影响：直接依赖 0 个 · 间接依赖 0 个 · 待核验 0 项；范围：Homebrew 依赖。',
    '- 备注：本次只读检查提示',
  ]) {
    assert.ok(markdown.includes(expected), `markdown must contain "${expected}"`);
  }

  // Dependency conflicts / uncertain details.
  assert.ok(markdown.includes('## 依赖冲突与待核验'));
  assert.ok(markdown.includes('### 依赖冲突（1 条）'));
  assert.ok(markdown.includes('- dep-conflict（1.0.0 → 2.0.0）：z · <2'));
  assert.ok(markdown.includes('### 依赖待核验（1 条）'));
  assert.ok(markdown.includes('- dep-uncertain（1.0.0 → 1.1.0）：q · >=1 · 可选 extra'));

  // Up-to-date names live in their own section, not in the actionable details.
  assert.ok(markdown.includes('## 已是最新工具'));
  const actionableSection = markdown.slice(markdown.indexOf('## 可行动工具明细'), markdown.indexOf('## 依赖冲突与待核验'));
  assert.ok(actionableSection.includes('up-steady') === false, 'steady tools must not be listed as actionable');
  assert.ok(markdown.includes('up-steady'), 'steady tools must be listed in the up-to-date section');

  // Skipped / degraded, semantics, read-only policy, data source.
  assert.ok(markdown.includes('## 未检查项与降级说明'));
  assert.ok(markdown.includes('未检查：winget（当前系统不适用）'));
  assert.ok(markdown.includes('## 状态与建议语义'));
  assert.ok(markdown.includes('候选更新 · 待核验'));
  assert.ok(markdown.includes('## 只读说明'));
  assert.ok(markdown.includes('不执行、也不代为执行任何升级动作'));
  assert.ok(markdown.includes('## 数据来源'));
  assert.ok(markdown.includes('check.js --json --no-update'));

  // No execution instruction or "just run this" inducement may appear.
  assert.equal(/请运行|请执行|立即升级|现在就升级|交给 Agent/.test(markdown), false);
});

test('report.buildMarkdownReport: marks fast-mode and stale data explicitly', () => {
  const markdown = clientReport.buildMarkdownReport(reportFixture(), {
    pluginVersion: null, checkedAt: null, mode: 'fast', elapsedMs: null, stale: true,
    now: Date.parse('2026-10-13T07:32:00.000Z'),
  });
  assert.ok(markdown.includes('检查模式：快速档'));
  assert.ok(markdown.includes('未比对最新版本'));
  assert.ok(markdown.includes('数据状态：已过期'));
});

test('report.buildMarkdownReport: tolerates an empty or malformed report', () => {
  for (const report of [null, undefined, {}, { managers: null }, { managers: { homebrew: { tools: [null, 42, 'x'], deps: 'nope' } } }]) {
    const markdown = clientReport.buildMarkdownReport(report);
    assert.equal(typeof markdown, 'string');
    assert.ok(markdown.includes('# CLI Doctor 诊断报告'));
    assert.ok(markdown.includes('## 只读说明'));
  }
  const empty = clientReport.buildMarkdownReport({});
  assert.ok(empty.includes('| 已发现工具 | 0 |'));
  assert.ok(empty.includes('本次未发现需要处理的可行动工具'));
  assert.ok(empty.includes('未发现依赖冲突'));
  assert.ok(empty.includes('未发现已是最新的工具'));
});

/* ------------------------------------------------------- clipboard (§v2.8) -- */

test('clipboard.copyText: success, unavailable and failure never throw', async () => {
  const copied = [];
  const ok = await clientClipboard.copyText('# report', { clipboard: { writeText: async (value) => copied.push(value) } });
  assert.deepEqual(ok, { ok: true, reason: null, message: null });
  assert.deepEqual(copied, ['# report']);

  assert.deepEqual(await clientClipboard.copyText('x', { clipboard: null }), { ok: false, reason: 'unavailable', message: null });
  assert.deepEqual(await clientClipboard.copyText('x', { clipboard: {} }), { ok: false, reason: 'unavailable', message: null });

  const failed = await clientClipboard.copyText('x', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'failed');
  assert.equal(failed.message, 'denied');

  assert.equal(clientClipboard.COPY_FEEDBACK_MS, 2000);
});

test('clipboard.copyText: stringifies non-string input and treats null as empty', async () => {
  const copied = [];
  const seam = { clipboard: { writeText: async (value) => copied.push(value) } };
  await clientClipboard.copyText(42, seam);
  await clientClipboard.copyText(null, seam);
  assert.deepEqual(copied, ['42', '']);
});

/* --------------------------------------------- panel copy actions (§v2.8) -- */

test('panel: copying the Markdown report writes it to the clipboard and confirms with aria-live', async () => {
  const copied = [];
  const clipboardStub = installClipboard({ writeText: async (value) => copied.push(value) });
  const panel = await mountPanel(snapshotRoute(reportFixture()));
  try {
    await settle();
    const before = panel.fetchStub.calls.length;
    const markdownButton = buttonByText(panel.container, '复制报告');
    assert.ok(markdownButton, 'the primary copy action must be discoverable');
    assert.match(markdownButton.getAttribute('aria-label'), /Markdown/);
    await act(async () => {
      markdownButton.click();
    });
    await settle(2);

    assert.equal(copied.length, 1, 'one click performs exactly one clipboard write');
    assert.ok(copied[0].startsWith('# CLI Doctor 诊断报告'));
    assert.ok(copied[0].includes('## 汇总计数'));
    assert.ok(copied[0].includes('## 可行动工具明细'));
    assert.ok(copied[0].includes('## 只读说明'));
    assert.equal(panel.fetchStub.calls.length, before, 'copying must not trigger a request');
    assert.ok(panel.container.textContent.includes('up-recommended'), 'the report is unchanged by copying');

    const feedback = panel.container.querySelector('[data-dsh-cli-doctor-copy-feedback]');
    assert.ok(feedback, 'the copy feedback must be announced');
    assert.equal(feedback.getAttribute('aria-live'), 'polite');
    assert.match(feedback.textContent, /已复制/);
  } finally {
    await panel.cleanup();
    clipboardStub.restore();
  }
});

test('panel: copying the raw JSON report writes the untouched report', async () => {
  const copied = [];
  const clipboardStub = installClipboard({ writeText: async (value) => copied.push(value) });
  const panel = await mountPanel(snapshotRoute(reportFixture()));
  try {
    await settle();
    const jsonButton = buttonByText(panel.container, '复制原始 JSON');
    assert.ok(jsonButton, 'the secondary copy action must be discoverable');
    assert.match(jsonButton.getAttribute('aria-label'), /JSON/);
    await act(async () => {
      jsonButton.click();
    });
    await settle(2);
    assert.equal(copied.length, 1);
    assert.deepEqual(JSON.parse(copied[0]), reportFixture());
  } finally {
    await panel.cleanup();
    clipboardStub.restore();
  }
});

test('panel: a failing clipboard falls back to a read-only textarea', async () => {
  const clipboardStub = installClipboard({ writeText: async () => { throw new Error('clipboard-denied'); } });
  const panel = await mountPanel(snapshotRoute(reportFixture()));
  try {
    await settle();
    const styleTagsBefore = document.querySelectorAll('style').length;
    await act(async () => {
      buttonByText(panel.container, '复制报告').click();
    });
    await settle(2);

    const textarea = panel.container.querySelector('textarea');
    assert.ok(textarea, 'the failed copy path must render a manual-copy textarea');
    assert.equal(textarea.readOnly, true, 'the fallback textarea is read-only');
    assert.ok(textarea.value.startsWith('# CLI Doctor 诊断报告'));
    assert.ok(panel.container.textContent.includes('手动复制'));
    assert.match(panel.container.textContent, /剪贴板写入失败/);
    assert.match(panel.container.textContent, /clipboard-denied/);
    assert.equal(document.querySelectorAll('style').length, styleTagsBefore, 'the fallback must not inject style tags');

    await act(async () => {
      buttonByText(panel.container, '关闭').click();
    });
    await flush();
    assert.equal(panel.container.querySelector('textarea'), null, 'the fallback panel can be dismissed');
  } finally {
    await panel.cleanup();
    clipboardStub.restore();
  }
});

test('panel: an unavailable clipboard also falls back to the textarea', async () => {
  const clipboardStub = installClipboard(null);
  const panel = await mountPanel(snapshotRoute(reportFixture()));
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '复制原始 JSON').click();
    });
    await settle(2);
    const textarea = panel.container.querySelector('textarea');
    assert.ok(textarea);
    assert.deepEqual(JSON.parse(textarea.value), reportFixture());
    assert.match(panel.container.textContent, /不支持剪贴板/);
  } finally {
    await panel.cleanup();
    clipboardStub.restore();
  }
});

test('panel: the 已复制 feedback clears after the 2 s window', async () => {
  const clipboardStub = installClipboard({ writeText: async () => {} });
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      buttonByText(panel.container, '复制报告').click();
    });
    await settle(2);
    const findFeedback = () => panel.container.querySelector('[data-dsh-cli-doctor-copy-feedback]');
    assert.ok(findFeedback(), 'feedback appears right after copying');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, clientClipboard.COPY_FEEDBACK_MS + 150));
    });
    assert.equal(findFeedback(), null, 'the feedback clears after the window');
  } finally {
    await panel.cleanup();
    clipboardStub.restore();
  }
});

/* ------------------------------------------ summary-card filter (§v2.8) --- */

test('view.toolMatchesSummaryFilter: every counter equals the matching tool count', () => {
  const fixtures = [filterReport(), sampleReport()];
  for (const fixture of fixtures) {
    const counts = view.summarize(fixture);
    const tools = view.groupReport(fixture).flatMap((block) => block.tools);
    for (const field of ['toolCount', 'updateCount', 'recommendedCount', 'reviewCount', 'unknownCount']) {
      const matched = tools.filter((tool) => view.toolMatchesSummaryFilter(tool, field)).length;
      assert.equal(matched, counts[field], `${field} count must equal the filtered tool count`);
    }
    const blockUpdateSum = view.groupReport(fixture).reduce((total, block) => total + block.updateCount, 0);
    assert.equal(blockUpdateSum, counts.updateCount, 'block badges reuse the same predicate');
  }
  assert.equal(view.toolMatchesSummaryFilter(null, 'toolCount'), true);
  assert.equal(view.toolMatchesSummaryFilter(null, 'updateCount'), false);
});

test('panel: clicking 「有可用更新」 filters the tool cards to the counted tools', async () => {
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    assert.equal(panel.container.querySelectorAll('article').length, 7, '6 tools + 1 dependency card before filtering');
    await act(async () => {
      summaryButton(panel.container, '有可用更新').click();
    });
    await settle(2);

    const expected = ['up-recommended', 'up-review', 'npm-recommended'].sort();
    assert.deepEqual(toolCardNames(panel.container).sort(), expected);
    const fixtureTools = Object.values(filterReport().managers).flatMap((manager) => manager.tools);
    for (const name of toolCardNames(panel.container)) {
      const tool = fixtureTools.find((entry) => entry.name === name);
      assert.ok(tool && view.toolMatchesSummaryFilter(tool, 'updateCount'), `${name} must match the filter`);
    }

    const active = summaryButton(panel.container, '有可用更新');
    assert.equal(active.getAttribute('aria-pressed'), 'true');
    assert.equal(summaryButton(panel.container, '已发现工具').getAttribute('aria-pressed'), 'false');
    assert.equal(summaryButton(panel.container, '建议更新').getAttribute('aria-pressed'), 'false');

    const text = panel.container.textContent;
    assert.equal(text.includes('依赖包类 · 查看'), false, 'the dependency layer is hidden while filtering');
    assert.match(text, /依赖层已隐藏/);
    assert.match(text, /匹配 2 \/ 共 5 个工具/, 'homebrew block shows matched/total');
    assert.match(text, /匹配 1 \/ 共 1 个工具/, 'npm block shows matched/total');
    assert.ok(buttonByText(panel.container, '清除筛选'), 'a clear action is offered');
    assert.equal(summaryValue(panel.container, '已发现工具'), '6', 'summary numbers stay global');
    assert.equal(summaryValue(panel.container, '有可用更新'), '3');
  } finally {
    await panel.cleanup();
  }
});

test('panel: clicking the active card again clears the filter', async () => {
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      summaryButton(panel.container, '建议更新').click();
    });
    await settle(1);
    assert.deepEqual(toolCardNames(panel.container).sort(), ['npm-recommended', 'up-recommended'].sort());

    await act(async () => {
      summaryButton(panel.container, '建议更新').click();
    });
    await settle(1);
    assert.equal(panel.container.querySelectorAll('article').length, 7);
    assert.ok(panel.container.textContent.includes('依赖包类 · 查看 1 个依赖'));
    assert.equal(summaryButton(panel.container, '建议更新').getAttribute('aria-pressed'), 'false');
    assert.equal(summaryButton(panel.container, '已发现工具').getAttribute('aria-pressed'), 'true');
  } finally {
    await panel.cleanup();
  }
});

test('panel: 「已发现工具」 and 「清除筛选」 both clear an active filter', async () => {
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      summaryButton(panel.container, '需核验或暂缓').click();
    });
    await settle(1);
    assert.deepEqual(toolCardNames(panel.container).sort(), ['up-blocked', 'up-review'].sort());

    await act(async () => {
      summaryButton(panel.container, '已发现工具').click();
    });
    await settle(1);
    assert.equal(panel.container.querySelectorAll('article').length, 7);

    await act(async () => {
      summaryButton(panel.container, '目标待核验').click();
    });
    await settle(1);
    assert.deepEqual(toolCardNames(panel.container).sort(), ['up-blocked', 'up-unknown'].sort());

    await act(async () => {
      buttonByText(panel.container, '清除筛选').click();
    });
    await settle(1);
    assert.equal(panel.container.querySelectorAll('article').length, 7);
    assert.equal(summaryButton(panel.container, '目标待核验').getAttribute('aria-pressed'), 'false');
  } finally {
    await panel.cleanup();
  }
});

test('panel: a filter with no matches shows an empty state with a clear action', async () => {
  const report = {
    generated_at: '2026-10-13T07:30:00.000Z',
    scope: '筛空范围',
    elapsed_ms: 1000,
    skipped: [],
    managers: {
      homebrew: {
        tools: [
          {
            name: 'only-steady', current: '1.0.0', latest: '1.0.0', outdated: false,
            impact: { checked: true, scope: 'x', dependents: [], conflicts: [], uncertain: [], indirect: [] },
          },
        ],
        deps: [],
      },
    },
  };
  const panel = await mountPanel(snapshotRoute(report));
  try {
    await settle();
    await act(async () => {
      summaryButton(panel.container, '建议更新').click();
    });
    await settle(1);
    assert.match(panel.container.textContent, /没有符合「建议更新」筛选的工具/);
    assert.equal(panel.container.querySelectorAll('article').length, 0);
    await act(async () => {
      buttonByText(panel.container, '清除筛选').click();
    });
    await settle(1);
    assert.deepEqual(toolCardNames(panel.container), ['only-steady']);
  } finally {
    await panel.cleanup();
  }
});

test('panel: the filter survives a remount and resets on dispose', async () => {
  const first = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      summaryButton(first.container, '目标待核验').click();
    });
    await settle(1);
    assert.deepEqual(toolCardNames(first.container).sort(), ['up-blocked', 'up-unknown'].sort());

    await first.mounted.unmount();
    const remounted = await mount(React.createElement(first.registerCalls[1].component));
    try {
      await settle(2);
      assert.equal(summaryButton(remounted.container, '目标待核验').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(toolCardNames(remounted.container).sort(), ['up-blocked', 'up-unknown'].sort());
    } finally {
      await remounted.unmount();
    }
    first.mounted.unmount = async () => {};
  } finally {
    await first.cleanup();
  }

  const second = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    assert.equal(summaryButton(second.container, '已发现工具').getAttribute('aria-pressed'), 'true');
    assert.equal(second.container.querySelectorAll('article').length, 7, 'dispose/reset clears the filter');
  } finally {
    await second.cleanup();
  }
});

test('panel: the active summary card uses theme tokens for its selected state', async () => {
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      summaryButton(panel.container, '建议更新').click();
    });
    await settle(1);
    const active = summaryButton(panel.container, '建议更新');
    assert.match(active.style.border, /var\(--dsw-alias-brand-primary,/);
    assert.match(active.style.color, /var\(--dsw-alias-brand-primary,/);
    assert.equal(/^#[0-9a-f]{6}$/i.test(active.style.color.trim()), false, 'no bare hardcoded colour');
    const inactive = summaryButton(panel.container, '有可用更新');
    assert.equal(inactive.style.background, 'transparent');
  } finally {
    await panel.cleanup();
  }
});

test('panel: dependency risk stays global while the tool list is filtered', async () => {
  const panel = await mountPanel(snapshotRoute(filterReport()));
  try {
    await settle();
    await act(async () => {
      summaryButton(panel.container, '有可用更新').click();
    });
    await settle(1);
    assert.equal(summaryValue(panel.container, '依赖冲突'), '1', 'dependency risk cells remain visible');
    assert.equal(panel.container.textContent.includes('依赖包类 · 查看'), false);
  } finally {
    await panel.cleanup();
  }
});
