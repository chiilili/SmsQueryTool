'use strict';
(function (A) {
  const C = A.constants;
  const D = A.Dates;
  const CrmRange = {
    info(mode, now) {
      const ref = now || new Date();
      const todayStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
      const normalized = mode === C.CRM_DATE_RANGE_YESTERDAY_TODAY ? C.CRM_DATE_RANGE_YESTERDAY_TODAY : C.CRM_DATE_RANGE_TODAY;
      const begin = normalized === C.CRM_DATE_RANGE_YESTERDAY_TODAY ? D.addDays(todayStart, -1) : todayStart;
      const todayText = D.formatDateOnly(todayStart);
      const beginText = D.formatDateOnly(begin);
      const label = normalized === C.CRM_DATE_RANGE_YESTERDAY_TODAY ? (beginText + ' 至 ' + todayText) : todayText;
      return {
        mode: normalized,
        begin,
        today: todayStart,
        beginDateText: beginText,
        todayDateText: todayText,
        beginTimeStr: D.formatDateTimeSeconds(begin),
        label,
        shortLabel: label,
        optionLabel: label,
        statusDateText: label
      };
    },
    selected() {
      const A2 = window.SmsApp;
      const mode = (A2.els && A2.els.crmDateRange && A2.els.crmDateRange.value)
        || (A2.state && A2.state.crmDateRangeMode)
        || C.CRM_DATE_RANGE_TODAY;
      const info = CrmRange.info(mode);
      if (A2.state) A2.state.crmDateRangeMode = info.mode;
      return info;
    }
  };
  A.CrmRange = CrmRange;
})(window.SmsApp);
