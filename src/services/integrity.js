'use strict';
(function (A) {
  // 桥接 content script 与 background：拉取扩展自身文件的 SHA-256 指纹，
  // 由 License 上报给服务端做强校验。
  let _cached = null;
  const Integrity = {
    async bundleHash() {
      if (_cached) return _cached;
      _cached = new Promise(resolve => {
        try {
          if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
            return resolve({ bundle_hash: '', file_count: 0, error: 'no_chrome_runtime' });
          }
          let settled = false;
          const finish = (v) => { if (settled) return; settled = true; resolve(v); };
          const timer = setTimeout(() => finish({ bundle_hash: '', file_count: 0, error: 'timeout' }), 15000);
          chrome.runtime.sendMessage({ type: 'JD_SMS_TOOL_BUNDLE_HASH' }, (resp) => {
            clearTimeout(timer);
            const lastErr = chrome.runtime.lastError && chrome.runtime.lastError.message;
            if (lastErr || !resp || resp.ok !== true) {
              return finish({
                bundle_hash: '',
                file_count: 0,
                error: (resp && resp.error) || lastErr || 'unknown'
              });
            }
            finish(resp.data || { bundle_hash: '', file_count: 0 });
          });
        } catch (e) {
          resolve({ bundle_hash: '', file_count: 0, error: e && e.message ? e.message : String(e) });
        }
      });
      return _cached;
    },
    invalidate() { _cached = null; }
  };
  A.Integrity = Integrity;
})(window.SmsApp);
