#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};
const MAX_OUTPUT = 24 * 1024 * 1024;
const MAX_DIAGNOSIS_MS = 8 * 60 * 1000;
let inFlight = false;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.end(body);
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
    const timer = setTimeout(() => child.kill('SIGTERM'), MAX_DIAGNOSIS_MS);

    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) {
        tooLarge = true;
        child.kill('SIGTERM');
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tooLarge) return reject(new Error('诊断输出过大，已停止检查'));
      if (code !== 0) return reject(new Error(`诊断程序退出码 ${code}：${stderr || '未提供错误详情'}`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`诊断程序没有返回有效 JSON（${error.message}，${outputBytes} 字节）`));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const expectedHost = `127.0.0.1:${server.address().port}`;
  if (req.headers.host !== expectedHost) {
    send(res, 403, JSON.stringify({ error: '仅接受本机地址访问' }));
    return;
  }
  if (req.method === 'GET' && FILES[url.pathname]) {
    const [name, type] = FILES[url.pathname];
    send(res, 200, fs.readFileSync(path.join(__dirname, name)), type);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/check') {
    if (req.headers.origin && req.headers.origin !== `http://${expectedHost}`) {
      send(res, 403, JSON.stringify({ error: '来源不匹配' }));
      return;
    }
    if (inFlight) {
      send(res, 409, JSON.stringify({ error: '已有诊断正在运行' }));
      return;
    }
    inFlight = true;
    try {
      send(res, 200, JSON.stringify(await diagnose()));
    } catch (error) {
      send(res, 500, JSON.stringify({ error: error.message }));
    } finally {
      inFlight = false;
    }
    return;
  }
  send(res, 404, JSON.stringify({ error: '未找到页面' }));
});

server.on('error', (error) => {
  console.error(`无法启动本地诊断页：${error.message}`);
  process.exitCode = 1;
});

server.listen(0, '127.0.0.1', () => {
  console.log(`CLI Doctor dashboard: http://127.0.0.1:${server.address().port}/`);
});
