'use strict';
(function (A) {
  const T = A.Text;
  const D = A.CrmDiscover;
  const CrmResolve = {
    pickDeptIdFromObject(obj) {
      const keys = ['parDeptId', 'parDeptID', 'deptId', 'deptID', 'curDeptId', 'curDeptID', 'orgId', 'organId', 'businessGroupId', 'id', 'value', 'key'];
      for (const k of keys) {
        const v = obj && obj[k];
        const m = T.clean(v).match(/^\d{4,12}$/);
        if (m && D.isLikelyDeptId(m[0])) return m[0];
      }
      const attrs = obj && (obj.attributes || obj.attr || obj.dataMap || obj.extra || obj.ext || obj.data);
      if (attrs && attrs !== obj && typeof attrs === 'object' && !Array.isArray(attrs)) return CrmResolve.pickDeptIdFromObject(attrs);
      return '';
    },
    parseLooseJsonPayload(text) {
      const raw = String(text || '').trim();
      if (!raw) return { ok: false };
      const tries = [raw];
      const assign = raw.match(/=\s*([\[{][\s\S]*[\]}])\s*;?\s*$/);
      if (assign) tries.push(assign[1]);
      const callback = raw.match(/^[\w$.]+\s*\(\s*([\[{][\s\S]*[\]}])\s*\)\s*;?$/);
      if (callback) tries.push(callback[1]);
      for (const item of tries) { try { return { ok: true, value: JSON.parse(item) }; } catch (_) {} }
      return { ok: false };
    },
    scoreCandidate(label, expectedLabel, sourceName) {
      const l = T.clean(label);
      const e = T.clean(expectedLabel);
      const src = String(sourceName || '').toLowerCase();
      let s = 20;
      if (/tree|businessgroup|dept|org|organ/.test(src)) s += 20;
      if (e && l === e) s += 100;
      else if (e && l && (l.includes(e) || e.includes(l))) s += 80;
      if (/升级[一二三四五六七八九十0-9]+组/.test(l)) s += 45;
      else if (/组$/.test(l)) s += 25;
      if (/家电家居/.test(l)) s += 10;
      return s;
    },
    extractCandidatesFromStructured(text, expectedLabel, sourceName) {
      const out = [];
      const raw = String(text || '').trim();
      const parsed = CrmResolve.parseLooseJsonPayload(raw);
      let order = 0;
      const visit = (value, pathLabel) => {
        if (Array.isArray(value)) { for (const it of value) visit(it, pathLabel); return; }
        if (!value || typeof value !== 'object') return;
        const name = T.clean(value.name || value.text || value.title || value.label || value.deptName || value.orgName || value.departmentName || value.businessGroupName || '');
        const deptId = CrmResolve.pickDeptIdFromObject(value);
        const merged = name || pathLabel || '';
        if (deptId) out.push({ deptId, label: merged || expectedLabel, score: CrmResolve.scoreCandidate(merged, expectedLabel, sourceName), order: order++, source: sourceName });
        const childLabel = merged || pathLabel || '';
        for (const k of ['children', 'childrens', 'nodes', 'data', 'rows', 'result', 'list', 'treeData', 'businessGroupTreeData']) {
          if (value[k] !== undefined) visit(value[k], childLabel);
        }
      };
      if (parsed.ok) visit(parsed.value);
      const blocks = raw.match(/(?:\[[\s\S]{0,20000}\]|\{[\s\S]{0,20000}\})/g) || [];
      for (const b of blocks.slice(0, 20)) { const p = CrmResolve.parseLooseJsonPayload(b); if (p.ok) visit(p.value); }
      const groupLabel = T.clean(expectedLabel || '');
      const labelRegex = groupLabel ? T.escapeRegExp(groupLabel) : '[\\u4e00-\\u9fa5A-Za-z0-9_-]{2,30}组';
      const nearRe = new RegExp('.{0,600}' + labelRegex + '.{0,600}', 'g');
      let m;
      while ((m = nearRe.exec(raw))) {
        const ids = [];
        D.collectDeptIds(m[0], ids, { broad: false });
        ids.forEach((deptId, i) => out.push({ deptId, label: groupLabel || D.findLikelyLabel(m[0]), score: 65, order: order++ + i, source: sourceName }));
      }
      return out;
    },
    fromSources(sources, expectedLabel) {
      const candidates = [];
      for (const source of (sources || [])) {
        const text = String(source.text || '');
        const direct = [];
        D.collectDeptIds(text, direct, { broad: false });
        const label = D.findLikelyLabel(text);
        if (direct.length) direct.forEach((deptId, i) => candidates.push({ deptId, label: label || expectedLabel, score: label ? 50 : 15, order: i, source: source.name }));
        CrmResolve.extractCandidatesFromStructured(text, expectedLabel, source.name).forEach(c => candidates.push(c));
      }
      return CrmResolve.chooseBest(candidates, expectedLabel);
    },
    chooseBest(candidates, expectedLabel) {
      const dedup = [];
      const seen = new Set();
      for (const c of (candidates || [])) {
        const deptId = T.clean(c.deptId);
        if (!D.isLikelyDeptId(deptId)) continue;
        const key = deptId + '|' + T.clean(c.label);
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(Object.assign({}, c, { deptId }));
      }
      if (!dedup.length) return null;
      dedup.sort((a, b) => (b.score || 0) - (a.score || 0) || (a.order || 0) - (b.order || 0));
      const expected = T.clean(expectedLabel);
      if (expected) {
        const exact = dedup.find(c => T.clean(c.label) === expected);
        if (exact) return exact;
        const fuzzy = dedup.find(c => { const l = T.clean(c.label); return l && (l.includes(expected) || expected.includes(l)); });
        if (fuzzy) return fuzzy;
      }
      return dedup[0];
    },
    discoverTreeEndpointUrls(sources, baseUrl) {
      const found = new Map();
      const add = (raw, score) => {
        if (!raw) return;
        let value = String(raw).replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
        if (!value || value === '#' || value.startsWith('javascript:')) return;
        if (!/^(https?:)?\/\//.test(value) && !value.startsWith('/')) {
          if (!/^[A-Za-z0-9_./?=&%-]+$/.test(value) || !/(businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)/.test(value)) return;
        }
        let href = '';
        try { href = new URL(value, baseUrl).href; } catch (_) { return; }
        if (!/^https:\/\/crm\.jd\.com\//i.test(href)) return;
        const lower = href.toLowerCase();
        let s = score || 0;
        if (/tree|businessgroup|group|dept|org|organ/.test(lower)) s += 40;
        if (/businessmonitor/.test(lower)) s += 20;
        if (/monitorcaseinfo|monitorcommon|monitordetail/.test(lower)) s -= 30;
        const old = found.get(href);
        if (!old || old.score < s) found.set(href, { href, score: s });
      };
      for (const source of (sources || [])) {
        const text = String(source.text || '');
        const regexes = [
          /(?:url|href)\s*[:=]\s*["']([^"']*(?:businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)[^"']*)["']/g,
          /(?:\$\.getJSON|\$\.get|\$\.post)\s*\(\s*["']([^"']+)["']/g,
          /["'](\/monitor\/[^"']*(?:businessGroup|BusinessGroup|dept|Dept|tree|Tree|org|Org|organ|Organ)[^"']*)["']/g,
          /["'](https:\/\/crm\.jd\.com\/monitor\/[^"']+)["']/g
        ];
        for (const re of regexes) { let m; while ((m = re.exec(text))) add(m[1], 10); }
      }
      // 探测端点列表来自服务端运行时下发的配置，避免在客户端静态暴露
      const guesses = (A.constants && Array.isArray(A.constants.CRM_TREE_ENDPOINT_GUESSES))
        ? A.constants.CRM_TREE_ENDPOINT_GUESSES : [];
      guesses.forEach(u => add(u, 1));
      return Array.from(found.values()).filter(x => x.score >= 0).sort((a, b) => b.score - a.score || a.href.localeCompare(b.href)).slice(0, 28).map(x => x.href);
    },
    async collectScripts(doc, baseUrl) {
      const out = [];
      const scripts = Array.from(doc.querySelectorAll('script'));
      for (const s of scripts) {
        const inline = s.textContent || '';
        if (inline && /businessGroupTreeData|urlTargetAll|caseCloseCount|parDeptId|deptId|monitor/.test(inline)) out.push({ name: 'inline script', url: baseUrl, text: inline });
        const src = s.getAttribute('src');
        if (!src) continue;
        let abs = '';
        try { abs = new URL(src, baseUrl).href; } catch (_) { continue; }
        if (!/^https:\/\/crm\.jd\.com\//i.test(abs) && !/^https:\/\/storage\.360buyimg\.com\//i.test(abs)) continue;
        try {
          const text = await A.Http.requestText(abs, {
            method: 'GET',
            headers: { 'Accept': 'application/javascript,text/javascript,*/*;q=0.8' },
            credentials: A.Http.credentialsFor(abs),
            errorPrefix: '读取CRM脚本失败'
          });
          if (/businessGroupTreeData|urlTargetAll|caseCloseCount|parDeptId|deptId|monitor|businessGroup|tree/i.test(text)) out.push({ name: 'script ' + abs, url: abs, text });
        } catch (_) {}
      }
      return out;
    },
    async resolveDetailUrl(rangeInfo) {
      const businessUrl = 'https://crm.jd.com/monitor/businessMonitor';
      const html = await A.Http.requestText(businessUrl, {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        errorPrefix: '读取CRM业务监控页失败'
      });
      if (D.looksLikeLogin(html)) throw new Error('CRM业务监控页返回登录页，请先确认当前浏览器已登录CRM。');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const groupInfo = D.resolveGroupInfo(doc, html);
      const label = groupInfo.label || '当前CRM组';
      const sources = [{ name: 'businessMonitor HTML', url: businessUrl, text: html }];
      const direct = D.findDirectDetailUrl(doc) || D.findDirectDetailUrlInText(html);
      if (direct) return { url: D.normalizeDetailUrl(direct, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: D.extractParDeptIdFromUrl(direct) };
      const immediate = groupInfo.parDeptId;
      if (immediate) return { url: D.buildDetailUrl(immediate, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: immediate };
      const scriptSources = await CrmResolve.collectScripts(doc, businessUrl);
      sources.push.apply(sources, scriptSources);
      const staticHit = CrmResolve.fromSources(sources, label);
      if (staticHit && staticHit.deptId && (staticHit.score || 0) >= 50) return { url: D.buildDetailUrl(staticHit.deptId, rangeInfo.beginTimeStr), label: staticHit.label || label, count: groupInfo.count || '', parDeptId: staticHit.deptId };
      const endpointUrls = CrmResolve.discoverTreeEndpointUrls(sources, businessUrl);
      const tried = [];
      for (const endpointUrl of endpointUrls) {
        const methods = [
          { method: 'GET' },
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/javascript, */*; q=0.01' }, body: '' }
        ];
        for (const req of methods) {
          const tag = req.method + ' ' + endpointUrl;
          tried.push(tag);
          try {
            const text = await A.Http.requestText(endpointUrl, {
              method: req.method,
              headers: req.headers || { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/html, */*; q=0.01' },
              body: req.body,
              errorPrefix: '读取CRM组织树接口失败'
            });
            if (D.looksLikeLogin(text)) continue;
            const directFromEndpoint = D.findDirectDetailUrlInText(text);
            if (directFromEndpoint) return { url: D.normalizeDetailUrl(directFromEndpoint, rangeInfo.beginTimeStr), label, count: groupInfo.count || '', parDeptId: D.extractParDeptIdFromUrl(directFromEndpoint) };
            const hit = CrmResolve.fromSources([{ name: tag, url: endpointUrl, text }], label);
            if (hit && hit.deptId) return { url: D.buildDetailUrl(hit.deptId, rangeInfo.beginTimeStr), label: hit.label || label, count: groupInfo.count || '', parDeptId: hit.deptId };
          } catch (_) {}
        }
      }
      const suffix = tried.length ? ('已尝试接口：' + tried.slice(0, 8).join('；') + (tried.length > 8 ? '；...' : '')) : '未在页面脚本中发现可探测的组织树接口。';
      throw new Error('后台HTTP请求未能识别当前组parDeptId。' + suffix);
    }
  };
  A.CrmResolve = CrmResolve;
})(window.SmsApp);
