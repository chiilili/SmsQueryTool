'use strict';

// 鉴权自动预热：
// 用户在 sms.jd.com 上批量查询时，man-sff 网关需要 x-mlaas-at 这个 Token，
// 而 Token 只能由 kfuad / crm 等页面的前端 JS 在请求时挂出来——所以"冷启动"必须
// 至少打开过一次 kfuad。本模块的作用：当 sms 页面发现 Token 缺失/失效时，
// 通过消息触发 background 自动在后台标签里打开 kfuad 首页，等本扩展的
// token-persist 嗅到新 Token 落盘后立刻关掉 tab，整个过程用户**无需手动操作**。
//
// 设计要点：
//   1) 优先复用已存在的 kfuad 标签，避免重复开窗
//   2) 用 chrome.storage.onChanged 监听 Token 时间戳变化作为"完成"信号
//   3) 12s 兜底超时，避免无限挂起（用户没登录 kfuad 的情况）
//   4) 同时间只允许一个预热流，并发请求会复用同一 Promise

const TOKEN_KEY = 'jd_sms_mlaas_token';
const TOKEN_TS_KEY = 'jd_sms_mlaas_token_ts';
const WARM_TIMEOUT_MS = 12000;
const KFUAD_WARM_URL = 'https://kfuad.jd.com/';

let _warmPromise = null;

function getStored() {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get([TOKEN_KEY, TOKEN_TS_KEY], r => {
        resolve({ token: (r && r[TOKEN_KEY]) || '', ts: Number((r && r[TOKEN_TS_KEY]) || 0) });
      });
    } catch (_) { resolve({ token: '', ts: 0 }); }
  });
}

function findExistingKfuadTab() {
  return new Promise(resolve => {
    try {
      chrome.tabs.query({ url: ['*://kfuad.jd.com/*'] }, tabs => {
        resolve(Array.isArray(tabs) ? tabs : []);
      });
    } catch (_) { resolve([]); }
  });
}

function createBackgroundTab(url) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.create({ url, active: false }, tab => {
        const err = chrome.runtime.lastError;
        if (err || !tab) return reject(new Error((err && err.message) || 'tab_create_failed'));
        resolve(tab);
      });
    } catch (e) { reject(e); }
  });
}

function removeTabQuiet(id) {
  return new Promise(resolve => {
    try { chrome.tabs.remove(id, () => { void chrome.runtime.lastError; resolve(); }); }
    catch (_) { resolve(); }
  });
}

async function doWarm() {
  const before = await getStored();
  const beforeTs = before.ts || 0;

  // 已有 kfuad 标签：很可能正在产生 Token，给它几秒时间观察 storage 是否被刷新
  const existing = await findExistingKfuadTab();
  let createdTabId = null;
  if (!existing.length) {
    try {
      const tab = await createBackgroundTab(KFUAD_WARM_URL);
      createdTabId = tab.id;
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : 'tab_create_failed', token_ts: beforeTs };
    }
  }

  // 等"Token 时间戳"被更新（由任一 kfuad 标签上的 token-persist 写入）
  const refreshed = await new Promise(resolve => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };
    const onChange = (changes, area) => {
      if (area !== 'local') return;
      const c = changes[TOKEN_TS_KEY];
      if (c && Number(c.newValue) > beforeTs) {
        try { chrome.storage.onChanged.removeListener(onChange); } catch (_) {}
        finish(true);
      }
    };
    try { chrome.storage.onChanged.addListener(onChange); } catch (_) {}
    setTimeout(() => {
      try { chrome.storage.onChanged.removeListener(onChange); } catch (_) {}
      finish(false);
    }, WARM_TIMEOUT_MS);
  });

  if (createdTabId != null) await removeTabQuiet(createdTabId);

  const after = await getStored();
  const ok = refreshed && after.token && after.ts > beforeTs;
  return {
    ok,
    error: ok ? '' : (existing.length
      ? '已打开 kfuad 页面但未检测到新鉴权，请在该页面随便点击一次后重试'
      : '未能自动刷新鉴权（可能未登录 kfuad）。请手动打开 https://kfuad.jd.com 完成登录后重试'),
    token_ts: after.ts || 0,
    created_tab: createdTabId != null,
    reused_existing: !!existing.length
  };
}

function warmTokenOnce() {
  if (_warmPromise) return _warmPromise;
  _warmPromise = doWarm().finally(() => { _warmPromise = null; });
  return _warmPromise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'JD_SMS_TOOL_WARM_TOKEN') return false;
  warmTokenOnce()
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
  return true; // 异步响应
});
