'use strict';
const ALLOWED_FETCH_ORIGINS = new Set([
  'https://crm.jd.com',
  'http://crm.jd.com',
  'http://newadmin.jpos.jd.com',
  'http://kfuad.jd.com',
  'https://kfuad.jd.com',
  'http://sms.jd.com',
  'https://sms.jd.com',
  'https://storage.360buyimg.com',
  'https://api.sms.playgroud.com'
]);
function normalizeCredentialsMode(value, fallback) {
  return ['include', 'omit', 'same-origin'].includes(value) ? value : fallback;
}
function inferCredentialsMode(url) {
  if (url.hostname === 'storage.360buyimg.com') return 'omit';
  if (url.hostname === 'api.sms.playgroud.com') return 'omit';
  return 'include';
}
function normalizeHeaders(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { Accept: '*/*' };
  return Object.assign({ Accept: '*/*' }, input);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'JD_SMS_TOOL_FETCH_TEXT') return false;
  (async () => {
    const target = new URL(message.url);
    if (!ALLOWED_FETCH_ORIGINS.has(target.origin)) throw new Error('不允许访问的地址：' + target.origin);
    const opts = message.options || {};
    const method = String(opts.method || 'GET').toUpperCase();
    const credentials = normalizeCredentialsMode(opts.credentials, inferCredentialsMode(target));
    const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 30000, 1000), 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(target.href, {
        method, headers: normalizeHeaders(opts.headers), body: opts.body || undefined,
        credentials, redirect: 'follow', signal: controller.signal
      });
      const text = await res.text();
      sendResponse({ ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, text });
    } finally { clearTimeout(timer); }
  })().catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
  return true;
});
