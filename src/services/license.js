'use strict';
(function (A) {
  // ====== 用户必须配置 ======
  const LICENSE_API_BASE = 'https://api.sms.playgroud.com';
  const LICENSE_TOKEN = 'XM0mxW6QnltmABeHzIQNMBLtOz7Acu6b7QmHc-tAJDA';
  const LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAy7isPl5MVdFmg8eh+PuZKOt3Lxo5T4Hh0aTYAx0XDME=';
  // =========================

  const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_HEARTBEAT_FAILURES = 3;
  const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
  const DEVICE_ID_KEY = 'jd_sms_device_id';

  // 用闭包私有变量 + Object.freeze 提高源码 patch 的门槛
  // 注：这只能挡住业余破解，专业用户照样能改。真正的反破解必须把业务功能搬到服务端。
  let _ctx = { erp: '', version: '', deviceId: '' };
  let _lastPolicy = null;
  let _validUntil = 0;
  let _heartbeatTimer = null;
  let _heartbeatFailures = 0;
  let _onBlocked = null;
  // 实时长轮询订阅状态
  let _subscribeActive = false;
  let _subscribeStop = false;
  let _onSubscribeUpdate = null;
  let _seenNonces = new Set();
  let _publicKeyHandle = null;
  // 请求间隔节流：所有调用排队，每个请求起跑时间至少间隔 intervalMs。
  // 关键：用一个可中断的 abort 信号 race interval timer，
  // 这样停止/重置时可以"一次性"释放整条等待链，而不是被排队的请求拖死。
  let _throttleChain = Promise.resolve();
  let _throttleAbort = { resolve: null, promise: null };
  function _newThrottleAbortGate() {
    let resolveAbort;
    const p = new Promise(r => { resolveAbort = r; });
    _throttleAbort = { resolve: resolveAbort, promise: p };
  }
  _newThrottleAbortGate();
  const DEFAULT_REQUEST_INTERVAL_MS = 1000;

  // ====== 用户可调速率档位 ======
  // 面板上「🐢温和 / ⚡标准 / 🚀极速」对应的请求起跑最小间隔（毫秒）。
  // 间隔越小越快；smsLim=8 的并发上限决定极速档最多 8 路在飞。
  // 有效间隔 = max(管理员下限 policy.request_interval_ms, 用户档位)，
  // 这样管理员仍能对滥用账号强制限速，但默认（下限 0）下完全由用户档位说了算。
  const SPEED_PRESETS = { gentle: 1000, standard: 330, turbo: 120 };
  const SPEED_PRESET_DEFAULT = 'standard';
  let _speedIntervalMs = null; // null = 用户未显式选择，按标准档默认

  function getManifestVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return String(chrome.runtime.getManifest().version || '');
      }
    } catch (_) {}
    return '';
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function randomDeviceId() {
    // 22 字节 base64url → 长度 ~30 字符，满足服务端 16-64 正则
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

  async function getPublicKey() {
    if (_publicKeyHandle) return _publicKeyHandle;
    const spki = b64ToBytes(LICENSE_PUBLIC_KEY);
    _publicKeyHandle = await crypto.subtle.importKey(
      'spki', spki, { name: 'Ed25519' }, false, ['verify']
    );
    return _publicKeyHandle;
  }

  async function verifySig(data, sigB64) {
    if (!data || !sigB64) return false;
    const sigBytes = b64ToBytes(sigB64);
    const canonical = JSON.stringify(data);
    const key = await getPublicKey();
    return crypto.subtle.verify(
      'Ed25519', key, sigBytes, new TextEncoder().encode(canonical)
    );
  }

  async function call(path, body, opts) {
    const o = opts || {};
    const url = LICENSE_API_BASE.replace(/\/+$/, '') + path;
    const text = await A.Http.requestText(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Extension-Token': LICENSE_TOKEN },
      body: JSON.stringify(body || {}),
      credentials: 'omit',
      timeoutMs: o.timeoutMs || 15000,
      errorPrefix: o.errorPrefix || 'license_call_failed',
      // 控制面请求不受批量"停止"影响
      ignoreStopped: true
    });
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('invalid_response'); }
    return parsed;
  }

  async function currentBundleHash() {
    const integrity = A.Integrity && typeof A.Integrity.bundleHash === 'function'
      ? await A.Integrity.bundleHash() : null;
    return (integrity && integrity.bundle_hash) || '';
  }

  async function callSigned(path, body, opts) {
    const parsed = await call(path, body, opts);
    if (!parsed || parsed.ok !== true || !parsed.data || !parsed.sig) {
      throw new Error('invalid_response_shape');
    }
    const valid = await verifySig(parsed.data, parsed.sig);
    if (!valid) throw new Error('signature_invalid');
    const now = Date.now();
    const ts = Number(parsed.data.timestamp || 0);
    if (!ts || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) throw new Error('stale_response');
    const nonce = String(parsed.data.nonce || '');
    if (!nonce || _seenNonces.has(nonce)) throw new Error('replay_detected');
    _seenNonces.add(nonce);
    if (_seenNonces.size > 200) {
      const arr = Array.from(_seenNonces);
      _seenNonces = new Set(arr.slice(-100));
    }
    // 服务端把 device_id 回写在签名里——校验它与本地匹配
    if (_ctx.deviceId && parsed.data.device_id && parsed.data.device_id !== _ctx.deviceId) {
      throw new Error('device_mismatch');
    }
    // ERP 也回写在签名里
    if (_ctx.erp && parsed.data.erp && parsed.data.erp !== _ctx.erp) {
      throw new Error('erp_mismatch');
    }
    return parsed.data;
  }

  function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // 实时通道：长轮询 /api/subscribe。服务端最多挂 ~45s，期间管理员一改状态/命令/横幅
  // 就立刻带回最新签名 policy（亚秒级生效）；无事件则超时返回，客户端立即重订阅。
  // 断线指数退避重连（1s→2s→…→30s 封顶）。是心跳之外的主实时通道，心跳降级为兜底。
  async function subscribeLoop() {
    let backoff = 1000;
    while (!_subscribeStop) {
      if (!_ctx.erp) { await _sleep(2000); continue; }
      try {
        const deviceId = await getOrCreateDeviceId();
        const data = await callSigned('/api/subscribe', {
          erp: _ctx.erp, version: _ctx.version, device_id: deviceId,
          bundle_hash: await currentBundleHash()
        }, { timeoutMs: 60000, errorPrefix: 'subscribe_failed' });
        _lastPolicy = data;
        _validUntil = Number(data.valid_until || 0);
        _heartbeatFailures = 0;
        backoff = 1000; // 成功，重置退避
        if (typeof _onSubscribeUpdate === 'function') {
          try { _onSubscribeUpdate(data); } catch (_) {}
        }
        // 立即进入下一轮订阅，形成持续的实时通道
      } catch (_e) {
        if (_subscribeStop) break;
        await _sleep(backoff + Math.floor(Math.random() * 300));
        backoff = Math.min(30000, backoff * 2);
      }
    }
    _subscribeActive = false;
  }

  const License = Object.freeze({
    isConfigured() {
      return LICENSE_TOKEN !== 'REPLACE_WITH_EXTENSION_TOKEN'
        && LICENSE_PUBLIC_KEY !== 'REPLACE_WITH_PUBLIC_KEY'
        && /^https?:\/\//.test(LICENSE_API_BASE);
    },
    async handshake(erp) {
      _ctx.erp = erp || '';
      _ctx.version = getManifestVersion();
      const deviceId = await getOrCreateDeviceId();
      const integrity = A.Integrity && typeof A.Integrity.bundleHash === 'function'
        ? await A.Integrity.bundleHash() : null;
      const bundleHash = (integrity && integrity.bundle_hash) || '';
      const data = await callSigned('/api/handshake', {
        erp: _ctx.erp, version: _ctx.version, device_id: deviceId,
        bundle_hash: bundleHash
      });
      _lastPolicy = data;
      _validUntil = Number(data.valid_until || 0);
      _heartbeatFailures = 0;
      return data;
    },

    async heartbeat() {
      if (!_ctx.erp) return null;
      const deviceId = await getOrCreateDeviceId();
      try {
        const integrity = A.Integrity && typeof A.Integrity.bundleHash === 'function'
          ? await A.Integrity.bundleHash() : null;
        const bundleHash = (integrity && integrity.bundle_hash) || '';
        const data = await callSigned('/api/heartbeat', {
          erp: _ctx.erp, version: _ctx.version, device_id: deviceId,
          bundle_hash: bundleHash
        });
        _lastPolicy = data;
        _validUntil = Number(data.valid_until || 0);
        _heartbeatFailures = 0;
        // 每次心跳都通知一次，让 app 侧统一处理阻断/横幅/命令等
        if (typeof _onBlocked === 'function') {
          try { _onBlocked(data); } catch (_) {}
        }
        return data;
      } catch (_e) {
        _heartbeatFailures++;
        if (_heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
          _lastPolicy = null;
          _validUntil = 0;
          if (typeof _onBlocked === 'function') {
            try {
              _onBlocked({ enabled: false, message: '与服务器连续多次失联，已停用。请检查网络后刷新页面。' });
            } catch (_) {}
          }
        }
        return null;
      }
    },

    startHeartbeat(onBlocked) {
      _onBlocked = onBlocked || null;
      if (_heartbeatTimer) clearInterval(_heartbeatTimer);
      _heartbeatTimer = setInterval(() => { License.heartbeat(); }, HEARTBEAT_INTERVAL_MS);
    },

    stopHeartbeat() {
      if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
    },

    // 启动实时长轮询订阅（主实时通道）。onUpdate 收到的 policy 与心跳同构，
    // app 侧用同一个处理器即可（阻断/横幅/命令统一处理）。
    startRealtimeSubscribe(onUpdate) {
      _onSubscribeUpdate = onUpdate || null;
      if (_subscribeActive) return;
      _subscribeActive = true;
      _subscribeStop = false;
      subscribeLoop();
    },
    stopRealtimeSubscribe() { _subscribeStop = true; },

    assertActive() {
      if (!_lastPolicy) throw new Error('未握手或已掉线');
      if (_lastPolicy.enabled !== true) throw new Error('账号已停用');
      if (_lastPolicy.force_update) throw new Error('需要升级版本');
      if (_validUntil && Date.now() > _validUntil) throw new Error('许可证已过期');
      return true;
    },

    isActive() {
      try { License.assertActive(); return true; } catch (_) { return false; }
    },

    // ---- 功能开关 + 配额 ----
    canUse(feature) {
      if (!_lastPolicy || !_lastPolicy.features) return true;
      const v = _lastPolicy.features[feature];
      return v === undefined ? true : Boolean(v);
    },
    requestIntervalMs() {
      // 管理员通过 policy.request_interval_ms 设的"硬下限"（限速上限）。
      // 默认 0 = 不额外限制，由用户档位决定；管理员可对滥用账号设 >0 强制限速。
      let adminFloor = 0;
      if (_lastPolicy) {
        const v = Number(_lastPolicy.request_interval_ms);
        if (Number.isFinite(v) && v > 0) adminFloor = Math.min(60000, v);
      }
      // 用户在面板上选的档位；未选则用标准档默认值。
      const preset = (_speedIntervalMs != null) ? _speedIntervalMs : SPEED_PRESETS[SPEED_PRESET_DEFAULT];
      return Math.min(60000, Math.max(adminFloor, preset));
    },
    // 设置用户速率档位（gentle / standard / turbo）。返回是否成功。
    setSpeedPreset(name) {
      if (Object.prototype.hasOwnProperty.call(SPEED_PRESETS, name)) {
        _speedIntervalMs = SPEED_PRESETS[name];
        return true;
      }
      return false;
    },
    // 当前生效档位名（用于 UI 高亮 / 持久化）。
    currentSpeedPreset() {
      const ms = (_speedIntervalMs != null) ? _speedIntervalMs : SPEED_PRESETS[SPEED_PRESET_DEFAULT];
      for (const k of Object.keys(SPEED_PRESETS)) if (SPEED_PRESETS[k] === ms) return k;
      return SPEED_PRESET_DEFAULT;
    },
    speedPresets() { return Object.assign({}, SPEED_PRESETS); },
    // 在发起单次查询请求前调用，按管理员配置的间隔串行节流；0 表示不限速。
    // 等待时与一个 abort 信号 race：cancelThrottle() 触发后，所有排队中的等待
    // 立即落地，整条 chain 被一次性"解锁"。
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
    // 一次性释放整条节流等待链。用于"停止"或"重置"时让 state.running 能立刻收尾。
    cancelThrottle() {
      try { if (_throttleAbort.resolve) _throttleAbort.resolve(); } catch (_) {}
      _newThrottleAbortGate();
      _throttleChain = Promise.resolve();
    },
    quotaInfo() {
      if (!_lastPolicy) return { quota: 0, used: 0, remaining: Infinity, unlimited: true };
      const quota = Number(_lastPolicy.daily_quota) || 0;
      const used = Number(_lastPolicy.used_today) || 0;
      if (!quota) return { quota: 0, used, remaining: Infinity, unlimited: true };
      return { quota, used, remaining: Math.max(0, quota - used), unlimited: false };
    },
    assertQuotaForBatch(additional) {
      const q = License.quotaInfo();
      if (q.unlimited) return true;
      if (Number(additional || 0) > q.remaining) {
        throw new Error('已超出今日查询配额：今日已查 ' + q.used + ' / ' + q.quota + '，剩余 ' + q.remaining + '。请明天再来或联系管理员调高配额。');
      }
      return true;
    },

    async fetchRuntimeConfig() {
      if (!_ctx.erp) throw new Error('not_handshaked');
      const deviceId = await getOrCreateDeviceId();
      return callSigned('/api/runtime-config', {
        erp: _ctx.erp, version: _ctx.version, device_id: deviceId
      });
    },

    async reportBatch(stats) {
      if (!_ctx.erp) return;
      try {
        await call('/api/events', Object.assign({
          erp: _ctx.erp,
          type: 'batch',
          version: _ctx.version
        }, stats || {}));
      } catch (_) {}
    },

    async fetchNotifications() {
      if (!_ctx.erp) return [];
      try {
        const parsed = await call('/api/notifications', { erp: _ctx.erp });
        if (!parsed || parsed.ok !== true || !Array.isArray(parsed.notices)) return [];
        return parsed.notices;
      } catch (_) { return []; }
    },

    lastPolicy() { return _lastPolicy; },
    ctx() { return Object.assign({}, _ctx); }
  });

  // 用 defineProperty 把 License 锁住，禁止后续整体替换
  try {
    Object.defineProperty(A, 'License', {
      value: License,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (_) { A.License = License; }
})(window.SmsApp);
