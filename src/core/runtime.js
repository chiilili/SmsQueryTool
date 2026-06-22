'use strict';
(function (A) {
  const C = A.constants;
  const INV = /extension context invalidated|context invalidated|extension has been reloaded|receiving end does not exist|message port closed/i;
  const Runtime = {
    isInvalidatedText(v) { return INV.test(String(v || '')); },
    createInvalidatedError(detail) {
      const t = C.EXTENSION_CONTEXT_INVALIDATED_TEXT;
      const err = new Error(detail ? (t + ' 原始错误：' + detail) : t);
      err.code = 'EXTENSION_CONTEXT_INVALIDATED';
      return err;
    },
    isInvalidatedError(e) { return Boolean(e && (e.code === 'EXTENSION_CONTEXT_INVALIDATED' || Runtime.isInvalidatedText(e.message || e))); },
    isChromeAvailable() {
      try { return typeof chrome !== 'undefined' && Boolean(chrome.runtime) && Boolean(chrome.runtime.id) && typeof chrome.runtime.sendMessage === 'function'; }
      catch (_) { return false; }
    },
    readLastError() { try { return (chrome.runtime.lastError && chrome.runtime.lastError.message) || ''; } catch (e) { return e && e.message ? e.message : String(e); } },
    sendMessageSafe(message, timeoutMs) {
      const to = Math.min(Math.max(Number(timeoutMs) || 30000, 1000), 120000);
      return new Promise((resolve, reject) => {
        if (!Runtime.isChromeAvailable()) return reject(Runtime.createInvalidatedError());
        let settled = false;
        const reject2 = e => { if (settled) return; settled = true; clearTimeout(t); reject(e); };
        const resolve2 = v => { if (settled) return; settled = true; clearTimeout(t); resolve(v); };
        const t = setTimeout(() => reject2(new Error('插件后台通信超时，请刷新页面后重试。')), to + 1000);
        try {
          chrome.runtime.sendMessage(message, resp => {
            const re = Runtime.readLastError();
            if (re) return reject2(Runtime.isInvalidatedText(re) ? Runtime.createInvalidatedError(re) : new Error(re || '插件后台通信失败'));
            resolve2(resp);
          });
        } catch (e) {
          const m = e && e.message ? e.message : String(e);
          reject2(Runtime.isInvalidatedText(m) ? Runtime.createInvalidatedError(m) : e);
        }
      });
    },
    handleInvalidated(err) {
      if (!Runtime.isInvalidatedError(err)) return false;
      try {
        if (A.state) { A.state.running = false; A.state.stopped = true; }
        if (A.View && A.View.flushResultsNow) A.View.flushResultsNow();
        if (A.View && A.View.updateButtons) A.View.updateButtons();
        if (A.View && A.View.log) A.View.log(C.EXTENSION_CONTEXT_INVALIDATED_TEXT);
      } catch (_) {}
      return true;
    },
    installGuard() {
      if (window.__smsAppRuntimeGuardInstalled) return;
      window.__smsAppRuntimeGuardInstalled = true;
      window.addEventListener('error', e => { if (Runtime.handleInvalidated(e.error || e.message)) e.preventDefault(); });
      window.addEventListener('unhandledrejection', e => { if (Runtime.handleInvalidated(e.reason)) e.preventDefault(); });
    },
    toFriendlyError(err) {
      const raw = A.Text.clean(err && err.message ? err.message : err);
      if (Runtime.isInvalidatedText(raw)) return C.EXTENSION_CONTEXT_INVALIDATED_TEXT;
      if (/cors|access-control-allow-origin|credentials/i.test(raw)) return '跨域静态资源读取失败，请确认插件已重新加载扩展。';
      if (/abort|timeout|timed out|signal is aborted/i.test(raw)) return '请求超时，请稍后重试或确认系统页面可正常打开。';
      if (/登录页|登录|login|passport|idp/i.test(raw)) return '登录态失效，请先确认当前浏览器已登录CRM。';
      if (/parDeptId|关闭明细链接|组织树|业务监控页/.test(raw)) return '未能自动识别当前组关闭数据，请确认CRM业务监控页有权限且能正常访问。';
      if (/HTTP\s*\d+/i.test(raw)) return raw.match(/HTTP\s*\d+/i)[0] + '，请求失败。';
      return raw || '未知错误';
    }
  };
  A.Runtime = Runtime;
})(window.SmsApp);
