'use strict';
(function (A) {
  const T = A.Text;
  const C = A.constants;
  const ROW_HARD_TIMEOUT_MS = 60000;
  const Batch = {
    async run() {
      if (A.state.running) return;
      if (A.License && typeof A.License.assertActive === 'function') {
        try { A.License.assertActive(); }
        catch (e) {
          A.View.log('已停止：' + (e && e.message ? e.message : '许可证状态异常'));
          if (A.Blocked && A.License.ctx) {
            A.Blocked.showDisabled({ erp: A.License.ctx().erp, reason: '许可证已失效，请刷新页面重试。' });
          }
          return;
        }
      }
      if (A.License && typeof A.License.canUse === 'function' && !A.License.canUse('batch_query')) {
        A.View.log('已停止：管理员已禁用此账号的批量查询功能。');
        return;
      }
      if (A.state.crmData) A.View.syncCrmSelectionForRun();
      if (A.state.rows.length === 0) return;
      if (A.License && typeof A.License.assertQuotaForBatch === 'function') {
        try { A.License.assertQuotaForBatch(A.state.rows.length); }
        catch (e) {
          A.View.log('已停止：' + (e && e.message ? e.message : '超出配额'));
          return;
        }
      }
      A.state.running = true;
      A.state.stopped = false;
      A.state.results = [];
      if (!A.state.smsQueryCache) A.state.smsQueryCache = new Map();
      if (!A.state.phoneCache) A.state.phoneCache = new Map();
      A.View.clearResultsView();
      A.View.resetStats();
      const rows = (A.state.rows || []).slice();
      A.state.stats.total = rows.length;
      A.View.renderStats(true);
      A.View.updateButtons();
      const eventCol = A.els.eventCol.value;
      const accountCol = A.els.accountCol.value;
      const window = A.Matcher.timeWindow();
      A.View.log('开始查询：' + (A.state.sourceContext ? A.View.formatSourceContext(A.state.sourceContext) : (rows.length + ' 条')));
      await A.PhoneService.ensureHookReady(2500);
      const phoneLim = A.Async.createLimiter(C.PHONE_LOOKUP_CONCURRENCY);
      const smsLim = A.Async.createLimiter(C.SMS_QUERY_CONCURRENCY);
      let yieldCounter = 0;
      const processRow = async (row) => {
        if (A.state.stopped) return;
        const eventNo = T.clean(row[eventCol]);
        const account = T.clean(row[accountCol]);
        const trackerName = A.Tracker.nameOf(row);
        const trackerErp = A.Tracker.erpOf(row);
        const creator = A.CreatorRules.valueByCandidates(row, C.CREATOR_COL_CANDIDATES);
        if (A.CreatorRules.shouldIgnore(creator)) {
          A.state.stats.skipped++;
          A.View.renderStats();
          A.View.appendResult({ status: '跳过', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: '无需查询' });
          await A.View.yieldAfterBatch(++yieldCounter);
          return;
        }
        if (!eventNo) {
          A.state.stats.skipped++;
          A.View.renderStats();
          A.View.appendResult({ status: '跳过', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: '事件号为空' });
          await A.View.yieldAfterBatch(++yieldCounter);
          return;
        }
        // 每行的硬超时只包裹「真正在跑的网络操作」——电话查询、SMS 查询各自计时。
        // 排队等待（并发槽位 phoneLim/smsLim、节流 throttleRequest）一律不计入：
        // 否则像 2000+ 行的大批量，后面的行还没轮到执行，60s 计时器就从入队时刻
        // 开始走，导致它们被集体误判为「整行处理超时」。这正是大面积异常的根因。
        const withActiveTimeout = (p) => {
          let t;
          return Promise.race([
            Promise.resolve(p),
            new Promise((_, rej) => {
              t = setTimeout(
                () => rej(new Error('整行处理超时（' + Math.round(ROW_HARD_TIMEOUT_MS / 1000) + 's，单步执行）')),
                ROW_HARD_TIMEOUT_MS
              );
            })
          ]).finally(() => clearTimeout(t));
        };
        try {
          // 阶段 1：电话查询。phoneLim 排队不计时；计时从拿到槽位、真正发起查询才开始。
          const phoneInfo = await phoneLim(() => {
            // 拿到 limiter 槽位时如果已停止，直接给空号码 short-circuit；
            // 不再发起真正的网关查询，让队列快速排干。
            if (A.state.stopped) return { phone: '', raw: '' };
            return withActiveTimeout(A.PhoneService.lookupByCase(eventNo));
          });
          if (A.state.stopped) return;
          const phone = (phoneInfo && phoneInfo.phone) ? phoneInfo.phone : '';
          if (!phone) {
            A.state.stats.done++; A.state.stats.error++;
            A.View.appendResult({ status: '异常', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: C.NO_PHONE_DETAIL });
            A.View.renderStats();
            await A.View.yieldAfterBatch(++yieldCounter);
            return;
          }
          // 阶段 2：SMS 查询。smsLim 排队 + throttle 节流等待都不计时；只给真正的查询计时。
          const matches = await smsLim(async () => {
            if (A.License && typeof A.License.throttleRequest === 'function') {
              await A.License.throttleRequest();
            }
            if (A.state.stopped) return [];
            return withActiveTimeout(A.SmsService.queryAllPagesCached(phone, window));
          });
          if (A.state.stopped) return;
          A.state.stats.done++;
          if (matches.length) {
            A.state.stats.hit += matches.length;
            for (const m of matches) {
              A.View.appendResult({
                status: '命中', eventNo, trackerName, trackerErp, account, phone,
                smsSendTime: m.receiptArrivedTime || m.sendTime || '',
                detail: m.smsContent || '',
                senderId: m.senderId, senderNum: m.senderNum
              });
            }
          } else {
            A.state.stats.noHit++;
            A.View.appendResult({ status: '未命中', eventNo, trackerName, trackerErp, account, phone, smsSendTime: '', detail: C.NO_SMS_HIT_DETAIL });
          }
        } catch (e) {
          A.state.stats.done++; A.state.stats.error++;
          A.View.appendResult({ status: '异常', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: e.message || String(e) });
        }
        A.View.renderStats();
        await A.View.yieldAfterBatch(++yieldCounter);
      };
      const startedAt = Date.now();
      try {
        await Promise.all(rows.map(r => processRow(r)));
      } finally {
        A.View.flushResultsNow();
        await A.Async.yieldToBrowser();
        A.state.running = false;
        A.View.renderStats(true);
        A.View.updateButtons();
        A.els.exportBtn.disabled = A.state.results.filter(r => r.status === '命中').length === 0;
        const final = A.state.stopped ? '已停止' : '查询完成';
        A.View.log(final + '：命中 ' + A.state.stats.hit + '，未命中 ' + A.state.stats.noHit + '，异常 ' + A.state.stats.error + '，跳过 ' + A.state.stats.skipped + '。');
        if (A.License && A.License.isConfigured && A.License.isConfigured()) {
          try {
            A.License.reportBatch({
              total: A.state.stats.total,
              hit: A.state.stats.hit,
              noHit: A.state.stats.noHit,
              error: A.state.stats.error,
              skipped: A.state.stats.skipped,
              durationMs: Date.now() - startedAt,
              payload: { stopped: !!A.state.stopped }
            });
          } catch (_) {}
        }
      }
    },
    stop() {
      A.state.stopped = true;
      // 立刻释放节流闸门，让正在排队等"下一个 1 秒槽位"的请求一次性收尾，
      // 否则 stopped 标志要等几十秒才能传到队列尾部，state.running 也跟着卡住。
      if (A.License && typeof A.License.cancelThrottle === 'function') {
        try { A.License.cancelThrottle(); } catch (_) {}
      }
      A.View.log('已请求停止，正在收尾...');
    }
  };
  A.Batch = Batch;
})(window.SmsApp);
