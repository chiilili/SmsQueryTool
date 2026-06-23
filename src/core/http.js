'use strict';
(function (A) {
  const Http = {
    credentialsFor(url) {
      const t = url instanceof URL ? url : new URL(url, location.href);
      if (t.hostname === 'storage.360buyimg.com') return 'omit';
      return 'include';
    },
    normalizeCredentials(v, fb) { return ['include', 'omit', 'same-origin'].includes(v) ? v : (fb || 'include'); },
    async requestText(url, options) {
      const opts = options || {};
      const target = new URL(url, location.href);
      const method = String(opts.method || 'GET').toUpperCase();
      const headers = opts.headers || undefined;
      const body = opts.body || undefined;
      const credentials = Http.normalizeCredentials(opts.credentials, Http.credentialsFor(target));
      const timeoutMs = Number(opts.timeoutMs || 30000);
      const errorPrefix = opts.errorPrefix || '请求失败';
      const retryOpts = { ignoreStopped: !!opts.ignoreStopped };
      const viaBackground = target.origin !== location.origin;
      if (viaBackground) {
        return A.Async.withRetry(async () => {
          const resp = await A.Runtime.sendMessageSafe({
            type: 'JD_SMS_TOOL_FETCH_TEXT',
            url: target.href,
            options: { method, headers, body, credentials, timeoutMs }
          }, timeoutMs);
          if (!resp || !resp.ok) throw new Error((resp && resp.error) || (errorPrefix + ': HTTP ' + ((resp && resp.status) || 'unknown')));
          return resp.text || '';
        }, retryOpts);
      }
      return A.Async.withRetry(async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), Math.min(Math.max(timeoutMs, 1000), 120000));
        try {
          const res = await fetch(target.href, { method, credentials, headers, body, signal: ctrl.signal });
          if (!res.ok) throw new Error(errorPrefix + ': HTTP ' + res.status);
          return await res.text();
        } finally { clearTimeout(timer); }
      }, retryOpts);
    }
  };
  A.Http = Http;
})(window.SmsApp);
