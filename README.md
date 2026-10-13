# cli-doctor

![cli-doctor hero](assets/cli-doctor-hero.png)

在升级之前，先看清你的 CLI 环境。

`cli-doctor` 是一个 macOS-first 的 CLI 与开发环境版本体检工具：扫描 Homebrew、npm 全局包、Python/pip、Rust、Bun、uv 以及自更新工具，把“真正的工具”和“被工具带进来的依赖库”分开，并输出可供人阅读或 AI 解读的报告。

它只做一件重要的事：**先告诉你哪里可能需要升级、升级可能影响什么；不替你执行升级。**

> WorkBuddy 兼容：`SKILL.md` frontmatter 同时提供版本号、中文/英文展示名和中文/英文描述，上传到 WorkBuddy 时可直接通过元数据校验。

## 为什么需要它

升级一个 CLI，往往不只是升级一个包：它可能牵动共享依赖、改变命令行为、覆盖 PATH 中的同名程序，或者影响正在运行的服务。

`cli-doctor` 会先帮你建立升级前地图：

- 区分工具与依赖包，避免把几百个库都当成“应该升级的工具”
- 标出大版本跳跃、锁版本依赖和需要各自核验的工具
- 给出可复制的升级命令，但不会自动执行任何升级
- CLI 可输出 Markdown 采集摘要；配套 Agent Skill 使用 `--json` 生成包含作用、耦合和风险的七字段决策报告
- 支持升级后复跑，核对哪些项目已经到位、哪些是刻意保留的版本

## Codex 侧栏：复制提示词安装或更新

在 **Codex 桌面版**任意对话中粘贴下面整段提示词。首次使用时，它会让 Codex 从本仓库注册 marketplace 并安装侧栏插件；以后粘贴同一段提示词，可刷新来源并安装新版本。这个插件与下文的 Agent Skill 是两种独立安装方式。

```text
请在这台电脑上安装或更新 Codex 桌面版的 CLI Doctor 侧栏插件。唯一可信来源是 https://github.com/MaxHou-infinity/cli-doctor；目标插件 ID 是 cli-doctor@cli-doctor-github。我要的是侧栏插件，不是同仓库的 Agent Skill。

请按顺序执行并报告每一步结果：
1. 先确认 codex CLI、Git 和 Node.js 18+ 可用。读取该仓库当前的 .agents/plugins/marketplace.json、plugin.json 和 mcp.json，核对插件名称、版本及本地 MCP 入口；不要执行仓库中与安装无关的命令。
2. 用 codex plugin marketplace list --json 检查是否已注册来自 MaxHou-infinity/cli-doctor 的 cli-doctor-github。未注册就运行 codex plugin marketplace add MaxHou-infinity/cli-doctor；已注册且来源正确就运行 codex plugin marketplace upgrade cli-doctor-github。若同名 marketplace 指向其他来源，停止并解释，不要覆盖。
3. 从 codex plugin marketplace list --json 返回的 cli-doctor-github `root` 读取 plugin.json 版本，用 codex plugin list --json 读取当前已安装版本。仅在未安装或来源版本更新时运行 codex plugin add cli-doctor@cli-doctor-github --json；不要降级。注意 marketplace upgrade 只是刷新来源，不能把它当成插件已升级的证据。
4. 用 codex plugin list --json 核对插件已安装、已启用及版本。安装或更新时从 codex plugin add --json 的 installedPath 找到安装副本；无需更新时按 Codex 插件缓存位置定位。检查副本包含 bin/check.js、bin/python_dependency_audit.py、dashboard 页面和 codex-server.js。如果包内有 test/codex_plugin_smoke.js，运行这个无需诊断和联网的 MCP 页面自检。
5. 如果本次安装了新版本，读取仓库的 CHANGELOG.md，简述这次插件更新内容。告诉我安装或更新是否完成、实际安装的插件版本、是否需要重启 Codex，以及重启后如何从左侧 CLI Doctor 入口打开页面并点击“一键诊断当前状态”。如果你无法亲眼确认我的侧栏已出现，请明确说明这一步还需我在重启后核对，不能声称已完成界面验证。

不要升级我电脑上的 Homebrew、npm、Python 或其他被诊断工具；不要运行 curl | sh，也不要清理或覆盖其他插件配置。任何命令失败时停止并报告具体原因，不要以猜测代替验证。
```

首次安装或更新后，重启 Codex，再从左侧栏打开 **CLI Doctor**。点击 **一键诊断当前状态** 才会运行本机检查；安装过程本身不会诊断或升级你的工具。运行环境需要 Node.js 18+、Git，以及支持插件 marketplace 的 Codex 桌面版。Codex 可能要求你批准联网或全局插件配置写入。这个提示词提供按需更新；如果你不再次使用它，当前版本不会因此自动升级或主动通知你。

## 30 秒安装 Agent Skill

使用开放的 `skills` CLI。它会自动发现仓库中的 `cli-doctor`，并安装到对应 Agent 的正确目录，无需手动填写 Claude、Codex 或其他 Agent 的本地路径：

```bash
# 交互式选择安装范围和 Agent
npx skills@latest add MaxHou-infinity/cli-doctor

# 全局安装到 Codex
npx skills@latest add MaxHou-infinity/cli-doctor \
  --skill cli-doctor --global --agent codex --yes

# 全局安装到所有受支持的 Agent
npx skills@latest add MaxHou-infinity/cli-doctor \
  --skill cli-doctor --global --agent '*' --yes
```

安装后请开启一个新对话，让 Agent 重新发现 Skill。

## 自然语言激活

安装后无需记忆命令，可以直接表达检查意图：

```text
帮我检查我的 CLI 类工具版本状态
帮我诊断命令行工具有没有过期
看看 brew、npm、pip 有哪些需要更新
检查开发环境里的工具和依赖版本

Check the status of my installed CLI tools
Audit my command-line tools for outdated versions
Diagnose CLI dependency and upgrade risks

CLIツールのバージョンと更新状況を確認して
Revisar las versiones de mis herramientas CLI
```

自然语言由各 Agent 进行语义匹配；需要确定调用时，可以使用显式名称：

```text
使用 $cli-doctor 检查我的 CLI 工具版本
```

## 只运行 CLI

无需安装 Skill，也可以直接从 GitHub 执行采集器：

```bash
# 人类可读的采集摘要
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor

# 给 AI / Agent 的完整结构化数据
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --json
```

## 常用命令

```bash
# 跳过网络刷新与版本比对，快速查看本地已安装清单
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --fast

# 只跳过 Homebrew 索引刷新
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --no-update

# 指定 pip 镜像
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor \
  --pypi-index https://pypi.tuna.tsinghua.edu.cn/simple

# 查看帮助和版本
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --help
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --version
```

`--fast` 下未联网核验的项目会显示为“需自查”，不会被误报为“全部最新”。

## CLI 摘要与 Agent 最终报告

CLI 负责采集版本事实；Agent Skill 负责把事实转成可用于升级决策的最终报告。两者不会混为一层。

Agent 最终报告默认直接显示在对话界面，不创建额外文件，并按两层组织：

1. **工具类**：Homebrew、npm 全局、Python CLI、Rust/Bun/uv、自更新 CLI
2. **依赖包类**：由工具带入的共享库和底层依赖，默认只展示摘要

每个待升级或待核验项必须使用固定七字段模板：

| 工具名称 | 当前版本 | 最新版本 | 手动升级命令 | 作用说明 | 耦合关系说明 | 风险说明 |
|---|---|---|---|---|---|---|
| 示例工具 | 1.0.0 | 2.0.0 | `manager upgrade example` | 说明实际用途 | 说明依赖、版本锁定或 PATH 关系 | 说明大版本、服务或兼容性风险 |

已核验为最新的项目会在对应分块中汇总；所有待升级项都会完整展示，不会只隐藏在 JSON 中。未联网核验的项目会明确标记为“待核验”，不会误报为“全部最新”。

HTML 不是默认输出。只有用户明确要求分享、存档或管理层展示时，Agent 才生成额外的 HTML 报告。

## 覆盖范围

| 生态 | 检查内容 |
|---|---|
| Homebrew | leaves 工具、outdated 依赖、服务重启提示 |
| npm | 全局包、当前/最新版本、大版本跳跃 |
| Python/pip | 通过 `console_scripts` 区分 CLI 与库依赖 |
| Rust | rustup 工具链、cargo install 工具 |
| Bun | Bun 版本与升级命令 |
| uv | uv 本体与 uv tools |
| 自更新 CLI | hermes、agy、bsk、browse-now、luckin 等本地工具 |

## 安全边界

- 只读检查，不执行 `brew upgrade`、`npm i -g`、`pip install -U` 或其他升级操作
- 报告中的命令需要你逐项确认后再执行
- 正在运行的 CLI、自带服务和大版本跳跃项，建议避开运行期并单独复核

## 本地开发

```bash
git clone https://github.com/MaxHou-infinity/cli-doctor.git
cd cli-doctor
node bin/check.js --fast
npm test
```

运行环境：Node.js 18+。项目无第三方运行时依赖。

### 本地诊断页与 Codex 插件

在仓库目录运行 `npm run dashboard`，打开终端打印的 `http://127.0.0.1:<端口>/`。点击“一键诊断当前状态”后，页面按生态展示工具卡片；检查调用 `bin/check.js --json --no-update`，不会执行升级，也不会主动运行 `brew update`。完整联网查询可能持续数分钟；没有可靠目标版本的项目会标为“待核验”。

页面把“有可用更新”和“建议更新”分开。依赖影响按已安装 Homebrew formula、npm 全局顶层包，以及当前 `python3` 解释器中的发行包元数据检查；Python 会比对目标版本与已安装项目声明的版本约束，并列出直接与间接依赖。发现约束冲突时标记“暂不建议”，检查范围内未发现其他已装项目依赖或约束冲突、且不是大版本变化时才标记“建议更新”。这些判断不扫描其他项目目录、虚拟环境或 lockfile，也不验证目标版新增依赖和运行时 API 兼容性；大版本会要求兼容验证。

仓库根目录的 `plugin.json`、`mcp.json` 和 `codex-server.js` 是可分发的 Codex 插件入口。插件中的“一键诊断”通过 MCP 调用同一份 `bin/check.js --json --no-update`，与独立诊断页共用卡片和建议逻辑。插件从已安装副本读取资源，不依赖开发者电脑上的仓库路径。每次发布插件更新时必须递增 `plugin.json` 的版本号、更新 `CHANGELOG.md`，并重新执行安装与页面自检；现有 `plugins/cli-doctor-entry-probe` 目录仅保留作早期本机试验记录，不用于分发。

## 关键词

CLI health check · CLI version checker · dependency audit · developer environment audit · Homebrew outdated · npm global packages · pip outdated · Rust toolchain · Bun upgrade · uv tools · macOS developer tools · read-only upgrade report · AI Agent Skill

## License

MIT
