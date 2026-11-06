# CLI Doctor for DeepSeek Harness（左侧边栏插件）

把 CLI Doctor 装进 DSH 的左侧边栏：点一下「一键诊断当前状态」，就在面板里看到本机 CLI 工具链的版本现状、
依赖耦合和升级风险。诊断调用仓库根目录的只读检查器 `bin/check.js --json --no-update`，**不执行任何升级**。

- 插件包名：`dsh-cli-doctor`
- 侧边栏入口 id：`cli-doctor`（顺序 30，在 Plugins、Schedules 之后）
- 运行面：Host 半体（`src/host/index.js`，注册 `/api/cli-doctor/*`）+ 浏览器半体（`lib/client.js`，注册侧栏 slot）
- 运行时依赖：无（client bundle 只 require `react` / `react/jsx-runtime`）
- 契约：`CONTRACT.md` v2（随包发布；2026-11-06 增补优先于 v1 正文）
- 与 Codex 侧栏插件互不影响：本目录自包含，不改动 `plugin.json`、`mcp.json`、`codex-server.js`、
  `dashboard/**` 等任何 Codex 适配文件

## v2 行为（当前批次）

- **结果缓存**：诊断结果由 Host 保存为快照（含 checkedAt / mode / elapsedMs / 摘要），
  写入 `<dataDir>/state.json`；Host 重启后 `GET /snapshot` 仍能恢复上次结果，面板打开即显示。
- **过期自动检查**：打开面板时，若没有快照或快照超过 `staleAfterHours`（默认 12 h）且
  `autoCheck` 为真，客户端自动触发**一次**可取消的 full 诊断；同一次面板生命周期内只自动触发一次。
  设置环境变量 `CLI_DOCTOR_AUTO_CHECK=0` 可关闭该行为（`/snapshot.cache.autoCheck` 会如实透出）。
- **可取消**：诊断进行中面板出现「取消」按钮，调用 `POST /api/cli-doctor/check/cancel`；
  Host 向检查器进程组发 SIGTERM，5 s 后 SIGKILL（Windows 用 `taskkill /T /F`），
  所有等待该次运行的请求收到 `500 {"error":"cancelled"}`，且**取消不会覆盖已有快照**。
- **两档检查**：`?mode=full`（默认，`--json --no-update`，约 60–70 s）与
  `?mode=fast`（`--json --fast --no-update`，约 9–11 s；npm/pip/rust 的 latest 为 null），
  响应与面板都会标注 mode，fast 结果不会被当成最终升级结论。
- **共享请求（不再是 409）**：已有诊断在跑时，新的 `POST /check` 会 attach 到同一次运行，
  两个请求都返回 200、`checkedAt` 相同、只 spawn 一个检查器进程（`cache:"attached"`、`shared:true`）。
- **历史**：每次成功诊断只保存摘要（≤ 1 KB），`GET /history?limit=N`（默认 20，上限 100）返回新→旧列表。
- **只读边界（永久）**：只检查、只生成建议命令供用户自行复制执行；**不执行升级、不接管包管理器、
  不提供「交给 Agent 执行升级」入口**。面板的升级命令只能复制，插件不会运行它。
- **主题与可访问性**：状态色使用 `var(--dsw-alias-*, 回退值)` 主题 token；自动检查/取消用
  `aria-busy` / `aria-live` 表达；结果区仍是唯一滚动容器（`data-dsh-cli-doctor-scroll`），表头固定。

## 面板操作（第二批-1）

### 复制诊断报告（Markdown / JSON）给 AI

诊断完成后，面板表头出现两个动作：

| 动作 | 内容 |
|---|---|
| **复制报告**（主） | AI 友好的 Markdown：标题、基本信息（插件版本 / 生成时间 / 检查时间 / 档位 / 耗时 / 范围 / 数据状态）、汇总计数（含依赖冲突与待核验）、按生态的**可行动工具明细**（当前/目标版本、状态、建议、升级命令、依赖影响摘要、备注）、依赖冲突与待核验明细、已是最新工具、跳过/降级说明、状态语义、只读说明、数据来源 |
| **复制原始 JSON**（次） | `check.js` 原始报告 `JSON.stringify(report, null, 2)`，不加工，可直接交给脚本或 AI 解析 |

- 复制成功后表头显示「已复制」，约 2 秒后自动消失；复制**不发网络请求、不修改报告**。
- Markdown 里升级命令一律标注「本插件不执行，仅供人工核对」，文档中没有任何执行升级的诱导。
- 剪贴板不可用或被拒绝时**不报错**：面板内会出现只读 `<textarea>`（带「关闭」按钮），
  可直接全选手动复制同一份 Markdown / JSON；提示会说明是「不支持剪贴板写入」还是「写入失败」。
- 复制暂无独立快捷键（使用 `⌘C`/`Ctrl+C` 手动复制文本框内容）；降级文本框出现时会自动聚焦并全选。

### 点击汇总卡片即时筛选

- 顶部 5 个汇总格是 `<button type="button" aria-pressed>`：**已发现工具**（= 全部）、**有可用更新**、
  **建议更新**、**需核验或暂缓**、**目标待核验**。
- 点击非全量卡片后，下方工具列表按与汇总计数**完全相同的判定函数**过滤；卡片数字始终是全局口径，
  不随筛选变化。活动卡 `aria-pressed="true"` 并有主题 token 的选中样式。
- 筛选生效时：只渲染匹配的工具卡；没有匹配的生态分块自动隐藏；**依赖层隐藏**并显示一行说明
  （依赖计数仍在顶部汇总）；分块头显示「匹配 N / 共 M 个工具」；空结果显示「没有符合…筛选的工具」
  并提供**清除筛选**按钮。
- 清除方式（三选一）：再次点击当前活动卡、点击筛选说明行/空结果里的「清除筛选」、点击「已发现工具」。
- 筛选状态保存在 client store，**切到其它侧栏页再回来仍保留**；插件卸载/重载时重置。
- 键盘可直接操作（`Tab` 聚焦、`Enter`/`Space` 激活）；无专用快捷键。

## 一次性安装（推荐：直接让 DSH agent 装）

在 DSH 任意对话里粘贴下面整段。它会让 agent 用 `plugin_manager` 把插件装进当前 profile，
核对启用状态，并告诉你是否需要重启。安装会写入 profile 目录，因此会请求一次批准。

```text
请在这台电脑上安装或更新 DeepSeek Harness 的 CLI Doctor 左侧边栏插件。唯一可信来源是 npm 包
dsh-cli-doctor（源码与工程契约在 https://github.com/MaxHou-infinity/cli-doctor 的 dsh/ 目录）。
我要的是 DSH 侧边栏插件，不是同仓库的 Codex 插件，也不是 Agent Skill。

请按顺序执行并报告每一步结果：
1. 先用 plugin_manager 的 list_bundles 确认当前 profile 与是否已安装 dsh-cli-doctor；用 list_plugins 核对
   是否已启用、fiber 阶段是否为 active。
2. 未安装时用 install_bundle 安装；已安装且来源正确时先 remove_bundle 再安装（DSH 插件不自动更新）。
   安装需要写入 profile 目录，请让我批准。不要手工改写 profile 的 cordis.patch.yml。
3. 安装后核对 list_bundles：该 bundle 的 enabled 为真、rows 含 cli-doctor 行、error 为空。若返回
   incompatible-version，不要用 set_version_exemption 放行，先把 peers 与运行时版本告诉我。
4. 若返回 restart-required（或该 profile 未启用热重载），告诉我需要重启 DSH；重启后从左侧栏
   CLI Doctor 入口打开面板，点「一键诊断当前状态」。
5. 报告实际安装版本、是否启用、是否需要重启，以及后续如何更新。不要升级我电脑上的 Homebrew、npm、
   Python 或其他被诊断工具，不要运行 curl | sh。任何命令失败就停下并报告具体原因。
```

## 其它安装方式

| 方式 | 操作 |
|---|---|
| npm（推荐） | `dsh plugin --profile <profile> add dsh-cli-doctor`；或左侧栏 **Plugins** → **Add plugin** → 填 `dsh-cli-doctor` |
| 本地路径（开发用） | 左侧栏 **Plugins** → **Add plugin** → 填本目录绝对路径；或 `dsh plugin --profile <profile> add <本目录绝对路径>` |
| Git | **可用**（见下）：`dsh plugin --profile <profile> add "github:MaxHou-infinity/cli-doctor"` |

### Git 安装（仓库根与 dsh/ 子目录等价）

仓库根 `package.json` 已声明 `dsh.bundle` → `./dsh/cordis.patch.yml`（commit `79b7ba9`），
因此 Git 安装可以直接用**仓库根**，不必非要子目录；两种写法注册的都是同一个 profile 层：

```bash
# 方式 A：仓库根（推荐；根 package.json 已声明 dsh.bundle）
dsh plugin --profile <profile> add "github:MaxHou-infinity/cli-doctor"

# 方式 B：只装 dsh/ 子目录（等价）
dsh plugin --profile <profile> add "github:MaxHou-infinity/cli-doctor#path:/dsh"
```

安装后验证（两条命令都应成功）：

```bash
# 1) 该行确实进入了组合树
dsh --profile <profile> --dump-config | grep -A3 "id: cli-doctor"

# 2) 启动后侧栏出现 CLI Doctor；或先看 Host 健康路由（端口以启动横幅为准）
curl -sS -H 'sec-fetch-site: same-origin' http://127.0.0.1:<port>/api/cli-doctor/health
```

说明：根 `package.json` 是 CLI 包、`dsh/package.json` 是 DSH 插件包，二者都声明了 `dsh.bundle`；
从 Git 安装拿到的是仓库根，DSH 会按根清单注册为 profile 层。npm 包则是**预构建**发布
（`lib/client.js` 与 `bin/` 都已提交），安装时不会触发构建脚本，不需要 pnpm 的 `allowBuilds` 批准。

`desktop` profile 由 DeepSeek Harness Desktop 应用持有：装它请优先用界面里的 Plugins 页或让 agent 安装；
用 CLI 时建议先退出应用，装完再启动。

## 安装后怎么验证

1. 左侧栏出现 **CLI Doctor** 图标（Plugins、Schedules 之后）。
2. 打开面板 → 若 Host 已有快照，立即显示上次结果（含「上次诊断 X 前」）；没有快照时按 v2 规则自动跑一次
   full 诊断（可取消），也可以手动点「一键诊断当前状态」/「重新诊断」。
3. 诊断中按钮进入 loading，出现「取消」；取消后保留上次快照（若没有则回到空态）。
4. 面板底部固定显示「只读检查，未执行任何升级」；没有任何升级动作发生。
5. 需要重启才能生效时，插件管理器会明确返回 `restart-required`。

## Host 接口（CONTRACT v2.1）

所有 `/api/cli-doctor/*` 路由都受 v1 §2 访问围栏约束（回环 socket + 回环 Host/同源 Origin +
浏览器同源标记，否则 `403 forbidden`）；方法不符返回 `405 method`，未知子路径返回 `404 not-found`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/HEAD | `/api/cli-doctor/health` | `{ok, version, busy, capabilities:{snapshot,history,cancel}, lastCheck\|null}` |
| GET/HEAD | `/api/cli-doctor/snapshot[?full=1]` | `{ok, snapshot:{checkedAt,mode,elapsedMs,ageMs,stale,summary,report?}\|null, busy, cache:{ttlMs,autoCheck}}`；`full=1` 才带完整报告，无缓存时 `snapshot:null`（不是 404） |
| GET/HEAD | `/api/cli-doctor/status` | `{ok, busy, running:{startedAt,elapsedMs,mode,waiters}\|null, lastCheck, cache:{ttlMs}}` |
| GET/HEAD | `/api/cli-doctor/history[?limit=N]` | `{ok, entries:[{checkedAt,mode,elapsedMs,summary}]}`，新→旧 |
| POST | `/api/cli-doctor/check[?mode=fast\|full][&force=0]` | `{ok, report, checkedAt, mode, elapsedMs, cache:'fresh'\|'hit'\|'attached', shared}`；默认 `force=1` 每次重跑，`force=0` 命中外缓存 |
| POST | `/api/cli-doctor/check/cancel` | `{ok, cancelled:<bool>}`；无运行中诊断时返回 `false` |

Host 配置（`cordis.patch.yml` 默认块，代码内 `resolveConfig` 兜底）：
`autoCheck:true`、`staleAfterHours:12`、`keepHistory:20`、`checkTimeoutMs:900000`；
运行数据落在 `config.dataDir || ($DSH_HOME || ~/.dsh)/storages/cli-doctor/state.json`（原子写，0700/0600）。

## 开发

```bash
cd dsh
npm run verify    # 版本联动检查 + 构建（含 bin/ sha 校验）+ 单元测试
npm run build     # 同步 bin/ 副本 + 构建 lib/client.js
npm test          # Host / Parity / Client 单元测试
npm run check:versions  # 断言 package.json / SKILL.md / plugin.json / dsh/package.json 版本一致
```

端到端全量验证（9 个阶段，含真实 DSH profile 与真实浏览器；不会碰 `~/.dsh`）：

```bash
bash dsh/test/e2e/run-all.sh --port 19390
# build-repro · loader · view-contract · panel-behavior · purity-negative ·
# codex-decouple · e2e-api(v2) · failure-paths · real browser layout
# 没装 Chrome 的机器会自动 skip 浏览器阶段，不会误报失败
```

- `e2e-api` 是唯一跑真实诊断（约 70 s）的阶段；其余 v2 路由/并发/取消/持久化断言由一个
  `CLI_DOCTOR_CHECK_PATH` stub 检查器驱动，秒级完成。
- 浏览器阶段用 `CLI_DOCTOR_AUTO_CHECK=0` 启动 Host，优先复用 `e2e-api` 落盘的快照；
  缓存为空时才点按钮跑真实诊断。
- 单独跑某个阶段：

```bash
bash dsh/test/e2e/e2e-api.sh --port 19390          # v2 HTTP 矩阵 + 真实诊断
bash dsh/test/e2e/e2e-failure-paths.sh --port 19392 # 结构化失败语义
bash dsh/test/e2e/e2e-browser-layout.sh --port 19394 # 真实 Chrome 布局探针
node dsh/test/e2e/panel-behavior.mjs                # jsdom 面板行为
node dsh/test/e2e/view-contract.mjs                 # 纯视图语义
bash dsh/test/e2e/run-all.sh --port 19390 --skip-e2e # 只跑不需要 dsh 的阶段
```

手工验证真实组合（**绝不使用 `~/.dsh`**）：

```bash
export DSH_HOME=<repo>/.dsh-test
export npm_config_store_dir=<repo>/.pnpm-store
dsh plugin --profile <scratch> add <repo>/dsh
dsh --profile <scratch> --dump-config | grep -A2 cli-doctor
```

工程契约、接口与不变量见 [CONTRACT.md](CONTRACT.md)，历史验证证据与 harness 变更记录见
[test/e2e/REPORT.md](test/e2e/REPORT.md)。

## 发布清单（每次发新版）

```bash
# 1. 四处版本号一起改（仓库约定：同版本）
#    package.json · SKILL.md · plugin.json · dsh/package.json
cd dsh && npm run check:versions      # 必须 ok

# 2. 构建 + 单测；bin/ 副本会做 sha256 校验
npm run verify

# 3. 端到端（真实 profile + 真实浏览器；不碰 ~/.dsh）
bash test/e2e/run-all.sh --port 19390 # 必须 ALL STAGES PASSED

# 4. 检查真正会被发布的文件（不含 scripts/、test/、CONTRACT.md）
npm pack --dry-run

# 5. 发布（预构建产物已提交，安装方不需要跑构建脚本）
npm publish

# 6. 发布后复验两条安装路径：npm 与 Git（仓库根）
dsh plugin --profile <scratch> add dsh-cli-doctor
dsh plugin --profile <scratch2> add "github:MaxHou-infinity/cli-doctor"
```

更新根 `CHANGELOG.md`（CLI Doctor 的 Skill / CLI / Codex 插件 / DSH 插件共用一个版本记录）。

## 社区目录收录

社区目录**不**按 npm 关键词自动收录（早期 README 的说法有误，已更正）。实际走 GitHub 仓库：

- 仓库需带 GitHub topic `dsh-plugin`（本仓库已有）；
- 仓库里**任意** `package.json` 声明 `dsh.bundle` 即可，monorepo 子目录算数（CI 会遍历整棵树）；
  根 `package.json` 也声明了一份 `dsh.bundle` 指向 `./dsh/cordis.patch.yml`，这样只读仓库根的扫描器也能识别；
- **awesome-dsh-plugin 是人工 PR 收录**：一个文件 `data/plugins/MaxHou-infinity__cli-doctor.yml`
  （`url` / `name` / `category` / `description.en` 必填），合并后 dshmarket、dshmarketplace、
  dshget 等派生目录会跟随更新；README 由脚本生成，不要手工编辑。

唯一按 npm 关键词自动收录的是 LivXue 的 dsh-plugin-shop（全量 npm 复制源扫描），
自助诊断：`curl -s https://LivXue.github.io/dsh-plugin-shop/v1/report.md | grep '| MaxHou-infinity/cli-doctor |'`。
