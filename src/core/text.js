'use strict';
(function (A) {
  const Text = {
    clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); },
    normalize(v) { return String(v == null ? '' : v).replace(/[\s:_\-—（）()【】\[\]{}\.。]+/g, '').trim(); },
    unique(arr) { return Array.from(new Set((arr || []).map(x => Text.clean(x)).filter(Boolean))); },
    escapeHtml(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); },
    escapeRegExp(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },
    decodeHtmlAttr(v) {
      const t = document.createElement('textarea');
      t.innerHTML = String(v || '');
      return t.value;
    }
  };
  const Dates = {
    pad2(n) { return String(n).padStart(2, '0'); },
    formatDateOnly(d) {
      return d.getFullYear() + '-' + Dates.pad2(d.getMonth() + 1) + '-' + Dates.pad2(d.getDate());
    },
    formatDateTimeSeconds(d) {
      return Dates.formatDateOnly(d) + ' ' + Dates.pad2(d.getHours()) + ':' + Dates.pad2(d.getMinutes()) + ':' + Dates.pad2(d.getSeconds());
    },
    formatDateForFile(d) {
      return d.getFullYear() + Dates.pad2(d.getMonth() + 1) + Dates.pad2(d.getDate()) + '_' + Dates.pad2(d.getHours()) + Dates.pad2(d.getMinutes()) + Dates.pad2(d.getSeconds());
    },
    startOfToday() {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0, 0);
    },
    addDays(d, n) { const o = new Date(d); o.setDate(o.getDate() + n); return o; },
    parseLoose(v) {
      const s = Text.clean(v);
      if (!s) return 0;
      const m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
      if (m) {
        const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
        return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
      }
      const dt = new Date(s.replace(/-/g, '/'));
      return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
    }
  };
  A.Text = Text;
  A.Dates = Dates;
  A.clean = Text.clean;
})(window.SmsApp);
