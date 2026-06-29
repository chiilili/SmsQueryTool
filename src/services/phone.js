'use strict';
(function (A) {
  const T = A.Text;
  const TIMEOUT = 20000;
  const pending = new Map();

  // 鉴权失效的特征串——page-hook 抛出来的中文错误 / 网关 401 的常见提示
  const AUTH_ERR_RE = /鉴权|x-mlaas-at|未登录|401/i;

  function installBridgeOnce() {
    if (window.__smsAppPhoneBridgeInstalled) return;
    window.__smsAppPhoneBridgeInstalled = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== 'JD_SMS_QUERY_CASE_RESPONSE') return;
      const p = pending.get(event.data.queryId);
      if (!p) return;
      pending.delete(event.data.queryId);
      clearTimeout(p.timer);
      if (event.data.success) p.resolve(event.data.data);
      else p.reject(new Error(event.data.error || '查询失败'));
    });
  }

  function rawLookup(caseId) {
    installBridgeOnce();
    const queryId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(queryId); reject(new Error('查询来电号码超时')); }, TIMEOUT);
      pending.set(queryId, { resolve, reject, timer });
      window.postMessage({ type: 'JD_SMS_QUERY_CASE_REQUEST', queryId, caseId: String(caseId) }, '*');
    });
  }

  // 让 background 自动在隐藏标签里打开 kfuad，把刚嗅到的 Token 推回当前页面。
  // 并发的多次失败只会触发一次预热（_warmInFlight）。
  let _warmInFlight = null;
  function warmTokenOnce() {
    if (_warmInFlight) return _warmInFlight;
    _warmInFlight = new Promise(resolve => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          return resolve({ ok: false, error: 'no_chrome_runtime' });
        }
        chrome.runtime.sendMessage({ type: 'JD_SMS_TOOL_WARM_TOKEN' }, resp => {
          const lastErr = chrome.runtime.lastError && chrome.runtime.lastError.message;
          if (lastErr || !resp) return resolve({ ok: false, error: lastErr || 'no_response' });
          resolve(resp.ok ? (resp.data || { ok: true }) : { ok: false, error: resp.error });
        });
      } catch (e) { resolve({ ok: false, error: e && e.message ? e.message : String(e) }); }
    }).finally(() => { _warmInFlight = null; });
    return _warmInFlight;
  }

  // 鉴权失败时自动预热一次再重试。再失败就把原错误抛出。
  async function rawLookupWithRetry(caseId) {
    try {
      return await rawLookup(caseId);
    } catch (err) {
      const msg = err && err.message ? err.message : '';
      if (!AUTH_ERR_RE.test(msg)) throw err;
      const warm = await warmTokenOnce();
      if (!warm || !warm.ok) {
        const e = new Error('首次使用请打开 http://kfuad.jd.com/#/produce 网页刷新一下，点击任意事件号之后，重新刷新本页');
        throw e;
      }
      // 等 storage 变更经 chrome.storage.onChanged 推回 page-hook 后再发起
      await new Promise(r => setTimeout(r, 200));
      return await rawLookup(caseId);
    }
  }

  function extract(rawText) {
    if (!rawText) return '';
    let parsed = null;
    try {
      parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
      if (parsed && typeof parsed.data === 'string') {
        try { parsed.data = JSON.parse(parsed.data); } catch (_e) {}
      }
    } catch (_e) { parsed = null; }
    const findKey = (obj, target) => {
      if (obj == null) return null;
      if (typeof obj === 'string') {
        const m = obj.match(new RegExp('[?&]' + target + '=([\\d\\*\\-]+)'));
        return m ? m[1] : null;
      }
      if (typeof obj !== 'object') return null;
      if (obj[target]) return obj[target];
      for (const k of Object.keys(obj)) { const v = findKey(obj[k], target); if (v) return v; }
      return null;
    };
    if (parsed) {
      const c = findKey(parsed.data || parsed, 'callTel');
      if (c) return normalize(c);
    }
    const cleanRaw = String(rawText).replace(/\\/g, '');
    const m = cleanRaw.match(/"callTel"\s*:\s*"?([\d\*\-]+)"?/)
      || cleanRaw.match(/[?&]callTel=([\d\*\-]+)/)
      || cleanRaw.match(/callTel[^a-zA-Z0-9_]([\d\*\-]+)/);
    return m ? normalize(m[1]) : '';
  }

  function normalize(v) {
    const raw = T.clean(v);
    if (!raw || raw.includes('*')) return '';
    const digits = raw.replace(/[^\d]/g, '');
    const mobile = digits.length === 13 && digits.startsWith('86') ? digits.slice(2) : digits;
    return /^1[3-9]\d{9}$/.test(mobile) ? mobile : '';
  }

  async function ensureHookReady(timeoutMs) {
    const to = Math.max(500, Number(timeoutMs) || 3000);
    return new Promise(resolve => {
      let done = false;
      const handler = (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'JD_SMS_PING_RESPONSE' || event.data.type === 'JD_SMS_TOKEN_CAPTURED') {
          if (done) return;
          done = true;
          window.removeEventListener('message', handler);
          resolve({ ready: true, token: event.data.token || '' });
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'JD_SMS_PING_REQUEST' }, '*');
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('message', handler);
        resolve({ ready: false, token: '' });
      }, to);
    });
  }

  async function lookupByCase(caseId) {
    const id = T.clean(caseId);
    if (!id) return { phone: '', raw: '' };
    if (A.state.phoneCache && A.state.phoneCache.has(id)) return A.state.phoneCache.get(id);
    const promise = (async () => {
      const raw = await rawLookupWithRetry(id);
      return { phone: extract(raw), raw };
    })().catch(err => {
      if (A.state.phoneCache && A.state.phoneCache.get(id) === promise) A.state.phoneCache.delete(id);
      throw err;
    });
    A.state.phoneCache.set(id, promise);
    return promise;
  }

  A.PhoneService = { lookupByCase, ensureHookReady };
})(window.SmsApp);
