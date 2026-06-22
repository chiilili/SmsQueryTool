'use strict';
(function (A) {
  const T = A.Text;
  const Parse = {
    findDataTable(doc) {
      const tables = Array.from(doc.querySelectorAll('table'));
      let best = null; let bestScore = 0;
      for (const table of tables) {
        const headers = Parse.tableHeaders(table).map(h => T.normalize(h));
        if (!headers.length) continue;
        let score = 0;
        if ((table.id || '').toLowerCase() === 'monitorlist') score += 20;
        const j = headers.join('|');
        if (j.includes('事件号')) score += 10;
        if (j.includes('客户账户') || j.includes('客户账号') || j.includes('账户名')) score += 8;
        if (j.includes('追踪人') || j.includes('跟踪人')) score += 8;
        if (j.includes('创建人')) score += 6;
        if (headers.length >= 6) score += 4;
        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(tr => T.clean(tr.textContent));
        if (rows.length) score += 2;
        if (score > bestScore) { bestScore = score; best = table; }
      }
      return bestScore >= 10 ? best : (doc.querySelector('#monitorlist') || best);
    },
    tableHeaders(table) {
      let cells = Array.from(table.querySelectorAll('thead th'));
      if (!cells.length) {
        const firstRow = table.querySelector('tr');
        cells = firstRow ? Array.from(firstRow.querySelectorAll('th,td')) : [];
      }
      return cells.map(th => T.normalize(th.textContent)).filter(Boolean);
    },
    hasRequiredHeader(headers) {
      const n = (headers || []).map(h => T.normalize(h)).join('|');
      return n.includes('事件号') || n.includes('客户账户') || n.includes('追踪人') || n.includes('创建人');
    },
    parseTable(table) {
      let headerCells = Array.from(table.querySelectorAll('thead th'));
      let bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      if (!headerCells.length) {
        const allRows = Array.from(table.querySelectorAll('tr'));
        const headerRow = allRows.find(tr => Array.from(tr.children).some(c => T.clean(c.textContent)));
        headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th,td')) : [];
        bodyRows = headerRow ? allRows.slice(allRows.indexOf(headerRow) + 1) : allRows;
      }
      const raw = headerCells.map(th => T.normalize(th.textContent));
      const keep = raw.map((h, i) => ({ h, i })).filter(x => x.h && !headerCells[x.i].querySelector('input[type="checkbox"]'));
      const headers = keep.map(x => x.h);
      const rows = bodyRows.map(tr => {
        const cells = Array.from(tr.children);
        return keep.map(x => T.clean((cells[x.i] && cells[x.i].textContent) || ''));
      }).filter(r => r.some(Boolean));
      return { headers, rows };
    },
    uniqueHeaders(row) {
      const used = new Map();
      return (row || []).map((h, i) => {
        const base = T.clean(h) || ('列' + (i + 1));
        const c = used.get(base) || 0;
        used.set(base, c + 1);
        return c ? (base + '_' + (c + 1)) : base;
      });
    },
    tableObjects(table) {
      const p = Parse.parseTable(table);
      const headers = Parse.uniqueHeaders(p.headers);
      const rows = p.rows.map(r => { const o = {}; headers.forEach((h, i) => { o[h] = T.clean(r[i] || ''); }); return o; })
        .filter(o => Object.values(o).some(Boolean));
      return { headers, rows };
    },
    dedupeByEvent(parsed) {
      const headers = parsed.headers || [];
      const ec = A.Columns.detect(headers, A.constants.EVENT_COL_CANDIDATES);
      if (!ec) return parsed;
      const seen = new Set();
      const rows = [];
      for (const row of (parsed.rows || [])) {
        const k = T.clean(row[ec]);
        if (k && seen.has(k)) continue;
        if (k) seen.add(k);
        rows.push(row);
      }
      return { headers, rows };
    },
    pageSizeFromDoc(doc) {
      const i = doc.querySelector('#current_size');
      const n = Number((i && i.value) || 0);
      if (n > 0) return n;
      const sel = doc.querySelector('.page select option[selected], .page select option:checked');
      const s = Number((sel && sel.value) || 0);
      return s > 0 ? s : 0;
    },
    preferredPageSizeFromDoc(doc) {
      const nums = Array.from(doc.querySelectorAll('.page select option, select option'))
        .map(o => Number(o.value || o.textContent || 0))
        .filter(n => Number.isFinite(n) && n > 0);
      const max = nums.length ? Math.max.apply(null, nums) : 100;
      return Math.min(Math.max(max, 10), 100);
    },
    totalCountFromDoc(doc) {
      const t = Array.from(doc.querySelectorAll('.page, .buttonLabel')).map(el => el.textContent || '').join(' ');
      const text = (t || (doc.body && doc.body.textContent) || '').replace(/\s+/g, ' ');
      const patterns = [/共\s*(\d+)\s*条?/, /共\s*(\d+)/, /total\s*[:：=]\s*(\d+)/i];
      for (const re of patterns) { const m = text.match(re); if (m) return Number(m[1]); }
      return 0;
    }
  };
  A.CrmParse = Parse;
})(window.SmsApp);
