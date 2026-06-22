'use strict';
(function (A) {
  const C = A.constants;
  const T = A.Text;
  const Discover = {
    looksLikeLogin(text) {
      const s = String(text || '').slice(0, 8000).toLowerCase();
      return s.includes('login.jd.com') || s.includes('passport.jd.com') || s.includes('idp.jd.com') || /用户登录|扫码登录|账号登录/.test(s);
    },
    findCrmBusinessGroupSpan(doc) {
      const d = doc || document;
      const pre = d.getElementById('businessGroupTreeData_1_span');
      if (pre) return pre;
      const spans = Array.from(d.querySelectorAll('[id^="businessGroupTreeData_"][id$="_span"], span'));
      return spans.find(el => /家电家居升级/.test(T.clean(el.textContent))) || null;
    },
    findCaseCloseLink(doc) {
      const links = Array.from((doc || document).querySelectorAll('a'));
      return links.find(a => /urlTargetAll\(["'](caseHandleCount|caseCloseCount)["']\)/.test(a.getAttribute('onclick') || '')) || null;
    },
    isLikelyDeptId(id) {
      const s = T.clean(id);
      if (!/^\d{4,12}$/.test(s)) return false;
      if (/^20\d{2}/.test(s) && s.length <= 8) return false;
      return true;
    },
    collectDeptIds(text, out, options) {
      const scoped = String(text || '');
      const patterns = [
        /(?:parDeptId|parDeptID|deptId|deptID|dept_id|orgId|organId|deptCode|id)\s*[:=]\s*["']?(\d{4,12})["']?/ig,
        /[?&](?:parDeptId|deptId|orgId|organId)=(\d{4,12})/ig,
        /urlTargetAll\([^)]*?(\d{4,12})/ig
      ];
      if (options && options.broad) patterns.push(/\b(2\d{4,8})\b/g);
      for (const re of patterns) {
        let m;
        while ((m = re.exec(scoped))) { const id = T.clean(m[1]); if (Discover.isLikelyDeptId(id)) out.push(id); }
      }
    },
    findLikelyLabel(html) {
      const text = String(html || '');
      const preferred = text.match(/[一-龥A-Za-z0-9_-]{2,30}升级[一二三四五六七八九十0-9]+组/);
      if (preferred) return T.clean(preferred[0]);
      const group = text.match(/[一-龥A-Za-z0-9_-]{2,30}组/);
      return group ? T.clean(group[0]) : '';
    },
    findDirectDetailUrl(doc) {
      const html = (doc.documentElement && doc.documentElement.innerHTML) || '';
      const m = html.match(/https:\/\/crm\.jd\.com\/monitor\/monitorCaseInfo\/monitorDetail[^'"<>\s]+/);
      return m ? T.decodeHtmlAttr(m[0]) : '';
    },
    findDirectDetailUrlInText(text) {
      const m = String(text || '').match(/https?:\\?\/\\?\/crm\.jd\.com\\?\/monitor\\?\/monitorCaseInfo\\?\/monitorDetail[^'"<>\s\\]+/i)
        || String(text || '').match(/\/monitor\/monitorCaseInfo\/monitorDetail\?[^'"<>\s\\]+/i);
      if (!m) return '';
      const raw = m[0].replace(/\\\//g, '/');
      return new URL(T.decodeHtmlAttr(raw), 'https://crm.jd.com').href;
    },
    extractParDeptIdFromUrl(url) {
      try {
        const u = new URL(url, 'https://crm.jd.com');
        return T.clean(u.searchParams.get('parDeptId') || u.searchParams.get('deptId') || u.searchParams.get('cfgDeptId') || u.searchParams.get('curDeptId') || '');
      } catch (_) { return ''; }
    },
    buildDetailUrl(parDeptId, beginTimeStr) {
      const u = new URL('https://crm.jd.com/monitor/monitorCaseInfo/monitorDetail');
      u.searchParams.set('flag', 'all');
      u.searchParams.set('funName', C.CRM_FUN_NAME);
      u.searchParams.set('parDeptId', String(parDeptId));
      u.searchParams.set('beginTimeStr', beginTimeStr || A.CrmRange.info(C.CRM_DATE_RANGE_TODAY).beginTimeStr);
      return u.href;
    },
    normalizeDetailUrl(url, beginTimeStr) {
      const t = new URL(url, 'https://crm.jd.com');
      t.searchParams.set('flag', t.searchParams.get('flag') || 'all');
      t.searchParams.set('funName', C.CRM_FUN_NAME);
      if (!t.searchParams.get('parDeptId')) {
        const d = t.searchParams.get('deptId') || t.searchParams.get('cfgDeptId') || t.searchParams.get('curDeptId');
        if (d) t.searchParams.set('parDeptId', d);
      }
      t.searchParams.set('beginTimeStr', beginTimeStr || A.CrmRange.info(C.CRM_DATE_RANGE_TODAY).beginTimeStr);
      return t.href;
    },
    resolveGroupInfo(doc, htmlText) {
      const html = String(htmlText || (doc.documentElement && doc.documentElement.innerHTML) || '');
      const span = Discover.findCrmBusinessGroupSpan(doc);
      const treeId = span && span.id ? span.id.replace(/_span$/, '') : 'businessGroupTreeData_1';
      const labelDom = T.clean(span && span.textContent || '');
      const labelHtml = (() => {
        const m = html.match(/id=["']businessGroupTreeData_1_span["'][^>]*>([^<]+)/i);
        return m ? T.clean(T.decodeHtmlAttr(m[1])) : '';
      })();
      const label = labelDom || labelHtml || Discover.findLikelyLabel(html);
      const nearParts = [];
      if (treeId) { const i = html.indexOf(treeId); if (i >= 0) nearParts.push(html.slice(Math.max(0, i - 3000), i + 3000)); }
      if (label) { const i = html.indexOf(label); if (i >= 0) nearParts.push(html.slice(Math.max(0, i - 4000), i + 4000)); }
      const near = nearParts.join('\\n');
      const cand = [];
      Discover.collectDeptIds(near, cand, { broad: false });
      if (!cand.length) Discover.collectDeptIds(html, cand, { broad: false });
      if (!cand.length) Discover.collectDeptIds(near || html, cand, { broad: true });
      return {
        label,
        treeId,
        parDeptId: T.unique(cand).find(Boolean) || '',
        count: Discover.findCaseCloseCount(doc, html)
      };
    },
    findCaseCloseCount(doc, html) {
      const link = Discover.findCaseCloseLink(doc);
      const dom = T.clean((link && link.textContent) || '');
      if (dom) return dom;
      const m = String(html || '').match(/urlTargetAll\(["'](?:caseHandleCount|caseCloseCount)["']\)[^>]*>(\d+)/i);
      return m ? m[1] : '';
    }
  };
  A.CrmDiscover = Discover;
})(window.SmsApp);
