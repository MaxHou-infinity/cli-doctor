# cli-check-report

检查本机 CLI 工具与依赖包的版本现状，输出**分类报告**，**只报不升**，升级决定权交给你。

覆盖：Homebrew · npm 全局 · Python/pip（区分 CLI 工具与库依赖）· Rust / Bun / uv 等自管理工具 · 无统一升级渠道的 CLI（hermes / agy / bsk 等）。

## 快速开始（npx）
```bash
# 人类可读的分类报告
npx cli-check-report

# AI/Agent 解读用的完整结构化数据
npx cli-check-report --json

# 把配套 SKILL 装进 agent 的 skills 目录（Claude Code / Hermes 等）
npx cli-check-report install                # 自动探测 ~/.claude/skills 等
npx cli-check-report install --to ~/.claude/skills
```

## 本地开发运行
```bash
git clone <repo-url> && cd cli-check-report
node bin/check.js            # 或 npm test
node bin/check.js --json
```

## 参数
| 参数 | 说明 |
|---|---|
| `--json` | 输出完整 JSON（含全部依赖明细） |
| `--no-update` / `--fast` | 跳过 brew update 等耗时刷新 |
| `--pypi-index <url>` | 指定 pip 镜像（默认 pypi.org，失败自动切清华镜像） |
| `install [--to <dir>]` | 安装 SKILL.md 到指定 agent skills 目录 |

## 报告结构
- 一级分类：**工具类** / **依赖包类**
- 二级分块：Homebrew / npm 全局 / Python·pip / Rust·Bun·uv / 无统一渠道 CLI
- 每项含：工具名称 · 当前版本 · 最新版本 · 升级命令 · 作用 · 耦合关系 · 风险（作用/耦合/风险由 AI 结合上下文补充）

## Skill 使用
`SKILL.md` 遵循通用 Anthropic SKILL.md 规范：把整个仓库（或其中的 `SKILL.md`）放入 agent 的 skills 目录即可，
agent 会自动调用 `bin/check.js` 采集并按其模板输出五要素报告。

## 安全
- 纯只读检查，不执行任何升级。
- 升级前请让 AI 逐项补充「作用 / 耦合 / 风险」，尤其是 ⚠️ 大版本跳跃、锁版本链、正在运行的 CLI 自身。

## License
MIT
