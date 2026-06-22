'use strict';
(function (A) {
  const WindowCtl = {
    setBodyCollapsed(hidden) {
      A.els.body.classList.toggle('hidden', hidden);
      A.els.toggleBtn.textContent = hidden ? '+' : '−';
      A.els.minimizeBtn.title = hidden ? '展开' : '收起';
      A.els.minimizeBtn.setAttribute('aria-label', hidden ? '展开面板内容' : '收起面板内容');
    },
    toggleBody() { WindowCtl.setBodyCollapsed(!A.els.body.classList.contains('hidden')); },
    toggleMaximized() {
      const m = A.els.panel.classList.toggle('maximized');
      A.els.zoomBtn.title = m ? '还原' : '最大化';
      A.els.zoomBtn.setAttribute('aria-label', m ? '还原面板' : '最大化面板');
    },
    hideToPill() { A.els.panel.classList.add('hidden'); A.els.restoreBtn.classList.remove('hidden'); },
    restoreFromPill() { A.els.panel.classList.remove('hidden'); A.els.restoreBtn.classList.add('hidden'); },
    makeDraggable() {
      if (A.state && A.state.appMode) return;
      let dragging = false, sx = 0, sy = 0, lx = 0, ty = 0;
      A.els.dragHandle.addEventListener('mousedown', e => {
        if (e.target && e.target.closest && e.target.closest('button, .window-dots')) return;
        if (A.els.panel.classList.contains('maximized')) return;
        dragging = true; sx = e.clientX; sy = e.clientY;
        const r = A.els.panel.getBoundingClientRect();
        lx = r.left; ty = r.top;
        A.els.panel.style.transform = 'none';
        A.els.panel.style.left = lx + 'px';
        A.els.panel.style.top = ty + 'px';
        A.els.panel.style.right = 'auto';
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        const maxLeft = Math.max(0, window.innerWidth - A.els.panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - A.els.panel.offsetHeight);
        A.els.panel.style.left = Math.min(maxLeft, Math.max(0, lx + dx)) + 'px';
        A.els.panel.style.top = Math.min(maxTop, Math.max(0, ty + dy)) + 'px';
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    }
  };
  A.WindowCtl = WindowCtl;
})(window.SmsApp);
