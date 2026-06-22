'use strict';
(function (A) {
  // ---- 自定义 CRM 来源的本地持久化 ----
  const SAVED_KEY = 'jd_sms_saved_crm_sources';
  const MAX_SAVED = 50;
  function storageGet(key) {
    return new Promise(resolve => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([key], r => resolve(r ? r[key] : undefined));
        } else resolve(undefined);
      } catch (_) { resolve(undefined); }
    });
  }
  function storageSet(key, val) {
    return new Promise(resolve => {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [key]: val }, () => resolve(true));
        } else resolve(false);
      } catch (_) { resolve(false); }
    });
  }
  function genId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  const CrmCtl = {
    // 校验自定义来源URL（不抛异常版，供保存前校验用）。
    validateCustomUrl(raw) {
      const s = String(raw || '').trim();
      if (!s) return { ok: false, error: '请先填写来源URL。' };
      let url;
      try { url = new URL(s, 'https://crm.jd.com'); }
      catch (_) { return { ok: false, error: '自定义数据来源URL格式不正确。' }; }
      if (!/^https?:$/.test(url.protocol) || !/crm\.jd\.com$/i.test(url.hostname)) {
        return { ok: false, error: '自定义数据来源URL必须来自 crm.jd.com。' };
      }
      const parDeptId = A.CrmDiscover.extractParDeptIdFromUrl(url.href);
      if (!parDeptId) return { ok: false, error: 'URL中未找到 parDeptId/deptId，请检查是否为有效的CRM数据来源URL。' };
      return { ok: true, parDeptId, href: url.href };
    },
    // 读取全部已保存来源（数组，按保存顺序）。
    async listSavedSources() {
      const arr = await storageGet(SAVED_KEY);
      return Array.isArray(arr) ? arr : [];
    },
    // 保存（同名覆盖URL；新名新增）。返回 { item } 或 { error }。
    async saveSource(name, url) {
      const nm = String(name || '').trim().slice(0, 40);
      if (!nm) return { error: '请先给这个来源起个名字。' };
      const v = CrmCtl.validateCustomUrl(url);
      if (!v.ok) return { error: v.error };
      const arr = await CrmCtl.listSavedSources();
      const now = Date.now();
      const existing = arr.find(s => s.name === nm);
      let item;
      if (existing) {
        existing.url = v.href; existing.updatedAt = now;
        item = existing;
      } else {
        if (arr.length >= MAX_SAVED) return { error: '已保存来源已达上限（' + MAX_SAVED + ' 个），请先删除一些。' };
        item = { id: genId(), name: nm, url: v.href, createdAt: now };
        arr.push(item);
      }
      const ok = await storageSet(SAVED_KEY, arr);
      return ok ? { item } : { error: '本地存储不可用，保存失败。' };
    },
    async removeSavedSource(id) {
      const arr = await CrmCtl.listSavedSources();
      const next = arr.filter(s => s.id !== id);
      if (next.length === arr.length) return false;
      return storageSet(SAVED_KEY, next);
    },
    // 重新填充「已存来源」下拉。selectId 可选：填充后选中该项。
    async refreshSavedSelect(selectId) {
      const sel = A.els && A.els.savedCrmSelect;
      if (!sel) return;
      const arr = await CrmCtl.listSavedSources();
      sel.innerHTML = '<option value="">—— 选择已保存的来源 ——</option>';
      for (const s of arr) {
        const o = document.createElement('option');
        o.value = s.id; o.textContent = s.name;
        if (selectId && s.id === selectId) o.selected = true;
        sel.appendChild(o);
      }
      if (A.els.deleteCrmBtn) A.els.deleteCrmBtn.disabled = !sel.value;
    },
    currentChannel() {
      const v = A.els && A.els.sourceChannel && A.els.sourceChannel.value;
      return v === 'custom' ? 'custom' : 'crm';
    },
    resolveCustomDetailUrl(rangeInfo) {
      const raw = ((A.els && A.els.customSourceUrl && A.els.customSourceUrl.value) || '').trim();
      if (!raw) throw new Error('请填写自定义数据来源URL。');
      let url;
      try { url = new URL(raw, 'https://crm.jd.com'); }
      catch (_) { throw new Error('自定义数据来源URL格式不正确。'); }
      if (!/^https?:$/.test(url.protocol) || !/crm\.jd\.com$/i.test(url.hostname)) {
        throw new Error('自定义数据来源URL必须来自 crm.jd.com。');
      }
      const parDeptId = A.CrmDiscover.extractParDeptIdFromUrl(url.href);
      if (!parDeptId) throw new Error('URL中未找到 parDeptId/deptId，请检查是否为有效的CRM数据来源URL。');
      const normalized = A.CrmDiscover.normalizeDetailUrl(url.href, rangeInfo.beginTimeStr);
      return { url: normalized, label: '自定义来源 - ' + parDeptId, parDeptId };
    },
    async load() {
      // 新的用户操作：清掉上一轮停止/重置遗留的 stopped 标记，
      // 否则 Async.withRetry 会立刻抛 "已停止"。和 Batch.run() 进入时的处理一致。
      A.state.stopped = false;
      A.els.loadCrmBtn.disabled = true;
      A.els.loadCrmBtn.classList.add('btn-loading');
      A.els.loadCrmBtn.textContent = '读取中';
      if (A.els.crmDateRange) A.els.crmDateRange.disabled = true;
      if (A.els.sourceChannel) A.els.sourceChannel.disabled = true;
      if (A.els.customSourceUrl) A.els.customSourceUrl.disabled = true;
      A.els.startBtn.disabled = true;
      A.els.exportBtn.disabled = true;
      const rangeInfo = A.CrmRange.selected();
      const channel = CrmCtl.currentChannel();
      const sourceLabel = channel === 'custom' ? '自定义来源' : 'CRM';
      const pending = '正在读取 ' + sourceLabel + '（' + rangeInfo.optionLabel + '），请耐心等待…';
      A.els.log.textContent = pending;
      A.els.detectStatus.textContent = pending;
      A.els.detectStatus.classList.add('loading');
      try {
        const detailInfo = channel === 'custom'
          ? CrmCtl.resolveCustomDetailUrl(rangeInfo)
          : await A.CrmResolve.resolveDetailUrl(rangeInfo);
        const detailUrl = A.CrmDiscover.normalizeDetailUrl(detailInfo.url, rangeInfo.beginTimeStr);
        const detail = new URL(detailUrl, location.href);
        const fallbackLabel = channel === 'custom' ? '自定义来源' : '当前CRM组';
        const label = detailInfo.label || fallbackLabel;
        const dateText = CrmCtl.describeDateFromUrl(detail, rangeInfo);
        A.View.log('读取中：' + dateText);
        const data = await A.CrmFetch.loadAll(detailUrl, (p, pages, t) => {
          const text = pages > 1 ? ('读取中：' + dateText + '｜' + p + '/' + pages) : ('读取中：' + dateText);
          A.View.log(text);
          A.els.detectStatus.textContent = text;
        });
        const filtered = CrmCtl.filterCreators(data.rows);
        const trackerCol = A.Columns.detect(data.headers, A.constants.TRACKER_COL_CANDIDATES);
        const rows = filtered.rows.map(row => {
          const copy = Object.assign({}, row);
          const raw = trackerCol ? A.Text.clean(row[trackerCol]) : '';
          copy.__trackerRaw = raw;
          copy.__trackerName = raw ? A.Tracker.extractChineseName(raw) : '';
          copy.__trackerErp = raw ? A.Tracker.extractErp(raw) : '';
          return copy;
        });
        A.state.crmData = {
          label, url: detailUrl, dateText,
          headers: data.headers, rows,
          ignored: filtered.ignored, trackerCol,
          dateRangeMode: rangeInfo.mode,
          beginTimeStr: rangeInfo.beginTimeStr,
          parDeptId: detail.searchParams.get('parDeptId') || detailInfo.parDeptId || ''
        };
        A.View.fillCrmPersonSelect(A.state.crmData);
        A.View.applyCrmPersonSelection();
        A.View.log(dateText + '｜可查询 ' + rows.length + ' 条');
      } finally {
        A.els.loadCrmBtn.disabled = false;
        A.els.loadCrmBtn.classList.remove('btn-loading');
        A.els.loadCrmBtn.textContent = '获取数据';
        A.els.detectStatus.classList.remove('loading');
        if (A.els.crmDateRange) A.els.crmDateRange.disabled = false;
        if (A.els.sourceChannel) A.els.sourceChannel.disabled = A.state.running;
        if (A.els.customSourceUrl) A.els.customSourceUrl.disabled = A.state.running;
      }
    },
    filterCreators(rows) {
      const kept = [];
      let ignored = 0;
      for (const row of (rows || [])) {
        const c = A.CreatorRules.valueByCandidates(row, A.constants.CREATOR_COL_CANDIDATES);
        if (A.CreatorRules.shouldIgnore(c)) ignored++;
        else kept.push(row);
      }
      return { rows: kept, ignored };
    },
    describeDateFromUrl(url, rangeInfo) {
      if (rangeInfo && rangeInfo.statusDateText) return rangeInfo.statusDateText;
      const begin = url.searchParams.get('beginTimeStr') || '';
      const m = begin.match(/\d{4}-\d{2}-\d{2}/);
      return m ? m[0] : '按URL时间范围';
    }
  };
  A.CrmCtl = CrmCtl;
})(window.SmsApp);
