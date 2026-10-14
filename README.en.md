# cli-doctor

[中文](README.md) | **English**

Understand your CLI environment before you upgrade.

`cli-doctor` is a macOS-first version checker for command-line tools and development environments. It inspects Homebrew, global npm packages, Python/pip, Rust, Bun, uv, and tools with their own update mechanisms. It distinguishes tools from their supporting libraries and produces reports for people or AI agents.

Current version: **v0.2.0**. The Agent Skill, CLI, and Codex sidebar plugin share one version number. See [CHANGELOG.md](CHANGELOG.md) for release notes in Chinese.

**It tells you what may need an update and what an upgrade could affect. You decide whether to upgrade.**

> WorkBuddy compatibility: the `SKILL.md` frontmatter includes a version number, Chinese and English display names, and descriptions in both languages for WorkBuddy metadata validation.

## Why use it?

Updating a CLI can affect shared dependencies, change command behavior, replace another executable on your PATH, or affect a running service.

`cli-doctor` helps you assess the environment before making changes:

- Distinguish tools from dependency libraries instead of treating hundreds of libraries as tools to upgrade.
- Identify major-version jumps, dependency version constraints, and tools that need individual checks.
- Get copyable upgrade commands without having them executed automatically.
- Use the CLI's Markdown inventory summary or the Agent Skill's seven-field decision report based on `--json` data.
- Run another check after an upgrade to identify completed updates and versions intentionally kept in place.

## Codex sidebar: copy a prompt to install or update

Paste the entire prompt below into any conversation in **Codex desktop**. On first use, Codex registers this repository as a marketplace and installs the sidebar plugin. Use the same prompt later to refresh the source and install a newer version. The sidebar plugin and the Agent Skill described below have separate installation flows.

```text
Install or update the CLI Doctor sidebar plugin for Codex desktop on this computer. The only trusted source is https://github.com/MaxHou-infinity/cli-doctor, and the target plugin ID is cli-doctor@cli-doctor-github. I want the sidebar plugin, not the Agent Skill in the same repository.

Follow these steps in order and report the result of each:
1. Confirm that the codex CLI, Git, and Node.js 18+ are available. Read the repository's current .agents/plugins/marketplace.json, plugin.json, and mcp.json to verify the plugin name, version, and local MCP entry point. Do not execute repository commands unrelated to installation.
2. Run codex plugin marketplace list --json to check whether cli-doctor-github is already registered from MaxHou-infinity/cli-doctor. If it is missing, run codex plugin marketplace add MaxHou-infinity/cli-doctor. If it is registered with the correct source, run codex plugin marketplace upgrade cli-doctor-github. If a marketplace with the same name points elsewhere, stop and explain instead of overwriting it.
3. Read the plugin.json version from the cli-doctor-github root returned by codex plugin marketplace list --json. Read the installed version with codex plugin list --json. Only if the plugin is missing or the source version is newer, run codex plugin add cli-doctor@cli-doctor-github --json. Do not downgrade. Marketplace upgrade only refreshes the source; it is not evidence that the installed plugin has been updated.
4. Run codex plugin list --json to verify that the plugin is installed and enabled, and check its version. When installing or updating, locate the installed copy using installedPath from codex plugin add --json. If no update is needed, locate it in Codex's plugin cache. Verify that it contains bin/check.js, bin/python_dependency_audit.py, the dashboard files, and codex-server.js. If test/codex_plugin_smoke.js is included, run this MCP page check, which does not run a diagnosis or access the network.
5. If a new version was installed, read CHANGELOG.md and summarize the changes in English. Report whether installation or updating completed, the actual installed plugin version, whether Codex needs a restart, and how to open CLI Doctor from the sidebar and run a diagnosis after restarting. If you cannot see that the sidebar entry has appeared, state that I still need to verify it after restarting; do not claim the interface has been verified.

Do not upgrade Homebrew, npm, Python, or any other tools being diagnosed. Do not run curl | sh, and do not remove or overwrite other plugins' configuration. If a command fails, stop and report the specific reason instead of guessing that it worked.
```

Restart Codex after installing or updating, then open **CLI Doctor** from the sidebar. Click the diagnostic button at the top of the page to inspect your computer; installation itself does not diagnose or upgrade your tools. The diagnostic interface currently uses Chinese labels.

You need Node.js 18+, Git, and a Codex desktop version that supports plugin marketplaces. Codex may ask you to approve network access or changes to global plugin configuration. Updates are on demand: this prompt does not provide automatic updates or background notifications.

## DSH sidebar: copy a prompt to install or update

The same read-only diagnosis is available as a DeepSeek Harness (DSH) sidebar plugin named `dsh-cli-doctor`. Its source and engineering contract are in [dsh/](dsh/README.md) (documentation in Chinese). This installation is independent of the Codex plugin. The DSH implementation is contained in `dsh/` and does not modify the Codex adapter files, including `plugin.json`, `mcp.json`, `codex-server.js`, and `dashboard/`.

Paste the entire prompt below into **any DSH conversation**. The agent uses `plugin_manager` to install and verify the plugin. Installation writes to the profile directory and requires approval.

```text
Install or update the CLI Doctor sidebar plugin for DeepSeek Harness on this computer. The only trusted source is the npm package dsh-cli-doctor. Its source and engineering contract are in the dsh/ directory of https://github.com/MaxHou-infinity/cli-doctor. I want the DSH sidebar plugin, not the Codex plugin or the Agent Skill in the same repository.

Follow these steps in order and report the result of each:
1. Use plugin_manager's list_bundles to identify the current profile and check whether dsh-cli-doctor is installed. Use list_plugins to verify that it is enabled and its fiber phase is active.
2. If it is missing, install it with install_bundle. If it is already installed from the correct source, use remove_bundle and then install it again; DSH plugins do not update automatically. Installation writes to the profile directory, so ask for my approval. Do not manually rewrite the profile's cordis.patch.yml.
3. After installation, verify with list_bundles that the bundle is enabled, its rows contain cli-doctor, and error is empty. If it reports incompatible-version, do not bypass it with set_version_exemption; report the peer requirements and runtime version first.
4. If it reports restart-required, or hot reload is disabled for the profile, tell me to restart DSH. After restarting, open CLI Doctor from the sidebar and use the diagnostic button.
5. Report the installed version, whether it is enabled, whether a restart is required, and how to update it later. Do not upgrade Homebrew, npm, Python, or other tools being diagnosed, and do not run curl | sh. If a command fails, stop and report the specific reason.
```

You can also install without an agent: enter `dsh-cli-doctor` under **Plugins → Add plugin** in the sidebar, or run `dsh plugin --profile <profile> add dsh-cli-doctor`. For local development, the plugin input also accepts the absolute path to `dsh/`. The npm package is prebuilt; installation does not run build scripts.

The DSH sidebar plugin requires removal and reinstallation to update. The desktop app owns the `desktop` profile, and installation usually requires an app restart. The panel uses Chinese labels and runs `bin/check.js --json --no-update` only when you click the diagnostic button. It does not execute upgrades.

## Install the Agent Skill in 30 seconds

Use the open `skills` CLI. It discovers `cli-doctor` in this repository and installs it in the selected agent's directory, so you do not need to enter local paths for Claude, Codex, or other agents.

```bash
# Choose installation scope and agents interactively
npx skills@latest add MaxHou-infinity/cli-doctor

# Install globally for Codex
npx skills@latest add MaxHou-infinity/cli-doctor \
  --skill cli-doctor --global --agent codex --yes

# Install globally for all supported agents
npx skills@latest add MaxHou-infinity/cli-doctor \
  --skill cli-doctor --global --agent '*' --yes
```

Start a new conversation after installation so the agent can discover the Skill.

## Use natural language

Once the Skill is installed, describe what you want to check:

```text
Check the status of my installed CLI tools.
Audit my command-line tools for outdated versions.
Diagnose CLI dependency and upgrade risks.
Check the versions of my development tools and dependencies.
```

Each agent uses semantic matching to select the Skill. To request it explicitly:

```text
Use $cli-doctor to check my CLI tool versions.
```

## Run the CLI directly

You can run the collector from GitHub without installing the Skill:

```bash
# Human-readable inventory summary
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor

# Full structured data for AI agents
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --json
```

## Common commands

```bash
# Quickly list local installations without network refreshes or version comparisons
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --fast

# Skip only the Homebrew index refresh
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --no-update

# Select a pip index mirror
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor \
  --pypi-index https://pypi.tuna.tsinghua.edu.cn/simple

# Show help and version
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --help
npx --yes --allow-git=all github:MaxHou-infinity/cli-doctor --version
```

In `--fast` mode, items whose latest versions have not been checked online are marked for further verification. They are not reported as up to date.

## CLI summary and the agent's final report

The CLI collects version facts. The Agent Skill interprets those facts to produce an upgrade decision report.

By default, the agent displays the final report directly in the conversation without creating another file. The report has two groups:

1. **Tools:** Homebrew, global npm packages, Python CLIs, Rust/Bun/uv, and tools with their own update mechanisms.
2. **Dependency libraries:** shared and underlying libraries brought in by tools, shown as a summary by default.

Every item that needs an update or further verification uses these seven fields:

| Tool | Current version | Latest version | Manual upgrade command | Purpose | Dependency relationships | Risks |
|---|---|---|---|---|---|---|
| Example tool | 1.0.0 | 2.0.0 | `manager upgrade example` | What the tool does | Dependencies, version constraints, or PATH relationships | Major-version, service, or compatibility risks |

Items verified as up to date are summarized in their respective groups. All items requiring updates are displayed rather than left only in JSON. Versions that have not been checked online remain explicitly unverified.

HTML is optional. The agent generates an additional HTML report only when you request a shareable, archived, or management-facing report.

## Coverage

| Ecosystem | Checks |
|---|---|
| Homebrew | Leaf tools, outdated dependencies, service restart notes |
| npm | Global packages, current/latest versions, major-version jumps |
| Python/pip | CLI tools and libraries distinguished using `console_scripts` |
| Rust | rustup toolchains and tools installed with cargo |
| Bun | Bun version and upgrade command |
| uv | uv itself and uv tools |
| Tools with their own update mechanisms | Local tools such as hermes, agy, bsk, browse-now, and luckin |

## Upgrade safeguards

- Diagnosis is read-only and does not execute `brew upgrade`, `npm i -g`, `pip install -U`, or other upgrades.
- Review and approve the reported commands individually before running them.
- Check running tools, bundled services, and major-version changes separately, and schedule updates outside active use.

## Local development

```bash
git clone https://github.com/MaxHou-infinity/cli-doctor.git
cd cli-doctor
node bin/check.js --fast
npm test
```

Runtime: Node.js 18+. The root CLI project has no third-party runtime dependencies.

### Local dashboard and Codex plugin

Run `npm run dashboard` from the repository and open the printed `http://127.0.0.1:<port>/` address. The diagnostic button runs `bin/check.js --json --no-update` and displays results by ecosystem. It does not perform upgrades or run `brew update`. Online version queries can take several minutes. Items without a reliable target version remain unverified. The dashboard currently uses Chinese labels.

The dashboard distinguishes available updates from upgrade recommendations. It checks declarations from installed Homebrew formulae, top-level global npm packages, and distributions in the current `python3` interpreter. For Python, it compares target versions against requirements declared by installed packages and lists direct and indirect dependents. Conflicting constraints lead to a recommendation to defer upgrading. An update is recommended only when no installed dependents or conflicting constraints are found within the checked scope and there is no major-version change.

These checks do not scan other project directories, virtual environments, or lockfiles. They do not verify new dependencies in the target release or runtime API compatibility. Major-version changes require compatibility verification.

The root `plugin.json`, `mcp.json`, and `codex-server.js` provide the distributable Codex plugin entry point. The plugin calls the same `bin/check.js --json --no-update` collector through MCP and shares the standalone dashboard's cards and recommendation logic. Resources are loaded from the installed copy, without relying on the developer's repository path.

For each release, update the shared version in `SKILL.md`, `package.json`, and `plugin.json`, update `CHANGELOG.md`, and rerun installation and page checks. The local `plugins/cli-doctor-entry-probe` directory is retained only as an early experiment and is excluded from distribution.

## Keywords

CLI health check · CLI version checker · dependency audit · developer environment audit · Homebrew outdated · npm global packages · pip outdated · Rust toolchain · Bun upgrade · uv tools · macOS developer tools · read-only upgrade report · AI Agent Skill

## License

MIT
