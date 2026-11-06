# cli-doctor DSH 插件：独立验证报告（verifier / task-3 + task-6）

- 验证对象：`dsh/`（Host 半体、Client 半体、构建脚本、vendored `bin/**`）
- 运行环境（v1 历史轮次）：macOS，Node v26.8.1，真实 CLI `dsh 0.2.0-rc.2`（`/opt/homebrew/bin/dsh`）
- 运行环境（v2 当前）：PATH `dsh 0.2.1-rc.5`；Desktop 运行时 `0.2.2-rc.1`（在 `app.asar` 内）
- **v1/v2 分界**：§0–§6 的 ✅ 是 CONTRACT **v1** 的历史结果；CONTRACT v2 的 harness 变更记录在 §0.3。
  **v2 第一批集成验证见 §7（task-7，9/9 阶段 ALL STAGES PASSED）**，
  **v2 第二批-1（复制报告 + 汇总卡片筛选）集成验证见 §8（task-9，9/9 阶段 ALL STAGES PASSED）**。
  原始证据另见 `.review/v0.3.0-verification.md` 与 `.review/v0.3.0-batch2-verification.md`。
- 记录中的本机仓库路径已脱敏为 `<repo>`，其余输出与命令保持原样
- 隔离环境：`DSH_HOME=<repo>/.dsh-test`（工作区内，gitignore）
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

## 0.3 CONTRACT v2 harness 更新（task-6，2026-11-06）— 断言变更与待复跑状态

**本轮（task-6）只改脚本/文档，未跑全量 e2e**：Host v2（`dsh/src/host/index.js`）与 Client v2
（`dsh/src/client/store.js`、`panel.jsx`、`lib/client.js`）由另外两个队友并行实现；不跑
`run-all` / `e2e-api` / `e2e-failure-paths` / 真实浏览器阶段。静态自检已通过：所有 `*.sh` 过
`bash -n`，所有 `*.mjs` 过 `node --check`。

> **后续状态（task-7，2026-11-06）**：上述 harness 已在实现落地后完整执行，**9/9 阶段通过**；
> 结果与日志路径见 §7。下面「未运行」的表述仅描述 task-6 当时的状态。

**本轮已跑的三个纯 harness（对当前工作树，不启动 dsh、不碰真实 profile）**：

```
node dsh/test/e2e/view-contract.mjs        -> pass=196 fail=0
node dsh/test/e2e/load-client-bundle.mjs   -> pass=36  fail=0
node dsh/test/e2e/panel-behavior.mjs       -> pass=122 fail=0
```

这三项只 import `src/client/view.js` / 装载 `lib/client.js`，不依赖 Host→profile→HTTP 链路，因此可以
在实现方并行改动期间先验证脚本自身。`e2e-api` / `e2e-failure-paths` / `e2e-browser-layout` **未运行**，
等 task-7 集成复跑。

**已知契约缺口（task-6 读当时工作树发现，均已在 task-7 前修复）**：

1. ~~失败响应缺 `detail`/`elapsedMs`~~：已修。Host 失败体现在是
   `{"ok":false,"error":"exit-1","detail":"check.js stderr: …","elapsedMs":29}`（CONTRACT v2.1 已同步）。
2. ~~`cordis.patch.yml` 缺 `checkTimeoutMs`~~：已修。默认块现有 `autoCheck/staleAfterHours/keepHistory/
   checkTimeoutMs: 900000`，`e2e-api` 的 dump-config 断言从 `skip` 变为实际 PASS。
3. 其余 v2 形状已按代码核对一致：`/health.capabilities/lastCheck`、`/snapshot`（`full=1` 才带 report，
   `cache:{ttlMs,autoCheck}`）、`/status.running{startedAt,elapsedMs,mode,waiters}`、`/history`（默认 20/上限
   100）、`force=0` 缓存命中、attach 共享（`fresh`/`attached`/`shared`）、取消返回 500 `cancelled`
   且不覆盖快照、`state.json`（`schemaVersion:1`、原子写、0700/0600、损坏忽略、写失败只记日志）、
   spawn 参数与 4 个 env 卫生变量。

| 脚本 | v2 主要变更（新增断言，不删 v1 覆盖） | 等哪个实现落地 | 预判风险 |
|---|---|---|---|
| `e2e-api.sh` | 双服务器矩阵：① contract server（`CLI_DOCTOR_CHECK_PATH` stub 检查器，记录 argv/env/spawn 次数 + 可调延迟）跑全部 HTTP 约定；② real server 跑一次真实 full 诊断并重启验证持久化。新增：health `capabilities/lastCheck`；`/snapshot`（无缓存 200+null、默认不含 report、`full=1` 含 report、`cache.ttlMs/autoCheck`）；`/status`（idle/running/lastCheck）；`/history`（默认/limit 上限）；全部新路由的 403/405/404；`?mode=fast|full` 的 argv（`--fast`/`--no-update`）与 spawn env 卫生（4 个变量）；`force=0` cache hit、默认 fresh；并发两请求 200 + 同 `checkedAt` + 只 spawn 一次（`fresh`/`attached`/`shared`）；运行中 `/status.busy`、`/health.busy`；`/check/cancel` 运行中 true/空闲 false、等待者 500 `cancelled`、busy 释放、取消不覆盖快照；`state.json` 重启恢复、损坏文件忽略、只读目录下写失败不影响响应、目录 0700/文件 0600、`schemaVersion:1`；真实诊断 `mode=full` + 重启恢复真实快照；bundle 字节含 v2 路由与主题 token。v1 围栏 4 类拒绝/3 类放行、405/404、boot manifest、UI-1 字节断言全部保留 | Host v2 全部路由 + `cordis.patch.yml` 默认配置块（`autoCheck/staleAfterHours/keepHistory/checkTimeoutMs`）；bundle 字节断言还需 Client v2 重建 `lib/client.js` | ① `cordis.patch.yml` 默认配置键由 Lead/契约维护，缺失时脚本降级为 `skip` 而非 FAIL；② stub checker 依赖 spawn env 透传（`{...process.env}`），若实现改为白名单 env 会连锁失败；③ 取消的 SIGTERM→5 s SIGKILL 升级只做了 `cancelled:true` 断言，未单独验证 SIGKILL 路径；④ 0700/0600 与写失败容器化在个别文件系统/CI 上可能表现不同 |
| `view-contract.mjs` | 依赖语义断言改为 CONTRACT §v2.3 的字面量：「候选更新 · 待核验」（tone=review）+「依赖更新需人工核验」；新增「v1 矛盾组合（有可用更新 + 无法判断）必须不存在」遍历断言；`summarize()` 新增 `depCount/conflictCount/uncertainCount` 且五个工具层计数口径不变；畸形依赖条目/impact 容错用例；可选 `formatAge/stalenessOf` 降级 SKIP | Client v2 的 `dsh/src/client/view.js`（导出名保持不变） | 若实现把 `候选更新 · 待核验` 拆成两段或改名，断言会失败；新计数只按契约名 `depCount/conflictCount/uncertainCount` 断言 |
| `panel-behavior.mjs` | 重写为「每个场景重新装载 bundle」以得到干净的模块级 store，覆盖：v2 挂载引导顺序 health→snapshot(full=1) 且 `autoCheck=false` 不发 POST；`autoCheck=true` 自动检查恰好一次、重挂载不再触发；快照恢复立即渲染（无 POST）+ 相对时间；过期快照触发一次自动检查并刷新；loading/aria-busy/双击守卫；取消按钮 → `POST /check/cancel` → 500 `cancelled` 可读文案 + 重试；`report:null`/畸形报告/exit-1/未知错误码容错；fast 结果显式标注；完整报告（五生态/五计数/meta/skipped/footer/升级命令/版本线）+ v2 依赖语义与「依赖冲突/依赖待核验」计数；UI-1 唯一滚动容器/固定表头/根撑满/内容可达全部保留；卸载→重挂载保留结果且无残留 interval | Client v2（`store.js` + `panel.jsx` + 重建 `lib/client.js`） | ① 文案类断言（取消/快速/依赖计数）依赖具体中文措辞，实现若用同义改写会失败；② 「root 直接子节点」断言放宽为 header+scroll 必须是直接子节点（v2 工具栏可能新增一层），其余 UI-1 精确断言不动；③ 自动检查依赖 effect 链，测试用空宏任务 settle，若实现使用更长延迟需调整 |
| `browser-layout-probe.mjs` | 服务器用 `CLI_DOCTOR_AUTO_CHECK=0` 启动，隔离真实 70 s 自动诊断；探针**优先使用缓存恢复的报告**做布局测量（来自 e2e-api 落盘快照），缓存为空才点诊断按钮跑真实诊断；原有 16 项布局/滚动断言逐条保留（新增相对时间 2 项）；按钮查找兼容「一键诊断当前状态/重新诊断/诊断当前状态」 | Client v2 面板 + e2e-api 落盘快照（独立跑时回落为点按钮） | ① 若浏览器阶段在 e2e-api 之前单独跑且无快照，会回落到 ~70 s 真实诊断（超时上限 6 min 不变）；② 相对时间/过期文案断言依赖实现措辞 |
| `load-client-bundle.mjs` | 首屏断言去掉 v1 的「首次打开不会自动检查」（v2 已有 stale-gate 自动检查），改为断言 `[data-dsh-cli-doctor-scroll]` 首屏存在且旧承诺已移除；新增 bundle 字节断言：`/snapshot`、`/status`、`/check/cancel`、`上次诊断`、`候选更新`、`依赖更新需人工核验`、`--dsw-alias-`；纯度/loader/slot/disposer 断言不变 | Client v2 重建后的 `lib/client.js` | 文案/端点字符串必须真的出现在 bundle 字节里；实现若把文案移到常量文件仍会内联进 bundle，一般可命中 |
| `e2e-failure-paths.sh` | 新增：错误体带 v2 `elapsedMs`、exit-1 带 stderr 尾 `detail`；失败矩阵前后 `/snapshot.checkedAt` 不变（失败不覆盖快照）；`/status.busy=false`；超时分支文案改为 `checkTimeoutMs`（默认 900 s）口径 | Host v2 错误体与快照持久化 | `detail` 可能被实现做成可选字段；若省略，这一条会失败 |
| `run-all.sh` | 只更新阶段说明（9 阶段，注明仅 e2e-api 跑真实诊断、浏览器阶段复用快照） | 无 | 无 |
| `e2e-browser-layout.sh` | 服务器启动加 `CLI_DOCTOR_AUTO_CHECK=0` 并打印说明 | 无 | 若运行时忽略该 env，自动检查会与探针点击竞争（超时上限仍覆盖） |

**复跑顺序（task-7 建议）**：`npm run build` + `npm test` → `load-client-bundle` → `view-contract`
→ `panel-behavior` → `purity-negative` → `codex-decouple` → `e2e-api --fresh` → `failure-paths`
→ `e2e-browser-layout`。预计耗时约 4–6 分钟（其中真实 full 诊断约 70 s；stub 矩阵秒级）。

**断言数量**：`e2e-api` 约 150 条（v1 62 条全部保留 + v2 新增，待 task-7 回填实测）；
`panel-behavior` 122 条（2026-11-06 实测 pass=122）；`view-contract` 196 条（实测 pass=196）；
`load-client-bundle` 36 条（实测 pass=36）；`browser-layout-probe` 18 条（原 16 + 2）。

## 1. 交付的可重跑脚本

| 文件 | 作用 |
|---|---|
| `dsh/test/e2e/lib.sh` | 公共库：DSH_HOME 围栏、断言、JSON 取值、curl 取证、进程清理 |
| `dsh/test/e2e/run-all.sh` | 全量编排（**9 阶段** + 汇总），`--port` / `--skip-e2e` |
| `dsh/test/e2e/e2e-api.sh` | **v2**：真实 scratch profile → 起 A) contract server（stub 检查器）跑 HTTP 矩阵（health/snapshot/status/history/check/cancel、围栏/405/404、cache/attach/cancel、持久化/损坏容错）→ 起 B) real server 跑一次真实诊断并重启验证持久化 → combo 包与 v2 client 字节断言 |
| `dsh/test/e2e/e2e-failure-paths.sh` | **v2**：`CLI_DOCTOR_CHECK_PATH` 接缝在独立端口验证 exit-1 / invalid-json / output-too-large，并断言 `elapsedMs`/`detail`、失败不覆盖快照 |
| `dsh/test/e2e/load-client-bundle.mjs` | **v2**：独立装载 `lib/client.js`：loader 外壳、inject/apply、两个 slot 参数、disposer、首屏 SSR、v2 端点/文案/主题 token 字节断言；`require` 只放行 react 两个模块 |
| `dsh/test/e2e/view-contract.mjs` | **v2**：直接 import `src/client/view.js`：statusFor/recommendationFor（含依赖语义修复）、分组/计数（含 `depCount/conflictCount/uncertainCount`）+ 13 组畸形报告容错 |
| `dsh/test/e2e/panel-behavior.mjs` | **v2**：jsdom + 真实 React：挂载引导（health→snapshot→自动检查一次）、快照恢复、过期自动检查、取消、loading/aria-busy、错误 role=alert+重试、五生态顺序、依赖语义、卸载/重挂载状态保留 |
| `dsh/test/e2e/browser-layout-probe.mjs` | **v2**：Chrome + CDP 真实布局；优先用缓存快照，缓存空才点按钮；`CLI_DOCTOR_AUTO_CHECK=0` 隔离自动诊断；16 项布局/滚动断言保留 + 相对时间 2 项 |
| `dsh/test/e2e/e2e-browser-layout.sh` | v2：以 `CLI_DOCTOR_AUTO_CHECK=0` 起服务后驱动 `browser-layout-probe.mjs` |
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
$ DSH_HOME=<repo>/.dsh-test dsh plugin --profile scratch add <repo>/dsh
plugin add exit=0
dependencies: + dsh-cli-doctor link:<repo>/dsh
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
  $ cd <repo> && node dsh/bin/check.js --json --no-update
  file://<repo>/dsh/bin/check.js:16
  const { spawnSync } = require('child_process');
  ReferenceError: require is not defined in ES module scope
  This file is being treated as an ES module because it has a '.js' file extension and
  '<repo>/dsh/package.json' contains "type": "module".
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

1. **超时分支的端到端复现**：CONTRACT v2.2 起 `checkTimeoutMs` 默认 900 000 ms（15 min），真实等待不可行；
   本报告只验证了 exit-1 / invalid-json / output-too-large 三条真实 HTTP 失败路径，超时分支由作者注入
   `timeoutMs` 的单测覆盖。**v2 新增未验证**：取消时 SIGTERM→5 s→SIGKILL 的升级路径只断言了
   `cancelled:true` 与 busy 释放，未观测 SIGKILL 本身。
2. **~~真机桌面侧栏渲染~~（已补齐）**：真实浏览器布局/滚动已由 §0.2 的 headless Chrome + CDP 实测关闭
   （rootClientH=757、bodyScrollH=19112、滚到底 18442/18442、顶栏 16→16）；运行中的 desktop GUI 由 §6 的
   安装确认关闭。剩余差异仅是 Electron 壳层外观，属 Lead 的桌面会话范畴。
3. **跨版本/跨平台**：v1 在 `dsh 0.2.0-rc.2` 上验证；v2 已在 PATH `dsh 0.2.1-rc.5` + Desktop
   `0.2.2-rc.1` 上完整复跑（§7），仍未覆盖其他 dsh 版本/平台。
5. **v2 契约实现与 harness 的一致性**：已由 task-7 集成复跑关闭（9/9 阶段通过）；剩余 4 条
   未验证项见 §7.4。
4. **~~`~/.dsh` 与 desktop profile~~（已由 Lead 补齐）**：verifier 全程未触碰；安装效果见 §6。

---

## 6. Lead 安装后确认（desktop profile，2026-10-13 17:07–17:09，非沙箱内验证）

verifier 的未验证项 2 与 4 由 Lead 在本机真实 `desktop` profile 上补齐，证据如下：

| 检查 | 命令 / 手段 | 结果 |
|---|---|---|
| 安装 | `plugin_manager install_bundle` target=`<repo>/dsh` | `application: "applied"`、`enabled: true`、`bundle: dsh-cli-doctor`、`warnings: []`（**无需重启**，热应用） |
| profile 状态 | `cat ~/.dsh/profiles/desktop/package.json` | 依赖 `dsh-cli-doctor: link:<repo>/dsh`；bundles 末尾追加 `dsh-cli-doctor` |
| 侧栏入口真的注册进运行中的界面 | `cordis_inspect_query` client/Slots `sidebar.panellist` | occupants 新增 `{id: "cli-doctor", order: 30, active: true}`（与 `plugins`、`schedules` 并列） |
| Host 半体在真实会话中可用 | `curl -H 'sec-fetch-site: same-origin' http://127.0.0.1:19387/api/cli-doctor/health` | `200 {"ok":true,"version":"0.2.0","busy":false}` |
| 围栏在真实会话中生效 | 同上但不带标记 | `403` |
| 真实诊断（面板按钮同一条链路） | `POST /api/cli-doctor/check` @19387 | `200`，`ok:true`，`elapsed_ms=66304`，五生态齐全（homebrew 9/21、npm_global 17、python_pip 56/87、rust_bun_uv 4、self_updating 5），`skipped: []` |
| 单飞 | 诊断进行中查 health + 并发第二次 POST | `busy:true`；并发返回 `409 {"ok":false,"error":"busy"}` |
| Codex 解耦（安装后复测） | `git status --porcelain -- plugin.json mcp.json codex-server.js codex-bridge.js dashboard .agents SKILL.md bin test package.json` | 空；`node test/codex_plugin_smoke.js` exit 0 |

结论：插件已安装进 `desktop` profile 并在**运行中的 GUI 里即时生效**，侧栏入口与主机路由均可用，
真实诊断链路端到端跑通。剩余唯一未覆盖项为「8 分钟超时分支的真实等待复现」（已由注入式单测覆盖）。

---

## 7. v2 集成验证结果（task-7，2026-11-06 15:18–15:25）

环境：macOS 27.2（arm64）· Node v26.8.1 · PATH `dsh 0.2.1-rc.5` · Desktop 运行时 `0.2.2-rc.1` ·
仓库 HEAD `3b56048` + v2 工作树修改 · `DSH_HOME=<repo>/.dsh-test`（继承的 `~/.dsh` 被 lib.sh 显式忽略）。

### 7.1 结论

**9/9 阶段通过，`ALL STAGES PASSED`，`RUN_ALL_EXIT=0`**；build 两次字节一致、单测 124/124、
client bundle 纯度达标（仅 `react` / `react/jsx-runtime`）。v0.3.0 第一批**可交付**。

### 7.2 阶段结果

命令：`cd dsh && bash test/e2e/run-all.sh --port 19390`
主日志：`.dsh-test/e2e-20261106-152230/`（含 `run-all.console.log`）。

| # | 阶段 | 结果 | 断言 | 子日志 |
|---|---|---|---|---|
| 1 | build reproducibility | PASS | 9/9（+1 unverified：`EXPECTED_CLIENT_SHA256` 未钉住） | `e2e-20261106-152230/` |
| 2 | client bundle loader | PASS | 36/36 | 无独立日志（stdout） |
| 3 | view contract | PASS | 196/196 | 无独立日志 |
| 4 | panel behavior (jsdom) | PASS | 122/122 | 无独立日志 |
| 5 | purity gate negative | PASS | 14/14 | `e2e-20261106-152233/` |
| 6 | codex decoupling | PASS | 10/10 | `e2e-20261106-152233/` |
| 7 | real DSH end-to-end (v2) | PASS | **217/217** | `e2e-20261106-152234/`（240 个证据文件） |
| 8 | host failure paths | PASS | 20/20（+1 unverified：超时分支） | `e2e-20261106-152315/` |
| 9 | real browser layout | PASS | 2/2（probe 18/18） | `e2e-20261106-152321/` |

合计 **626 条阶段级断言全部通过**。

### 7.3 关键证据（摘要，原文见 `.review/v0.3.0-verification.md`）

- 并发 attach：`a=200 b=200`、同一 `checkedAt`、spawn 仅 1 次、`cache: fresh/attached`、`shared:true`。
- 快照/历史/持久化：`state.json` 2435 B（`schemaVersion:1`、0700/0600）跨重启恢复；
  `/snapshot` 1432 B summary 默认不含 report，`?full=1` 1449 B 含 report；`/history` 4 条。
- 取消：waiter 收 `500 {"error":"cancelled","elapsedMs":163}`，busy 在子进程 close 后复位，
  快照 checkedAt 前后不变；空闲取消返回 `cancelled:false`。
- 缓存：`force=0` → `cache:"hit"` 且不 spawn；默认 `force=1` → `fresh` 且 checkedAt 前进。
- 真实 full 诊断：200、177,298 B、`elapsed_ms=19399`、五生态齐全；重启后 `?full=1` 177,627 B 恢复。
- 真实 fast 档（独立探针）：`mode:"fast"`、`elapsedMs=8460`，npm/pip/rust 的 `latest` 全为 null，
  homebrew 14/14 有 latest。
- env 卫生：`HOMEBREW_NO_AUTO_UPDATE/HOMEBREW_NO_ANALYTICS/PIP_DISABLE_PIP_VERSION_CHECK/NO_COLOR`
  在 stub spawn 中均为 `1`；fast argv 含 `--fast`，full 不含。
- 真实浏览器：面板子树唯一滚动容器、父层 flex/column、header 固定在 16px、
  `bodyScrollH=21954 / bodyClientH=670`、滚到底 `21284/21284`、footer 可见。

### 7.4 首跑失败与修复（harness 缺陷，非实现 bug）

第一次全量 8/9（e2e-api 5 条 FAIL，日志 `.dsh-test/e2e-20261106-151901/`）：
并发请求的 `*.status`/`*.body` 为空、attach 请求被误判。
根因是 task-6 的 `bg_post()` 用 `PID="$(bg_post …)"` 命令替换启动后台 curl，PID 属于被回收的子 shell，
主 shell `wait` 立即返回且读到未写入的文件；残留请求又使后续 16b 的运行 mode 变为 `fast`。
修复：`bg_post` 改为写全局 `BG_PID`（只改 `dsh/test/e2e/e2e-api.sh`），修复后单跑 e2e-api 217/217，
全量复跑 9/9 通过。

### 7.5 护栏

- `git status --short`：仅预期改动（`dsh/src/{host,client}`、`dsh/lib`、`dsh/test`、`CONTRACT.md`、
  `cordis.patch.yml`、`dsh/README.md`、`dsh/test/e2e/**`、`.review/`、设计文档、`store.js`）；
  Codex 保护路径（`plugin.json`/`mcp.json`/`codex-server.js`/`codex-bridge.js`/`dashboard/`/`.agents/`/
  `SKILL.md`/根 `test/`/根 `package.json`）零出现。
- `git diff --check` rc=0；无残留 dsh 进程、端口已释放。
- `~/.dsh` 隔离：自测试标记之后无任何 e2e 产物（无 `storages/cli-doctor`、无 `profiles/scratch`）；
  唯一 2 个新文件是本次 agent 会话自身的 runtime 日志/投影缓存，与测试无关。

### 7.6 未验证项（明确不当作通过）

1. `checkTimeoutMs`（默认 900 000 ms）超时分支未端到端复现，由 Host 注入 `timeoutMs` 的单测覆盖。
2. 取消的 SIGTERM→5 s→SIGKILL 升级路径只断言 `cancelled:true` + busy 复位，未单独观测 SIGKILL。
3. `EXPECTED_CLIENT_SHA256` 未钉住（build-repro 的 1 条 unverified），仅证明两次构建字节稳定
   （sha256 `4e0d6b1db289…`）。
4. 真实 desktop GUI 的最终视觉验收不在本任务内（真实浏览器布局/滚动已由 Chrome 阶段覆盖）。

---

## 8. v2.8 第二批-1 集成验证结果（task-9，2026-11-06 16:12–16:15）

验证对象：复制诊断报告（Markdown / 原始 JSON）+ 汇总卡片即时筛选（CONTRACT §v2.8）。
环境同 §7（macOS 27.2 / Node v26.8.1 / PATH `dsh 0.2.1-rc.5` / Desktop `0.2.2-rc.1`）；
`DSH_HOME=<repo>/.dsh-test`，未写 `~/.dsh`。

### 8.1 结论

**9/9 阶段 `ALL STAGES PASSED`，`RUN_ALL_EXIT=0`；npm test 143/143；788 条阶段级断言全通过**
（+2 条显式 unverified）。本轮**一次通过**，未发现实现 bug；只新增 e2e 断言与 README 两节。
第二批-1 **可交付**。

### 8.2 阶段结果

命令：`cd dsh && bash test/e2e/run-all.sh --port 19390`
主日志：`.dsh-test/e2e-20261106-161227/`（含控制台证据 `run-all.console.txt`）；
子日志：e2e-api `.dsh-test/e2e-20261106-161234/`、failure-paths `.dsh-test/e2e-20261106-161429/`、
browser `.dsh-test/e2e-20261106-161434/`。

| # | 阶段 | 结果 | 断言（较 task-7 增量） |
|---|---|---|---|
| 1 | build reproducibility | PASS | 9/9（+1 unverified：sha 未钉住）；`lib/client.js` 80,317 B，sha256 `a02bfb42e102…` |
| 2 | client bundle loader | PASS | 46/46（+10） |
| 3 | view contract | PASS | 288/288（+92） |
| 4 | panel behavior（jsdom） | PASS | 175/175（+53） |
| 5 | purity gate negative | PASS | 14/14 |
| 6 | codex decoupling | PASS | 10/10 |
| 7 | real DSH end-to-end | PASS | 224/224（+7 served-bytes 断言；真实 full 诊断 90.8 s / 177,298 B） |
| 8 | host failure paths | PASS | 20/20（+1 unverified：超时分支） |
| 9 | real browser layout | PASS | 2/2（probe 25/25，+7；原 16 项布局/滚动断言保留） |

合计 **788 条阶段级断言通过**。

### 8.3 关键证据

- **复制报告**：报告渲染后存在「复制报告」（Markdown，`aria-label` 声明“可直接粘贴给 AI”）与
  「复制原始 JSON」两个 `type="button"`；jsdom clipboard seam 收到的 Markdown 含
  `# CLI Doctor 诊断报告` / 基本信息 / 汇总计数 / 可行动工具明细（`#### ripgrep`）/ 依赖冲突与待核验 /
  只读说明 / 数据来源；JSON 可 parse 并深等于原报告且等于 `JSON.stringify(report,null,2)`；
  复制前后无网络请求、报告不变；成功反馈「已复制」`role=status` `aria-live=polite`，约 2 s 后消失；
  `writeText` 抛错 → 只读 textarea 降级（含完整 Markdown + “剪贴板写入失败…denied” + 关闭按钮）；
  `navigator.clipboard` 缺失 → 同样 textarea 降级（“当前环境不支持剪贴板写入”），JSON 可 parse 回原报告。
- **汇总卡片筛选**：5 张卡均 `<button type="button" aria-pressed>`；无筛选时「已发现工具」为 true；
  点击「有可用更新」→ 可见工具卡恰为 4 张匹配卡、活动卡 pressed=true、说明行写明「依赖层已隐藏」、
  依赖卡消失、分块头「匹配 N / 共 M 个工具」、「清除筛选」出现；再次点击同卡 / 「清除筛选」/
  「已发现工具」三种方式均恢复全量；「建议更新」→ 仅 ripgrep；「需核验或暂缓」→ 3 张；
  「目标待核验」→ 仅 pip；空结果显示「没有符合…」+ 清除入口；筛选跨卸载/重挂载保留。
- **一致性**：view-contract 对 7 工具 fixture 穷举 `toolMatchesSummaryFilter` 与 `summarize()`
  五计数（toolCount/updateCount/recommendedCount/reviewCount/unknownCount = 7/4/1/4/2 全等），
  且 `groupBlock.updateCount` 用同一判定；Markdown 对“请运行/请执行/建议执行/立即执行/自动执行升级”
  五类诱导式样断言不存在。
- **真实浏览器**：真实报告面板上复制按钮可发现、5 张卡带 `aria-pressed`；点击卡后真实 DOM 出现
  「依赖层已隐藏」+「匹配 N / 共 M」+「清除筛选」，清除后说明行消失；原 16 项布局断言保持绿色
  （唯一滚动容器、父层 flex/column、header 固定 16→16、滚到底 21284/21284、footer 可见）。
- **产物字节**：真实 combo bundle（2,093,637 B）包含「复制报告」「复制原始 JSON」
  「data-dsh-cli-doctor-copy」「data-dsh-cli-doctor-copy-feedback」「清除筛选」「匹配 」
  「aria-pressed」——GUI 实际收到的产物即带这两项能力。

### 8.4 本轮 e2e/文档变更

`panel-behavior.mjs`（+53）、`view-contract.mjs`（+92）、`load-client-bundle.mjs`（+10）、
`e2e-api.sh`（+7 served-bytes）、`browser-layout-probe.mjs`（+7，原断言零删改）、
`dsh/README.md`（新增「面板操作（第二批-1）」：复制 Markdown/JSON、剪贴板降级、汇总卡筛选与清除方式）。
未改 `src/**`、`lib/**`、`CONTRACT.md`、`cordis.patch.yml`。

### 8.5 护栏与未验证项

- `git status --short` 仅预期改动；Codex 保护路径出现 0；`git diff --check` rc=0；
  `~/.dsh` 自 marker 后 e2e 产物 0 个（仅本 agent 会话自身 2 个 runtime 日志/投影缓存）；
  无残留进程/端口。
- 未验证：① 真实浏览器剪贴板写入内容未回读（headless 权限模型不同；内容由纯函数 + jsdom seam 证明）；
  ② 「已复制」2 s 消失只在 jsdom 计时；③ `checkTimeoutMs` 超时分支未端到端复现（单测覆盖）；
  ④ SIGKILL 升级未单独观测；⑤ `EXPECTED_CLIENT_SHA256` 未钉住（build-repro 唯一 unverified）；
  ⑥ desktop GUI 最终视觉验收不在本任务内。均不阻塞交付。
