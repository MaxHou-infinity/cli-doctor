# CLI Doctor for DeepSeek Harness（左侧边栏插件）

把 CLI Doctor 装进 DSH 的左侧边栏：点一下「一键诊断当前状态」，就在面板里看到本机 CLI 工具链的版本现状、
依赖耦合和升级风险。诊断调用仓库根目录的只读检查器 `bin/check.js --json --no-update`，**不执行任何升级**。

- 插件包名：`dsh-cli-doctor`
- 侧边栏入口 id：`cli-doctor`（顺序 30，在 Plugins、Schedules 之后）
- 运行面：Host 半体（`src/host/index.js`，注册 `/api/cli-doctor/*`）+ 浏览器半体（`lib/client.js`，注册侧栏 slot）
- 运行时依赖：无
- 与 Codex 侧栏插件互不影响：本目录自包含，不改动 `plugin.json`、`mcp.json`、`codex-server.js`、
  `dashboard/**` 等任何 Codex 适配文件。

## 一句话安装（推荐：直接让 DSH agent 装）

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
| Git | `dsh plugin --profile <profile> add github:MaxHou-infinity/cli-doctor` **当前不可用**：Git 安装拿到的是**仓库根**，而根 `package.json` 是 CLI 包、没有 `dsh.bundle`，会被判定 `not-a-bundle`。要走 Git 需要把 `dsh/` 拆成独立仓库，或改用 npm |

npm 包是**预构建**发布的（`lib/client.js` 与 `bin/` 都已提交），因此安装时不会触发任何构建脚本，
不需要 pnpm 的 `allowBuilds` 批准。

`desktop` profile 由 DeepSeek Harness Desktop 应用持有：装它请优先用界面里的 Plugins 页或让 agent 安装；
用 CLI 时建议先退出应用，装完再启动。

## 安装后怎么验证

1. 左侧栏出现 **CLI Doctor** 图标（Plugins、Schedules 之后）。
2. 打开面板 → 点「一键诊断当前状态」→ 出现分生态卡片。
3. 面板底部显示「只读检查，未执行任何升级」；没有任何升级动作发生。
4. 需要重启才能生效时，插件管理器会明确返回 `restart-required`。

## 开发

```bash
cd dsh
npm run verify    # 版本联动检查 + 构建（含 bin/ sha 校验）+ 单元测试
npm run build     # 同步 bin/ 副本 + 构建 lib/client.js
npm test          # Host / Parity / Client 单元测试（76 项）
```

`npm run check:versions` 会断言四个版本号一致：`package.json`、`SKILL.md`、`plugin.json`、
`dsh/package.json`（仓库约定：Agent Skill、CLI、Codex 插件、DSH 插件同版本）。

端到端全量验证（9 个阶段，含真实 DSH profile 与真实浏览器；不会碰 `~/.dsh`）：

```bash
bash dsh/test/e2e/run-all.sh --port 19390
# build-repro · loader · view-contract · panel-behavior · purity-negative ·
# codex-decouple · e2e-api · failure-paths · real browser layout
# 没装 Chrome 的机器会自动 skip 浏览器阶段，不会误报失败
```

单独跑真实浏览器布局探针（驱动真 GUI：点侧栏入口 → 点「一键诊断当前状态」→ 断言滚动几何）：

```bash
bash dsh/test/e2e/e2e-browser-layout.sh --port 19394
```

手工验证真实组合（**绝不使用 `~/.dsh`**）：

```bash
export DSH_HOME=<repo>/.dsh-test
export npm_config_store_dir=<repo>/.pnpm-store
dsh plugin --profile <scratch> add <repo>/dsh
dsh --profile <scratch> --dump-config | grep -A2 cli-doctor
```

工程契约、接口与不变量见 [CONTRACT.md](CONTRACT.md)，历史验证证据见 [test/e2e/REPORT.md](test/e2e/REPORT.md)。

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

# 6. 发布后复验一次「从 npm 安装」的路径
dsh plugin --profile <scratch> add dsh-cli-doctor
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

从 Git 安装可直接用仓库根（根 `package.json` 已声明 `dsh.bundle`，实测注册为 profile 层）：

```bash
dsh plugin --profile <profile> add "github:MaxHou-infinity/cli-doctor"
```

也可以只装 `dsh/` 子目录，两种方式等价：

```bash
dsh plugin --profile <profile> add "github:MaxHou-infinity/cli-doctor#path:/dsh"
```
