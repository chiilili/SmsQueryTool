'use strict';

// SMS 查询：sms.jd.com/sms-query.html POST，返回中按 senderId=115 + smsContent 关键字 + receiptArrivedTime 在 5 日窗口内判定命中。

async function runBatch() {
  if (state.running) return;
  if (state.crmData) syncCrmSelectionForRun();
  if (state.rows.length === 0) return;

  state.running = true;
  state.stopped = false;
  state.results = [];
  if (!state.smsQueryCache) state.smsQueryCache = new Map();
  if (!state.phoneCache) state.phoneCache = new Map();
  clearResultsView();
  resetStats();

  const rowsForRun = (state.rows || []).slice();
  state.stats.total = rowsForRun.length;
  renderStats(true);
  updateButtons();

  const eventCol = els.eventCol.value;
  const accountCol = els.accountCol.value;

  let timeRange;
  try {
    timeRange = getSmsTimeRange();
  } catch (err) {
    alert(err.message || String(err));
    state.running = false;
    updateButtons();
    return;
  }

  log(`开始查询：${state.sourceContext ? formatSourceContextForLog(state.sourceContext) : `${rowsForRun.length} 条`}`);

  // 预热 main world hook（仅一次）
  const hookStatus = await ensurePageHookReady(2500);
  if (!hookStatus.ready) {
    log('提示：未检测到 main world 钩子响应；若长时间未获取号码，请在 kfuad 页面操作一次以激活 Token。');
  }

  // 两阶段独立并发池：phone 查询用一个池，sms 查询用另一个池，两者可流水线并行。
  const phoneLimiter = createAsyncLimiter(PHONE_LOOKUP_CONCURRENCY);
  const smsLimiter = createAsyncLimiter(SMS_QUERY_CONCURRENCY);

  let renderedSinceYield = 0;
  const processRow = async (inputRow) => {
    if (state.stopped) return;
    const eventNo = clean(inputRow[eventCol]);
    const account = clean(inputRow[accountCol]);
    const trackerName = getTrackerNameFromRow(inputRow);
    const trackerErp = getTrackerErpFromRow(inputRow);
    const creator = getRowValueByCandidates(inputRow, CREATOR_COL_CANDIDATES);

    if (shouldIgnoreCreator(creator)) {
      state.stats.skipped++;
      renderStats();
      appendResult({ status: '跳过', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: '无需查询' });
      await yieldAfterResultBatch(++renderedSinceYield);
      return;
    }
    if (!eventNo) {
      state.stats.skipped++;
      renderStats();
      appendResult({ status: '跳过', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: '事件号为空' });
      await yieldAfterResultBatch(++renderedSinceYield);
      return;
    }

    try {
      const phoneInfo = await phoneLimiter(() => lookupPhoneByCase(eventNo));
      if (state.stopped) return;
      const phone = phoneInfo && phoneInfo.phone ? phoneInfo.phone : '';
      if (!phone) {
        state.stats.done++;
        state.stats.error++;
        appendResult({ status: '异常', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: NO_PHONE_DETAIL });
        renderStats();
        await yieldAfterResultBatch(++renderedSinceYield);
        return;
      }
      const matches = await smsLimiter(() => queryAllSmsPagesCached(phone, timeRange));
      if (state.stopped) return;
      state.stats.done++;
      if (matches.length) {
        state.stats.hit += matches.length;
        for (const m of matches) {
          appendResult({
            status: '命中',
            eventNo,
            trackerName,
            trackerErp,
            account,
            phone,
            smsSendTime: m.receiptArrivedTime || m.sendTime || '',
            detail: m.smsContent || '',
            senderId: m.senderId,
            senderNum: m.senderNum
          });
        }
      } else {
        state.stats.noHit++;
        appendResult({ status: '未命中', eventNo, trackerName, trackerErp, account, phone, smsSendTime: '', detail: NO_SMS_HIT_DETAIL });
      }
    } catch (err) {
      state.stats.done++;
      state.stats.error++;
      appendResult({ status: '异常', eventNo, trackerName, trackerErp, account, smsSendTime: '', detail: err.message || String(err) });
      console.debug('[115短信查询] 异常：', eventNo, err);
    }
    renderStats();
    await yieldAfterResultBatch(++renderedSinceYield);
  };

  try {
    await Promise.all(rowsForRun.map(row => processRow(row)));
  } finally {
    flushResultsNow();
    await yieldToBrowser();
    state.running = false;
    renderStats(true);
    updateButtons();
    els.exportBtn.disabled = state.results.filter(r => r.status === '命中').length === 0;
    const finalText = state.stopped ? '已停止' : '查询完成';
    log(`${finalText}：命中 ${state.stats.hit}，未命中 ${state.stats.noHit}，异常 ${state.stats.error}，跳过 ${state.stats.skipped}。`);
  }
}

function getSmsTimeRange() {
  const now = new Date();
  const start = new Date(now.getTime() - SMS_QUERY_WINDOW_DAYS * 24 * 3600 * 1000);
  return { start, end: now };
}

function buildSmsCacheKey(phone, timeRange) {
  const s = timeRange?.start ? timeRange.start.getTime() : '';
  const e = timeRange?.end ? timeRange.end.getTime() : '';
  return `sms|${phone}|${s}|${e}`;
}

async function queryAllSmsPagesCached(phone, timeRange) {
  if (!state.smsQueryCache) state.smsQueryCache = new Map();
  const key = buildSmsCacheKey(phone, timeRange);
  if (state.smsQueryCache.has(key)) return state.smsQueryCache.get(key);
  const promise = queryAllSmsPages(phone, timeRange);
  state.smsQueryCache.set(key, promise);
  return promise;
}

async function queryAllSmsPages(phone, timeRange) {
  const matches = [];
  const startStr = formatSmsTime(timeRange.start);
  const endStr = formatSmsTime(timeRange.end);
  const cutoffMs = timeRange.start.getTime();
  const nowMs = timeRange.end.getTime();

  for (let page = 1; page <= SMS_QUERY_MAX_PAGES; page++) {
    if (state.stopped) break;
    const payload = await querySmsOnce(phone, startStr, endStr, page, SMS_QUERY_PAGE_SIZE);
    const records = Array.isArray(payload?.records) ? payload.records : [];
    let oldestSeen = Infinity;
    for (const item of records) {
      const senderId = Number(item?.senderId);
      if (senderId !== SMS_TARGET_SENDER_ID) continue;
      const content = String(item?.smsContent || '');
      if (!SMS_CONTENT_KEYWORDS.every(k => content.includes(k))) continue;
      const arrivedMs = parseSmsDateTime(item?.receiptArrivedTime || item?.sendTime);
      if (!arrivedMs) continue;
      oldestSeen = Math.min(oldestSeen, arrivedMs);
      if (arrivedMs < cutoffMs || arrivedMs > nowMs) continue;
      matches.push(item);
    }
    const total = Number(payload?.total || 0);
    if (records.length < SMS_QUERY_PAGE_SIZE) break;
    if (total > 0 && page * SMS_QUERY_PAGE_SIZE >= total) break;
    if (oldestSeen !== Infinity && oldestSeen < cutoffMs) break;
    await yieldToBrowser();
  }
  return matches;
}

async function querySmsOnce(mobileNum, startTime, endTime, pageNo, pageSize) {
  const body = JSON.stringify({
    mobileNum,
    startTime,
    endTime,
    keyword: '',
    senderSource: 0,
    pageNo,
    pageSize
  });
  return runWithRetry(async () => {
    const res = await fetch(SMS_QUERY_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': 'application/json, text/plain, */*'
      },
      body
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch (_e) {
      if (/登录|login|passport/i.test(text)) throw new Error('sms.jd.com 登录态失效，请先登录');
      throw new Error('返回内容无法解析为 JSON');
    }
    if (json && json.success === false) throw new Error(json.message || 'SMS 接口失败');
    return json && json.result ? json.result : { records: [], total: 0 };
  });
}

function formatSmsTime(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseSmsDateTime(v) {
  const s = clean(v);
  if (!s) return 0;
  const m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se = '0'] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
    return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
  }
  const dt = new Date(s.replace(/-/g, '/'));
  return Number.isFinite(dt.getTime()) ? dt.getTime() : 0;
}
