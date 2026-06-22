'use strict';
(function (A) {
  const T = A.Text;

  const STYLE = `
    :host { all: initial; }
    .mask {
      position: fixed; inset: 0; z-index: 2147483646;
      background: radial-gradient(ellipse at center, rgba(255,255,255,.96), rgba(245,245,247,.99));
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      display: flex; align-items: center; justify-content: center;
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #1d1d1f;
    }
    .card { max-width: 520px; padding: 36px 40px; text-align: center; }
    .icon { font-size: 48px; line-height: 1; margin-bottom: 12px; }
    .title { font-size: 26px; font-weight: 700; margin-bottom: 12px; letter-spacing: -.3px; }
    .erp { color: #6e6e73; font-size: 13px; margin-bottom: 18px; }
    .erp b { color: #1d1d1f; }
    .reason { font-size: 14px; color: #3a3a3c; background: #f5f5f7; padding: 12px 16px; border-radius: 10px; margin-bottom: 22px; word-break: break-all; }
    .actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    a.btn, button.btn {
      display: inline-block; padding: 10px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; text-decoration: none; border: 1px solid #d2d2d7; background: #fff; color: #1d1d1f;
    }
    a.btn.primary, button.btn.primary { background: #0a84ff; color: #fff; border-color: #0a84ff; }
    a.btn:hover, button.btn:hover { background: #f5f5f7; }
    a.btn.primary:hover, button.btn.primary:hover { background: #006edc; }
    .ver { margin-top: 14px; font-size: 12px; color: #8e8e93; }
  `;

  function mount(builder) {
    const old = document.getElementById('jdsms-blocked-host');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = 'jdsms-blocked-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:block;pointer-events:auto;';
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.appendChild(style);
    const mask = document.createElement('div');
    mask.className = 'mask';
    mask.innerHTML = builder();
    root.appendChild(mask);
    return { host, root, mask };
  }

  const Blocked = {
    showDisabled(opts) {
      const erp = T.clean((opts && opts.erp) || '');
      const reason = T.clean((opts && opts.reason) || '') || '管理员已停用该账号的使用权限。';
      const v = T.clean((opts && opts.version) || '');
      mount(() => `
        <div class="card">
          <div class="icon">⛔</div>
          <div class="title">已被管理员停用</div>
          <div class="erp">当前 ERP <b>${T.escapeHtml(erp || '未识别')}</b></div>
          <div class="reason">${T.escapeHtml(reason)}</div>
          <div class="actions"><button class="btn" id="jdsms-blocked-retry">我已联系管理员，重试</button></div>
          ${v ? ('<div class="ver">当前版本 ' + T.escapeHtml(v) + '</div>') : ''}
        </div>
      `);
      const btn = document.getElementById('jdsms-blocked-host').shadowRoot.getElementById('jdsms-blocked-retry');
      if (btn) btn.addEventListener('click', () => location.reload());
    },
    showForceUpdate(opts) {
      const erp = T.clean((opts && opts.erp) || '');
      const cur = T.clean((opts && opts.currentVersion) || '');
      const latest = T.clean((opts && opts.latestVersion) || '');
      // 防御性校验：禁止 javascript:/data:/file: 等协议，仅放行 http(s)
      let safeUrl = '';
      try {
        const raw = String((opts && opts.downloadUrl) || '').trim();
        if (raw) {
          const u = new URL(raw);
          if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href;
        }
      } catch (_) { safeUrl = ''; }
      const notes = String((opts && opts.releaseNotes) || '').trim();
      // 注意：release_notes 是富文本（服务端已经经过白名单 sanitizeRichHtml），
      // 这里**不能**用 escapeHtml，否则用户会看到 <h3> 等字面字符；
      // 走客户端二次净化（白名单解析 → DocumentFragment）后挂载到 shadow DOM 内。
      const { host, root } = mount(() => `
        <div class="card">
          <div class="icon">⬆️</div>
          <div class="title">必须升级到新版本</div>
          <div class="erp">当前 ERP <b>${T.escapeHtml(erp || '未识别')}</b></div>
          <div class="reason"><span id="jdsms-blocked-cur"></span><span id="jdsms-blocked-notes"></span></div>
          <div class="actions">
            ${safeUrl ? '<a class="btn primary" href="' + T.escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">下载新版本</a>' : ''}
            <button class="btn" id="jdsms-blocked-retry">已升级，重新加载</button>
          </div>
        </div>
      `);
      const curEl = root.getElementById('jdsms-blocked-cur');
      if (curEl) {
        curEl.innerHTML = '当前版本 <b>' + T.escapeHtml(cur || '未知') + '</b>，最新版本 <b>' + T.escapeHtml(latest || '未知') + '</b><br>';
      }
      const notesEl = root.getElementById('jdsms-blocked-notes');
      if (notesEl) {
        if (notes && A.VersionCheck && typeof A.VersionCheck.sanitizeRichHtmlToFragment === 'function') {
          notesEl.appendChild(A.VersionCheck.sanitizeRichHtmlToFragment(notes));
        } else if (notes) {
          // 降级：服务端净化过的内容直接渲染（极少触达）
          notesEl.innerHTML = notes;
        } else {
          notesEl.textContent = '请下载并安装新版本后继续使用。';
        }
      }
      const btn = root.getElementById('jdsms-blocked-retry');
      if (btn) btn.addEventListener('click', () => location.reload());
    },
    showIntegrityFailed(opts) {
      const erp = T.clean((opts && opts.erp) || '');
      const cur = T.clean((opts && opts.currentVersion) || '');
      const latest = T.clean((opts && opts.latestVersion) || '');
      const msg = T.clean((opts && opts.message) || '') || '检测到扩展文件指纹与服务器记录不一致，可能已被篡改、损坏或版本未及时同步。请下载并安装官方最新版本后继续使用。';
      let safeUrl = '';
      try {
        const raw = String((opts && opts.downloadUrl) || '').trim();
        if (raw) {
          const u = new URL(raw);
          if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href;
        }
      } catch (_) { safeUrl = ''; }
      mount(() => `
        <div class="card">
          <div class="icon">🛡️</div>
          <div class="title">文件完整性校验未通过</div>
          <div class="erp">当前 ERP <b>${T.escapeHtml(erp || '未识别')}</b></div>
          <div class="reason">
            当前版本 <b>${T.escapeHtml(cur || '未知')}</b>${latest ? '，服务器最新版本 <b>' + T.escapeHtml(latest) + '</b>' : ''}<br>
            ${T.escapeHtml(msg)}
          </div>
          <div class="actions">
            ${safeUrl ? '<a class="btn primary" href="' + T.escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">下载新版本</a>' : ''}
            <button class="btn" id="jdsms-blocked-retry">已重新安装，重试</button>
          </div>
        </div>
      `);
      const btn = document.getElementById('jdsms-blocked-host').shadowRoot.getElementById('jdsms-blocked-retry');
      if (btn) btn.addEventListener('click', () => location.reload());
    },
    showOfflineNotice(opts) {
      const erp = T.clean((opts && opts.erp) || '');
      const reason = T.clean((opts && opts.reason) || '');
      mount(() => `
        <div class="card">
          <div class="icon">⚠️</div>
          <div class="title">无法连接授权服务器</div>
          <div class="erp">当前 ERP <b>${T.escapeHtml(erp || '未识别')}</b></div>
          <div class="reason">
            ${reason ? T.escapeHtml(reason) : '请检查网络后重试。'}
          </div>
          <div class="actions"><button class="btn" id="jdsms-blocked-retry">重试</button></div>
        </div>
      `);
      const btn = document.getElementById('jdsms-blocked-host').shadowRoot.getElementById('jdsms-blocked-retry');
      if (btn) btn.addEventListener('click', () => location.reload());
    },
    hide() {
      const host = document.getElementById('jdsms-blocked-host');
      if (host) host.remove();
    }
  };

  A.Blocked = Blocked;
})(window.SmsApp);
