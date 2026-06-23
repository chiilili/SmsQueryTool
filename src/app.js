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

      // 脱机版：业务知识（列名候选 / CRM 参数 / SMS 关键字 等）已内置在 constants.js，
      // 无需再从服务端拉取，这里不做任何运行时配置加载。

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
      };
      // 主实时通道：长轮询订阅（管理员改状态/命令/横幅 → 亚秒级生效，替代原 5 分钟轮询）
      if (typeof A.License.startRealtimeSubscribe === 'function') {
        A.License.startRealtimeSubscribe(handlePolicyUpdate);
      }
      // 兜底通道：心跳保留为低频保活，订阅断线时仍能定期拿到最新 policy
      A.License.startHeartbeat(handlePolicyUpdate);

      A.Panel.boot();
    }
  };
  A.App = App;
})(window.SmsApp);
