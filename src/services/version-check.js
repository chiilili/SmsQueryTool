'use strict';
(function (A) {
  // 客户端的"检查更新"模块。
  // - 通过 License.lastPolicy() 拿当前版本信息（handshake/heartbeat 时已经下发）
  // - 通过 License.heartbeat() 主动拉一次最新策略
  // - 渲染富文本说明前进行客户端二次净化（防御性深度，主要净化在服务端）
  // - "What's New" 首次升级自动弹窗：用 chrome.storage.local 记下已读版本

  const SEEN_KEY = 'jd_sms_seen_release_version';
  const BANNER_DISMISS_KEY = 'jd_sms_banner_dismissed';
  // 仅在 dismiss_key 为空时使用：本次会话已关闭过空 key 横幅
  let _sessionBannerDismissed = false;

  // ===== 客户端 HTML 白名单 =====
  const ALLOWED = {
    P:[], BR:[], HR:[], B:[], STRONG:[], I:[], EM:[], U:[], S:[], DEL:[], INS:[],
    CODE:['class'], PRE:['class'], KBD:[], SAMP:[], BLOCKQUOTE:['class'], Q:[],
    UL:[], OL:['start'], LI:[],
    H1:[], H2:[], H3:[], H4:[], H5:[], H6:[],
    A:['href','title','target'], SPAN:['class'], DIV:['class'],
    MARK:[], SUB:[], SUP:[], SMALL:[],
    TABLE:['class'], THEAD:[], TBODY:[], TR:[], TH:['colspan','rowspan','class'], TD:['colspan','rowspan','class']
  };
  function isSafeUrl(v) {
    const s = String(v || '').trim();
    if (!s) return false;
    if (s.startsWith('#')) return true;
    return /^(https?:|mailto:)/i.test(s);
  }
  function sanitizeNode(node) {
    if (node.nodeType === 3) return node.cloneNode(); // text
    if (node.nodeType !== 1) return null;
    const tag = node.tagName;
    if (!ALLOWED.hasOwnProperty(tag)) {
      // 不在白名单的元素：保留其文本内容（拆出来）
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(c => { const r = sanitizeNode(c); if (r) frag.appendChild(r); });
      return frag;
    }
    const out = document.createElement(tag);
    const allowedAttrs = ALLOWED[tag];
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) continue;
      if (!allowedAttrs.includes(name)) continue;
      const val = attr.value;
      if ((name === 'href' || name === 'src') && !isSafeUrl(val)) continue;
      if (name === 'target' && val !== '_blank') continue;
      out.setAttribute(name, val);
    }
    if (tag === 'A' && out.getAttribute('target') === '_blank') {
      out.setAttribute('rel', 'noopener noreferrer');
    }
    node.childNodes.forEach(c => { const r = sanitizeNode(c); if (r) out.appendChild(r); });
    return out;
  }
  function sanitizeRichHtmlToFragment(htmlString) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(htmlString || '');
    const frag = document.createDocumentFragment();
    tpl.content.childNodes.forEach(c => { const r = sanitizeNode(c); if (r) frag.appendChild(r); });
    return frag;
  }

  // ===== chrome.storage 包装 =====
  function storageGet(key) {
    return new Promise(resolve => {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(null);
        chrome.storage.local.get([key], r => resolve(r ? r[key] : null));
      } catch (_) { resolve(null); }
    });
  }
  function storageSet(key, value) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ [key]: value });
    } catch (_) {}
  }

  // ===== 比较版本 =====
  function cmpVer(a, b) {
    const pa = String(a || '').split('.').map(n => Number(n) || 0);
    const pb = String(b || '').split('.').map(n => Number(n) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x - y;
    }
    return 0;
  }

  // ===== 弹窗 UI =====
  // 给 release notes 容器一套完整排版样式：所有 h3 / p / ul / ol / code 在弹窗里都有可读层级。
  // 还支持几个可在更新说明里用的 class（白名单已放行 div/span/blockquote 的 class 属性）：
  //   .callout.info / .callout.warn / .callout.danger - 顶部块状提示
  //   .step-list                                       - 大号编号步骤列表
  //   .faq                                             - Q&A 折叠风格
  //   .lead                                            - 第一段强调
  //   .kbd                                             - 行内键位
  const RELEASE_STYLE = `
    #jdsmsReleaseMask { box-sizing: border-box; }
    #jdsmsReleaseMask, #jdsmsReleaseMask * { box-sizing: border-box; }
    #jdsmsReleaseModal { text-align: left; }
    #jdsmsReleaseBody { font-size: 13.5px; line-height: 1.65; color: #1d1d1f; }
    #jdsmsReleaseBody > *:first-child { margin-top: 0; }
    #jdsmsReleaseBody > *:last-child { margin-bottom: 0; }
    #jdsmsReleaseBody h1, #jdsmsReleaseBody h2, #jdsmsReleaseBody h3, #jdsmsReleaseBody h4 {
      margin: 22px 0 10px; color: #15161a; letter-spacing: -.2px; line-height: 1.3; font-weight: 700;
    }
    #jdsmsReleaseBody h3 { font-size: 15px; padding-bottom: 6px; border-bottom: 1px solid #ececef; }
    #jdsmsReleaseBody h4 { font-size: 13.5px; color: #4b5063; }
    #jdsmsReleaseBody p { margin: 8px 0; }
    #jdsmsReleaseBody p.lead { font-size: 14.5px; color: #15161a; }
    #jdsmsReleaseBody ul, #jdsmsReleaseBody ol { margin: 8px 0; padding-left: 22px; }
    #jdsmsReleaseBody li { margin: 4px 0; }
    #jdsmsReleaseBody li > ul, #jdsmsReleaseBody li > ol { margin: 4px 0; }
    #jdsmsReleaseBody code {
      background: rgba(15,17,25,.06); color: #15161a;
      padding: 1px 6px; border-radius: 5px;
      font-family: "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
      font-size: 12px;
    }
    #jdsmsReleaseBody pre {
      background: #f6f7f9; border: 1px solid #ececef; border-radius: 8px;
      padding: 10px 12px; overflow: auto; font-size: 12px; line-height: 1.55;
      font-family: "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    }
    #jdsmsReleaseBody pre code { background: transparent; padding: 0; }
    #jdsmsReleaseBody a { color: #2e6df6; text-decoration: underline; text-underline-offset: 2px; }
    #jdsmsReleaseBody a:hover { color: #1f54c9; }
    #jdsmsReleaseBody hr { border: 0; height: 1px; background: #ececef; margin: 18px 0; }
    #jdsmsReleaseBody small { color: #6b7180; }
    #jdsmsReleaseBody blockquote {
      margin: 10px 0; padding: 8px 14px; border-left: 3px solid #2e6df6;
      background: rgba(46,109,246,.06); color: #15161a; border-radius: 0 6px 6px 0;
    }
    /* === 富类：callouts === */
    #jdsmsReleaseBody .callout {
      margin: 12px 0; padding: 12px 14px; border-radius: 10px;
      border: 1px solid transparent;
      display: flex; align-items: flex-start; gap: 10px;
    }
    #jdsmsReleaseBody .callout .ic { font-size: 18px; line-height: 1.2; flex: 0 0 auto; }
    #jdsmsReleaseBody .callout .bd { flex: 1 1 auto; min-width: 0; }
    #jdsmsReleaseBody .callout .bd p { margin: 0; }
    #jdsmsReleaseBody .callout .bd p + p { margin-top: 6px; }
    #jdsmsReleaseBody .callout.info    { background: rgba(46,109,246,.08); border-color: rgba(46,109,246,.18); }
    #jdsmsReleaseBody .callout.warn    { background: rgba(154,90,0,.08);   border-color: rgba(154,90,0,.20);   color: #5b3a00; }
    #jdsmsReleaseBody .callout.warn .bd, #jdsmsReleaseBody .callout.warn .bd b { color: #5b3a00; }
    #jdsmsReleaseBody .callout.danger  { background: rgba(198,52,42,.08);  border-color: rgba(198,52,42,.20);  color: #7a1c15; }
    /* === 富类：step-list === */
    #jdsmsReleaseBody ol.step-list { list-style: none; padding-left: 0; counter-reset: rn; margin: 12px 0; }
    #jdsmsReleaseBody ol.step-list > li {
      counter-increment: rn; position: relative;
      padding: 10px 12px 10px 44px; margin: 0 0 8px;
      background: #f8f9fb; border: 1px solid #ececef; border-radius: 10px;
    }
    #jdsmsReleaseBody ol.step-list > li::before {
      content: counter(rn); position: absolute; left: 12px; top: 10px;
      width: 22px; height: 22px; line-height: 22px; text-align: center;
      background: #2e6df6; color: #fff; border-radius: 50%;
      font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums;
    }
    #jdsmsReleaseBody ol.step-list > li b:first-child { display: block; margin-bottom: 4px; color: #15161a; font-size: 13.5px; }
    #jdsmsReleaseBody ol.step-list ul { margin: 6px 0 2px; padding-left: 18px; }
    #jdsmsReleaseBody ol.step-list li li { margin: 3px 0; }
    /* === 富类：FAQ === */
    #jdsmsReleaseBody .faq { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
    #jdsmsReleaseBody .faq .qa { padding: 10px 12px; border: 1px solid #ececef; border-radius: 8px; background: #fff; }
    #jdsmsReleaseBody .faq .q { font-weight: 600; color: #15161a; margin: 0 0 4px; }
    #jdsmsReleaseBody .faq .a { margin: 0; color: #4b5063; font-size: 13px; }
    /* === 富类：键位 === */
    #jdsmsReleaseBody .kbd {
      display: inline-block; padding: 1px 6px; margin: 0 2px;
      background: #fff; border: 1px solid #d2d4d8; border-bottom-width: 2px;
      border-radius: 5px; font-family: "SF Mono", Menlo, Consolas, monospace;
      font-size: 11.5px; color: #15161a; line-height: 1.4;
    }
  `;

  function ensureModal() {
    let mask = A.root && A.root.getElementById('jdsmsReleaseMask');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.id = 'jdsmsReleaseMask';
    mask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
    mask.innerHTML = `
      <style>${RELEASE_STYLE}</style>
      <div id="jdsmsReleaseModal" style="background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(15,17,25,.22);overflow:hidden;font:13.5px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
        <div style="padding:18px 24px 12px;border-bottom:1px solid #ececef;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <div style="text-align:left;">
            <div id="jdsmsReleaseTitle" style="font-size:17px;font-weight:700;color:#15161a;letter-spacing:-.2px;line-height:1.3;">新版本说明</div>
            <div id="jdsmsReleaseSub" style="font-size:12px;color:#6b7180;margin-top:4px;font-variant-numeric:tabular-nums;"></div>
          </div>
          <button id="jdsmsReleaseClose" type="button" aria-label="关闭" style="background:transparent;border:0;font-size:22px;color:#8e8e93;cursor:pointer;line-height:1;padding:0 4px;flex:0 0 auto;">×</button>
        </div>
        <div id="jdsmsReleaseBody" style="padding:18px 24px;overflow:auto;color:#1d1d1f;flex:1 1 auto;text-align:left;"></div>
        <div style="padding:14px 24px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #ececef;background:#fafbfc;">
          <a id="jdsmsReleaseDownload" target="_blank" rel="noopener noreferrer" style="display:none;text-decoration:none;padding:8px 16px;border-radius:999px;background:#2e6df6;color:#fff;font-weight:600;font-size:13px;">下载新版</a>
          <button id="jdsmsReleaseOk" type="button" style="padding:8px 16px;border-radius:999px;border:1px solid rgba(15,17,25,.12);background:#f5f6f8;color:#15161a;cursor:pointer;font-weight:600;font-size:13px;">知道了</button>
        </div>
      </div>`;
    if (A.root) A.root.appendChild(mask); else document.body.appendChild(mask);
    const close = () => { mask.style.display = 'none'; };
    mask.querySelector('#jdsmsReleaseClose').addEventListener('click', close);
    mask.querySelector('#jdsmsReleaseOk').addEventListener('click', close);
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    return mask;
  }

  function showReleaseModal({ current, latest, html, downloadUrl, autoFromUpgrade }) {
    const mask = ensureModal();
    mask.style.display = 'flex';
    const titleEl = mask.querySelector('#jdsmsReleaseTitle');
    const subEl = mask.querySelector('#jdsmsReleaseSub');
    const body = mask.querySelector('#jdsmsReleaseBody');
    const dl = mask.querySelector('#jdsmsReleaseDownload');
    const newer = latest && cmpVer(latest, current) > 0;
    titleEl.textContent = autoFromUpgrade ? ('已升级到 v' + (current || '?')) : (newer ? '发现新版本 v' + latest : '已是最新版本');
    subEl.textContent = '当前 v' + (current || '?') + (latest ? '｜服务器最新 v' + latest : '');
    body.textContent = '';
    if (html && String(html).trim()) {
      body.appendChild(sanitizeRichHtmlToFragment(html));
    } else {
      const p = document.createElement('p');
      p.style.color = '#6e6e73';
      p.textContent = autoFromUpgrade ? '本次升级未提供更新说明。' : (newer ? '当前版本可升级，但服务器未提供说明。' : '当前已经是最新版本。');
      body.appendChild(p);
    }
    if (newer && downloadUrl) {
      dl.href = downloadUrl;
      dl.style.display = 'inline-block';
      dl.textContent = '下载 v' + latest;
    } else {
      dl.style.display = 'none';
    }
  }

  // ===== 公开 API =====
  const VersionCheck = {
    // 对外暴露给 blocked.js / 其他模块复用的客户端二次净化器
    sanitizeRichHtmlToFragment(html) { return sanitizeRichHtmlToFragment(html); },
    async check({ silent } = {}) {
      // 主动刷一次心跳，让 _lastPolicy 是最新的
      try { await A.License.heartbeat(); } catch (_) {}
      const p = A.License.lastPolicy() || {};
      const ctx = A.License.ctx() || {};
      if (silent) return p;
      showReleaseModal({
        current: ctx.version,
        latest: p.latest_version,
        html: p.release_notes,
        downloadUrl: p.download_url,
        autoFromUpgrade: false
      });
      return p;
    },

    async showWhatsNewIfUpgraded() {
      const p = A.License.lastPolicy() || {};
      const ctx = A.License.ctx() || {};
      const current = ctx.version || '';
      if (!current) return;
      const seen = await storageGet(SEEN_KEY);
      if (seen === current) return; // 当前版本已读过
      // 首次看到这个版本——弹一次 What's New，再写入 seen
      // 这里展示"当前版本"的说明（如果 server 把它作为 current 发下来）
      showReleaseModal({
        current,
        latest: p.latest_version,
        html: p.release_notes,
        downloadUrl: p.download_url,
        autoFromUpgrade: true
      });
      storageSet(SEEN_KEY, current);
    },

    // 远程横幅：渲染/关闭。
    // 数据优先级：心跳/握手 policy.banner（实时） > RuntimeConfig 缓存（30 分钟）
    async renderBannerIfAny() {
      let banner = null;
      try {
        const p = A.License && typeof A.License.lastPolicy === 'function' ? A.License.lastPolicy() : null;
        if (p && p.banner && p.banner.enabled) banner = p.banner;
      } catch (_) {}
      if (!banner) {
        banner = (A.RuntimeConfig && typeof A.RuntimeConfig.banner === 'function') ? A.RuntimeConfig.banner() : null;
      }
      const slot = A.root && A.root.getElementById('runtimeBanner');
      if (!slot) return;
      slot.textContent = '';
      slot.style.display = 'none';
      if (!banner || !banner.enabled) return;
      // 修复："dismiss_key 为空 + 用户曾关闭过任意横幅"会让后续所有空 key 横幅被永久隐藏。
      // 现在只在 dismiss_key 非空时才尊重持久化关闭；空 key = 每次都展示（除非本次会话内已关闭）。
      const dk = String(banner.dismiss_key || '').trim();
      if (dk) {
        const dismissed = await storageGet(BANNER_DISMISS_KEY);
        if (dismissed && dismissed === dk) return;
      } else if (_sessionBannerDismissed) {
        return;
      }
      slot.style.display = 'flex';
      slot.dataset.level = banner.level || 'info';
      const left = document.createElement('div');
      left.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;';
      left.appendChild(sanitizeRichHtmlToFragment(banner.html || ''));
      slot.appendChild(left);
      if (banner.link_url && banner.link_text) {
        const a = document.createElement('a');
        a.href = banner.link_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = banner.link_text;
        a.style.cssText = 'margin-left:10px;flex:0 0 auto;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,.4);color:inherit;text-decoration:none;font-weight:600;font-size:12px;';
        slot.appendChild(a);
      }
      const close = document.createElement('button');
      close.textContent = '×';
      close.title = '关闭横幅';
      close.style.cssText = 'margin-left:8px;flex:0 0 auto;background:transparent;border:0;color:inherit;font-size:18px;cursor:pointer;line-height:1;opacity:.7;';
      close.addEventListener('click', () => {
        slot.style.display = 'none';
        if (dk) storageSet(BANNER_DISMISS_KEY, dk);
        else _sessionBannerDismissed = true;
      });
      slot.appendChild(close);
    }
  };

  A.VersionCheck = VersionCheck;
})(window.SmsApp);
