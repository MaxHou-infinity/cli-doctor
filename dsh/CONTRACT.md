# dsh-cli-doctor 工程契约（v1，冻结）

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
