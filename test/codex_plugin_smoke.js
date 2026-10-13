#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
const cli = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const skillVersion = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').match(/^version: "([^"]+)"$/m)?.[1];
assert.equal(manifest.version, cli.version, '插件与 CLI 版本必须一致');
assert.equal(manifest.version, skillVersion, '插件与 Skill 版本必须一致');
const mcp = JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8'));
const server = mcp.mcpServers?.['cli-doctor'];
assert.equal(manifest.name, 'cli-doctor');
assert.equal(server?.type, 'stdio');
assert.equal(server?.command, 'node');
assert.deepEqual(server?.args, ['codex-server.js']);
for (const file of ['bin/check.js', 'bin/python_dependency_audit.py', 'dashboard/index.html',
  'dashboard/app.css', 'dashboard/app.js', 'codex-bridge.js']) {
  assert.ok(fs.existsSync(path.join(root, file)), `安装包缺少 ${file}`);
}

const calls = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'ui://cli-doctor/dashboard-v2.html' } },
];
const run = spawnSync(process.execPath, [path.join(root, 'codex-server.js')], {
  cwd: os.tmpdir(),
  input: calls.map((call) => JSON.stringify(call)).join('\n') + '\n',
  encoding: 'utf8',
  timeout: 5000,
});
assert.equal(run.status, 0, run.stderr || `MCP 退出码 ${run.status}`);
const responses = run.stdout.trim().split('\n').map((line) => JSON.parse(line));
const byId = new Map(responses.map((response) => [response.id, response]));
assert.equal(byId.get(1)?.result?.serverInfo?.version, manifest.version);
const tools = byId.get(2)?.result?.tools || [];
assert.ok(tools.some((tool) => tool.name === 'open_cli_doctor' &&
  tool._meta?.['openai/ui']?.entrypoints?.some((entry) => entry.type === 'global')));
assert.ok(tools.some((tool) => tool.name === 'run_cli_doctor_check'));
const html = byId.get(3)?.result?.contents?.[0]?.text || '';
assert.match(html, /一键诊断当前状态/);
assert.match(html, /cliDoctorCheck/);
assert.ok(!html.includes('__CLI_DOCTOR_VERSION__'));
console.log(`CLI Doctor 插件 ${manifest.version}：MCP 握手、侧栏入口和页面资源正常`);
