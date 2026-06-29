/**
 * SmsQueryTool · Page Hook（Main World）
 *
 * 1. 拦截 fetch / XHR 嗅探 x-mlaas-at 鉴权 Token，并通过 postMessage 回传给 content 端
 * 2. 接收 content 端的 JD_SMS_QUERY_CASE_REQUEST，在主世界发起 man-sff.jd.com 的网关查询
 */

(function () {
  const originalFetch = window.fetch;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  let capturedToken = window.__JD_SMS_TOOL_TOKEN__ || '';

  function updateCapturedToken(token) {
    if (!token || token === capturedToken) return;
    capturedToken = token;
    window.__JD_SMS_TOOL_TOKEN__ = token;
    window.postMessage({ type: 'JD_SMS_TOKEN_CAPTURED', token }, '*');
  }

  function headerValue(headers, name) {
    if (!headers) return null;
    const target = String(name || '').toLowerCase();
    if (headers instanceof Headers) return headers.get(target);
    if (Array.isArray(headers)) {
      for (const pair of headers) {
        if (!pair || pair.length < 2) continue;
        if (String(pair[0] || '').toLowerCase() === target) return pair[1];
      }
      return null;
    }
    if (typeof headers === 'object') {
      const key = Object.keys(headers).find(k => k.toLowerCase() === target);
      return key ? headers[key] : null;
    }
    return null;
  }

  window.fetch = function (resource, init) {
    const initToken = init && headerValue(init.headers, 'x-mlaas-at');
    const requestToken = !initToken && resource instanceof Request ? headerValue(resource.headers, 'x-mlaas-at') : null;
    const token = initToken || requestToken;
    if (token) updateCapturedToken(token);
    return originalFetch.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (header && header.toLowerCase() === 'x-mlaas-at') updateCapturedToken(value);
    return originalXHRSetHeader.apply(this, arguments);
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'JD_SMS_RESTORE_TOKEN') {
      if (!capturedToken && event.data.token) {
        capturedToken = event.data.token;
        window.__JD_SMS_TOOL_TOKEN__ = event.data.token;
      }
      return;
    }
    // 显式替换：当后台自动刷新了鉴权（kfuad 后台标签嗅到新 Token）后，
    // 跨标签的 storage 变更会广播到本页，page-hook 必须接受新 Token 覆盖旧的。
    if (event.data.type === 'JD_SMS_REPLACE_TOKEN') {
      if (event.data.token) {
        capturedToken = event.data.token;
        window.__JD_SMS_TOOL_TOKEN__ = event.data.token;
      }
      return;
    }
    if (event.data.type === 'JD_SMS_PING_REQUEST') {
      window.postMessage({ type: 'JD_SMS_PING_RESPONSE', token: capturedToken }, '*');
      return;
    }
    if (event.data.type === 'JD_SMS_QUERY_CASE_REQUEST') {
      const { queryId, caseId } = event.data;
      if (!caseId) {
        sendResponse(queryId, false, null, '事件号为空');
        return;
      }
      if (!capturedToken) capturedToken = window.__JD_SMS_TOOL_TOKEN__ || '';
      if (!capturedToken) {
        sendResponse(queryId, false, null, '鉴权已失效，请打开 kfuad 页面刷新后再重试');
        return;
      }
      executeJDQuery(caseId, capturedToken)
        .then(data => sendResponse(queryId, true, data, null))
        .catch(err => sendResponse(queryId, false, null, err.message || '网关通信失败'));
    }
  });

  function sendResponse(queryId, success, data, error) {
    window.postMessage({ type: 'JD_SMS_QUERY_CASE_RESPONSE', queryId, success, data, error }, '*');
  }

  async function executeJDQuery(caseId, token) {
    const url = 'https://man-sff.jd.com/api?appId=4EVU3SJ9MVHN0RL1SJLN&v=1.0&api=dsm.uad.info.crm.CaseDomainApiService.getCaseResource';
    const payload = {
      apiRequestDTO: {
        authType: '5',
        buId: '301',
        lang: 'zh_CN',
        body: String(caseId).trim(),
        params: { activeScreenType: '', activeScreenId: '' }
      }
    };
    const res = await originalFetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'dsm-platform': 'erp',
        'x-mlaas-at': token
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`网关响应HTTP状态异常: ${res.status}`);
    return await res.text();
  }
})();
