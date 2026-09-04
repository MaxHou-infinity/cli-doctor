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
- 默认输出 Markdown；使用 `--json` 时可交给 AI/Agent 做作用、耦合和风险解读
- 支持升级后复跑，核对哪些项目已经到位、哪些是刻意保留的版本

## 30 秒开始

无需克隆仓库，直接从 GitHub 运行：

```bash
# 人类可读报告
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor

# 给 AI / Agent 的完整结构化数据
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --json
```

> npm 12+ 运行 GitHub 源时需要 `--allow-git=all`。如果你经常使用，可以执行一次 `npm config set allow-git all`，之后省略该参数。

## 安装配套 Agent Skill

方案 A 会安装一个自包含 Skill：`SKILL.md` 和它需要的 `bin/check.js` 会一起复制，不依赖仓库路径。

```bash
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor install --to ~/.claude/skills
```

也可以安装到其他 Agent 的 skills 目录：

```bash
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor install --to <你的 skills 目录>
```

安装后，Agent 可以在这些场景调用它：

- “帮我看看电脑里哪些 CLI 需要升级”
- “brew、npm、pip 最近有什么更新”
- “升级前帮我评估风险和依赖耦合”
- “我刚升级完，帮我复核一下”

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

## 报告怎么看

报告按两层组织：

1. **工具类**：Homebrew、npm 全局、Python CLI、Rust/Bun/uv、自更新 CLI
2. **依赖包类**：由工具带入的共享库和底层依赖，默认只展示摘要

每个可升级项会提供当前版本、最新版本、升级命令和探测备注。把 `--json` 输出交给 AI 后，还可以继续补充：

- 作用：它在你的工作流中负责什么
- 耦合：谁依赖它、它锁定了哪些版本
- 风险：大版本变化、服务重启、运行期升级和 PATH 冲突

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
