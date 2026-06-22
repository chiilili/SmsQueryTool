'use strict';
(function (A) {
  // 业务"知识"运行时下发：列名候选、CRM 探测端点、SMS 关键字等。
  // 客户端不再静态包含这些常量，攻击者直接反编译看不到核心特征。
  // 网络异常时回退到本地缓存（chrome.storage.local），再降级到 constants.js 中的兜底默认值。
  const CACHE_KEY = 'jd_sms_runtime_config_v1';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  // 服务端可下发并被合入 A.constants 的字段白名单
  const SCALAR_KEYS = [
    'CRM_FUN_NAME',
    'SMS_TARGET_SENDER_ID',
    'SMS_QUERY_WINDOW_DAYS',
    'SMS_QUERY_PAGE_SIZE',
    'SMS_QUERY_MAX_PAGES'
  ];
  const ARRAY_KEYS = [
    'EVENT_COL_CANDIDATES',
    'ACCOUNT_COL_CANDIDATES',
    'TRACKER_COL_CANDIDATES',
    'CREATOR_COL_CANDIDATES',
    'CRM_TREE_ENDPOINT_GUESSES',
    'SMS_CONTENT_KEYWORDS'
  ];

  function readCache() {
    return new Promise(resolve => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
        chrome.storage.local.get([CACHE_KEY], r => {
          const v = r && r[CACHE_KEY];
          if (!v || !v.data || !v.savedAt) return resolve(null);
          if (Date.now() - v.savedAt > CACHE_TTL_MS) return resolve(null);
          resolve(v.data);
        });
      } catch (_) { resolve(null); }
    });
  }

  function writeCache(data) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ [CACHE_KEY]: { data, savedAt: Date.now() } });
    } catch (_) {}
  }

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    const C = A.constants;
    for (const k of SCALAR_KEYS) if (cfg[k] !== undefined && cfg[k] !== null) C[k] = cfg[k];
    for (const k of ARRAY_KEYS) if (Array.isArray(cfg[k])) C[k] = cfg[k].slice();
    if (Array.isArray(cfg.IGNORED_CREATORS)) C.IGNORED_CREATORS = new Set(cfg.IGNORED_CREATORS);
    // 远程横幅
    A.runtimeBanner = (cfg.banner && cfg.banner.enabled) ? cfg.banner : null;
    return true;
  }

  const RuntimeConfig = {
    async load() {
      let fresh = null;
      try { fresh = await A.License.fetchRuntimeConfig(); } catch (_) { fresh = null; }
      if (fresh) {
        applyConfig(fresh);
        writeCache(fresh);
        return { source: 'server', config: fresh };
      }
      const cached = await readCache();
      if (cached) {
        applyConfig(cached);
        return { source: 'cache', config: cached };
      }
      return { source: 'defaults', config: null };
    },
    banner() { return A.runtimeBanner || null; }
  };
  A.RuntimeConfig = RuntimeConfig;
})(window.SmsApp);
