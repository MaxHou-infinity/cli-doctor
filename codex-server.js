#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PLUGIN_VERSION = require('./plugin.json').version;
const RESOURCE_URI = 'ui://cli-doctor/dashboard-v2.html';
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_DIAGNOSIS_MS = 8 * 60 * 1000;
let inFlight = false;

function dashboardHtml() {
  const dir = path.join(ROOT, 'dashboard');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(dir, 'app.css'), 'utf8');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  const bridge = fs.readFileSync(path.join(ROOT, 'codex-bridge.js'), 'utf8')
    .replace('__CLI_DOCTOR_VERSION__', JSON.stringify(PLUGIN_VERSION));
  return html
    .replace('<link rel="stylesheet" href="/app.css">', `<style>${css}</style>`)
    .replace('<script src="/app.js" defer></script>', '')
    .replace('</body>', `<script>${bridge}</script><script>${app}</script></body>`);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function diagnose() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin/check.js'), '--json', '--no-update'], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let outputBytes = 0;
    let stderr = '';
    let tooLarge = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, MAX_DIAGNOSIS_MS);
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) {
        tooLarge = true;
        child.kill('SIGTERM');
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('诊断超过 8 分钟，已停止检查'));
      if (tooLarge) return reject(new Error('诊断输出过大，已停止检查'));
      if (code !== 0) return reject(new Error(`诊断程序退出码 ${code}：${stderr || '未提供错误详情'}`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`诊断程序没有返回有效 JSON：${error.message}`));
      }
    });
  });
}

async function handle(message) {
  if (!Object.hasOwn(message, 'id')) return;
  const { id, method, params } = message;
  if (method === 'initialize') {
    reply(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: 'cli-doctor', version: PLUGIN_VERSION },
    });
  } else if (method === 'ping') {
    reply(id, {});
  } else if (method === 'tools/list') {
    reply(id, { tools: [
      {
        name: 'open_cli_doctor',
        title: 'CLI Doctor',
        description: '打开本机 CLI Doctor 诊断页。',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: { resourceUri: RESOURCE_URI },
          'openai/ui': { entrypoints: [{ type: 'global' }] },
        },
      },
      {
        name: 'run_cli_doctor_check',
        title: '一键诊断当前状态',
        description: '只读检查本机 CLI 工具版本和已安装包声明的依赖关系，不执行升级。',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
      },
    ] });
  } else if (method === 'tools/call' && params?.name === 'open_cli_doctor') {
    reply(id, { content: [{ type: 'text', text: 'CLI Doctor 诊断页已打开。' }] });
  } else if (method === 'tools/call' && params?.name === 'run_cli_doctor_check') {
    if (inFlight) return reply(id, { isError: true, content: [{ type: 'text', text: '已有诊断正在运行，请稍后重试。' }] });
    inFlight = true;
    try {
      const report = await diagnose();
      reply(id, { content: [{ type: 'text', text: '诊断完成。' }], structuredContent: { report } });
    } catch (error) {
      reply(id, { isError: true, content: [{ type: 'text', text: `诊断失败：${error.message}` }] });
    } finally {
      inFlight = false;
    }
  } else if (method === 'resources/list') {
    reply(id, { resources: [{ uri: RESOURCE_URI, name: 'CLI Doctor', mimeType: 'text/html;profile=mcp-app' }] });
  } else if (method === 'resources/read' && params?.uri === RESOURCE_URI) {
    try {
      reply(id, { contents: [{ uri: RESOURCE_URI, mimeType: 'text/html;profile=mcp-app', text: dashboardHtml() }] });
    } catch (error) {
      fail(id, -32603, `无法加载诊断页面：${error.message}`);
    }
  } else {
    fail(id, -32601, `Method not found: ${method}`);
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  try {
    Promise.resolve(handle(JSON.parse(line))).catch((error) => process.stderr.write(`MCP error: ${error.message}\n`));
  } catch (error) {
    process.stderr.write(`Invalid MCP message: ${error.message}\n`);
  }
});
