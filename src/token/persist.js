'use strict';
(function () {
  if (window.__smsAppTokenPersistInstalled) return;
  window.__smsAppTokenPersistInstalled = true;
  const TOKEN_KEY = 'jd_sms_mlaas_token';
  const TOKEN_TS_KEY = 'jd_sms_mlaas_token_ts';
  function storageAvailable() {
    try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local; }
    catch (_e) { return false; }
  }
  // 1) 页面加载时把已存的 Token 回灌给 MAIN 世界 page-hook
  if (storageAvailable()) {
    try {
      chrome.storage.local.get([TOKEN_KEY], (r) => {
        if (chrome.runtime.lastError) return;
        const tok = r && r[TOKEN_KEY];
        if (tok) window.postMessage({ type: 'JD_SMS_RESTORE_TOKEN', token: tok }, '*');
      });
    } catch (_e) {}
  }
  // 2) MAIN 世界抓到新 Token → 落盘并打时间戳。
  //    时间戳是 background/warm-token.js 判断"鉴权已刷新"的唯一信号，缺它预热必然 12s 超时误判失败。
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type !== 'JD_SMS_TOKEN_CAPTURED') return;
    const token = event.data.token;
    if (!token || !storageAvailable()) return;
    try { chrome.storage.local.set({ [TOKEN_KEY]: token, [TOKEN_TS_KEY]: Date.now() }); } catch (_e) {}
  });
  // 3) 其它标签页（如后台自动打开的 kfuad）刷新 Token 后，storage 跨标签广播变更，
  //    把最新值推回本页 MAIN 世界，不重开页面也能用上刚刷新的鉴权（page-hook 的 JD_SMS_REPLACE_TOKEN）。
  if (storageAvailable() && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const c = changes[TOKEN_KEY];
        if (!c || !c.newValue || c.newValue === c.oldValue) return;
        window.postMessage({ type: 'JD_SMS_REPLACE_TOKEN', token: c.newValue }, '*');
      });
    } catch (_e) {}
  }
})();
