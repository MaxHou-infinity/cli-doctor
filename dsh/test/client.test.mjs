/**
 * Client-half acceptance tests (CONTRACT.md §3, §6).
 *
 * The committed `lib/client.js` is executed exactly the way the Web GUI executes
 * it: a fake `window.__ModuleLoader__` captures the loader call, the factory is
 * invoked with the two modules this plugin is allowed to require, and the panel
 * is then rendered imperatively with react-dom into jsdom.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import * as api from '../src/client/api.js';
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
    const record = { url, init };
    calls.push(record);
    return route(url, init, calls.length);
  };
  return {
    calls,
    restore() {
      if (previous === undefined) delete globalThis.fetch;
      else globalThis.fetch = previous;
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
            name: 'openssl@3', current: '3.3.0', latest: '3.4.0', outdated: true,
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

/** Route a check request to a healthy report. */
function reportRoute(report = sampleReport()) {
  return (url) => (url.includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0', busy: false })
    : jsonResponse({ ok: true, report, checkedAt: '2026-10-13T07:31:02.000Z' }));
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
});

test('bundle exports: inject=[slots], apply() is callable', () => {
  assert.deepEqual(bundle.moduleExports.inject, ['slots']);
  assert.equal(typeof bundle.moduleExports.apply, 'function');
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

/* ------------------------------------------------------------------- panel -- */

test('panel: opens idle — no automatic diagnosis, button and version visible', async () => {
  const fetchStub = installFetch(reportRoute());
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    const button = buttonByText(mounted.container, '一键诊断当前状态');
    assert.ok(button, 'the panel must offer 「一键诊断当前状态」');
    assert.equal(button.getAttribute('type'), 'button');
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute('aria-busy'), 'false');
    assert.match(mounted.container.textContent, /当前状态：空闲/);
    assert.ok(mounted.container.textContent.includes('插件版本 0.2.0'), 'health version must be shown');

    const posts = fetchStub.calls.filter((call) => call.init.method === 'POST');
    assert.equal(posts.length, 0, 'opening the panel must not run a diagnosis');
    const health = fetchStub.calls.filter((call) => String(call.url).includes('/health'));
    assert.equal(health.length, 1, 'health is probed once on mount');
    assert.equal(health[0].url, '/api/cli-doctor/health');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});

test('panel: clicking the button POSTs to the check route and renders the report', async () => {
  const fetchStub = installFetch(reportRoute());
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    const button = buttonByText(mounted.container, '一键诊断当前状态');
    await act(async () => {
      button.click();
    });
    await flush();

    const posts = fetchStub.calls.filter((call) => call.init.method === 'POST');
    assert.equal(posts.length, 1, 'one click runs exactly one diagnosis');
    assert.equal(posts[0].url, '/api/cli-doctor/check');
    assert.equal(posts[0].init.headers.Accept, 'application/json');

    const text = mounted.container.textContent;
    assert.match(text, /当前状态：诊断完成/);
    assert.match(text, /生成时间：/);
    assert.match(text, /范围：当前 PATH 与全局环境/);
    assert.match(text, /耗时：12\.3 秒/);
    assert.match(text, /未检查：winget（当前系统不适用）/);
    assert.match(text, /只读检查/);
    assert.match(text, /未执行任何升级/);

    // Ecosystem blocks: fixed order, empty managers skipped, both layers shown.
    const titles = [...mounted.container.querySelectorAll('h3')].map((element) => element.textContent);
    assert.deepEqual(titles, ['Homebrew', 'npm 全局', 'Rust / Bun / uv', '独立更新工具']);
    assert.ok(!text.includes('Python / pip'), 'a manager with no items is skipped');

    // Tool and dependency layers, names, versions, commands and status labels.
    assert.ok(text.includes('工具类'));
    assert.ok(text.includes('依赖包类 · 查看 1 个依赖'));
    assert.ok(text.includes('ripgrep'));
    assert.ok(text.includes('14.1.0') && text.includes('14.2.0'));
    assert.ok(text.includes('brew upgrade ripgrep'));
    assert.ok(text.includes('openssl@3'));
    assert.ok(text.includes('有可用更新'));

    // Dashboard status/recommendation semantics survived the port.
    assert.ok(text.includes('版本线异常'), 'candidate below current is an anomaly');
    assert.ok(text.includes('目标待核验'), 'missing latest is unknown');
    assert.ok(text.includes('影响待核验'), 'unchecked impact is a review');
    assert.ok(text.includes('升级建议 · 建议更新'));
    assert.ok(text.includes('与目标版本冲突') === false, 'no conflict was reported');
    assert.ok(text.includes('间接依赖'));

    // The five dashboard counters, computed over tools only.
    assert.equal(summaryValue(mounted.container, '已发现工具'), '6');
    assert.equal(summaryValue(mounted.container, '有可用更新'), '4');
    assert.equal(summaryValue(mounted.container, '建议更新'), '1');
    assert.equal(summaryValue(mounted.container, '需核验或暂缓'), '4');
    assert.equal(summaryValue(mounted.container, '目标待核验'), '2');

    // …and they agree with the shared pure helpers.
    const counts = view.summarize(sampleReport());
    assert.equal(summaryValue(mounted.container, '已发现工具'), String(counts.toolCount));
    assert.equal(summaryValue(mounted.container, '有可用更新'), String(counts.updateCount));
    assert.equal(summaryValue(mounted.container, '建议更新'), String(counts.recommendedCount));
    assert.equal(summaryValue(mounted.container, '需核验或暂缓'), String(counts.reviewCount));
    assert.equal(summaryValue(mounted.container, '目标待核验'), String(counts.unknownCount));
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});

test('panel: shows a readable failure with a retry, and busy is explained', async () => {
  let mode = 'error';
  const fetchStub = installFetch((url) => {
    if (String(url).includes('/health')) return jsonResponse({ ok: true, version: '0.2.0', busy: false });
    return mode === 'busy'
      ? jsonResponse({ ok: false, error: 'busy' }, 409)
      : jsonResponse({ ok: false, error: 'spawn check.js ENOENT' }, 500);
  });
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await flush();

    const alert = mounted.container.querySelector('[role="alert"]');
    assert.ok(alert, 'failures must be announced with role=alert');
    assert.match(alert.textContent, /spawn check\.js ENOENT/);
    assert.match(mounted.container.textContent, /当前状态：诊断失败/);
    const retry = buttonByText(mounted.container, '重试');
    assert.ok(retry, 'a retry button must be offered');

    mode = 'busy';
    await act(async () => {
      retry.click();
    });
    await flush();
    const alertAgain = mounted.container.querySelector('[role="alert"]');
    assert.match(alertAgain.textContent, /已有一次诊断正在进行中/);
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});

test('panel: tolerates an empty or malformed report without crashing', async () => {
  const fetchStub = installFetch((url) => (String(url).includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0' })
    : jsonResponse({
      ok: true,
      checkedAt: null,
      report: {
        generated_at: null,
        scope: null,
        elapsed_ms: null,
        skipped: ['noop', 42, null],
        managers: { homebrew: { tools: [null, 42, { name: null }], deps: 'not-an-array' }, bogus: { tools: [{ name: 'x' }] } },
      },
    })));
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await flush();
    const text = mounted.container.textContent;
    assert.match(text, /时间未知/);
    assert.match(text, /耗时未知/);
    assert.match(text, /未标注/);
    assert.match(text, /未检查：noop/);
    assert.match(text, /未知工具/);
    assert.equal(mounted.container.querySelectorAll('h3').length, 1, 'only the known manager is rendered');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }

  const emptyStub = installFetch((url) => (String(url).includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0' })
    : jsonResponse({ ok: true, report: {}, checkedAt: null })));
  const second = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(second.container, '一键诊断当前状态').click();
    });
    await flush();
    assert.match(second.container.textContent, /没有发现可展示的 CLI 工具/);
    assert.equal(summaryValue(second.container, '已发现工具'), '0');
  } finally {
    await second.unmount();
    emptyStub.restore();
  }
});

test('panel: shows the live wait time, disables the button and clears all timers on unmount', async () => {
  const intervals = new Set();
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, ms, ...rest) => {
    const id = realSetInterval(callback, ms, ...rest);
    intervals.add(id);
    return id;
  };
  globalThis.clearInterval = (id) => {
    intervals.delete(id);
    return realClearInterval(id);
  };

  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const fetchStub = installFetch((url) => (String(url).includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0' })
    : pending));

  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    assert.equal(intervals.size, 0, 'an idle panel keeps no timer');

    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    assert.equal(intervals.size, 1, 'the running panel owns exactly one wait timer');

    const button = buttonByText(mounted.container, '一键诊断当前状态');
    assert.equal(button.disabled, true, 'the button is disabled while running');
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.match(mounted.container.textContent, /当前状态：诊断中/);
    assert.match(mounted.container.textContent, /已等待/);

    const post = fetchStub.calls.find((call) => call.init.method === 'POST');
    assert.ok(post.init.signal, 'the request carries an abort signal');

    await mounted.unmount();
    assert.equal(intervals.size, 0, 'unmount must clear the wait timer');
    assert.equal(post.init.signal.aborted, true, 'unmount must abort the in-flight request');
  } finally {
    resolveCheck(jsonResponse({ ok: true, report: {}, checkedAt: null }));
    await flush();
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
    fetchStub.restore();
  }
});

test('panel: a second click while running does not start a second diagnosis', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  const fetchStub = installFetch((url) => (String(url).includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0' })
    : pending));
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    const posts = fetchStub.calls.filter((call) => call.init.method === 'POST');
    assert.equal(posts.length, 1);
  } finally {
    await mounted.unmount();
    resolveCheck(jsonResponse({ ok: true, report: {}, checkedAt: null }));
    await flush();
    fetchStub.restore();
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

test('layout: the root fills the main slot and the header stays fixed', async () => {
  const fetchStub = installFetch(reportRoute());
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    const { body } = assertPanelLayout(mounted.container);
    assert.match(body.textContent, /首次打开不会自动检查/, 'the idle hint lives in the scroll container');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});

test('layout: every tool card of a long report is inside the single scroll container', async () => {
  const fetchStub = installFetch(reportRoute(longReport(40)));
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await flush();

    const { root, body } = assertPanelLayout(mounted.container);
    const cards = [...root.querySelectorAll('article')];
    assert.equal(cards.length, 42, '40 tools + 1 dependency + the last tool');
    for (const card of cards) {
      assert.ok(body.contains(card), `card "${card.textContent.slice(0, 24)}" must be a descendant of the scroll container`);
    }
    const last = cards[cards.length - 1];
    assert.match(last.textContent, /last-tool/, 'the final block is the last rendered card');
    assert.ok(body.contains(last), 'the last card of the report must be reachable by scrolling');

    // The rest of the report body scrolls with the cards.
    assert.ok(body.contains(root.querySelector('section')), 'ecosystem blocks scroll');
    assert.ok([...body.querySelectorAll('p')].some((element) => element.textContent.includes('未执行任何升级')), 'the footer scrolls');
    assert.ok([...body.querySelectorAll('span')].some((element) => element.textContent === '已发现工具'), 'the summary scrolls');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});

test('layout: loading and error states keep the same scroll contract', async () => {
  let resolveCheck;
  const pending = new Promise((resolve) => {
    resolveCheck = resolve;
  });
  let failing = false;
  const fetchStub = installFetch((url) => {
    if (String(url).includes('/health')) return jsonResponse({ ok: true, version: '0.2.0' });
    if (failing) return jsonResponse({ ok: false, error: 'timeout' }, 500);
    return pending;
  });
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    const loading = assertPanelLayout(mounted.container);
    assert.match(loading.body.textContent, /已等待/, 'the wait indicator lives in the scroll container');

    resolveCheck(jsonResponse({ ok: true, report: {}, checkedAt: null }));
    await flush();

    failing = true;
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await flush();
    const errored = assertPanelLayout(mounted.container);
    const alert = errored.body.querySelector('[role="alert"]');
    assert.ok(alert, 'the failure alert lives in the scroll container');
    assert.match(alert.textContent, /诊断超时/);
    assert.equal(errored.header.querySelector('button').disabled, false, 'the action button stays in the fixed header');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
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

test('view.statusFor: unknown target, update, steady and anomaly tones', () => {
  assert.deepEqual(view.statusFor({ outdated: true, latest: '2.0.0' }, '工具'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor({ outdated: null, latest: '2.0.0' }, '工具'), ['目标待核验', 'unknown']);
  assert.deepEqual(view.statusFor({ outdated: true, latest: null }, '工具'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor({ outdated: false, latest: null }, '工具'), ['目标待核验', 'unknown']);
  assert.deepEqual(view.statusFor({ outdated: false, latest: '1.0.0' }, '工具'), ['未检出更新', 'steady']);
  assert.deepEqual(view.statusFor({ current: '2.0.0', latest: '1.0.0', outdated: true }, '工具'), ['版本线异常', 'anomaly']);
  assert.deepEqual(view.statusFor({ current: '1.0.0', latest: '1.1.0', outdated: false }, '依赖'), ['有可用更新', 'update']);
  assert.deepEqual(view.statusFor(null, '工具'), ['目标待核验', 'unknown']);
  assert.deepEqual(view.statusFor(undefined, '依赖'), ['目标待核验', 'unknown']);
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

test('view.groupReport/summarize: fixed block order, empty blocks skipped, tolerant of junk', () => {
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
  const blockSum = blocks.reduce((total, block) => total + block.updateCount, 0);
  assert.equal(blockSum, counts.updateCount, 'per-block badges must sum to the summary counter');

  const junk = view.summarize({ managers: { homebrew: { tools: [null, 1, 'x'], deps: {} } } });
  assert.equal(junk.toolCount, 3);
  assert.equal(junk.unknownCount, 3);
  assert.equal(junk.blocks[0].deps.length, 0);
});

test('view: timestamp, duration, scope and skipped formatting', () => {
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
});

test('view: the panel is null-tolerant for every sample entry shape', () => {
  // Rendering reads go through view helpers first; none of these may throw.
  for (const item of [null, undefined, {}, 0, '', { impact: null }, { latest: '' }, { current: 5, latest: null }]) {
    assert.doesNotThrow(() => {
      view.statusFor(item, '工具');
      view.recommendationFor(item, '工具');
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
  assert.match(api.failureMessage(500, 'timeout'), /诊断超时/);
  assert.match(api.failureMessage(500, 'output-too-large'), /安全上限/);
  assert.match(api.failureMessage(500, 'invalid-json'), /不是合法 JSON/);
  assert.match(api.failureMessage(500, 'spawn-error'), /无法启动诊断子进程/);
  assert.match(api.failureMessage(500, 'exit-3'), /退出码 3/);
  assert.match(api.failureMessage(500, 'signal-SIGTERM'), /信号 SIGTERM/);

  // An unknown code is never swallowed: it is shown verbatim.
  assert.equal(api.failureMessage(500, 'totally-new-code'), '诊断失败：totally-new-code');

  // With no code the status decides.
  assert.match(api.failureMessage(500, null), /内部错误/);
  assert.match(api.failureMessage(403, null), /未获得本机授权/);
  assert.match(api.failureMessage(418, null), /HTTP 418/);
  assert.match(api.failureMessage(0, null), /诊断请求失败/);
});

test('api.checkStatus: a missing/non-object report never reaches the panel', async () => {
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
  const ok = await api.checkStatus({ fetch: async () => jsonResponse({ ok: true, report: { managers: {} }, checkedAt: '2026-10-13T07:31:02.000Z' }) });
  assert.deepEqual(ok.report, { managers: {} });
  assert.equal(ok.checkedAt, '2026-10-13T07:31:02.000Z');
});

test('api.checkStatus: host codes surface on the error object and in the message', async () => {
  for (const [status, code, pattern] of [[500, 'timeout', /诊断超时/], [409, 'busy', /已有一次诊断正在进行中/], [500, 'exit-7', /退出码 7/]]) {
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
  // A 200 envelope may still carry ok:false.
  await assert.rejects(
    () => api.checkStatus({ fetch: async () => jsonResponse({ ok: false, error: 'busy' }) }),
    (error) => {
      assert.equal(error.code, 'busy');
      assert.match(error.message, /已有一次诊断正在进行中/);
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

test('panel: Host error codes and a null report show readable alerts, never a crash', async () => {
  let payload = { ok: false, error: 'timeout' };
  let status = 500;
  const fetchStub = installFetch((url) => (String(url).includes('/health')
    ? jsonResponse({ ok: true, version: '0.2.0' })
    : jsonResponse(payload, status)));
  const { ctx, registerCalls } = createFakeCtx();
  bundle.moduleExports.apply(ctx);
  const Panel = registerCalls[1].component;
  const mounted = await mount(React.createElement(Panel));
  try {
    await flush();
    await act(async () => {
      buttonByText(mounted.container, '一键诊断当前状态').click();
    });
    await flush();
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /诊断超时/);

    payload = { ok: true, report: null, checkedAt: null };
    status = 200;
    await act(async () => {
      buttonByText(mounted.container, '重试').click();
    });
    await flush();
    assert.match(mounted.container.querySelector('[role="alert"]').textContent, /无法识别/);
    assert.match(mounted.container.textContent, /当前状态：诊断失败/);

    payload = { ok: true, report: { generated_at: '2026-10-13T07:30:00.000Z', managers: { homebrew: { tools: [{ name: 'jq', current: '1.7.0', latest: '1.7.0', outdated: false, impact: { checked: true, scope: '全局' } }] } } } };
    await act(async () => {
      buttonByText(mounted.container, '重试').click();
    });
    await flush();
    assert.equal(mounted.container.querySelector('[role="alert"]'), null, 'a recovered run clears the alert');
    assert.match(mounted.container.textContent, /当前状态：诊断完成/);
    assert.match(mounted.container.textContent, /jq/);
    assert.equal(summaryValue(mounted.container, '已发现工具'), '1');
  } finally {
    await mounted.unmount();
    fetchStub.restore();
  }
});
