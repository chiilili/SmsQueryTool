'use strict';
(function (A) {
  const D = A.Dates;
  const Csv = {
    cell(v) { const s = String(v == null ? '' : v); return '"' + s.replace(/"/g, '""') + '"'; },
    exportHits() {
      const all = A.state.results.filter(r => r.status === '命中');
      const hits = all.filter(r => A.View.rowPassesFilters(r));
      if (!all.length) { alert('暂无命中数据可导出。'); return; }
      if (!hits.length) { alert('当前筛选下没有可导出的命中数据。'); return; }
      if (hits.length < all.length) A.View.log('按当前筛选导出 ' + hits.length + '/' + all.length + ' 条命中。');
      const headers = ['事件号', '追踪人', 'ERP', '客户账户', '短信发送时间', '发送者ID', '发送者号码', '详细说明'];
      const rows = hits.map(r => [
        r.eventNo || '', r.trackerName || '', r.trackerErp || '', r.account || '',
        r.smsSendTime || '',
        r.senderId != null ? String(r.senderId) : '', r.senderNum || '', r.detail || ''
      ]);
      const csv = '﻿' + [headers].concat(rows).map(row => row.map(Csv.cell).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '115短信回访命中结果_' + D.formatDateForFile(new Date()) + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  };
  A.Csv = Csv;
})(window.SmsApp);
