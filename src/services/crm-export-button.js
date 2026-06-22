'use strict';
(function (A) {
  const T = A.Text;
  const D = A.Dates;
  const ExportButton = {
    isMonitorPage() {
      return location.hostname === 'crm.jd.com' && location.pathname.indexOf('/monitor/monitorCaseInfo/monitorDetail') >= 0;
    },
    downloadAsExcel(headers, rows) {
      const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const tableHtml = [
        '<table border="1">',
        '<thead><tr>' + headers.map(h => '<th style="mso-number-format:\'@\';">' + esc(h) + '</th>').join('') + '</tr></thead>',
        '<tbody>' + rows.map(row => '<tr>' + row.map(c => '<td style="mso-number-format:\'@\';">' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody>',
        '</table>'
      ].join('');
      const html = '﻿<html><head><meta charset="utf-8"></head><body>' + tableHtml + '</body></html>';
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'CRM系统数据导出_' + D.formatDateForFile(new Date()) + '.xls';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    async exportFromCurrentPage(btn) {
      const status = document.getElementById('jdbeanLocalCrmExportStatus');
      const setStatus = m => { if (status) status.textContent = m; };
      const oldHtml = btn.innerHTML;
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '.65';
      btn.innerHTML = '<s><b><span>正在导出...</span></b></s>';
      try {
        setStatus('正在识别 CRM 数据接口...');
        const data = await A.CrmFetch.loadAll(location.href, (p, ps, t) => setStatus('正在读取第 ' + p + '/' + ps + ' 页，共 ' + (t || '未知') + ' 条...'));
        if (!data.rows.length) throw new Error('当前页面没有可导出的数据');
        const rows = data.rows.map(r => data.headers.map(h => r[h] == null ? '' : r[h]));
        ExportButton.downloadAsExcel(data.headers, rows);
        setStatus('已导出 ' + data.rows.length + ' 条。');
      } catch (e) {
        const fallbackTable = A.CrmParse.findDataTable(document);
        const fallback = fallbackTable ? A.CrmParse.parseTable(fallbackTable) : { headers: [], rows: [] };
        if (fallback.rows.length) {
          ExportButton.downloadAsExcel(fallback.headers, fallback.rows);
          setStatus('完整分页读取失败，已导出当前页 ' + fallback.rows.length + ' 条。');
        } else { setStatus('导出失败。'); throw e; }
      } finally {
        btn.innerHTML = oldHtml;
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
      }
    },
    install() {
      const mount = () => {
        const original = document.getElementById('exportMonitorCommonDetail');
        const existing = document.getElementById('jdbeanLocalCrmExport');
        if (existing) { if (original) original.remove(); return; }
        const btn = document.createElement('a');
        btn.id = 'jdbeanLocalCrmExport';
        btn.className = original ? original.className : 'btn btn-x';
        btn.href = 'javascript:void(0);';
        btn.style.marginRight = '8px';
        btn.innerHTML = '<s><b><span>导出到本地</span></b></s>';
        btn.addEventListener('click', () => ExportButton.exportFromCurrentPage(btn).catch(e => alert('导出失败：' + (e.message || e))));
        const status = document.createElement('span');
        status.id = 'jdbeanLocalCrmExportStatus';
        status.style.cssText = 'margin-left:8px;color:#666;font-size:12px;vertical-align:middle;';
        if (original && original.parentNode) {
          original.parentNode.insertBefore(btn, original);
          original.parentNode.insertBefore(status, original.nextSibling);
          original.remove();
        } else {
          const target = document.getElementById('monitorDetail') || document.body;
          const wrap = document.createElement('div');
          wrap.style.cssText = 'margin:4px 0 4px 4px;';
          wrap.appendChild(btn);
          wrap.appendChild(status);
          target.parentNode ? target.parentNode.insertBefore(wrap, target.nextSibling) : document.body.appendChild(wrap);
        }
      };
      mount();
      let scheduled = false;
      const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => { scheduled = false; mount(); }, 250);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  };
  A.CrmExportButton = ExportButton;
})(window.SmsApp);
