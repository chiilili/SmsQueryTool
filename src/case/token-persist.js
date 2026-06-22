'use strict';

// 在 kfuad / crm / sms 各域名之间用 chrome.storage.local 持久化 x-mlaas-at Token。
// 1. 页面加载时把已存的 Token 回灌给 MAIN 世界的 page-hook（JD_SMS_RESTORE_TOKEN）
// 2. MAIN 世界每次抓到新 Token 都会广播 JD_SMS_TOKEN_CAPTURED，我们落盘
// 这样一次在 kfuad 上的请求嗅到 Token 后，sms.jd.com 面板也能直接用。
//
// 注意：本文件可能被 manifest 注册到同一 isolated world 多次（panel bundle + 独立注入）。
// 因此所有声明放在 IIFE 内，并用 window.__jdSmsTokenPersistInstalled 做幂等保护，
// 防止 "Identifier already declared" 这种顶层 const 重复错误把后续脚本一起带崩。

(function () {
  if (window.__jdSmsTokenPersistInstalled) return;
  window.__jdSmsTokenPersistInstalled = true;

  const TOKEN_KEY = 'jd_sms_mlaas_token';
  const TOKEN_TS_KEY = 'jd_sms_mlaas_token_ts';

  function chromeStorageAvailable() {
    try {
      return typeof chrome !== 'undefined'
        && chrome.runtime && chrome.runtime.id
        && chrome.storage && chrome.storage.local;
    } catch (_e) { return false; }
  }

  // 1) 页面加载时把已存的 Token 回灌给 MAIN 世界 page-hook
  if (chromeStorageAvailable()) {
    try {
      chrome.storage.local.get([TOKEN_KEY], (result) => {
        if (chrome.runtime.lastError) return;
        const tok = result && result[TOKEN_KEY];
        if (tok) window.postMessage({ type: 'JD_SMS_RESTORE_TOKEN', token: tok }, '*');
      });
    } catch (_e) {}
  }

  // 2) MAIN 世界抓到新 Token → 落盘并打时间戳（供后台判断"是否被刷新过"）
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type !== 'JD_SMS_TOKEN_CAPTURED') return;
    const token = event.data.token;
    if (!token) return;
    if (!chromeStorageAvailable()) return;
    try {
      chrome.storage.local.set({ [TOKEN_KEY]: token, [TOKEN_TS_KEY]: Date.now() });
    } catch (_e) {}
  });

  // 3) 其它标签页（如后台自动打开的 kfuad）拿到新 Token 后，
  //    chrome.storage 会跨标签广播变更——把最新值推回当前 MAIN 世界，
  //    这样不重开页面也能用上刚刷新的鉴权。
  if (chromeStorageAvailable() && chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
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
