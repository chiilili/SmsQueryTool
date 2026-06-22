'use strict';
(function (A) {
  const C = A.constants;
  A.state = null;
  A.host = null;
  A.root = null;
  A.els = null;
  A.originalPageCache = null;
  A.State = {
    createInitial() {
      return {
        rows: [],
        headers: [],
        results: [],
        autoDetected: null,
        sourceContext: null,
        crmData: null,
        crmDateRangeMode: C.CRM_DATE_RANGE_TODAY,
        smsQueryCache: new Map(),
        phoneCache: new Map(),
        appMode: false,
        statsRenderScheduled: false,
        running: false,
        stopped: false,
        stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 },
        resultRenderQueue: [],
        resultRenderScheduled: false,
        columnFilters: {},
        filterPopoverCol: null,
        filterPopoverSelected: null,
        filterPopoverEntries: null
      };
    }
  };
})(window.SmsApp);
