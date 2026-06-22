'use strict';
(function (A) {
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_READ_IDS = 200;

  let _erp = '';
  let _notices = [];
  let _readIds = new Set();
  let _shownCriticalIds = new Set();
  let _timer = null;
  let _outsideHandler = null;

  function storageKey(erp) { return 'notif_read_' + erp; }

  async function loadReadIds(erp) {
    if (!erp) return new Set();
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return new Set();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([storageKey(erp)], (res) => {
          const arr = (res && Array.isArray(res[storageKey(erp)])) ? res[storageKey(erp)] : [];
          resolve(new Set(arr));
        });
      } catch (_) { resolve(new Set()); }
    });
  }

  function saveReadIds() {
    if (!_erp) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const arr = Array.from(_readIds).slice(-MAX_READ_IDS);
    try { chrome.storage.local.set({ [storageKey(_erp)]: arr }); } catch (_) {}
  }

  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function levelLabel(lv) {
    return lv === 'critical' ? '紧急' : (lv === 'warning' ? '警告' : '提示');
  }

  function unreadCount() {
    let n = 0;
    for (const x of _notices) if (!_readIds.has(x.id)) n++;
    return n;
  }

  function renderBadge() {
    if (!A.els || !A.els.notifBadge) return;
    const n = unreadCount();
    if (n > 0) {
      A.els.notifBadge.classList.remove('hidden');
      A.els.notifBadge.textContent = n > 99 ? '99+' : String(n);
    } else {
      A.els.notifBadge.classList.add('hidden');
    }
  }

  function renderList() {
    if (!A.els || !A.els.notifList) return;
    if (!_notices.length) {
      A.els.notifList.innerHTML = '<div class="notif-empty">暂无通知</div>';
      return;
    }
    A.els.notifList.innerHTML = _notices.map(n => {
      const unread = !_readIds.has(n.id);
      const lv = ['info', 'warning', 'critical'].includes(n.level) ? n.level : 'info';
      return `
        <div class="notif-item ${unread ? 'unread' : ''}">
          <div class="head">
            <span class="lvl lvl-${lv}">${levelLabel(lv)}</span>
            <span class="ti">${escapeHtml(n.title)}</span>
            <span class="ts">${escapeHtml(fmtTime(n.published_at))}</span>
          </div>
          <div class="ct">${escapeHtml(n.content)}</div>
        </div>
      `;
    }).join('');
  }

  function positionPopover() {
    if (!A.els || !A.els.notifPopover || !A.els.notifBtn) return;
    const rect = A.els.notifBtn.getBoundingClientRect();
    const pop = A.els.notifPopover;
    pop.style.top = (rect.bottom + 8) + 'px';
    const right = Math.max(8, window.innerWidth - rect.right);
    pop.style.right = right + 'px';
    pop.style.left = 'auto';
  }

  function openPopover() {
    if (!A.els || !A.els.notifPopover) return;
    A.els.notifPopover.classList.remove('hidden');
    positionPopover();
    renderList();
    if (!_outsideHandler) {
      _outsideHandler = (e) => {
        const target = e.composedPath ? e.composedPath()[0] : e.target;
        if (!target) return;
        if (A.els.notifPopover.contains(target) || A.els.notifBtn.contains(target)) return;
        closePopover();
      };
      setTimeout(() => document.addEventListener('mousedown', _outsideHandler, true), 0);
      window.addEventListener('resize', positionPopover);
    }
  }

  function closePopover() {
    if (!A.els || !A.els.notifPopover) return;
    A.els.notifPopover.classList.add('hidden');
    if (_outsideHandler) {
      document.removeEventListener('mousedown', _outsideHandler, true);
      window.removeEventListener('resize', positionPopover);
      _outsideHandler = null;
    }
  }

  function togglePopover() {
    if (!A.els || !A.els.notifPopover) return;
    if (A.els.notifPopover.classList.contains('hidden')) openPopover();
    else closePopover();
  }

  function markAllRead() {
    let changed = false;
    for (const n of _notices) {
      if (!_readIds.has(n.id)) { _readIds.add(n.id); changed = true; }
    }
    if (changed) {
      saveReadIds();
      renderBadge();
      renderList();
    }
  }

  function showCriticalToast(n) {
    const root = A.root;
    if (!root) return;
    const mask = document.createElement('div');
    mask.className = 'notif-toast-mask';
    mask.innerHTML = `
      <div class="notif-toast">
        <h3>${escapeHtml(n.title)}</h3>
        <div class="ct">${escapeHtml(n.content)}</div>
        <div class="row"><button type="button" class="primary" id="notifToastOk">我知道了</button></div>
      </div>`;
    root.appendChild(mask);
    const btn = mask.querySelector('#notifToastOk');
    if (btn) btn.addEventListener('click', () => {
      _readIds.add(n.id);
      saveReadIds();
      renderBadge();
      renderList();
      mask.remove();
    });
  }

  async function refresh() {
    if (!A.License || typeof A.License.fetchNotifications !== 'function') return;
    const list = await A.License.fetchNotifications();
    _notices = Array.isArray(list) ? list : [];
    renderBadge();
    if (!A.els.notifPopover.classList.contains('hidden')) renderList();
    for (const n of _notices) {
      if (n.level === 'critical' && !_readIds.has(n.id) && !_shownCriticalIds.has(n.id)) {
        _shownCriticalIds.add(n.id);
        showCriticalToast(n);
        break;
      }
    }
  }

  const Notifications = {
    async init(erp) {
      _erp = erp || '';
      _readIds = await loadReadIds(_erp);
      if (A.els && A.els.notifBtn) {
        A.els.notifBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePopover(); });
      }
      if (A.els && A.els.notifMarkRead) {
        A.els.notifMarkRead.addEventListener('click', markAllRead);
      }
      await refresh();
      if (_timer) clearInterval(_timer);
      _timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    },
    refresh,
    stop() { if (_timer) { clearInterval(_timer); _timer = null; } }
  };

  A.Notifications = Notifications;
})(window.SmsApp);
