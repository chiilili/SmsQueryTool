'use strict';
(function (A) {
  const T = A.Text;
  const View = {
    log(msg) { if (A.els && A.els.log) A.els.log.textContent = T.clean(msg || ''); },
    renderRuntimeTitle() {
      if (!A.els || !A.els.runtimeTitle) return;
      let name = 'SmsQueryTool';
      let version = '';
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
          const m = chrome.runtime.getManifest() || {};
          name = T.clean(m.name || name);
          version = T.clean(m.version || '');
        }
      } catch (_) { name = 'SmsQueryTool'; }
      A.els.runtimeTitle.textContent = name + (version ? ' v' + version : '') + '｜运行环境：Manifest V3';
    },
    resetStats() { A.state.stats = { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 }; View.renderStats(); },
    renderStats(immediate) {
      if (!A.state || !A.els) return;
      if (A.state.running && !immediate) {
        if (A.state.statsRenderScheduled) return;
        A.state.statsRenderScheduled = true;
        const raf = window.requestAnimationFrame || (cb => setTimeout(cb, 16));
        raf(() => { A.state.statsRenderScheduled = false; View.renderStats(true); });
        return;
      }
      A.els.sTotal.textContent = A.state.stats.total;
      A.els.sDone.textContent = A.state.stats.done;
      A.els.sHit.textContent = A.state.stats.hit;
      A.els.sNoHit.textContent = A.state.stats.noHit;
      A.els.sError.textContent = A.state.stats.error;
      A.els.sSkipped.textContent = A.state.stats.skipped;
      const pct = A.state.stats.total ? Math.round((A.state.stats.done + A.state.stats.skipped) * 100 / A.state.stats.total) : 0;
      A.els.bar.style.width = Math.min(100, pct) + '%';
    },
    renderColumns() {
      const fill = (select, selected) => {
        select.innerHTML = '';
        for (const h of A.state.headers) {
          const o = document.createElement('option');
          o.value = h; o.textContent = h;
          if (h === selected) o.selected = true;
          select.appendChild(o);
        }
      };
      const C = A.constants;
      const acctPrimary = A.Columns.detect(A.state.headers, C.ACCOUNT_COL_CANDIDATES);
      const acctFallback = acctPrimary || A.Columns.detect(A.state.headers, ['事件线索', '订单账号', '订单用户']);
      const ec = A.Columns.detect(A.state.headers, C.EVENT_COL_CANDIDATES);
      const account = acctFallback || A.state.headers[0] || '';
      const event = ec || A.state.headers[0] || '';
      fill(A.els.accountCol, account);
      fill(A.els.eventCol, event);
      const autoOk = Boolean(acctPrimary && ec);
      A.state.autoDetected = { autoOk, accountCol: account, eventCol: event };
      if (autoOk) A.els.detectStatus.textContent = '已自动识别：客户账户列「' + acctPrimary + '」，事件号列「' + ec + '」。';
      else A.els.detectStatus.textContent = '未能识别' + ([acctPrimary ? '' : '客户账户', ec ? '' : '事件号'].filter(Boolean).join('、') || '必要') + '列，请检查数据来源。';
    },
    fillCrmPersonSelect(data) {
      const counts = new Map();
      for (const row of data.rows) {
        const name = T.clean(row.__trackerName);
        if (!name) continue;
        counts.set(name, (counts.get(name) || 0) + 1);
      }
      A.els.crmPersonSelect.innerHTML = '';
      const group = document.createElement('option');
      group.value = A.constants.CRM_GROUP_ALL;
      group.textContent = '整组 - ' + data.label + '（' + data.rows.length + '条）';
      A.els.crmPersonSelect.appendChild(group);
      Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN')).forEach(([name, cnt]) => {
        const o = document.createElement('option');
        o.value = name; o.textContent = name + '（' + cnt + '条）';
        A.els.crmPersonSelect.appendChild(o);
      });
      A.els.crmPersonSelect.disabled = false;
    },
    rowsForSelectedPerson() {
      const data = A.state.crmData;
      if (!data) return A.state.rows || [];
      const sel = A.els.crmPersonSelect.value || A.constants.CRM_GROUP_ALL;
      return sel === A.constants.CRM_GROUP_ALL ? data.rows : data.rows.filter(r => T.clean(r.__trackerName) === sel);
    },
    syncCrmSelectionForRun() {
      if (!A.state.crmData) return;
      const sel = A.els.crmPersonSelect.value || A.constants.CRM_GROUP_ALL;
      const rows = View.rowsForSelectedPerson();
      A.state.rows = rows;
      A.state.headers = A.state.crmData.headers;
      const personText = sel === A.constants.CRM_GROUP_ALL ? ('整组 - ' + A.state.crmData.label) : sel;
      A.state.sourceContext = { mode: 'crm', label: A.state.crmData.label, dateText: A.state.crmData.dateText, personText, count: rows.length };
      View.renderSourceSummary();
    },
    applyCrmPersonSelection() {
      const data = A.state.crmData;
      if (!data) return;
      const sel = A.els.crmPersonSelect.value || A.constants.CRM_GROUP_ALL;
      const rows = sel === A.constants.CRM_GROUP_ALL ? data.rows : data.rows.filter(r => T.clean(r.__trackerName) === sel);
      A.state.rows = rows;
      A.state.headers = data.headers;
      A.state.results = [];
      View.clearResultsView();
      View.resetStats();
      A.state.stats.total = rows.length;
      View.renderStats();
      View.renderColumns();
      const personText = sel === A.constants.CRM_GROUP_ALL ? ('整组 - ' + data.label) : sel;
      A.state.sourceContext = { mode: 'crm', label: data.label, dateText: data.dateText, personText, count: rows.length };
      View.renderSourceSummary();
      A.els.detectStatus.textContent = data.dateText + '｜' + personText + '｜' + rows.length + ' 条';
      A.els.startBtn.disabled = rows.length === 0;
      A.els.exportBtn.disabled = true;
      View.log(personText + '｜' + rows.length + ' 条');
    },
    renderSourceSummary() {
      if (!A.state.sourceContext) { A.els.sourceSummary.textContent = '当前来源：未选择。'; return; }
      A.els.sourceSummary.textContent = '当前来源：' + View.formatSourceContext(A.state.sourceContext);
    },
    formatSourceContext(ctx) { return ctx.dateText + '｜' + ctx.personText + '｜' + ctx.count + ' 条'; },
    updateButtons() {
      A.els.startBtn.disabled = A.state.running || A.state.rows.length === 0;
      A.els.stopBtn.disabled = !A.state.running;
      A.els.loadCrmBtn.disabled = A.state.running;
      A.els.crmPersonSelect.disabled = A.state.running || !A.state.crmData;
      if (A.els.crmDateRange) A.els.crmDateRange.disabled = A.state.running;
      if (A.els.sourceChannel) A.els.sourceChannel.disabled = A.state.running;
      if (A.els.customSourceUrl) A.els.customSourceUrl.disabled = A.state.running;
      if (A.els.savedCrmSelect) A.els.savedCrmSelect.disabled = A.state.running;
      if (A.els.saveCrmBtn) A.els.saveCrmBtn.disabled = A.state.running;
      if (A.els.crmNameInput) A.els.crmNameInput.disabled = A.state.running;
      if (A.els.deleteCrmBtn) A.els.deleteCrmBtn.disabled = A.state.running || !(A.els.savedCrmSelect && A.els.savedCrmSelect.value);
      if (A.els.accountCol) A.els.accountCol.disabled = A.state.running;
      if (A.els.eventCol) A.els.eventCol.disabled = A.state.running;
    },
    // 统一显隐「自定义」渠道的三行（已存来源 / 来源URL / 命名保存）。
    setCustomRowsVisible(show) {
      ['savedCrmRow', 'customUrlRow', 'crmNameRow'].forEach(id => {
        if (A.els[id]) A.els[id].classList.toggle('hidden', !show);
      });
    },
    applySourceChannel() {
      const channel = A.els.sourceChannel && A.els.sourceChannel.value === 'custom' ? 'custom' : 'crm';
      View.setCustomRowsVisible(channel === 'custom');
      if (channel === 'custom' && A.CrmCtl && typeof A.CrmCtl.refreshSavedSelect === 'function') {
        A.CrmCtl.refreshSavedSelect();
      }
      A.state.rows = []; A.state.headers = []; A.state.results = [];
      A.state.crmData = null; A.state.sourceContext = null;
      A.els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
      A.els.crmPersonSelect.disabled = true;
      View.clearResultsView(); View.resetStats(); View.renderSourceSummary();
      A.els.startBtn.disabled = true; A.els.exportBtn.disabled = true;
      const hint = channel === 'custom'
        ? '请填写自定义数据来源URL，然后点击"获取数据"。'
        : '等待读取CRM数据。';
      A.els.detectStatus.textContent = hint;
      View.log(hint);
    },
    resetCrmLoadedForRangeChange() {
      if (!A.state || A.state.running) return;
      const info = A.CrmRange.selected();
      A.state.crmDateRangeMode = info.mode;
      A.state.rows = []; A.state.headers = []; A.state.results = [];
      A.state.crmData = null; A.state.sourceContext = null;
      A.state.smsQueryCache = new Map(); A.state.phoneCache = new Map();
      A.els.accountCol.innerHTML = ''; A.els.eventCol.innerHTML = '';
      A.els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
      A.els.crmPersonSelect.disabled = true;
      View.clearResultsView(); View.resetStats(); View.renderSourceSummary();
      A.els.startBtn.disabled = true; A.els.exportBtn.disabled = true;
      A.els.detectStatus.textContent = '数据日期：' + info.optionLabel;
      View.log('数据日期：' + info.optionLabel);
    },
    initDataSourceControls() {
      A.els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
      A.els.crmPersonSelect.disabled = true;
      if (A.els.crmDateRange) A.els.crmDateRange.value = A.state.crmDateRangeMode || A.constants.CRM_DATE_RANGE_TODAY;
      if (A.els.sourceChannel) A.els.sourceChannel.value = 'crm';
      View.setCustomRowsVisible(false);
      const info = A.CrmRange.selected();
      A.els.detectStatus.textContent = '数据日期：' + info.optionLabel;
    },
    appendResult(item) {
      A.state.results.push(item);
      if (View.rowPassesFilters(item)) {
        A.state.resultRenderQueue.push(View.buildResultRowHtml(item));
        View.scheduleResultFlush();
      }
    },
    rowPassesFilters(item) {
      const f = A.state.columnFilters;
      if (!f) return true;
      for (const k of Object.keys(f)) {
        const s = f[k];
        if (!s) continue;
        if (!s.has(View.getColumnValue(item, k))) return false;
      }
      return true;
    },
    getColumnValue(item, key) { return String(item && item[key] != null ? item[key] : ''); },
    rerenderResultsFromState() {
      if (!A.state || !A.els.resultBody) return;
      A.state.resultRenderQueue = [];
      A.state.resultRenderScheduled = false;
      const htmls = [];
      for (const item of A.state.results) if (View.rowPassesFilters(item)) htmls.push(View.buildResultRowHtml(item));
      A.els.resultBody.innerHTML = htmls.join('');
      View.updateFilterIndicators();
    },
    updateFilterIndicators() {
      if (!A.root) return;
      const f = A.state.columnFilters || {};
      A.root.querySelectorAll('.th-filter').forEach(btn => { btn.classList.toggle('active', f[btn.dataset.colKey] instanceof Set); });
    },
    buildResultRowHtml(item) {
      const s = item.status || '';
      const rowClass = s === '命中' ? 'result-hit' : s === '未命中' ? 'result-nohit' : s === '异常' ? 'result-error' : 'result-skipped';
      const badge = s === '命中' ? 'badge-hit' : s === '未命中' ? 'badge-nohit' : s === '异常' ? 'badge-error' : 'badge-skipped';
      const E = T.escapeHtml;
      return '<tr class="' + rowClass + '">'
        + '<td title="' + E(s) + '"><span class="badge ' + badge + '">' + E(s) + '</span></td>'
        + View.compactCell(item.eventNo || '')
        + View.compactCell(item.trackerName || '')
        + View.compactCell(item.trackerErp || '')
        + View.compactCell(item.account || '')
        + View.compactCell(item.smsSendTime || '')
        + View.compactCell(item.detail || '', '', true)
        + '</tr>';
    },
    compactCell(value, titleSuffix, multiline) {
      const text = String(value == null ? '' : value);
      const title = (text || titleSuffix) ? (' title="' + T.escapeHtml(text + (titleSuffix || '')) + '"') : '';
      const cls = multiline ? 'result-cell result-cell-multiline' : 'result-cell';
      return '<td' + title + '><span class="' + cls + '">' + T.escapeHtml(text) + '</span></td>';
    },
    scheduleResultFlush() {
      if (!A.state || A.state.resultRenderScheduled) return;
      A.state.resultRenderScheduled = true;
      const raf = window.requestAnimationFrame || (cb => setTimeout(cb, 16));
      raf(() => {
        A.state.resultRenderScheduled = false;
        View.flushPending(A.constants.RESULT_RENDER_BATCH_SIZE);
        if (A.state.resultRenderQueue.length) View.scheduleResultFlush();
      });
    },
    flushPending(maxRows) {
      if (!A.state || !A.els.resultBody || !A.state.resultRenderQueue.length) return;
      const rows = A.state.resultRenderQueue.splice(0, maxRows == null ? Infinity : maxRows);
      A.els.resultBody.insertAdjacentHTML('beforeend', rows.join(''));
    },
    flushResultsNow() {
      if (!A.state) return;
      View.flushPending(Infinity);
      A.state.resultRenderScheduled = false;
    },
    clearResultsView() {
      if (A.state) {
        A.state.resultRenderQueue = [];
        A.state.resultRenderScheduled = false;
        A.state.columnFilters = {};
        A.Filter.close();
      }
      if (A.els && A.els.resultBody) A.els.resultBody.textContent = '';
      View.updateFilterIndicators();
    },
    async yieldAfterBatch(counter) {
      if (counter % A.constants.UI_YIELD_EVERY_ROWS !== 0) return;
      View.flushResultsNow();
      await A.Async.yieldToBrowser();
    }
  };
  A.View = View;
})(window.SmsApp);
