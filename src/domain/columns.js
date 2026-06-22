'use strict';
(function (A) {
  const T = A.Text;
  const Columns = {
    detect(headers, candidates) {
      const normalized = (headers || []).map(h => ({ raw: h, text: T.normalize(h).toLowerCase() }));
      for (const c of candidates) {
        const n = T.normalize(c).toLowerCase();
        const exact = normalized.find(h => h.text === n);
        if (exact) return exact.raw;
      }
      for (const c of candidates) {
        const n = T.normalize(c).toLowerCase();
        const fuzzy = normalized.find(h => h.text.includes(n) || n.includes(h.text));
        if (fuzzy) return fuzzy.raw;
      }
      return '';
    }
  };
  A.Columns = Columns;
})(window.SmsApp);
