# CLI Doctor 更新记录

从 0.2.0 起，Agent Skill、CLI 和 Codex 侧栏插件采用同一版本号，分别记录在 `SKILL.md`、`package.json` 和 `plugin.json` 中。DSH 侧栏插件（`dsh/`）同样按仓库统一版本号发布。

## 0.3.0

DSH 侧栏插件（`dsh/`）升级到工程契约 v2：从"一次性报告页"升级为"常驻诊断中枢"。CLI 与 Codex 侧栏插件的行为不变，仅随仓库统一版本号。

- **诊断状态常驻**：Host 新增结果快照、历史摘要与落盘持久化（`<DSH_HOME>/storages/cli-doctor/state.json`，tmp + fsync + rename 原子写），重启/切页后面板可立即恢复上次结果（保留诊断状态）。
- **过期自动检查**：打开面板时若没有快照或快照超过 `staleAfterHours`（默认 12 小时），自动执行一次可取消的完整诊断；环境变量 `CLI_DOCTOR_AUTO_CHECK=0` 可关闭。
- **并发请求共享同一次运行**：不再返回 409；并发/多客户端请求 attach 到同一次诊断，拿到同一份结果，同一时刻只 spawn 一个检查器子进程。
- **可取消**：新增 `POST /api/cli-doctor/check/cancel`，终止走进程组 SIGTERM → 5 秒后 SIGKILL；取消不会覆盖已有快照，`busy` 在子进程真正退出后才复位。
- **新路由**：`GET /snapshot[?full=1]`、`GET /status`、`GET /history`；`POST /check` 支持 `mode=fast|full` 与 `force=0` 缓存命中；`/health` 增加 `capabilities` 与 `lastCheck`；失败响应附带 `detail` 与 `elapsedMs`。
- **一键复制诊断报告**：面板可复制 AI 友好的 Markdown 报告（基本信息、汇总计数、按生态的可行动工具明细与升级命令、依赖冲突/待核验、已是最新列表、只读说明、数据来源）或原始 JSON；剪贴板不可用/被拒绝时降级为面板内只读文本框手动复制。
- **汇总卡片即时筛选**：顶部 5 个计数卡片可点击筛选下方工具列表，再次点击同卡、点「清除筛选」或点「已发现工具」均可恢复；筛选时依赖层隐藏并给出说明，筛选状态跨切页保留，且筛选判定与计数复用同一纯函数。
- **依赖语义与主题修正**：依赖条目不再同时显示「有可用更新 + 无法判断」；新增依赖冲突/待核验统计；状态色改用 DSH 主题 token，修正 aria-live / aria-busy 与相对时间/过期提示。
- **工程**：契约升级到 v2（`dsh/CONTRACT.md`）；单元测试 76 → 143；e2e 9 阶段 788 条断言（desktop 运行时 0.2.2-rc.1 + PATH dsh 0.2.1-rc.5）；只读边界保持不变（不执行升级、不提供"交给 Agent 执行"入口）。

## 0.2.0

- 新增 Codex 侧栏诊断页，按生态展示工具卡片和“一键诊断当前状态”按钮。
- 区分“有可用更新”与“是否建议升级”，展示已安装包声明的直接、间接依赖与版本约束冲突。
- 新增 Python 依赖约束检查；可选依赖启用状态和大版本兼容性无法确认时，明确要求核验。
- 提供 Git marketplace 分发与 README 安装、更新共用提示词；安装副本不再依赖开发者电脑路径。
- 统一 Skill、CLI、插件版本为 0.2.0，保留只读检查和手动决定升级的行为。
- 新增 DeepSeek Harness 左侧边栏插件 `dsh-cli-doctor`（`dsh/` 目录）：Host 半体注册只读诊断前缀路由
  `/api/cli-doctor/*`，浏览器半体注册 `sidebar.panellist` 入口与主面板；提供一句话安装提示词。
  它完全自包含于 `dsh/`，不修改 Codex 插件、MCP 入口和 `dashboard/` 的既有实现。
- DSH 侧栏插件按**预构建**方式分发（`lib/client.js` 与 vendored `bin/` 随包发布），安装时不执行任何
  构建脚本；新增 `npm run verify` 发布门禁（四处版本号联动检查 + 构建 + 单元测试 + `bin/` 副本 sha256 校验）。

依赖诊断不扫描其他项目目录、虚拟环境或 lockfile，也不验证运行时 API 兼容性。安装或更新 Codex 插件后需重启 Codex；DSH 插件同样不做热更新，升级需卸载后重装，`desktop` profile 安装后通常需要重启应用。提示词更新按需执行，不提供后台更新通知。

## 0.1.0

此项记录早期 Codex 插件的独立版本；当时 Skill 与 CLI 版本为 0.1.4。

- 提供可从 Codex Git marketplace 安装的侧栏插件入口。
- 在侧栏展示现有 CLI Doctor 生态卡片，并通过本地 MCP 运行只读诊断。
- 将页面和诊断程序随插件一起安装，移除对开发者电脑绝对路径的依赖。
