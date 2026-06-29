'use strict';
(function (A) {
  const URL_USER_ERP = 'https://sms.jd.com/common/getUserErp.html';
  let cached = null;
  const UserService = {
    async fetchErp() {
      if (cached) return cached;
      try {
        const text = await A.Http.requestText(URL_USER_ERP, {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json, text/plain, */*' },
          errorPrefix: '读取用户ERP失败'
        });
        const json = JSON.parse(text);
        const erp = A.Text.clean(json && json.erp);
        const exist = Boolean(json && json.exist);
        cached = { erp, exist, raw: json };
        return cached;
      } catch (_e) {
        return { erp: '', exist: false, raw: null };
      }
    },
    greetingByHour(hour) {
      const h = Number(hour);
      if (!Number.isFinite(h)) return '你好';
      if (h >= 5 && h < 9) return '早上好';
      if (h >= 9 && h < 12) return '上午好';
      if (h >= 12 && h < 13) return '中午好';
      if (h >= 13 && h < 18) return '下午好';
      if (h >= 18 && h < 23) return '晚上好';
      return '夜深了';
    },
    greetingNow() { return UserService.greetingByHour(new Date().getHours()); }
  };
  A.UserService = UserService;
})(window.SmsApp);
