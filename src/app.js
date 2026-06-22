'use strict';
(function (A) {
  const App = {
    async boot() {
      A.Runtime.installGuard();
      if (A.CrmExportButton.isMonitorPage()) {
        A.CrmExportButton.install();
        return;
      }

      if (!A.License || !A.License.isConfigured()) {
        A.Blocked.showOfflineNotice({ reason: '扩展未正确配置（缺少授权信息），请联系管理员。' });
        return;
      }

      let info = { erp: '' };
      try { info = await A.UserService.fetchErp(); } catch (_e) {}
      const erp = (info && info.erp) ? info.erp : '';
      if (!erp) {
        A.Blocked.showOfflineNotice({ reason: '无法识别您的 ERP，请确认已登录京东内网账号后刷新。' });
        return;
      }

      let policy = null;
      try {
        policy = await A.License.handshake(erp);
      } catch (e) {
        A.Blocked.showOfflineNotice({ erp, reason: '服务器握手失败：' + (e && e.message ? e.message : String(e)) });
        return;
      }

      const ctx = A.License.ctx();

      if (policy.integrity_failed) {
        A.Blocked.showIntegrityFailed({
          erp,
          currentVersion: ctx.version,
          latestVersion: policy.latest_version,
          downloadUrl: policy.download_url,
          message: policy.message
        });
        return;
      }
      if (policy.force_update) {
        A.Blocked.showForceUpdate({
          erp,
          currentVersion: ctx.version,
          latestVersion: policy.latest_version,
          downloadUrl: policy.download_url,
          releaseNotes: policy.release_notes
        });
        return;
      }
      if (policy.enabled === false) {
        A.Blocked.showDisabled({ erp, reason: policy.message, version: ctx.version });
        return;
      }

      // 处理服务端下发的一次性命令
      function applyCommand(p) {
        if (!p || !p.command) return;
        if (p.command === 'force_reload') {
          try { location.reload(); } catch (_) {}
        } else if (p.command === 'force_logout') {
          try { A.License.stopHeartbeat(); } catch (_) {}
          A.Blocked.showDisabled({ erp, reason: '管理员已强制下线该账号，请联系管理员。', version: ctx.version });
        }
      }
      applyCommand(policy);

      // 拉取并合入服务端下发的业务知识（列名候选 / CRM 探测端点 / SMS 关键字 等）。
      // 失败时降级到本地缓存或骨架默认值——但 CRM 探测会因为没有 endpoint 列表而失效，
      // 这是把核心逻辑搬到服务端的代价，也是安全收益。
      try {
        if (A.RuntimeConfig && typeof A.RuntimeConfig.load === 'function') {
          const r = await A.RuntimeConfig.load();
          if (r && r.source === 'defaults') {
            console.warn('[SmsQueryTool] 未能从服务端获取业务配置，将使用本地兜底默认值。');
          }
        }
      } catch (e) {
        console.warn('[SmsQueryTool] 拉取业务配置异常：', e && e.message ? e.message : e);
      }

      // 收到任意 policy 更新（订阅推送 or 心跳）后的统一处理：命令 / 阻断 / 横幅。
      const handlePolicyUpdate = (next) => {
        applyCommand(next);
        if (next && next.integrity_failed) {
          A.Blocked.showIntegrityFailed({
            erp, currentVersion: ctx.version,
            latestVersion: next.latest_version, downloadUrl: next.download_url, message: next.message
          });
        } else if (next && next.force_update) {
          A.Blocked.showForceUpdate({
            erp, currentVersion: ctx.version,
            latestVersion: next.latest_version, downloadUrl: next.download_url, releaseNotes: next.release_notes
          });
        } else if (next && next.enabled === false) {
          A.Blocked.showDisabled({ erp, reason: next.message, version: ctx.version });
        }
        // 把 policy 里的最新横幅刷新到面板顶部
        try {
          if (A.VersionCheck && typeof A.VersionCheck.renderBannerIfAny === 'function') {
            A.VersionCheck.renderBannerIfAny().catch(() => {});
          }
        } catch (_) {}
      };
      // 主实时通道：长轮询订阅（管理员改状态/命令/横幅 → 亚秒级生效，替代原 5 分钟轮询）
      if (typeof A.License.startRealtimeSubscribe === 'function') {
        A.License.startRealtimeSubscribe(handlePolicyUpdate);
      }
      // 兜底通道：心跳保留为低频保活，订阅断线时仍能定期拿到最新 policy
      A.License.startHeartbeat(handlePolicyUpdate);

      A.Panel.boot();

      if (A.Notifications && typeof A.Notifications.init === 'function') {
        A.Notifications.init(erp).catch(() => {});
      }

      // 「检查更新」标记 + 「What's New」自动弹窗 + 远程横幅渲染
      try {
        if (A.VersionCheck) {
          // 顶栏更新按钮高亮（有可用新版本时变橙）
          if (policy && policy.update_available && A.els && A.els.checkUpdateBtn) {
            A.els.checkUpdateBtn.classList.add('has-update');
            A.els.checkUpdateBtn.title = '发现新版本 v' + (policy.latest_version || '');
          }
          A.VersionCheck.showWhatsNewIfUpgraded().catch(() => {});
          A.VersionCheck.renderBannerIfAny().catch(() => {});
        }
      } catch (e) { console.warn('[SmsQueryTool] 版本/横幅初始化失败：', e); }
    }
  };
  A.App = App;
})(window.SmsApp);
