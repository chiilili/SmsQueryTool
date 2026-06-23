'use strict';
(function (A) {
  // 脱机版授权模块：完全本地运行，不连接任何授权服务器。
  // 原版会向 api.sms.playgroud.com 发握手/心跳/订阅/上报请求来做激活与限速；
  // 这里全部改为本地无网络实现——永远处于"已激活、功能全开、无配额限制"状态，
  // 单机即可使用，无需联网。
  //
  // 保留的是纯本地的「请求速率档位 + 节流」逻辑：它只用来给京东内网查询限速，
  // 不涉及任何外部服务器，因此原样保留。

  let _ctx = { erp: '', version: '', deviceId: '' };
  // 始终有效的本地策略：启用、无强制升级、无配额。
  const _lastPolicy = { enabled: true, force_update: false, valid_until: 0 };

  // 请求间隔节流：所有调用排队，每个请求起跑时间至少间隔 intervalMs。
  let _throttleChain = Promise.resolve();
  let _throttleAbort = { resolve: null, promise: null };
  function _newThrottleAbortGate() {
    let resolveAbort;
    const p = new Promise(r => { resolveAbort = r; });
    _throttleAbort = { resolve: resolveAbort, promise: p };
  }
  _newThrottleAbortGate();

  // ====== 用户手动调节查询速度 ======
  // 请求起跑的最小间隔（毫秒）：间隔越小越快。用户在面板上用滑块自由调节。
  const SPEED_MIN_MS = 50;     // 最快：约 20 条/秒
  const SPEED_MAX_MS = 2000;   // 最慢：约 0.5 条/秒
  const SPEED_DEFAULT_MS = 330; // 默认：约 3 条/秒
  let _speedIntervalMs = SPEED_DEFAULT_MS;
  function _clampInterval(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return SPEED_DEFAULT_MS;
    return Math.min(SPEED_MAX_MS, Math.max(SPEED_MIN_MS, Math.round(n)));
  }

  const DEVICE_ID_KEY = 'jd_sms_device_id';

  function getManifestVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return String(chrome.runtime.getManifest().version || '');
      }
    } catch (_) {}
    return '';
  }

  function randomDeviceId() {
    const buf = new Uint8Array(22);
    crypto.getRandomValues(buf);
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function getOrCreateDeviceId() {
    if (_ctx.deviceId) return _ctx.deviceId;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const got = await new Promise(resolve => {
          try { chrome.storage.local.get([DEVICE_ID_KEY], r => resolve(r && r[DEVICE_ID_KEY])); }
          catch (_) { resolve(''); }
        });
        if (got && /^[A-Za-z0-9_-]{16,64}$/.test(got)) { _ctx.deviceId = got; return got; }
      }
    } catch (_) {}
    const id = randomDeviceId();
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
      }
    } catch (_) {}
    _ctx.deviceId = id;
    return id;
  }

  const License = Object.freeze({
    // 脱机版始终视为已正确配置。
    isConfigured() { return true; },

    // 本地"握手"：不发任何网络请求，直接返回启用策略。
    async handshake(erp) {
      _ctx.erp = erp || '';
      _ctx.version = getManifestVersion();
      await getOrCreateDeviceId();
      return _lastPolicy;
    },

    // 心跳/订阅在脱机版没有意义，保留为无网络的空实现，便于其他模块照常调用。
    async heartbeat() { return _lastPolicy; },
    startHeartbeat(_onBlocked) { /* 脱机版不需要心跳 */ },
    stopHeartbeat() { /* no-op */ },
    startRealtimeSubscribe(_onUpdate) { /* 脱机版不需要实时订阅 */ },
    stopRealtimeSubscribe() { /* no-op */ },

    assertActive() { return true; },
    isActive() { return true; },

    // 功能全开。
    canUse(_feature) { return true; },

    requestIntervalMs() { return _clampInterval(_speedIntervalMs); },
    // 设置查询间隔（毫秒），自动夹到合法范围；返回生效后的实际值。
    setSpeedIntervalMs(ms) {
      _speedIntervalMs = _clampInterval(ms);
      return _speedIntervalMs;
    },
    currentSpeedIntervalMs() { return _clampInterval(_speedIntervalMs); },
    // 滑块的范围/默认值，供 UI 读取。
    speedRange() { return { min: SPEED_MIN_MS, max: SPEED_MAX_MS, default: SPEED_DEFAULT_MS }; },

    // 在发起单次查询请求前调用，按用户档位串行节流；0 表示不限速。
    async throttleRequest() {
      const interval = License.requestIntervalMs();
      if (!interval) return;
      const prev = _throttleChain;
      let release;
      _throttleChain = new Promise(resolve => { release = resolve; });
      try { await prev; } catch (_) {}
      const abortPromise = _throttleAbort.promise;
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
        const timer = setTimeout(finish, interval);
        abortPromise.then(finish);
      });
      release();
    },
    cancelThrottle() {
      try { if (_throttleAbort.resolve) _throttleAbort.resolve(); } catch (_) {}
      _newThrottleAbortGate();
      _throttleChain = Promise.resolve();
    },

    // 无配额限制。
    quotaInfo() { return { quota: 0, used: 0, remaining: Infinity, unlimited: true }; },
    assertQuotaForBatch(_additional) { return true; },

    // 统计上报无目标服务器，空实现（批量结束时仍会调用）。
    async reportBatch(_stats) { /* no-op */ },

    lastPolicy() { return _lastPolicy; },
    ctx() { return Object.assign({}, _ctx); }
  });

  try {
    Object.defineProperty(A, 'License', {
      value: License,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (_) { A.License = License; }
})(window.SmsApp);
