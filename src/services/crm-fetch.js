'use strict';
(function (A) {
  const T = A.Text;
  const C = A.constants;
  const CrmFetch = {
    paramsFromUrlAndDoc(url, doc) {
      const params = {};
      for (const [k, v] of url.searchParams.entries()) params[k] = v;
      const keys = ['flag', 'parDeptId', 'curDeptId', 'userPin', 'master', 'funName', 'caseType', 'closeBeg', 'closeEnd', 'beginTimeStr', 'remindBizType'];
      const scripts = Array.from(doc.scripts || []).map(s => s.textContent || '').join('\n');
      for (const k of keys) {
        if (params[k] !== undefined) continue;
        const re = new RegExp(k + "\\s*:\\s*[\"']([^\"']*)[\"']");
        const m = scripts.match(re);
        params[k] = m ? m[1] : '';
      }
      return params;
    },
    async fetchPage(params, pageNumber, pageSize, baseOrigin) {
      const url = new URL('/monitor/monitorCaseInfo/monitorCommon', baseOrigin || location.origin);
      url.searchParams.set('pageNumber', String(pageNumber));
      url.searchParams.set('pageSize', String(pageSize));
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(params || {})) body.append(k, v == null ? '' : String(v));
      body.set('pageNumber', String(pageNumber));
      body.set('pageSize', String(pageSize));
      return A.Http.requestText(url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html, */*; q=0.01' },
        body: body.toString(),
        errorPrefix: '读取分页失败'
      });
    },
    async loadAll(detailUrl, onProgress) {
      const detail = new URL(detailUrl, location.href);
      const html = await A.Http.requestText(detail.href, { method: 'GET', errorPrefix: '读取CRM详情页失败' });
      const detailDoc = new DOMParser().parseFromString(html, 'text/html');
      const params = CrmFetch.paramsFromUrlAndDoc(detail, detailDoc);
      const configuredPageSize = A.CrmParse.preferredPageSizeFromDoc(detailDoc);
      let firstDoc = detailDoc;
      let firstTable = A.CrmParse.findDataTable(firstDoc);
      let firstParsed = firstTable ? A.CrmParse.tableObjects(firstTable) : { headers: [], rows: [] };
      let total = A.CrmParse.totalCountFromDoc(firstDoc);
      let pageSize = A.CrmParse.pageSizeFromDoc(firstDoc) || configuredPageSize;
      if (!firstParsed.rows.length || !A.CrmParse.hasRequiredHeader(firstParsed.headers)) {
        pageSize = configuredPageSize;
        onProgress && onProgress(1, 1, total);
        const firstHtml = await CrmFetch.fetchPage(params, 1, pageSize, detail.origin);
        firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');
        firstTable = A.CrmParse.findDataTable(firstDoc);
        if (!firstTable) throw new Error('CRM数据接口返回中未找到可识别的数据表格');
        firstParsed = A.CrmParse.tableObjects(firstTable);
        total = A.CrmParse.totalCountFromDoc(firstDoc) || total || firstParsed.rows.length;
        pageSize = A.CrmParse.pageSizeFromDoc(firstDoc) || pageSize || firstParsed.rows.length || 100;
      }
      total = total || firstParsed.rows.length;
      pageSize = Math.max(1, pageSize || configuredPageSize || 100);
      const pages = Math.max(1, Math.ceil(total / pageSize));
      if (pages <= 1 && firstParsed.rows.length >= total) return A.CrmParse.dedupeByEvent(firstParsed);
      const limiter = A.Async.createLimiter(C.CRM_PAGE_CONCURRENCY);
      let done = 1;
      onProgress && onProgress(done, pages, total);
      const restPromises = [];
      for (let page = 2; page <= pages; page++) {
        const p = page;
        restPromises.push(limiter(async () => {
          const pageHtml = await CrmFetch.fetchPage(params, p, pageSize, detail.origin);
          const pageDoc = new DOMParser().parseFromString(pageHtml, 'text/html');
          const table = A.CrmParse.findDataTable(pageDoc);
          if (!table) throw new Error('CRM第 ' + p + ' 页返回中未找到可识别的数据表格');
          const parsed = A.CrmParse.tableObjects(table);
          done++;
          onProgress && onProgress(done, pages, total);
          return { page: p, parsed };
        }));
      }
      const restResults = await Promise.all(restPromises);
      restResults.sort((a, b) => a.page - b.page);
      let headers = firstParsed.headers;
      const allRows = [].concat(firstParsed.rows);
      for (const { parsed } of restResults) {
        headers = parsed.headers.length ? parsed.headers : headers;
        for (const r of parsed.rows) allRows.push(r);
      }
      return A.CrmParse.dedupeByEvent({ headers, rows: allRows });
    }
  };
  A.CrmFetch = CrmFetch;
})(window.SmsApp);
