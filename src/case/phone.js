'use strict';

// 与 page-hook（MAIN World）通信，按事件号查询来电号码。
// 由于 chrome.runtime 无法访问 MAIN World 中的变量，采用 postMessage 桥接。

const PHONE_QUERY_TIMEOUT_MS = 20000;
const __pendingPhoneQueries = new Map();

(function installCaseQueryBridge() {
  if (window.__jdSmsCaseBridgeInstalled) return;
  window.__jdSmsCaseBridgeInstalled = true;
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type !== 'JD_SMS_QUERY_CASE_RESPONSE') return;
    const pending = __pendingPhoneQueries.get(event.data.queryId);
    if (!pending) return;
    __pendingPhoneQueries.delete(event.data.queryId);
    clearTimeout(pending.timer);
    if (event.data.success) pending.resolve(event.data.data);
    else pending.reject(new Error(event.data.error || '查询失败'));
  });
})();

async function lookupPhoneByCaseRaw(caseId) {
  const queryId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      __pendingPhoneQueries.delete(queryId);
      reject(new Error('查询来电号码超时'));
    }, PHONE_QUERY_TIMEOUT_MS);
    __pendingPhoneQueries.set(queryId, { resolve, reject, timer });
    window.postMessage({ type: 'JD_SMS_QUERY_CASE_REQUEST', queryId, caseId: String(caseId) }, '*');
  });
}

async function lookupPhoneByCase(caseId) {
  const cleanId = clean(caseId);
  if (!cleanId) return { phone: '', raw: '' };
  if (state.phoneCache && state.phoneCache.has(cleanId)) return state.phoneCache.get(cleanId);
  const promise = (async () => {
    const raw = await lookupPhoneByCaseRaw(cleanId);
    const phone = extractCallTel(raw);
    return { phone, raw };
  })();
  state.phoneCache.set(cleanId, promise);
  return promise;
}

function extractCallTel(rawText) {
  if (!rawText) return '';
  let parsed = null;
  try {
    parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
    if (parsed && typeof parsed.data === 'string') {
      try { parsed.data = JSON.parse(parsed.data); } catch (_e) { /* keep string */ }
    }
  } catch (_e) {
    parsed = null;
  }
  const findKey = (obj, target) => {
    if (obj == null) return null;
    if (typeof obj === 'string') {
      const m = obj.match(new RegExp('[?&]' + target + '=([\\d\\*\\-]+)'));
      return m ? m[1] : null;
    }
    if (typeof obj !== 'object') return null;
    if (obj[target]) return obj[target];
    for (const k of Object.keys(obj)) {
      const v = findKey(obj[k], target);
      if (v) return v;
    }
    return null;
  };
  if (parsed) {
    const candidate = findKey(parsed.data || parsed, 'callTel');
    if (candidate) return normalizePhone(candidate);
  }
  // 终极降级：在原文里正则扫描
  const cleanRaw = String(rawText).replace(/\\/g, '');
  const m = cleanRaw.match(/"callTel"\s*:\s*"?([\d\*\-]+)"?/)
        || cleanRaw.match(/[?&]callTel=([\d\*\-]+)/)
        || cleanRaw.match(/callTel[^a-zA-Z0-9_]([\d\*\-]+)/);
  return m ? normalizePhone(m[1]) : '';
}

function normalizePhone(v) {
  return clean(v).replace(/[^\d]/g, '');
}

async function ensurePageHookReady(timeoutMs = 3000) {
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
    }, timeoutMs);
  });
}
