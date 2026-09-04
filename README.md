# cli-doctor

![cli-doctor hero](assets/cli-doctor-hero.png)

在升级之前，先看清你的 CLI 环境。

`cli-doctor` 是一个 macOS-first 的 CLI 与开发环境版本体检工具：扫描 Homebrew、npm 全局包、Python/pip、Rust、Bun、uv 以及自更新工具，把“真正的工具”和“被工具带进来的依赖库”分开，并输出可供人阅读或 AI 解读的报告。

它只做一件重要的事：**先告诉你哪里可能需要升级、升级可能影响什么；不替你执行升级。**

## 为什么需要它

升级一个 CLI，往往不只是升级一个包：它可能牵动共享依赖、改变命令行为、覆盖 PATH 中的同名程序，或者影响正在运行的服务。

`cli-doctor` 会先帮你建立升级前地图：

- 区分工具与依赖包，避免把几百个库都当成“应该升级的工具”
- 标出大版本跳跃、锁版本依赖和需要各自核验的工具
- 给出可复制的升级命令，但不会自动执行任何升级
- CLI 可输出 Markdown 采集摘要；配套 Agent Skill 使用 `--json` 生成包含作用、耦合和风险的七字段决策报告
- 支持升级后复跑，核对哪些项目已经到位、哪些是刻意保留的版本

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

## 关键词

CLI health check · CLI version checker · dependency audit · developer environment audit · Homebrew outdated · npm global packages · pip outdated · Rust toolchain · Bun upgrade · uv tools · macOS developer tools · read-only upgrade report · AI Agent Skill

## License

MIT
