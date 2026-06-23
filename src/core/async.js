'use strict';
(function (A) {
  const Async = {
    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    nextAnimationFrame() {
      return new Promise(r => (window.requestAnimationFrame || (cb => setTimeout(cb, 16)))(() => r()));
    },
    yieldToBrowser() { return Async.nextAnimationFrame(); },
    createLimiter(limit) {
      const max = Math.max(1, Number(limit) || 1);
      let active = 0;
      const queue = [];
      const next = () => {
        if (active >= max || !queue.length) return;
        const it = queue.shift();
        active++;
        Promise.resolve().then(it.fn).then(it.resolve, it.reject).finally(() => { active--; next(); });
      };
      return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
    },
    isRetriable(err) {
      const msg = String(err && err.message ? err.message : err || '');
      if (A.Runtime && A.Runtime.isInvalidatedText(msg)) return false;
      if (/HTTP\s*5\d{2}/.test(msg)) return true;
      // MV3 后台 service worker 被中途回收时 chrome 抛的瞬时错误：
      // 重试会重新唤醒后台并成功，因此视为可重试。
      if (/message channel closed|before a response was received|asynchronous response by returning true/i.test(msg)) return true;
      return /abort|timed?\s*out|timeout|network|failed to fetch|ERR_|ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN/i.test(msg);
    },
    async withRetry(fn, opts) {
      const o = Object.assign({ retries: 2, baseDelayMs: 300, isRetriable: Async.isRetriable }, opts || {});
      let last;
      for (let attempt = 0; attempt <= o.retries; attempt++) {
        // ignoreStopped：控制面请求（握手/心跳/订阅/上报）不受批量"停止"影响，
        // 否则用户一停批量，实时通道与心跳就被一起掐断。
        if (!o.ignoreStopped && A.state && A.state.stopped) throw last || new Error('已停止');
        try { return await fn(attempt); } catch (e) {
          last = e;
          if (attempt === o.retries || !o.isRetriable(e)) throw e;
          await Async.sleep(o.baseDelayMs * Math.pow(3, attempt) + Math.floor(Math.random() * 150));
        }
      }
      throw last;
    },
    async runConcurrent(items, limit, worker) {
      const list = Array.isArray(items) ? items : [];
      const max = Math.max(1, Number(limit) || 1);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(max, list.length) }, async () => {
        while (!(A.state && A.state.stopped)) {
          const i = cursor++;
          if (i >= list.length) break;
          await worker(list[i], i);
        }
      });
      await Promise.all(workers);
    }
  };
  A.Async = Async;
})(window.SmsApp);
