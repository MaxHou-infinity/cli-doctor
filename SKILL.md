---
name: cli-doctor
description: >-
  Read-only diagnosis of installed CLI tools, package-manager versions, outdated status,
  dependency coupling, and upgrade risks. Use when a user asks in any language to check,
  diagnose, audit, review, verify, inspect, or troubleshoot CLI tools, command-line utilities,
  developer tools, or package versions. Example intents: “帮我检查或诊断 CLI 工具版本状态”,
  “check or audit my CLI tool versions”, “CLIツールのバージョンと更新状況を確認”,
  “revisar las versiones de mis herramientas CLI”. Covers Homebrew, global npm packages,
  Python/pip, Rust/Bun/uv, and CLIs without a unified update channel. Produces a fixed-category,
  fixed-section, seven-field Markdown decision report directly in the conversation. Do not use
  for project-only dependency updates, and never perform upgrades without explicit authorization.
---

# cli-doctor Skill

## 何时使用
- 用户想了解本机 CLI 相关工具**版本现状 / 谁需要升级 / 升级风险**。
- 用户升级前想评估：哪些是工具、哪些是依赖库、彼此耦合、升级风险。
- 升级完成后用于**验证**是否全部到位（此时应看到"无待升级项"或只剩刻意保留项）。

## 铁律（安全边界）
1. **只读检查，绝不自动升级。** 未经用户明确同意（且给出范围），不执行任何 `brew upgrade` / `npm i -g` / `pip install -U` / `rustup update` 等写操作。
2. 报告必须能让用户**自己拍板**：每条给出 当前版本 / 最新版本 / 手动升级命令 / 作用 / 耦合 / 风险。
3. 升级正在运行的 CLI 自身（如 dsh）需提醒避开运行期；npm 12+ 有 install 脚本拦截；brew 服务类升级后需重启服务。

## 执行步骤

### 第 1 步：采集数据
运行 Skill 自带 CLI 的 JSON 模式，作为 Agent 分析输入：
```bash
node <本skill目录>/bin/check.js --json
```
> 通过 npx 从 GitHub 源运行时，npm 12+ 需加放行参数：
> `npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor [--json|--fast|install --to <目录>]`
> （也可一次性 `npm config set allow-git all`。）
可选参数：`--fast`（跳过网络刷新与版本比对）、`--no-update`（跳过 brew update）、`--pypi-index <url>`（指定 pip 镜像）。
若本机没有 node / 没有仓库副本，用下面"手工回退命令表"逐项采集。

### 第 2 步：分类与分块（报告骨架固定）
- **一级分类**：工具类 / 依赖包类
- **二级分块**：Homebrew、npm 全局、Python/pip、Rust·Bun·uv 自管理、无统一升级渠道 CLI
- 判定标准（CLI 已自动做，手工时按此）：
  - Homebrew：`brew leaves` = 工具类；`brew outdated` 中非 leaves = 依赖库。
  - npm 全局：顶层包基本全是工具；判断是否提供命令看其 package.json 的 bin。
  - pip：**反查 console_scripts**（有入口的才是 CLI 工具），其余 90% 是依赖库 —— 不要把 158 个库全列成"工具"。
  - rust：rustup 组件（rustc/clippy/rustfmt）≠ cargo install 的第三方工具；uv tools 单独列。
  - 无统一渠道：hermes/agy/bsk/browse-now/luckin 等，各自自查，不做自动版本比对。

### 第 3 步：生成最终报告（强制输出契约）

默认直接在 Agent 对话中输出 Markdown，不创建额外文件。CLI 的 Markdown 模式只是采集层摘要，**不得直接复制为 Skill 的最终答案**。

报告层级和顺序固定：

1. **工具类**
   - Homebrew
   - npm 全局
   - Python / pip
   - Rust / Bun / uv 等自管理工具
   - 无统一升级渠道的 CLI
2. **依赖包类**
   - 按同样的管理器顺序展示存在的结果；没有结果时明确写“无待升级项”。

每个**待升级项或待核验项**都必须使用以下七字段，不能用“备注”合并或替代后三列：

`工具名称 | 当前版本 | 最新版本 | 手动升级命令 | 作用说明 | 耦合关系说明 | 风险说明`

- **作用说明**：说明工具或依赖在当前环境中的用途。无法可靠判断时写“需结合实际用途确认”，不要猜测。
- **耦合关系说明**：说明直接依赖、被依赖、版本锁定、PATH 同名覆盖或服务关系；确认无明显耦合时写“未发现明显耦合”。查证可使用 `npm ls -g <pkg>`、Python 包 metadata、`brew uses --installed <pkg>`、`which <cmd>`。
- **风险说明**：结合大版本跳跃、破坏性变更、共享依赖、运行中进程、服务重启、安装脚本和来源不明等事实分级说明。没有发现特殊风险时写“低：常规版本升级”，不能留空。

已经核验为最新的项目可以在对应分块下用名称列表汇总，不必逐项生成七字段表格；但不得把“未联网核验”写成“全部最新”。所有待升级项必须完整展示，不能因数量多而只放在 `--json` 中。

报告头部必须说明“只读检查、未执行升级”和检查时间；尾部给出整体建议及按管理器分组的可复制升级命令，并强调这些命令尚未执行。

只有用户明确要求可分享、存档、管理层展示或 HTML 时，才调用可用的 HTML 设计 Skill 生成 HTML；HTML 是附加产物，不能取代对话内的 Markdown 结论。

### 第 4 步：收尾
- 若用户让"全部升级"，仍需逐项先自检：排除正在运行的 CLI 自身、标出大版本跳跃项让其知情、提醒 npm allow-scripts、升级后 brew 服务类（postgres 等）`brew services restart <name>`。
- 升级完成后可再跑一次验证，报告应显示无待升级（或只剩刻意保留的锁版项，如被 sympy 锁定的 mpmath）。

## 常见坑速查（经验沉淀）
- 中国网络：pip/brew 建议清华镜像；直连 pypi.org 会超时。`--pypi-index https://pypi.tuna.tsinghua.edu.cn/simple`。
- pip 的"最新版本"列表可能把某些包误判（如 kimi-cli 版本线混乱）；涉及**整包被换名/换版本线**时要查 `pip3 index versions <pkg>` 确认正确目标。
- 装某工具可能**降级**一堆共享库（锁版依赖），事后用 `pip3 check` / 复跑报告确认。
- PATH 劫持：npm 全局包可能覆盖 brew 同名命令（如 agent-browser），升级后 `which <cmd>` 核对来源。
- brew 升级大版本（ffmpeg 8→9 等）会连带升一堆依赖库，属正常。

## 输出示例（节选）
```
## 一、工具类
### Homebrew（工具 10 个，2 个可升级）
| 工具/包 | 当前 | 最新 | 升级命令 | 作用 | 耦合 | 风险 |
|---|---|---|---|---|---|---|
| gh | 2.87.3 | 2.100.0 | brew upgrade gh | GitHub 官方 CLI | 无 | 常规升级 |
...
## 二、依赖包类（摘要）
### Python/pip 依赖库（8 个可升级）… mpmath 1.3.0→1.4.1（被 sympy 锁定，刻意保留）…
```

## 手工回退命令表（无 node / 无仓库时）
| 管理器 | 工具列表 | 待升级列表 | 升级命令 |
|---|---|---|---|
| Homebrew | `brew leaves` | `brew outdated --verbose` | `brew upgrade` |
| npm 全局 | `npm ls -g --depth=0` | `npm outdated -g` | `npm i -g <pkg>@latest` |
| pip | 见 console_scripts 反查 | `pip3 list --outdated -i <镜像>` | `pip3 install -U <pkg> -i <镜像>` |
| rust | `rustc --version` / `cargo install --list` | `rustup check` | `rustup update` / `cargo install <pkg> --force` |
| bun | `bun --version` | （无内置） | `bun upgrade` |
| uv | `uv tool list` | `uv self update --dry-run` | `uv self update` / `uv tool upgrade <name>` |
