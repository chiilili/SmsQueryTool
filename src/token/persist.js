'use strict';
(function () {
  if (window.__smsAppTokenPersistInstalled) return;
  window.__smsAppTokenPersistInstalled = true;
  const TOKEN_KEY = 'jd_sms_mlaas_token';
  function storageAvailable() {
    try { return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local; }
    catch (_e) { return false; }
  }
  if (storageAvailable()) {
    try {
      chrome.storage.local.get([TOKEN_KEY], (r) => {
        if (chrome.runtime.lastError) return;
        const tok = r && r[TOKEN_KEY];
        if (tok) window.postMessage({ type: 'JD_SMS_RESTORE_TOKEN', token: tok }, '*');
      });
    } catch (_e) {}
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type !== 'JD_SMS_TOKEN_CAPTURED') return;
    const token = event.data.token;
    if (!token || !storageAvailable()) return;
    try { chrome.storage.local.set({ [TOKEN_KEY]: token }); } catch (_e) {}
  });
})();
