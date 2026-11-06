# dsh-cli-doctor 工程契约（v1，冻结；**v2 增补见文末，优先级更高**）

本文件是本次开发的唯一接口事实来源。**任何偏离都必须先回报 Lead，不得自行改契约。**

## 0. 目标与非目标

目标：把 cli-doctor 做成一个可在 DSH 左侧边栏使用、并能安装进 `desktop` profile 的 bundle 插件，
诊断逻辑复用仓库既有的 `bin/check.js`（只读、不升级）。

非目标 / 硬约束（越界即失败）：

- **禁止修改**以下 Codex 适配路径的任何文件：`plugin.json`、`mcp.json`、`codex-server.js`、
  `codex-bridge.js`、`dashboard/**`、`.agents/**`、`SKILL.md`、`bin/**`、根 `package.json`、
  `test/**`（根目录的 test）。
- DSH 侧所有代码必须自包含在 `dsh/` 内；不得从 `dashboard/app.js` import，也不得让 DSH 运行时
  依赖仓库根路径以外的文件（`dsh/bin/**` 是构建期复制出来的副本）。
- 不执行任何升级动作；插件只做只读检查。

## 1. 包与运行面

| 项 | 值 |
|---|---|
| 包目录 | `dsh/` |
| 包名 | `dsh-cli-doctor` |
| 版本 | `0.2.0`（与根 package.json / SKILL.md / plugin.json 对齐） |
| 类型 | ESM（`"type": "module"`） |
| Host 半体 | `dsh/src/host/index.js`（手写、直接提交、**无构建步骤**） |
| Client 半体 | 源码 `dsh/src/client/**` → 构建产物 `dsh/lib/client.js`（提交） |
| patch | `dsh/cordis.patch.yml`（Lead 已写好，勿改） |
| 运行时依赖 | **零**。devDependencies 只用于构建/测试，不进 profile |

`package.json` 与 `cordis.patch.yml` 由 **Lead 独占**，teammate 不要写这两个文件（需要变更就发消息）。

关键点：**不要声明任何 `@deepseek-ai/dsh*` 的 peerDependencies**。DSH 装载前会用
`peerDependencies` 与运行时单版本（本机 `0.2.0-rc.2`）做兼容闸门；完全不声明即不构成约束，
这是本插件跨版本最稳的策略。Host/Client 半体也不要在运行时 import 任何 `@deepseek-ai/*` 值。

## 2. Host 半体契约（`dsh/src/host/index.js`）

Cordis 函数插件，零 import（只用 `node:` 内置模块）：

```js
export const name = 'cli-doctor'
export const inject = ['webServer']
export function apply(ctx, config) { /* 注册路由 */ }
```

路由一律通过 `ctx.webServer.register({ kind, path, handler })` 注册（返回 disposer），
用 `ctx.effect(() => register(...), 'cli-doctor: routes')` 绑定到 fiber 生命周期。

| 方法 | 路径 | 行为 |
|---|---|---|
| `GET`/`HEAD` | `/api/cli-doctor/health` | `200 {"ok":true,"version":"<包版本>","busy":<bool>}` |
| `POST` | `/api/cli-doctor/check` | 运行诊断，成功 `200 {"ok":true,"report":<check.js JSON>,"checkedAt":"<ISO>"}`；并发时 `409 {"ok":false,"error":"busy"}`；失败 `500 {"ok":false,"error":"<原因>"}` |
| 其它方法 | 上述路径 | `405 {"ok":false,"error":"method"}`
| 其它子路径 | `/api/cli-doctor/*` | `404 {"ok":false,"error":"not-found"}` |

实现要求：

1. **注册前缀路由** `{ kind: 'prefix', path: '/api/cli-doctor' }`。
2. **访问围栏（必须）**，任一不满足返回 `403 {"ok":false,"error":"forbidden"}`：
   - 连接必须是回环（`req.socket.remoteAddress` 属于 `127.0.0.0/8`、`::1`、`::ffff:127.0.0.1`）；
   - `Host` 头必须是回环主机名（`127.0.0.1`、`localhost`、`[::1]`），`Origin`（若有）必须与 Host 同源；
   - 浏览器同源标记：`sec-fetch-site: same-origin` **或** 存在 `Origin` 头 **或** `Cookie` 里存在
     `dsh-auth-` 前缀的会话 cookie。三条都没有则拒绝。
     说明：DSH Desktop shell 从 `dsh-app://app/` 提供 Web GUI，并由 shell 转发面板的 fetch，
     **转发时会删掉 `Origin` 与 `sec-fetch-site`，但会带上 Host 的 `dsh-auth-*` cookie**。
     只认前两条标记会导致面板在桌面端 403，所以 cookie 分支是必需的（参照社区成熟实现
     `@linxin666/dsh-client-ui-task-board/src/host-routes.ts`）。
3. **单飞**：同一时刻只允许一个诊断在跑，第二个请求立即 `409 busy`。
4. **子进程**：`spawn(process.execPath, [checkPath, '--json', '--no-update'], { cwd: <包根>, env: process.env })`，
   其中 `checkPath = path.join(<包根>, 'bin', 'check.js')`，包根 = `fileURLToPath(import.meta.url)` 上溯两级
   （`src/host/index.js` → 包根）。超时 8 分钟（SIGTERM + 拒绝），stdout 上限 24 MiB。
5. **失败语义**：非零退出、超时、超限、JSON 解析失败都要转成结构化错误，写日志到 `process.stderr`，
   绝不能让异常冒泡成未处理 rejection（webserver 会把 handler 异常变成 400）。
6. 响应一律 `Content-Type: application/json; charset=utf-8` + `Cache-Control: no-store`。
7. 需要解析请求体时设定上限（本插件 `POST` 无 body，可直接忽略/丢弃）。

## 3. Client 半体契约

### 3.1 产物封装（`dsh/lib/client.js`）

必须与原样协议一致（照抄已验证插件的外壳，不要自创）：

```js
window.__ModuleLoader__.load({
  id: "dsh-cli-doctor",
  factory: (require) => { /* esbuild 的 CJS 产物；结尾 return module.exports */ }
});
```

`id` 必须等于包名 `dsh-cli-doctor`（构建脚本自动取 `package.json.name`）。

### 3.2 模块纯度

浏览器模块表只提供：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。

本插件只允许 `require('react')` 与 `require('react/jsx-runtime')`。构建脚本必须做纯度检查：
产物里所有 `require("…")` 的字面量必须落在 `{react, react/jsx-runtime}` 内，否则构建失败。

### 3.3 导出与注册

```js
export const inject = ['slots']
export function apply(ctx) { /* 注册两个 slot，返回/绑定 disposer */ }
```

- 侧边栏入口：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'cli-doctor', order: 30, label: 'CLI Doctor' }, CliDoctorIcon))`
- 主面板：`ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'cli-doctor' }, CliDoctorPanel))`
- `sidebar.panellist` 是 root scope 的 **list** slot（注册字段：`id` 必填，`order`、`label` 可选）；
  `main` 是 root scope 的 **keyed** slot（`key` 必填）。`slots.inject` 是等待声明后再注册，
  两个注册都必须可 dispose（把 disposer 交给 `ctx.effect` 或 `apply` 返回值）。
- 面板组件不带 props；图标组件接收 `{ size, active }`。

### 3.4 面板行为（对齐现有 dashboard 语义，代码独立实现）

- 顶栏：标题、插件版本、当前状态（空闲/诊断中/完成/失败）、主按钮 **「一键诊断当前状态」**。
- 首次打开不自动诊断；只有点击按钮才 `POST /api/cli-doctor/check`（桌面 shell 会转发到 Host）。
  可在挂载时 `GET /api/cli-doctor/health` 取版本，失败不影响面板渲染。
- 诊断可能持续数分钟：按钮进入 loading 并禁用，显示已等待时间；失败显示可读原因 + 重试。
- 结果按 **工具类 / 依赖包类** 两层、按 `homebrew`、`npm_global`、`python_pip`、`rust_bun_uv`、
  `self_updating` 顺序分块渲染；每块显示数量与「有可用更新」数。
- 每个条目至少展示：名称、当前版本、最新版本、升级命令、状态标签。
  状态语义照 `dashboard/app.js` 的 `statusFor` / `recommendationFor` 移植为**纯函数**放在
  `dsh/src/client/view.js` 并单测：
  - `outdated === null || !latest` → 「目标待核验」（unknown）
  - `candidateBelowCurrent` → 「暂不建议」
  - `impact?.checked === false` → 「影响待核验」
  - `impact.conflicts?.length` → 「暂不建议」
  - 其余 → 「建议更新」
- 顶部汇总计数与 `dashboard/app.js` 一致：已发现工具 / 有可用更新 / 建议更新 / 需核验或暂缓 / 目标待核验。
- 报告头显示 `generated_at`、`scope`、`elapsed_ms`；底部固定提示：只读检查、未执行任何升级。
- `skipped` 非空时列出被跳过的检查项。
- 样式：**只用内联 style**，不引入 CSS 文件、不做 DOM 注入、不吃任何全局样式表；
  浅色/深色都用中性色（透明背景 + 继承文字色），避免与主题冲突。
- 可访问性：按钮 `type="button"`、loading 用 `aria-busy`、错误用 `role="alert"`。
- 组件卸载/`dispose` 后不得有残留定时器或未决 setState。

## 4. 报告数据形状（`bin/check.js --json --fast` 实测）

```
{
  generated_at: string, scope: string, elapsed_ms: number, skipped: string[],
  managers: {
    homebrew:      { tools: Item[], deps: Item[] },
    npm_global:    { tools: Item[], deps: Item[] },
    python_pip:    { tools: Item[], deps: Item[] },
    rust_bun_uv:   { tools: Item[], deps: Item[] },
    self_updating: { tools: Item[], deps: Item[] }
  }
}
```

`Item`：`name`、`current`、`latest`（可能 null，也可能形如 `"1.0.0"` 或带 compare 结果）、
`outdated`（bool|null）、`upgrade_cmd`（可能 null）、可选 `note`、可选 `major_jump`、可选
`version_line_anomaly`、可选 `impact: { checked, scope, dependents[], conflicts[], uncertain[], indirect[],
operational_review }`。**渲染必须对未知字段/null 宽容**：任何字段缺失都不能让面板崩。

## 5. 构建与同步

- `node scripts/sync-shared.mjs`：把 `../bin/check.js`、`../bin/python_dependency_audit.py`
  复制到 `dsh/bin/`，并校验 sha256 与源一致；源文件缺失或哈希不符要显式失败。
  **同时生成并维护 `dsh/bin/package.json`，内容精确为 `{"type":"commonjs"}`**：本包 `"type": "module"`，
  没有这个 CJS 边界声明，Node 会把 `bin/check.js` 当 ESM 解析并在 `require` 处直接报错
  （真实故障：`POST /api/cli-doctor/check` 返回 500 `exit-1`）。该文件由脚本生成、需提交，
  并在 stray 检查与 parity 测试中显式放行/断言。
- `node scripts/build-client.mjs`：用 esbuild（devDependency，已装好）把 `src/client/index.jsx`
  打成 `format: 'cjs'`、`platform: 'browser'`、`external: ['react','react/jsx-runtime']`，
  再包 §3.1 外壳，写入 `lib/client.js`；随后跑纯度检查。构建必须**只**写 `lib/client.js`。
- `npm run build` = `sync:shared` + `build:client`。产物 `dsh/lib/client.js` 与 `dsh/bin/**` 需要提交。

## 6. 测试与验收

每个 teammate 必须让自己的测试可独立运行：

- Host：`node --test test/host.test.mjs`（用假 `ctx`/假 `req,res` 覆盖：路由注册与 dispose、
  围栏 4 种拒绝与 1 种放行、405/404、单飞 409、子进程成功/失败/超时路径）。
- Parity：`node --test test/parity.test.mjs`（`dsh/bin/**` 与 `../bin/**` 字节一致 +
  `bin/package.json` 的 CJS 边界声明 + **真实子进程**跑 `node bin/check.js --version` 断言 exit 0）。
  最后这条是 DEFECT-1 的回归门禁：注入式 spawn 测试无法覆盖"vendored 脚本能否被 Node 真正加载"，
  必须留一个不经注入的真实子进程用例。
- Client：`node --test test/client.test.mjs`（jsdom + 假 `window.__ModuleLoader__` 工厂执行
  `lib/client.js`，断言 `inject/apply`、两个 slot 注册参数、命令式渲染面板后能找到
  「一键诊断当前状态」按钮，以及 `view.js` 纯函数分支）。
- E2E（verifier 独占）：真实 `DSH_HOME=.dsh-test` + 真实 profile + 真实 `dsh` 启动。

统一命令：`cd dsh && npm run build && npm test`。

## 7. 环境事实（已由 Lead 实测）

- 运行时 `dsh` CLI：`/opt/homebrew/bin/dsh`，版本 `0.2.0-rc.2`。
- Host 路由服务键：`webServer`，`register({kind,path,handler})` → disposer；匹配规则
  精确 → 最长前缀 → fallback，`/api` 前缀由 dsh-client-connection 占用，本插件用更长的
  `/api/cli-doctor` 前缀，不会被它吞掉。
- 目标 profile：`desktop`（本机 GUI 正在运行的那个，`$DSH_HOME/profiles/desktop`）。
- **禁止**直接写用户的 `~/.dsh`：本地端到端验证一律用 `DSH_HOME=<workspace>/.dsh-test`。
  当前会话的文件沙箱是 workspace-write，写 `~/.dsh` 会 EPERM。
- esbuild 的 postinstall 被 pnpm 拦了，但运行时能自己找到平台包，**可以正常用**，不要去 approve builds。

---

## v2 增补（2026-11-06）— 从"报告页"到"诊断中枢"

> **优先级**：本增补优先于正文 v1 条款；v1 未提及处继续有效。
> **不变的红线**：插件只读、不执行任何升级、不提供"交给 Agent 执行升级"的入口；不声明 `@deepseek-ai/dsh*` peerDependencies；client bundle 白名单仍只有 `react`、`react/jsx-runtime`。
> 背景与设计依据见仓库根 `dsh-cli-doctor-optimization-design.md`、`.review/*.md`。

### v2.1 新增/变更 Host 路由（全部受 v1 §2 围栏、405/404 语义约束）

| 方法 | 路径 | 响应 |
|---|---|---|
| GET/HEAD | `/api/cli-doctor/health` | `200 {ok, version, busy, capabilities:{snapshot:true,history:true,cancel:true}, lastCheck:{checkedAt,mode,ageMs}\|null}` |
| GET/HEAD | `/api/cli-doctor/snapshot[?full=1]` | `200 {ok:true, snapshot:{checkedAt,mode,elapsedMs,ageMs,stale,summary,report?}\|null, busy, cache:{ttlMs,autoCheck}}`；`?full=1` 才带完整 report |
| GET/HEAD | `/api/cli-doctor/status` | `200 {ok:true, busy, running:{startedAt,elapsedMs,mode,waiters}\|null, lastCheck:{checkedAt,mode,ageMs}\|null, cache:{ttlMs}}` |
| GET/HEAD | `/api/cli-doctor/history[?limit=N]` | `200 {ok:true, entries:[{checkedAt,mode,elapsedMs,summary}]}`（新→旧，默认 20，上限 100） |
| POST | `/api/cli-doctor/check[?mode=fast\|full][&force=0]` | `200 {ok:true, report, checkedAt, mode, elapsedMs, cache:'fresh'\|'hit'\|'attached', shared}` |
| POST | `/api/cli-doctor/check/cancel` | `200 {ok:true, cancelled:<bool>}` |

- **不再返回 409 busy**：已有诊断在跑时，新请求 attach 同一次 run，等它结束后返回同一份结果（`cache:'attached'`，`shared:true`）。同一时刻仍只 spawn 一个子进程。
- `force=0` 且快照未过期（`ageMs < ttlMs`）时直接返回缓存（`cache:'hit'`）；默认 `force=1`（保留 v0.2 每次点击必跑的行为）。
- 取消：向子进程发 SIGTERM，5 s 后 SIGKILL（POSIX 用 detached + 进程组，Windows 用 `taskkill /T /F`）；所有在当前 run 上等待的请求收到 `500 {ok:false,error:'cancelled'}`；`busy` 必须在子进程真正 close 后才复位。
- 错误码新增 `cancelled`；其余沿用 v1（`forbidden` / `method` / `not-found` / `timeout` / `output-too-large` / `invalid-json` / `spawn-error` / `exit-N` / `signal-X`）。诊断失败（`POST /check` 的 500）响应体为 `{ok:false, error:<code>, detail?:<string≤2KB stderr 尾>, elapsedMs?:<number>}`。
- 无快照时 `/snapshot` 返回 `200 {ok:true, snapshot:null, ...}`（不是 404）。

### v2.2 Host 状态、持久化与配置

- 内存态：`snapshot = {report, checkedAt, mode, elapsedMs}`；`history = [{checkedAt, mode, elapsedMs, summary}]`（≤ `keepHistory` 条，只存摘要）。
- `summary` 形状（≤ 1 KB）：`{toolCount, depCount, updateCount, recommendedCount, reviewCount, unknownCount, conflictCount, uncertainCount, generatedAt, checkedAt, mode, stale}`；其中 `conflictCount`/`uncertainCount` 统计**依赖层** `impact.conflicts` / `impact.uncertain` 非空的条目数（补充 v1 只统计工具层的口径，不改变 v1 五个计数语义）。
- **落盘**：`<dataDir>/state.json`，`dataDir = config.dataDir || ($DSH_HOME || ~/.dsh)/storages/cli-doctor`；形状 `{schemaVersion:1, snapshot:{report,checkedAt,mode,elapsedMs}, history:[...]}`。
  - 读取失败/JSON 损坏：忽略并从空状态启动，**不得抛错**；写失败只写日志，不得影响响应。
  - 原子写：同目录临时文件 + `fsync` + `rename`；目录 `0700`、文件 `0600`。
  - 测试必须注入临时 `dataDir`（或 `persist:false`），**禁止写用户真实 `~/.dsh`**；`apply()` 加载不得阻塞超过 50 ms。
- Host 不自带定时器：自动检查由 client 在打开面板时按 stale-gate 触发；Host 只负责快照/TTL/共享请求。
- 子进程：`mode=full → ['--json','--no-update']`；`mode=fast → ['--json','--fast','--no-update']`；响应必须带 `mode`，面板对 fast 结果必须显式标注（v0.3.0 客户端默认只用 full）。
- spawn env：`{...process.env, HOMEBREW_NO_AUTO_UPDATE:'1', HOMEBREW_NO_ANALYTICS:'1', PIP_DISABLE_PIP_VERSION_CHECK:'1', NO_COLOR:'1'}`（用户已有值时以用户值优先；测试断言）。
- 配置键（`cordis.patch.yml` 默认块，代码内 `resolveConfig` 兜底）：`autoCheck:true`、`staleAfterHours:12`、`keepHistory:20`、`checkTimeoutMs:900000`（现有 8 min 小于最坏路径 >13 min）；测试 seam 保留 `checkPath/execPath/spawn/timeoutMs/maxOutputBytes/logger/dataDir/persist`。
- 环境变量 seam（仅测试/集成隔离）：`CLI_DOCTOR_CHECK_PATH`（v1 已有）、`CLI_DOCTOR_AUTO_CHECK=0|1`（默认 1，透出到 `/snapshot.cache.autoCheck`，客户端据此决定是否自动触发）。

### v2.3 客户端行为（v0.3.0 第一批）

- 新增模块级 store（`dsh/src/client/store.js`）：`{phase:'idle'|'running'|'done'|'error', report, checkedAt, mode, error, autoStarted}`；订阅用 `useSyncExternalStore`（无则退化为 `useState/useEffect`），`dispose` 时 reset。
- **覆盖 v1 §3.4:141**：组件卸载**不再 abort 在途请求**，状态保留在 store 中跨挂载存活；取消只能由用户点"取消"（调 `POST /check/cancel`）。
- 挂载引导（顺序固定）：
  1. `GET /health` → version / busy；
  2. `GET /snapshot?full=1` → 有快照立即渲染（phase='done'），记录 `cache.ttlMs/autoCheck`；无快照进入空态；
  3. `autoCheck` 为真且（无快照 或 `ageMs > ttlMs`）时自动 `POST /check`（full）一次；同一 store 生命周期只自动触发一次；若已有 run 则靠 attach 共享；
  4. running 时 1 s 刷新等待时长；可取消。
- 结果渲染保留 v1 §3.4 全部要求（五计数、五生态分块、工具/依赖两层、未知字段容错、只读 footer、唯一滚动容器 `data-dsh-cli-doctor-scroll`），并新增：
  - 顶部相对时间与过期提示（"上次诊断 X 前 / 数据已过期"）；
  - **依赖语义修复**：依赖条目无 `outdated` 时，状态显示「候选更新 · 待核验」（review 色），建议显示「依赖更新需人工核验」；不得再出现「有可用更新」+「无法判断」并存；
  - 汇总计数保持工具层口径，另增「依赖冲突 N / 依赖待核验 N」两格（N>0 才渲染）；
  - 自动检查/取消用 `aria-busy` 与 `aria-live` 正确表达（只在 phase 变化播报，禁止每秒刷屏）；
  - 状态色改为 `var(--dsw-alias-*, 回退值)`（映射见设计文档附录 E），不得新增硬编码语义色；
  - 仍只 require `react` / `react/jsx-runtime`，纯度门禁不变。

### v2.4 模块基线（0.2.2-rc.1 实测，替代 v1 §3.2 的 9 项清单）

浏览器 `staticModules` 实为 11 项：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。
本插件构建白名单 **仍只开 `react` 与 `react/jsx-runtime`**，v0.3.0 不新增；`dsh.client.inject` 暂保留现状（v0.4 清理）。

### v2.5 测试与验收（v0.3.0 第一批）

- `cd dsh && npm test` 全绿；新增覆盖：并发共享同一 run、缓存命中/强制刷新、取消、快照与持久化往返、损坏文件容错、TTL 语义、依赖语义一致性、自动检查只触发一次、切页状态恢复、fast/full 参数与 env 注入。
- e2e：更新 `e2e-api`（并发 200 + snapshot/status/cancel/persistence）、`view-contract`、`panel-behavior`；使用 `DSH_HOME=<repo>/.dsh-test`，不碰 `~/.dsh`；在当前运行时（desktop 0.2.2-rc.1 / PATH dsh 0.2.1-rc.5）跑通。
- README：修正 Git 安装自相矛盾；补"结果缓存 / 过期自动检查 / 可取消 / 只读边界（不执行升级、不提供 Agent 执行）"。

### v2.6 环境事实补充

- desktop 运行时 **0.2.2-rc.1** 在 `app.asar` 内；PATH 上 `dsh` 为 **0.2.1-rc.5**；`~/.dsh/profiles/node_modules/@deepseek-ai/*` 多为指向 0.2.1-rc.5 的链接（部分断链）。平台 API 取证以 0.2.2-rc.1 为准。
- 本地 e2e 一律 `DSH_HOME=<workspace>/.dsh-test`。

### v2.7 第一批范围（2026-11-06 定稿）

- **Host**：共享请求（去 409）、内存快照、`/snapshot`、`/status`、`/history`、`/check/cancel`、落盘持久化、env 卫生、TTL 暴露。
- **Client**：模块 store、挂载引导与自动检查、取消、快照恢复、依赖语义修复、主题 token、过期提示。
- **不做（后续批次）**：工具栏搜索/筛选/排序、紧凑行（第二批）；徽标/通知/agent 工具/prompt 命令（第三批）；配置表单（后置，已决定暂不做）；"交给 Agent 执行升级"（**永久不做**）。

### v2.8 面板操作（2026-11-06 第二批-1：复制报告 + 汇总卡片筛选）

#### 复制诊断报告（只读导出）

- 面板在已有报告时提供两个复制动作：
  - 主按钮「复制报告」：复制 **AI 友好的 Markdown**，由纯函数 `buildMarkdownReport(report, meta)` 生成（必须可单测，不依赖 React/DOM）。
  - 次按钮「复制原始 JSON」：复制 `JSON.stringify(report, null, 2)`（check.js 原始报告，不加工）。
- Markdown 报告必须包含：标题；生成时间 / 检查时间 / 模式 / 耗时 / 范围 / 插件版本；汇总计数（含依赖冲突/待核验）；按生态分组的**可行动工具**明细（名称/当前/目标/状态/建议/升级命令/依赖影响摘要/note）；依赖**冲突与待核验**明细；已是最新工具的名称列表；`skipped`/降级说明；只读策略与状态语义说明；数据来源。不得出现任何执行升级的指令或"请运行"式诱导。
- 剪贴板：优先 `navigator.clipboard.writeText`；不可用或失败时**不得抛错、不得注入全局样式/DOM**，改为在面板内渲染只读 `<textarea>`（React 渲染，内联样式）显示同一文本供手动复制，并给出可读提示。
- 复制成功后 2 秒内显示「已复制」反馈（`aria-live="polite"`）；失败显示可读原因。复制动作不发网络请求、不改变报告。
- 现有剪贴板不可用的降级路径必须可单测（注入 clipboard seam）。

#### 汇总卡片即时筛选

- 顶部 5 个汇总格改为 `<button type="button" aria-pressed>`；点击后以**同一判定函数**过滤下方工具列表，再次点击或点「清除筛选」取消：
  - 已发现工具 → 全部（清除筛选）；
  - 有可用更新 → `statusFor(item,'工具')[1] ∈ {update, review}`；
  - 建议更新 → `recommendationFor(item,'工具')[1] === 'recommended'`；
  - 需核验或暂缓 → `recommendationFor(item,'工具')[1] ∈ {review, blocked}`；
  - 目标待核验 → `statusFor(item,'工具')[1] ∈ {unknown, anomaly}`。
  判定必须与 `summarize()` 五计数复用同一纯函数（禁止复制条件），保证卡片数字与筛选结果一致。
- 筛选状态进 client store，跨挂载保留，`dispose` 时重置。
- 筛选生效时：只渲染匹配的工具卡；无匹配的生态分块隐藏；依赖层隐藏并显示一行说明（依赖计数仍在汇总/分块头）；分块头显示「匹配 N / 共 M」；空结果提供清除入口。
- 卡片计数保持全局口径（不随筛选变化）；活动卡 `aria-pressed="true"` 且有可见选中样式（使用主题 token，不新增硬编码色）。
- 纯函数（判定 + Markdown 生成）放在 client 模块内，必须由 `node --test test/client.test.mjs` 覆盖；JSX 与 DOM 只做接线。
