---
name: cli-doctor
description: >-
  检查本机各类 CLI 工具与依赖包的版本现状并输出分类报告（只报不升）。
  适用触发场景：用户询问"帮我检查/看看哪些 CLI/工具/依赖需要升级"、"brew/npm/pip 有什么要更新的"、
  "检查一下我电脑里的工具版本"、升级前想先看风险与耦合关系，或升级后想验证是否已全部到位。
  覆盖范围：Homebrew、npm 全局、Python/pip（含 CLI 与库分类）、Rust / Bun / uv 等自管理工具、
  无统一升级渠道的 CLI 工具（hermes/agy/bsk 等）。
  输出：默认直接在对话内给出结构化 Markdown 报告；如需可分享存档版本再询问是否转 HTML。
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
优先运行仓库内 CLI（数据一致、快、含分类）：
```bash
# 人类可读报告
node <本skill目录>/bin/check.js            # 或已发布后: npx cli-doctor
# AI 解读用完整数据
node <本skill目录>/bin/check.js --json     # 或: npx cli-doctor --json
```
可选参数：`--no-update`（跳过 brew update）、`--pypi-index <url>`（指定 pip 镜像）。
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

### 第 3 步：按模板出报告（对话内 Markdown，逐条含五要素）
对每个**待升级项**，输出表格列：`工具/包 | 当前 | 最新 | 升级命令 | 作用 | 耦合 | 风险`。

每条必须补充（CLI 给的是数据，下面三列是你的增值）：
- **作用**：一句话说明这工具/库干嘛的（用你的知识与本机上下文判断）。
- **耦合**：它被谁依赖 / 它锁定了谁（例：某 CLI 把 fastmcp 锁在 ==3.2.4；markitdown→magika~=0.6.1；sympy→mpmath<1.4）。
  手工查证手段：`npm ls -g <pkg>`、pip 用 `grep -r 'Requires-Dist: <pkg>' <site-packages>/*.dist-info/METADATA`、`brew uses --installed <pkg>`。
- **风险**：大版本跳跃（⚠️ 配置/命令/API 可能变）、升级会连带降级其它包、正在运行中、需重启服务、官方已停更（建议迁替代品）等。

报告头部：说明"只读检查、未升级"；中部按 工具类→依赖包类 分块；依赖包类默认给**摘要**（数量 + 高风险/有锁链的前几项 + "完整清单见 --json"），不要几百行全贴。尾部：给"整体建议"与"可直接复制的升级命令（按 manager 分组）"，但强调逐项确认后再执行。

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
