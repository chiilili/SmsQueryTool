'use strict';
(function (A) {
  const Events = {
    bindAll() {
      Events.bindActions();
      Events.bindSpeed();
      Events.bindSavedSources();
      Events.bindFilter();
      A.View.initDataSourceControls();
      A.View.renderSourceSummary();
      A.WindowCtl.makeDraggable();
    },
    // 自定义CRM来源：命名保存到本地、下拉复用、删除。
    bindSavedSources() {
      const sel = A.els.savedCrmSelect, saveBtn = A.els.saveCrmBtn, delBtn = A.els.deleteCrmBtn;
      const urlInput = A.els.customSourceUrl, nameInput = A.els.crmNameInput;
      if (!sel || !saveBtn || !A.CrmCtl || typeof A.CrmCtl.saveSource !== 'function') return;
      // 首次填充下拉
      A.CrmCtl.refreshSavedSelect();
      // 选择已存来源 → 回填URL与名称
      sel.addEventListener('change', async () => {
        if (delBtn) delBtn.disabled = !sel.value;
        if (!sel.value) return;
        const arr = await A.CrmCtl.listSavedSources();
        const item = arr.find(s => s.id === sel.value);
        if (!item) return;
        if (urlInput) urlInput.value = item.url;
        if (nameInput) nameInput.value = item.name;
        A.View.log('已载入来源「' + item.name + '」，点击"获取数据"开始查询。');
      });
      // 保存当前URL到本地
      saveBtn.addEventListener('click', async () => {
        const name = (nameInput && nameInput.value) || '';
        const url = (urlInput && urlInput.value) || '';
        const res = await A.CrmCtl.saveSource(name, url);
        if (res.error) { alert(res.error); return; }
        await A.CrmCtl.refreshSavedSelect(res.item.id);
        A.View.log('已保存来源「' + res.item.name + '」到本地，下次可直接在"已存来源"里选用。');
      });
      // 删除选中的已存来源
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!sel.value) return;
          const arr = await A.CrmCtl.listSavedSources();
          const item = arr.find(s => s.id === sel.value);
          if (!item) return;
          if (!confirm('删除已保存来源「' + item.name + '」？此操作不可撤销。')) return;
          await A.CrmCtl.removeSavedSource(item.id);
          await A.CrmCtl.refreshSavedSelect();
          A.View.log('已删除来源「' + item.name + '」。');
        });
      }
    },
    // 速率档位：🐢温和 / ⚡标准 / 🚀极速。选择即时生效并持久化到 chrome.storage.local，
    // 下次打开自动恢复。批量进行中禁用切换，避免中途改速率造成统计困惑。
    bindSpeed() {
      const seg = A.els.speedSeg;
      if (!seg || !A.License || typeof A.License.setSpeedPreset !== 'function') return;
      const STORE_KEY = 'jd_sms_speed_preset';
      const opts = Array.from(seg.querySelectorAll('.speed-opt'));
      const reflect = (name) => {
        opts.forEach(b => b.classList.toggle('active', b.dataset.speed === name));
      };
      const apply = (name, persist) => {
        if (!A.License.setSpeedPreset(name)) return;
        reflect(A.License.currentSpeedPreset());
        if (persist) {
          try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({ [STORE_KEY]: name });
            }
          } catch (_) {}
        }
      };
      // 恢复上次选择
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORE_KEY], r => {
            const saved = r && r[STORE_KEY];
            if (saved && A.License.speedPresets && A.License.speedPresets()[saved] != null) apply(saved, false);
            else reflect(A.License.currentSpeedPreset());
          });
        } else {
          reflect(A.License.currentSpeedPreset());
        }
      } catch (_) { reflect(A.License.currentSpeedPreset()); }
      // 点击切换
      seg.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('.speed-opt') : null;
        if (!btn || !seg.contains(btn)) return;
        if (A.state && A.state.running) return; // 跑批中不允许切换
        apply(btn.dataset.speed, true);
      });
    },
    bindActions() {
      A.els.startBtn.addEventListener('click', () => A.Batch.run().catch(e => {
        console.error(e);
        A.Runtime.handleInvalidated(e);
        A.View.log('执行失败：' + A.Runtime.toFriendlyError(e));
        A.state.running = false;
        A.View.updateButtons();
      }));
      A.els.stopBtn.addEventListener('click', () => A.Batch.stop());
      A.els.exportBtn.addEventListener('click', () => {
        if (A.License && typeof A.License.canUse === 'function' && !A.License.canUse('export_csv')) {
          alert('管理员已禁用此账号的 CSV 导出功能。');
          return;
        }
        A.Csv.exportHits();
      });
      A.els.loadCrmBtn.addEventListener('click', () => A.CrmCtl.load().catch(e => {
        console.error(e);
        A.Runtime.handleInvalidated(e);
        const f = A.Runtime.toFriendlyError(e);
        alert('读取CRM数据失败：' + f);
        A.View.log('读取CRM数据失败：' + f);
        A.els.loadCrmBtn.disabled = false;
      }));
      if (A.els.crmDateRange) A.els.crmDateRange.addEventListener('change', () => A.View.resetCrmLoadedForRangeChange());
      if (A.els.sourceChannel) A.els.sourceChannel.addEventListener('change', () => A.View.applySourceChannel());
      A.els.crmPersonSelect.addEventListener('change', () => A.View.applyCrmPersonSelection());
      A.els.clearBtn.addEventListener('click', () => Events.reset());
      A.els.toggleBtn.addEventListener('click', () => A.WindowCtl.toggleBody());
      A.els.minimizeBtn.addEventListener('click', e => { e.stopPropagation(); A.WindowCtl.toggleBody(); });
      A.els.zoomBtn.addEventListener('click', e => { e.stopPropagation(); A.WindowCtl.toggleMaximized(); });
      A.els.closeBtn.addEventListener('click', e => { e.stopPropagation(); A.WindowCtl.hideToPill(); });
      A.els.restoreBtn.addEventListener('click', () => A.WindowCtl.restoreFromPill());
      if (A.els.checkUpdateBtn && A.VersionCheck) {
        A.els.checkUpdateBtn.addEventListener('click', () => {
          A.VersionCheck.check({ silent: false }).catch(e => console.warn('[SmsQueryTool] 检查更新失败：', e));
        });
      }
    },
    reset() {
      // 若有正在跑的批量，先发停止信号并把节流队列一次性释放掉，
      // 否则 state.running 会保持 true，updateButtons() 就把获取/开始全锁住。
      A.state.stopped = true;
      if (A.License && typeof A.License.cancelThrottle === 'function') {
        try { A.License.cancelThrottle(); } catch (_) {}
      }
      A.state.running = false;
      A.state.rows = []; A.state.headers = []; A.state.results = [];
      A.state.crmData = null;
      A.state.crmDateRangeMode = A.constants.CRM_DATE_RANGE_TODAY;
      A.state.sourceContext = null;
      A.state.smsQueryCache = new Map(); A.state.phoneCache = new Map();
      A.els.accountCol.innerHTML = ''; A.els.eventCol.innerHTML = '';
      if (A.els.crmDateRange) A.els.crmDateRange.value = A.constants.CRM_DATE_RANGE_TODAY;
      if (A.els.sourceChannel) A.els.sourceChannel.value = 'crm';
      if (A.els.customSourceUrl) A.els.customSourceUrl.value = '';
      if (A.els.crmNameInput) A.els.crmNameInput.value = '';
      if (A.els.savedCrmSelect) A.els.savedCrmSelect.value = '';
      if (A.els.deleteCrmBtn) A.els.deleteCrmBtn.disabled = true;
      A.View.setCustomRowsVisible(false);
      const info = A.CrmRange.selected();
      A.els.crmPersonSelect.innerHTML = '<option value="">请先读取数据</option>';
      A.state.autoDetected = null;
      A.View.renderSourceSummary();
      A.els.detectStatus.textContent = '数据日期：' + info.optionLabel;
      A.View.clearResultsView();
      A.els.log.textContent = '数据日期：' + info.optionLabel;
      A.View.resetStats();
      A.els.exportBtn.disabled = true;
      // 用 updateButtons 统一刷新所有按钮（获取数据、开始、停止、各下拉框），
      // 而不是手工逐个 disabled=true/false，避免漏配。
      A.View.updateButtons();
    },
    bindFilter() {
      if (!A.els.panel || !A.els.filterPopover) return;
      A.els.panel.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('.th-filter');
        if (!btn || !A.root.contains(btn)) return;
        e.stopPropagation();
        const colKey = btn.dataset.colKey;
        if (A.state.filterPopoverCol === colKey && !A.els.filterPopover.classList.contains('hidden')) A.Filter.close();
        else A.Filter.open(colKey, btn);
      });
      A.els.filterPopover.addEventListener('click', e => e.stopPropagation());
      A.els.filterPopoverSearch.addEventListener('input', e => A.Filter.renderList(e.target.value));
      A.els.filterPopoverList.addEventListener('change', e => {
        const input = e.target;
        if (!input || input.type !== 'checkbox') return;
        if (input.dataset.all === '1') {
          const values = A.Filter.currentFilteredValues();
          if (input.checked) values.forEach(v => A.state.filterPopoverSelected.add(v));
          else values.forEach(v => A.state.filterPopoverSelected.delete(v));
          A.Filter.renderList(A.els.filterPopoverSearch.value);
          return;
        }
        const idx = Number(input.dataset.idx);
        const values = A.Filter.currentFilteredValues();
        const value = values[idx];
        if (value == null) return;
        if (input.checked) A.state.filterPopoverSelected.add(value);
        else A.state.filterPopoverSelected.delete(value);
        const master = A.els.filterPopoverList.querySelector('input[data-all="1"]');
        if (master) master.checked = values.length > 0 && values.every(v => A.state.filterPopoverSelected.has(v));
      });
      A.els.filterPopoverApply.addEventListener('click', () => A.Filter.apply());
      A.els.filterPopoverCancel.addEventListener('click', () => A.Filter.close());
      A.els.filterPopoverClear.addEventListener('click', () => A.Filter.clearForCurrent());
      A.root.addEventListener('click', e => {
        if (A.els.filterPopover.classList.contains('hidden')) return;
        if (A.els.filterPopover.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.th-filter')) return;
        A.Filter.close();
      });
      document.addEventListener('click', () => { if (!A.els.filterPopover.classList.contains('hidden')) A.Filter.close(); });
      window.addEventListener('keydown', e => { if (e.key === 'Escape' && !A.els.filterPopover.classList.contains('hidden')) A.Filter.close(); });
      window.addEventListener('resize', () => { if (!A.els.filterPopover.classList.contains('hidden')) A.Filter.close(); });
      window.addEventListener('scroll', () => { if (!A.els.filterPopover.classList.contains('hidden')) A.Filter.close(); }, true);
    }
  };
  A.Events = Events;
})(window.SmsApp);
