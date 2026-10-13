# cli-doctor DSH 插件：独立验证报告（verifier / task-3 + task-6）

- 验证对象：`dsh/`（Host 半体、Client 半体、构建脚本、vendored `bin/**`）
- 运行环境：macOS，Node v26.8.1，真实 CLI `dsh 0.2.0-rc.2`（`/opt/homebrew/bin/dsh`）
- 隔离环境：`DSH_HOME=/Users/maxhou/Desktop/cli-doctor/.dsh-test`（工作区内，gitignore）
  - **全程未写 `~/.dsh`**：脚本会忽略从 shell 继承的 `DSH_HOME`，并对 `E2E_DSH_HOME` 做「必须在仓库内」的硬围栏
- 一键复跑：`bash dsh/test/e2e/run-all.sh --port 19390`
- 第一轮全量（2026-10-13 16:08–16:12）：**8/8 阶段通过**
  - build-repro 8/8 · loader 26/26 · view-contract 106/106 · panel-behavior 38/38 ·
    purity-negative 14/14 · codex-decouple 10/10 · e2e-api 56/56 · failure-paths 11/11（+1 明确未验证）
- 第二轮全量（2026-10-13 17:19–17:22，UI-1 滚动修复后的新产物）：**8/8 阶段通过**
  - build-repro 11/11（含产物 sha256 钉住 + 76/76 用例）· loader 26/26 · view-contract 106/106 ·
    panel-behavior **74/74**（含 UI-1 布局契约）· purity-negative 14/14 · codex-decouple 10/10 ·
    e2e-api **62/62**（含服务端字节布局断言）· failure-paths 11/11（+1 明确未验证）
- 第三轮全量（2026-10-13 17:26–17:31，新增真实浏览器阶段）：**9/9 阶段通过，ALL STAGES PASSED**
  - 追加 `browser-layout-probe` **16/16**（headless Chrome + CDP 实测布局与滚动，见 §0.2）；其余阶段同第二轮全绿
  - 逐阶段日志：`.dsh-test/e2e-*/`（`run.log` + 每个请求的 `*.status/.headers/.body/.err`）

## 0. 结论速览

| 状态 | 条目 |
|---|---|
| ✅ 已验证通过 | 契约 §1/§2/§3/§4/§5/§6 全部硬性接口；真实 scratch profile 端到端；三个围栏放行分支 + 四个拒绝分支；405/404；单飞；真实诊断 200 + 五生态；boot manifest 组合包 200；失败路径 500 结构化错误；构建幂等；纯度门禁正/负；Codex 解耦；面板 jsdom 交互与畸形报告容错；**UI-1 滚动契约（根节点撑满 + 唯一滚动容器 + 全部内容可滚到）** |
| ⚠️ 未验证（已说明原因，不算通过） | ① 8 分钟超时分支的**端到端**复现（需 8 分钟真实等待，仅由作者注入 timeout 的单测覆盖）② `~/.dsh` 之外的跨机/跨版本行为。（原「真机渲染」一项已由 §0.2 的真实浏览器测量 + §6 的 desktop 安装确认补齐） |
| ❌ 失败 | 无（DEFECT-1 修复后复验通过；UI-1 修复后第二轮全量通过） |

**缺陷 1：DEFECT-1**（vendored CJS 检查器在 `type: module` 包内被当 ESM 加载 → `POST /check` 必然 500）已由 dsh-host 按方案 A 修复，本报告 §4 记录复现、根因、修法与关闭证据。
**缺陷 2：UI-1**（面板无滚动条、内容被裁，用户实机反馈）已由 dsh-client 修复，本报告 §0.1 记录独立复验证据（该缺陷不在我的端到端 harness 覆盖范围内——jsdom 量不到真实布局，故修复后新增了样式契约断言）。

## 0.1 UI-1（滚动）修复后的独立复验（task-6，2026-10-13 17:19–17:22）

**产物身份（先核对再断言）**

```
$ ls -l dsh/lib/client.js          -> 38533 bytes
$ shasum -a 256 dsh/lib/client.js  -> 746c907da5fd91faa26aa819a3746cad5566ee76e44697a780899425b7df56fc
（与 dsh-client 申报值逐字节一致；旧值 232b8444… 作废）
$ npm run build ×2                 -> 两次 sha256 恒为 746c907d…，整树 digest 068175ff… 不变
$ npm test                         -> ℹ tests 76 / pass 76 / fail 0
纯度：产物 require() 字面量仍只有 "react"、"react/jsx-runtime"，无动态 import，无 @deepseek-ai
```

**1) panel-behavior（jsdom + 真实 React）74/74 —— 新增的 UI-1 布局断言（全绿）**

```
PASS: exactly one overflow-y:auto element in the whole tree (1)
PASS: the scroll container is [data-dsh-cli-doctor-scroll]
PASS: scroll container is a descendant of the panel root
PASS: scroll container is a direct child of the panel root
PASS: root height is 100% (100%)      PASS: root is a flex column      PASS: root flexDirection (column)
PASS: root minHeight is 0 (0)         PASS: root minWidth is 0 (0)     PASS: root boxSizing (border-box)
PASS: root flex-grow is non-zero      PASS: root has no maxWidth any more (UI-1 acceptance)
PASS: header is a direct child of the root / header is NOT inside the scroll container / header flexShrink 0
PASS: root exposes exactly header + scroll body (2)
PASS: scroll overflowY (auto) / overflowX (hidden) / minHeight 0 / flex-grow non-zero
PASS: scroll overscrollBehavior (contain) / paddingRight 8px
PASS: first paint hint / loading block / error role=alert block live inside the scroll container
PASS: summary counters / report meta / skipped list / first ecosystem block / read-only footer / last tool card / last upgrade command is inside the scroll container
PASS: the last card really is below the first card in document order
PASS: no element keeps the removed maxWidth layout
PASS: unmount leaves no live interval (0) / unmount empties the container
```
最后一张卡片用唯一探针名 `self-update-probe-9f3` 定位，避免「恰好在首屏内」的假阳性。

**2) 服务端字节（真实 dsh web，从 boot.html 取 combo）**

```
boot manifest: .../client.js,dsh-cli-doctor/client.js,...&rev=1f5cd4950d84
GET <combo> -> 200, 10460756 bytes   (上一轮 10459607，增量与新产物一致)
on-disk sha256: 746c907da5fd91faa26aa819a3746cad5566ee76e44697a780899425b7df56fc
PASS: served bytes carry root height              (height: "100%")
PASS: served bytes carry root flex                (flex: "1 1 auto")
PASS: served bytes carry the scroll container     (data-dsh-cli-doctor-scroll)
PASS: served bytes carry overflowY                (overflowY: "auto")
PASS: served bytes carry overscrollBehavior       (overscrollBehavior: "contain")
PASS: served bytes pin the header                 (flexShrink: 0)
```

**3) 回归（Host 侧未受影响）**

```
GET /api/cli-doctor/health (sec-fetch-site) -> 200 {"ok":true,"version":"0.2.0","busy":false}
POST /api/cli-doctor/check                  -> 200 (149931 B, 70s), managers verdict: OK, checkedAt 合法
并发两个 POST                                -> a=200 b=409 {"ok":false,"error":"busy"}
围栏：裸 GET/POST -> 403；跨源 Origin -> 403；伪造 Host -> 403；三条放行 -> 200
405/404：DELETE health -> 405；GET check -> 405；/nope -> 404；/api/cli-doctor -> 404
失败路径（桩）：exit-1 / invalid-json / output-too-large 均 500 结构化，无 unhandled rejection
Codex 解耦：受保护路径 git status 为空；node test/codex_plugin_smoke.js exit 0
```

**本轮结论**：UI-1 修复在「产物字节 → 浏览器装载 → 面板实际渲染树 → 服务端交付字节」四层都被独立复现，
无新缺陷。真实浏览器里的布局与滚动随后由 §0.2 的 headless Chrome 实测补齐（16/16）。

## 0.2 真实浏览器布局实测（UI-1 的最终关闭证据，2026-10-13 17:25）

`.dsh-test` scratch profile 起真实 `dsh web`（端口 19394），用 **headless Chrome 155 + CDP** 打开真实 GUI
（`?token=` 换 cookie → 等 shell 启动 → 点侧栏 CLI Doctor 行 → 点「一键诊断当前状态」跑真实诊断 → 读布局）：

```
驱动脚本: node dsh/test/e2e/browser-layout-probe.mjs "<authenticated url>"
包装脚本: bash dsh/test/e2e/e2e-browser-layout.sh --port 19394
Chrome:   --headless=new --no-sandbox --disable-dev-shm-usage --user-data-dir=/tmp/<throwaway>
结果:     ---- browser-layout-probe: pass=16 fail=0 ----
```

关键原始测量值（空面板 → 真实报告渲染后）：

| 指标 | 实测 | 判读 |
|---|---|---|
| 父链 | `DIV`(display:contents，slot 宿主) → `DIV.pI_x6G_centerCol`(display:flex / column / overflow:hidden) | 槽位宿主布局透明；真正的父层就是 centerCol，**与 dsh-client 的判断一致** |
| `parentClientH` | **757** | 父层高度已解析（非 0） |
| `rootClientH` / computed height / flex | **757** / `757px` / `1 1 auto` | root 撑满父层 |
| `bodyClientH` | **670** | 滚动容器有确定高度 |
| `bodyScrollH`（报告渲染后） | **19112** | ≈ clientHeight 的 28.5 倍 → 真的需要滚动 |
| `scrollTop`（滚到底） | **18442 / maxScroll 18442** | 程序化滚到底成功 |
| header `top`（滚动前后） | **16 → 16** | 顶栏固定不动 |
| 底部只读提示可见性（滚到底后） | `true` | 最后一块内容可达 |
| 面板子树内 `overflow-y:auto` 元素 | **1**（即 `[data-dsh-cli-doctor-scroll]`） | 面板自身只有一个滚动容器；文档里另有 3 个属于 shell（`DIV.bhn1Oq_list`、`DIV`、`DIV.jLrgrW_content`），非本插件 |
| 真实诊断（由面板按钮触发） | 报告渲染成功，面板文本 71753 字符 | 按钮 → Host → check.js → 渲染整条链路在真浏览器里跑通 |

过程中我自己的 harness 有两处判据写错（已修正，非产品缺陷）：① 把「全树唯一滚动容器」错误地扫成整个 document
（应为面板子树，shell 自带滚动容器）；② 只看了直接父节点，未跳过 `display:contents` 的布局透明宿主。
两处修正后 16/16 全绿，且修正后的判据比原判据更贴近真实布局语义。

## 1. 交付的可重跑脚本

| 文件 | 作用 |
|---|---|
| `dsh/test/e2e/lib.sh` | 公共库：DSH_HOME 围栏、断言、JSON 取值、curl 取证、进程清理 |
| `dsh/test/e2e/run-all.sh` | 全量编排（7 阶段 + 汇总），`--port` / `--skip-e2e` |
| `dsh/test/e2e/e2e-api.sh` | 真实 scratch profile：plugin add → dump-config → 起服务 → HTTP 矩阵 → combo 包 → 真实诊断 → 单飞 |
| `dsh/test/e2e/e2e-failure-paths.sh` | 用 `CLI_DOCTOR_CHECK_PATH` 接缝在独立端口验证 exit-1 / invalid-json / output-too-large |
| `dsh/test/e2e/load-client-bundle.mjs` | 独立装载 `lib/client.js`：loader 外壳、inject/apply、两个 slot 参数、disposer、首屏 SSR；`require` 只放行 react 两个模块 |
| `dsh/test/e2e/view-contract.mjs` | 直接 import `src/client/view.js`：statusFor/recommendationFor/分组/计数 + 11 组畸形报告容错 |
| `dsh/test/e2e/panel-behavior.mjs` | jsdom + 真实 React 点击流：挂载不发 POST、loading/aria-busy、错误 role=alert+重试、五生态顺序、条目字段、卸载无残留定时器 |
| `dsh/test/e2e/purity-negative.sh` | 纯度门禁负面验证（在 `.dsh-test/purity-pkg` 副本上做，绝不改真包） |
| `dsh/test/e2e/build-repro.sh` | 构建幂等 + git status 不变 + `sync-shared --check` + `npm test` |
| `dsh/test/e2e/codex-decouple.sh` | Codex 路径零改动 + smoke 测试 + vendored 字节一致 + 半体自包含 |

脚本只写 `dsh/test/e2e/**`、`.dsh-test/**`、`/tmp`；**未修改** `dsh/src/**`、`dsh/lib/**`、`dsh/scripts/**`、`dsh/package.json`、`dsh/cordis.patch.yml` 及任何 Codex 文件。

## 2. 契约复核（§1–§7 逐条）

- **§1 包与运行面**：`name=dsh-cli-doctor`、`version=0.2.0`、`type=module`、`main=src/host/index.js`、
  `exports["./client"]=./lib/client.js`、零 `dependencies`。
  **无任何 `@deepseek-ai/dsh*` peerDependencies**（运行时兼容闸门只读 `peerDependencies`，已在
  `dsh-app-boot/lib/index.js:289` 核对），符合契约的跨版本策略。
  观察（非偏离）：`dsh.engines.dsh` 字段在本机运行时无消费者，惰性字段。
- **§2 Host**：前缀路由 + `ctx.effect` 绑定；`GET|HEAD health` / `POST check` / 405 / 404；
  三条件围栏；单飞；`spawn(process.execPath,[checkPath,'--json','--no-update'],{cwd:pkgRoot,env:process.env})`；
  8 分钟超时、24 MiB stdout 上限；结构化错误且无未处理 rejection；`application/json; charset=utf-8` + `no-store`。
  全部与实现一致（代码复核 + §3 端到端）。
- **§3.1 产物封装**：`lib/client.js` 首行逐字 `window.__ModuleLoader__.load({ id: "dsh-cli-doctor", factory: (require) => {`，`id` 取 `package.json.name`。
- **§3.2 模块纯度**：产物中 `require()` 字面量仅 `react`、`react/jsx-runtime`；无动态 `import()`；无 `@deepseek-ai`。
- **§3.3 导出与注册**：`inject=['slots']`；`sidebar.panellist` 参数 `{name,id:'cli-doctor',order:30,label:'CLI Doctor'}`；
  `main` 参数 `{name:'main',key:'cli-doctor'}`；两个 `slots.inject` disposer 都交给 `ctx.effect` 并由 `apply` 返回，可重复 dispose 不抛错。
  观察（非偏离）：参考实现（`dsh-client-ui-attachment` 等）连 `slots.inject` 的返回值都不收集，本插件收集并 dispose，更严格。
- **§3.4 面板行为**：见 §3 断言表；语义分支按 Lead 裁决以 `dashboard/app.js` 为准（版本线异常 vs 暂不建议、`outdated == null` 宽松判定）。
  观察（非偏离）：底部「只读检查…未执行任何升级」在有报告时渲染（随报告固定展示），首屏显示「首次打开不会自动检查」提示；
  契约措辞可两解，未按缺陷处理，在此备案。
- **§4 报告形状**：真实 `check.js --json` 报告在 `POST /check` 中透传；五个生态 `tools[]/deps[]` 齐全（见 §3）。
- **§5 构建与同步**：`npm run build` 幂等、只写 `lib/client.js`（与 `bin/**` 的同步产物）；`sync-shared --check` 通过；
  `dsh/bin/package.json`（`{"type":"commonjs"}`）为 DEFECT-1 修复的一部分，由 sync 脚本生成/校验（Lead 已同步契约 §5/§6）。
- **§6 测试**：`cd dsh && npm test` 全绿（含真实子进程回归用例）。
- **§7 环境事实**：`dsh 0.2.0-rc.2`；`.dsh-test` 隔离；未触碰 `~/.dsh`。
  修正两条 task-3 原始判据（实测证伪，**不是代码缺陷**）：
  1. 无浏览器标记的 `GET /health` 期望 200 是错的 → 正确为 **403**（围栏「先方法/路径、后围栏」）。
  2. `GET /plugins/dsh-cli-doctor/client.js` 期望 200 是错的 → 本版本该裸路径 **404**，插件资源只以
     boot manifest 里的 revisioned combo 形式提供（正确验证方式见 §3.10）。

## 3. 端到端断言与原始证据

证据目录示例：`.dsh-test/e2e-20261013-160458/`（下列输出均为该轮原文）。

### 3.1 装配（命令按 Lead 更正后的正确写法）

```
$ DSH_HOME=<repo>/.dsh-test dsh --profile scratch --from-default-profile web --dump-config   # 先用 web 模板建 profile
$ DSH_HOME=<repo>/.dsh-test dsh plugin --profile scratch add /Users/maxhou/Desktop/cli-doctor/dsh
plugin add exit=0
dependencies: + dsh-cli-doctor link:/Users/maxhou/Desktop/cli-doctor/dsh
```
- 说明：`dsh plugin add` 新建的 profile 只带 `@deepseek-ai/dsh-base`，没有 web 面，
  `dsh --profile <name> web` 这种写法在新版 dsh 上也会因多余 app 参数直接报错；
  脚本自动用 `--from-default-profile web` 初始化，并以 `dsh --profile scratch --port N --no-open` 启动。

### 3.2 dump-config

```
$ dsh --profile scratch --dump-config | grep -A2 'dsh-cli-doctor'
# == dsh-cli-doctor
- id: cli-doctor
  name: dsh-cli-doctor
```
✅ exit 0，`id: cli-doctor` 与 `name: dsh-cli-doctor` 均在。

### 3.3 health

```
GET /api/cli-doctor/health  (sec-fetch-site: same-origin) -> 200
{"ok":true,"version":"0.2.0","busy":false}
content-type: application/json; charset=utf-8
cache-control: no-store
HEAD /api/cli-doctor/health -> 200
```

### 3.4 围栏（4 拒绝 + 3 放行）

| 请求 | 期望 | 实际 | 结果 |
|---|---|---|---|
| 裸 `GET /health`（无任何标记） | 403 | `403 {"ok":false,"error":"forbidden"}` | ✅ |
| 裸 `POST /check`（无任何标记） | 403 | `403 {"ok":false,"error":"forbidden"}` | ✅ |
| `POST /check` + `Origin: http://evil.example` | 403 | 403 | ✅ |
| `POST /check` + `Host: evil.example` | 403 | 403 | ✅ |
| `GET /health` + `sec-fetch-site: same-origin` | 200 | 200 | ✅ |
| `GET /health` + `Origin: http://127.0.0.1:19390` | 200 | 200 | ✅ |
| `GET /health` + `Cookie: dsh-auth-e2e=1` | 200 | 200 | ✅ |

### 3.5 方法与路径

```
DELETE /api/cli-doctor/health -> 405 {"ok":false,"error":"method"}
GET    /api/cli-doctor/check   -> 405 {"ok":false,"error":"method"}   (无标记也是 405，先方法后围栏)
GET    /api/cli-doctor/nope    -> 404 {"ok":false,"error":"not-found"}
GET    /api/cli-doctor         -> 404 {"ok":false,"error":"not-found"}
```

### 3.6 真实诊断（DEFECT-1 关闭条件）

```
POST /api/cli-doctor/check  (sec-fetch-site: same-origin) -> 200
elapsed: 67s
{"ok":true,"report":{"generated_at":"2026-10-13T08:05:01.384Z",
 "scope":"本机 CLI 工具与依赖包版本现状（只读检查）",
 "managers":{"homebrew":{"tools":[{"name":"agent-browser","current":"0.36.0","latest":"0.39.0",
 "outdated":true,"upgrade_cmd":"brew upgrade agent-browser", ...}] ...}} ...},
 "checkedAt":"..."}
managers verdict: OK   # homebrew / npm_global / python_pip / rust_bun_uv / self_updating 全为 {tools[],deps[]}
report.elapsed_ms: 67289
```
✅ 200、149931 字节、`ok:true`、`checkedAt` 存在、五生态齐全。

### 3.7 单飞

```
并发两个 POST /check -> a=200 b=409
409 body: {"ok":false,"error":"busy"}
```
✅ 一个真实跑完、另一个立即 409；失败诊断后 `busy` 正确复位（§3.9）。

### 3.8 客户端产物（boot manifest 路径）

```
$ curl -c cookies.txt -o /dev/null "http://127.0.0.1:19390/?token=<banner token>"   -> 303（种 dsh-auth-* cookie）
$ curl -b cookies.txt -o boot.html http://127.0.0.1:19390/                          -> 200 (35000 bytes)
boot.html 中的 preload 含： .../client.js,dsh-cli-doctor/client.js,...&rev=17a44ff432e5
$ curl -b cookies.txt "<该 combo URL>" -> 200  10459607 bytes
```
产物内容断言（该 combo 内）：`window.__ModuleLoader__.load({ id: "dsh-cli-doctor", factory: (require) => {`、
`sidebar.panellist`、`"cli-doctor"`、`/api/cli-doctor/check` 全部命中。
这同时证明 **`dsh.client` 声明被 Host 接受并编入浏览器启动图**。
（裸 `GET /plugins/dsh-cli-doctor/client.js` = 404，为本版本正常行为，非缺陷。）

### 3.9 失败路径（真实 HTTP，Host 接缝驱动）

在独立端口用 `CLI_DOCTOR_CHECK_PATH` 指向桩脚本：

```
桩 exit 1        -> 500 {"ok":false,"error":"exit-1"}
桩 输出非 JSON    -> 500 {"ok":false,"error":"invalid-json"}
桩 输出 26 MiB    -> 500 {"ok":false,"error":"output-too-large"}
随后 GET /health -> 200 {"busy":false}     # 失败后 busy 复位、进程存活
所有失败运行日志无 unhandled/uncaught
```
✅ 结构化 500（未被 webserver 变成 400）。⚠️ 8 分钟超时分支未做端到端复现（见 §0 未验证项）。

### 3.10 客户端代码与面板（独立 harness）

- `load-client-bundle.mjs`：26/26 —— 单一注册、`id` 为包名、`inject=['slots']`、两个 slot 参数逐字段、
  `ctx.effect` 绑定、dispose 幂等、首屏 SSR 有「一键诊断当前状态」且 `type="button"`、
  `require()` 只出现 react 两项、无动态 import、无 `@deepseek-ai`。
- `view-contract.mjs`：106/106 —— statusFor/recommendationFor 全分支（含 Lead 裁决的「版本线异常」与依赖层分支）、
  五生态分组顺序、五项计数、11 组畸形报告（null/undefined/字段错型/原始值条目）不抛错、显示函数兜底。
- `panel-behavior.mjs`：38/38 —— 挂载仅 1 次 GET health 且无 POST；点击发 POST `/api/cli-doctor/check`；
  `report:null` 与结构性畸形报告不崩且仍可用；500 显示 `role="alert"` + 重试，未映射码原样透出；
  loading 时按钮 disabled + `aria-busy="true"` + 已等待文案，且不会重复发请求；
  五生态按契约顺序、条目含当前/最新版本与升级命令、报告头三项、skipped、底部只读提示；
  卸载后无残留 interval、容器清空。

## 4. 缺陷清单

### DEFECT-1（阻塞 → 已修复并复验通过）

- **严重度**：阻塞（面板主功能完全不可用）
- **期望**：`POST /api/cli-doctor/check` 返回 200 + `{ok:true, report, checkedAt}`
- **实际（修复前）**：`500 {"ok":false,"error":"exit-1"}`，耗时 0s
- **复现（脱离插件）**：
  ```
  $ cd /Users/maxhou/Desktop/cli-doctor && node dsh/bin/check.js --json --no-update
  file:///Users/maxhou/Desktop/cli-doctor/dsh/bin/check.js:16
  const { spawnSync } = require('child_process');
  ReferenceError: require is not defined in ES module scope
  This file is being treated as an ES module because it has a '.js' file extension and
  '/Users/maxhou/Desktop/cli-doctor/dsh/package.json' contains "type": "module".
  → exit 1
  ```
  服务端日志同一根因：`[cli-doctor] diagnosis failed (exit-1): ... ReferenceError: require is not defined in ES module scope`
- **根因**：`dsh/package.json` 的 `"type": "module"` 使 vendored 的 CommonJS `dsh/bin/check.js` 被按 ESM 加载；
  与脚本内容无关（它和 `../bin/check.js` 字节一致），纯属包 type 边界问题。
- **备选修法（均在 `/tmp` 同构副本上实测 exit 0 + 合法 JSON）**：A) 新增 `dsh/bin/package.json={"type":"commonjs"}`；
  B) vendored 副本改名 `check.cjs`。
- **裁决与修复**：Lead 采用方案 A，派 task-4 给 dsh-host（sync 脚本生成并校验该文件、stray 检查放行、
  parity 断言、新增真实子进程回归 `node dsh/bin/check.js --version`）。
- **复验证据（修复后）**：
  ```
  $ cat dsh/bin/package.json   -> {"type":"commonjs"}   (19 bytes)
  $ node dsh/bin/check.js --version                      -> 0.2.0   exit=0
  $ node dsh/bin/check.js --json --fast --no-update      -> exit=0，输出合法 JSON（"{ ... managers ... }"）
  E2E: POST /check -> 200，五生态 OK，checkedAt 合法，耗时 67s
  E2E: 并发两个 POST -> a=200 b=409
  ```
  ✅ 关闭。`dsh/test/parity.test.mjs` 回归用例已由作者加入，`npm test` 全绿。

### 非缺陷（已核实的判定更正）

| 项 | 原判据 | 实测 | 处理 |
|---|---|---|---|
| 裸 `GET /health` | 期望 200 | 403（围栏如此设计） | 更正判据，改带 `sec-fetch-site` 断言 |
| 裸 `/plugins/dsh-cli-doctor/client.js` | 期望 200 | 404（本版本不服务裸路径） | 改为从 boot.html 取 combo URL 断言 200 |
| `assert "both registrations disposed"` | 期望 register disposer 被保留 | 参考实现均只依赖 `slots.inject` 句柄 | 更正 harness，按参考语义断言 inject disposer |
| 首屏无「未执行任何升级」 | — | 该文案随报告渲染 | 备案为观察，非缺陷 |
| 面板把 `exit-1` 显示为中文 | 期望原样含 `exit-1` | 设计如此（未映射码才原样透出） | 更正 harness 断言 |

## 5. 未验证项（明确不当作通过）

1. **8 分钟超时分支的端到端复现**：需要真实等待 8 分钟；本报告只验证了 exit-1 / invalid-json / output-too-large
   三条真实 HTTP 失败路径，超时分支由作者注入 `timeoutMs` 的单测覆盖。
2. **~~真机桌面侧栏渲染~~（已补齐）**：真实浏览器布局/滚动已由 §0.2 的 headless Chrome + CDP 实测关闭
   （rootClientH=757、bodyScrollH=19112、滚到底 18442/18442、顶栏 16→16）；运行中的 desktop GUI 由 §6 的
   安装确认关闭。剩余差异仅是 Electron 壳层外观，属 Lead 的桌面会话范畴。
3. **跨版本/跨平台**：仅在 `dsh 0.2.0-rc.2` / macOS / Node v26.8.1 上验证。
4. **~~`~/.dsh` 与 desktop profile~~（已由 Lead 补齐）**：verifier 全程未触碰；安装效果见 §6。

---

## 6. Lead 安装后确认（desktop profile，2026-10-13 17:07–17:09，非沙箱内验证）

verifier 的未验证项 2 与 4 由 Lead 在本机真实 `desktop` profile 上补齐，证据如下：

| 检查 | 命令 / 手段 | 结果 |
|---|---|---|
| 安装 | `plugin_manager install_bundle` target=`/Users/maxhou/Desktop/cli-doctor/dsh` | `application: "applied"`、`enabled: true`、`bundle: dsh-cli-doctor`、`warnings: []`（**无需重启**，热应用） |
| profile 状态 | `cat ~/.dsh/profiles/desktop/package.json` | 依赖 `dsh-cli-doctor: link:/Users/maxhou/Desktop/cli-doctor/dsh`；bundles 末尾追加 `dsh-cli-doctor` |
| 侧栏入口真的注册进运行中的界面 | `cordis_inspect_query` client/Slots `sidebar.panellist` | occupants 新增 `{id: "cli-doctor", order: 30, active: true}`（与 `plugins`、`schedules` 并列） |
| Host 半体在真实会话中可用 | `curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:19387/api/cli-doctor/health` | `200 {"ok":true,"version":"0.2.0","busy":false}` |
| 围栏在真实会话中生效 | 同上但不带标记 | `403` |
| 真实诊断（面板按钮同一条链路） | `POST /api/cli-doctor/check` @19387 | `200`，`ok:true`，`elapsed_ms=66304`，五生态齐全（homebrew 9/21、npm_global 17、python_pip 56/87、rust_bun_uv 4、self_updating 5），`skipped: []` |
| 单飞 | 诊断进行中查 health + 并发第二次 POST | `busy:true`；并发返回 `409 {"ok":false,"error":"busy"}` |
| Codex 解耦（安装后复测） | `git status --porcelain -- plugin.json mcp.json codex-server.js codex-bridge.js dashboard .agents SKILL.md bin test package.json` | 空；`node test/codex_plugin_smoke.js` exit 0 |

结论：插件已安装进 `desktop` profile 并在**运行中的 GUI 里即时生效**，侧栏入口与主机路由均可用，
真实诊断链路端到端跑通。剩余唯一未覆盖项为「8 分钟超时分支的真实等待复现」（已由注入式单测覆盖）。
