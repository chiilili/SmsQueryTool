'use strict';
(function (A) {
  const T = A.Text;
  const COLUMNS = [
    { key: 'status', label: '状态' },
    { key: 'eventNo', label: '事件号' },
    { key: 'trackerName', label: '追踪人' },
    { key: 'trackerErp', label: 'ERP' },
    { key: 'account', label: '客户账户' },
    { key: 'smsSendTime', label: '短信发送时间' }
  ];
  const Filter = {
    columns() { return COLUMNS; },
    open(colKey, anchorBtn) {
      const col = COLUMNS.find(c => c.key === colKey);
      if (!col || !A.els.filterPopover) return;
      const counts = new Map();
      for (const item of A.state.results) {
        const v = A.View.getColumnValue(item, colKey);
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      const entries = Array.from(counts.entries()).sort((a, b) => {
        if (colKey === 'smsSendTime') return a[0].localeCompare(b[0]);
        return a[0].localeCompare(b[0], 'zh-Hans-CN');
      });
      const current = A.state.columnFilters && A.state.columnFilters[colKey];
      A.state.filterPopoverCol = colKey;
      A.state.filterPopoverEntries = entries;
      A.state.filterPopoverSelected = new Set(current instanceof Set ? current : entries.map(e => e[0]));
      A.els.filterPopoverTitle.textContent = '筛选：' + col.label;
      A.els.filterPopoverSearch.value = '';
      Filter.renderList('');
      Filter.position(anchorBtn);
      A.els.filterPopover.classList.remove('hidden');
      A.els.filterPopoverSearch.focus();
    },
    close() {
      if (!A.els || !A.els.filterPopover) return;
      A.els.filterPopover.classList.add('hidden');
      A.state.filterPopoverCol = null;
      A.state.filterPopoverEntries = null;
      A.state.filterPopoverSelected = null;
    },
    renderList(searchText) {
      const list = A.els.filterPopoverList;
      if (!list) return;
      const entries = A.state.filterPopoverEntries || [];
      const s = T.clean(searchText).toLowerCase();
      const filtered = s ? entries.filter(e => e[0].toLowerCase().includes(s)) : entries;
      const sel = A.state.filterPopoverSelected;
      const allChecked = filtered.length > 0 && filtered.every(e => sel.has(e[0]));
      let html = '<label class="filter-item filter-item-all"><input type="checkbox" data-all="1"' + (allChecked ? ' checked' : '') + '><span class="filter-item-text">(全选)</span></label>';
      filtered.forEach(([v, cnt], idx) => {
        const display = v === '' ? '(空白)' : v;
        const checked = sel.has(v) ? ' checked' : '';
        html += '<label class="filter-item" title="' + T.escapeHtml(display) + '"><input type="checkbox" data-idx="' + idx + '"' + checked + '><span class="filter-item-text">' + T.escapeHtml(display) + '</span><span class="filter-item-count">' + cnt + '</span></label>';
      });
      if (!filtered.length) html += '<div class="filter-empty">(无匹配项)</div>';
      list.innerHTML = html;
      list.dataset.filteredKeys = JSON.stringify(filtered.map(e => e[0]));
    },
    currentFilteredValues() {
      const list = A.els.filterPopoverList;
      if (!list || !list.dataset.filteredKeys) return [];
      try { return JSON.parse(list.dataset.filteredKeys); } catch (_) { return []; }
    },
    position(anchor) {
      if (!anchor || !A.els.filterPopover) return;
      const rect = anchor.getBoundingClientRect();
      const p = A.els.filterPopover;
      p.style.visibility = 'hidden';
      p.classList.remove('hidden');
      const pr = p.getBoundingClientRect();
      let left = rect.left;
      if (left + pr.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pr.width - 8);
      let top = rect.bottom + 4;
      if (top + pr.height > window.innerHeight - 8) top = Math.max(8, rect.top - pr.height - 4);
      p.style.left = left + 'px';
      p.style.top = top + 'px';
      p.style.visibility = '';
    },
    apply() {
      const k = A.state.filterPopoverCol;
      if (!k) return;
      if (!A.state.columnFilters) A.state.columnFilters = {};
      const all = (A.state.filterPopoverEntries || []).map(e => e[0]);
      const sel = A.state.filterPopoverSelected;
      if (sel.size === all.length) delete A.state.columnFilters[k];
      else A.state.columnFilters[k] = new Set(sel);
      Filter.close();
      A.View.rerenderResultsFromState();
    },
    clearForCurrent() {
      const k = A.state.filterPopoverCol;
      if (!k) return;
      if (A.state.columnFilters) delete A.state.columnFilters[k];
      Filter.close();
      A.View.rerenderResultsFromState();
    }
  };
  A.Filter = Filter;
})(window.SmsApp);
