'use strict';

// 查询结果 CSV 导出。
function exportHitsCsv() {
  const allHits = state.results.filter(r => r.status === '命中');
  const hits = allHits.filter(r => rowPassesFilters(r));
  if (!allHits.length) {
    alert('暂无命中数据可导出。');
    return;
  }
  if (!hits.length) {
    alert('当前筛选下没有可导出的命中数据。');
    return;
  }
  if (hits.length < allHits.length) {
    log(`按当前筛选导出 ${hits.length}/${allHits.length} 条命中。`);
  }
  const headers = ['事件号', '追踪人', 'ERP', '客户账户', '来电号码', '短信发送时间', '发送者ID', '发送者号码', '详细说明'];
  const rows = hits.map(r => [
    r.eventNo || '',
    r.trackerName || '',
    r.trackerErp || '',
    r.account || '',
    r.phone || '',
    r.smsSendTime || '',
    r.senderId != null ? String(r.senderId) : '',
    r.senderNum || '',
    r.detail || ''
  ]);
  const csv = '﻿' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `115短信回访命中结果_${formatDateForFile(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function formatDateForFile(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
