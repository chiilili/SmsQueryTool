'use strict';
(function (A) {
  const C = A.constants;
  const Matcher = {
    timeWindow() {
      const now = new Date();
      const start = new Date(now.getTime() - C.SMS_QUERY_WINDOW_DAYS * 86400000);
      return { start, end: now };
    },
    isTargetSms(item) {
      if (!item) return false;
      if (Number(item.senderId) !== C.SMS_TARGET_SENDER_ID) return false;
      const content = String(item.smsContent || '');
      return C.SMS_CONTENT_KEYWORDS.every(k => content.includes(k));
    },
    inWindow(timestampMs, window) {
      return timestampMs >= window.start.getTime() && timestampMs <= window.end.getTime();
    }
  };
  A.Matcher = Matcher;
})(window.SmsApp);
