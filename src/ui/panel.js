'use strict';
(function (A) {
  const Panel = {
    boot() {
      if (document.getElementById('jdsms-tool-host')) return;
      A.state = A.State.createInitial();
      A.state.appMode = Panel.shouldUseStandalone();
      A.host = document.createElement('div');
      A.host.id = 'jdsms-tool-host';
      if (A.state.appMode) A.host.className = 'app-mode';
      A.host.style.cssText = 'display:block;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
      document.documentElement.appendChild(A.host);
      A.root = A.host.attachShadow({ mode: 'open' });
      A.root.innerHTML = A.Template.html();
      Panel.installScopedCursorStyle();
      Panel.bindEls();
      if (A.state.appMode) Panel.installStandalone();
      A.View.renderRuntimeTitle();
      A.Events.bindAll();
    },
    bindEls() {
      const $ = id => A.root.getElementById(id);
      A.els = {
        panel: $('panel'), body: $('body'), dragHandle: $('dragHandle'), toggleBtn: $('toggleBtn'),
        runtimeTitle: $('runtimeTitle'), closeBtn: $('closeBtn'), minimizeBtn: $('minimizeBtn'), zoomBtn: $('zoomBtn'), restoreBtn: $('restoreBtn'),
        crmPersonSelect: $('crmPersonSelect'), crmDateRange: $('crmDateRange'), loadCrmBtn: $('loadCrmBtn'), sourceSummary: $('sourceSummary'),
        sourceChannel: $('sourceChannel'), customUrlRow: $('customUrlRow'), customSourceUrl: $('customSourceUrl'),
        savedCrmRow: $('savedCrmRow'), savedCrmSelect: $('savedCrmSelect'), deleteCrmBtn: $('deleteCrmBtn'),
        crmNameRow: $('crmNameRow'), crmNameInput: $('crmNameInput'), saveCrmBtn: $('saveCrmBtn'),
        accountCol: $('accountCol'), eventCol: $('eventCol'), detectStatus: $('detectStatus'),
        startBtn: $('startBtn'), stopBtn: $('stopBtn'), exportBtn: $('exportBtn'), clearBtn: $('clearBtn'),
        speedRange: $('speedRange'), speedReadout: $('speedReadout'),
        log: $('log'), resultBody: $('resultBody'), bar: $('bar'),
        sTotal: $('sTotal'), sDone: $('sDone'), sHit: $('sHit'), sNoHit: $('sNoHit'), sError: $('sError'), sSkipped: $('sSkipped'),
        filterPopover: $('filterPopover'), filterPopoverTitle: $('filterPopoverTitle'),
        filterPopoverSearch: $('filterPopoverSearch'), filterPopoverList: $('filterPopoverList'),
        filterPopoverApply: $('filterPopoverApply'), filterPopoverCancel: $('filterPopoverCancel'), filterPopoverClear: $('filterPopoverClear'),
      };
    },
    shouldUseStandalone() {
      return location.hostname === 'sms.jd.com' && location.pathname.indexOf('/ext/TextSMSList.html') >= 0;
    },
    installStandalone() {
      if (!document.body || document.body.dataset.jdsmsStandaloneHome === '1') return;
      document.body.dataset.jdsmsStandaloneHome = '1';
      while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
      document.documentElement.classList.add('jdsms-standalone-home-html');
      document.body.classList.add('jdsms-standalone-home-body');
      const fix = (el, k, v) => el.style.setProperty(k, v, 'important');
      fix(document.documentElement, 'width', '100%');
      fix(document.documentElement, 'height', '100%');
      fix(document.documentElement, 'margin', '0');
      fix(document.documentElement, 'overflow', 'hidden');
      fix(document.body, 'width', '100%');
      fix(document.body, 'height', '100%');
      fix(document.body, 'margin', '0');
      fix(document.body, 'overflow', 'hidden');
      fix(document.body, 'background', '#f5f5f7');
      const style = document.createElement('style');
      style.id = 'jdsms-standalone-home-style';
      style.textContent = 'html.jdsms-standalone-home-html,body.jdsms-standalone-home-body{width:100% !important;height:100% !important;margin:0 !important;overflow:hidden !important;background:#f5f5f7 !important;}';
      (document.head || document.documentElement).appendChild(style);
    },
    installScopedCursorStyle() {
      const arrow = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cpath d='M5 3.5L21.5 18.6l-8.2 1.1 4.3 7.3-3.1 1.8-4.4-7.5-5.1 5.1z' fill='white' stroke='black' stroke-width='1.45' stroke-linejoin='round'/%3E%3C/svg%3E\") 5 3";
      const hand = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M12.8 28.5c-1.4-1.4-3.8-4.2-5.1-6.4-.7-1.2-.4-2.4.6-2.9.9-.5 1.8-.2 2.6.6l1 1V8.6a1.8 1.8 0 0 1 3.6 0v7.7h.5v-2.5a1.8 1.8 0 0 1 3.6 0v2.5h.5v-1.8a1.8 1.8 0 0 1 3.6 0v2.5h.4a1.8 1.8 0 0 1 3.5.5v4.3c0 3.7-2.9 6.7-6.6 6.7z' fill='white' stroke='black' stroke-width='1.35' stroke-linejoin='round'/%3E%3C/svg%3E\") 13 7";
      if (A.root && A.root.host) {
        A.root.host.style.setProperty('--jdbean-cursor-arrow', arrow);
        A.root.host.style.setProperty('--jdbean-cursor-hand', hand);
      }
    }
  };
  A.Panel = Panel;
})(window.SmsApp);
