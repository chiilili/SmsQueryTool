'use strict';
(function (A) {
  const T = A.Text;
  const Tracker = {
    extractChineseName(value) {
      const s = T.clean(value);
      if (!s) return '';
      const parts = s.split(/[-—_]/).map(x => T.clean(x)).filter(Boolean);
      const tail = parts.length > 1 ? parts[parts.length - 1] : s;
      const ch = tail.match(/[一-龥·]{2,}/g);
      if (ch && ch.length) return ch.join('');
      const any = s.match(/[一-龥·]{2,}/g);
      return any && any.length ? any.join('') : '';
    },
    extractErp(value) {
      const s = T.clean(value);
      if (!s) return '';
      const parts = s.split(/[-—_]/).map(x => T.clean(x)).filter(Boolean);
      for (const p of parts) if (/^[A-Za-z][A-Za-z0-9_.]*$/.test(p)) return p;
      return parts[0] || '';
    },
    nameOf(row) {
      const cached = T.clean(row && row.__trackerName);
      if (cached) return Tracker.extractChineseName(cached);
      const raw = A.CreatorRules.valueByCandidates(row, A.constants.TRACKER_COL_CANDIDATES);
      return Tracker.extractChineseName(raw);
    },
    erpOf(row) {
      const rawCached = T.clean(row && row.__trackerRaw);
      if (rawCached) return Tracker.extractErp(rawCached);
      const raw = A.CreatorRules.valueByCandidates(row, A.constants.TRACKER_COL_CANDIDATES);
      return Tracker.extractErp(raw);
    }
  };
  A.Tracker = Tracker;
})(window.SmsApp);
