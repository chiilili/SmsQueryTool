'use strict';
(function (A) {
  const C = A.constants;
  const T = A.Text;
  const CreatorRules = {
    shouldIgnore(value) {
      const v = T.clean(value);
      if (!v) return false;
      const n = v.toLowerCase();
      if (C.IGNORED_CREATORS.has(n)) return true;
      return Array.from(C.IGNORED_CREATORS).some(x => n.includes(x));
    },
    valueByCandidates(row, candidates) {
      if (!row) return '';
      const headers = Object.keys(row).filter(k => !k.startsWith('__'));
      const col = A.Columns ? A.Columns.detect(headers, candidates) : '';
      return col ? T.clean(row[col]) : '';
    }
  };
  A.CreatorRules = CreatorRules;
})(window.SmsApp);
