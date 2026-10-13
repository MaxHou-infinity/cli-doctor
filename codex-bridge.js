'use strict';

(() => {
  let nextId = 0;
  const pending = new Map();

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data?.jsonrpc !== '2.0') return;
    const response = event.data;
    if (typeof response.id !== 'number' || !pending.has(response.id)) return;
    const { resolve, reject } = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) reject(new Error(response.error.message || 'Codex 界面请求失败'));
    else resolve(response.result);
  });

  const ready = request('ui/initialize', {
    appInfo: { name: 'cli-doctor', version: __CLI_DOCTOR_VERSION__ },
    appCapabilities: {},
    protocolVersion: '2026-01-26',
  }).then(() => {
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
  });

  window.cliDoctorCheck = async () => {
    await ready;
    const result = await request('tools/call', { name: 'run_cli_doctor_check', arguments: {} });
    if (result?.isError) throw new Error(result.content?.find((part) => part.type === 'text')?.text || '诊断失败');
    if (!result?.structuredContent?.report) throw new Error('诊断程序未返回报告');
    return result.structuredContent.report;
  };
})();
