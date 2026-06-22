'use strict';
(function (A) {
  const C = A.constants;
  const T = A.Text;
  const D = A.Dates;
  const SmsService = {
    cacheKey(phone, window) {
      const s = window && window.start ? window.start.getTime() : '';
      const e = window && window.end ? window.end.getTime() : '';
      return 'sms|' + phone + '|' + s + '|' + e;
    },
    fmt(d) { return D.formatDateTimeSeconds(d); },
    async queryOnce(mobileNum, startTime, endTime, pageNo, pageSize) {
      const body = JSON.stringify({ mobileNum, startTime, endTime, keyword: '', senderSource: 0, pageNo, pageSize });
      return A.Async.withRetry(async () => {
        const res = await fetch(C.SMS_QUERY_URL, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Accept': 'application/json, text/plain, */*' },
          body
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch (_e) {
          if (/登录|login|passport/i.test(text)) throw new Error('sms.jd.com 登录态失效，请先登录');
          throw new Error('返回内容无法解析为 JSON');
        }
        if (json && json.success === false) throw new Error(json.message || 'SMS 接口失败');
        return (json && json.result) ? json.result : { records: [], total: 0 };
      });
    },
    async queryAllPages(phone, window) {
      const matches = [];
      const startStr = SmsService.fmt(window.start);
      const endStr = SmsService.fmt(window.end);
      const cutoff = window.start.getTime();
      const nowMs = window.end.getTime();
      for (let page = 1; page <= C.SMS_QUERY_MAX_PAGES; page++) {
        if (A.state.stopped) break;
        const payload = await SmsService.queryOnce(phone, startStr, endStr, page, C.SMS_QUERY_PAGE_SIZE);
        const records = Array.isArray(payload && payload.records) ? payload.records : [];
        let oldest = Infinity;
        for (const item of records) {
          if (!A.Matcher.isTargetSms(item)) continue;
          const t = T.clean(item.receiptArrivedTime || item.sendTime);
          const ms = A.Dates.parseLoose(t);
          if (!ms) continue;
          oldest = Math.min(oldest, ms);
          if (!A.Matcher.inWindow(ms, window)) continue;
          matches.push(item);
        }
        const total = Number((payload && payload.total) || 0);
        const isLast = records.length < C.SMS_QUERY_PAGE_SIZE;
        if (isLast) break;
        if (total > 0 && page * C.SMS_QUERY_PAGE_SIZE >= total) break;
        if (oldest !== Infinity && oldest < cutoff) break;
        await A.Async.yieldToBrowser();
      }
      return matches;
    },
    async queryAllPagesCached(phone, window) {
      if (!A.state.smsQueryCache) A.state.smsQueryCache = new Map();
      const key = SmsService.cacheKey(phone, window);
      if (A.state.smsQueryCache.has(key)) return A.state.smsQueryCache.get(key);
      const p = SmsService.queryAllPages(phone, window);
      A.state.smsQueryCache.set(key, p);
      return p;
    }
  };
  A.SmsService = SmsService;
})(window.SmsApp);
