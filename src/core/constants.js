'use strict';
(function (A) {
  // 注意：这里只保留"骨架默认值"。
  // 真正的业务知识（列名候选、SMS 关键字、CRM 探测端点）由服务端通过签名接口
  // /api/runtime-config 下发，并在 A.RuntimeConfig.load() 时合入本对象。
  // 这样攻击者反编译扩展也拿不到核心特征。
  A.constants = {
    // —— 由服务端覆盖（这里给空/最小兜底）——
    IGNORED_CREATORS: new Set(),
    CREATOR_COL_CANDIDATES: [],
    TRACKER_COL_CANDIDATES: [],
    EVENT_COL_CANDIDATES: [],
    ACCOUNT_COL_CANDIDATES: [],
    CRM_FUN_NAME: '',
    CRM_TREE_ENDPOINT_GUESSES: [],
    SMS_TARGET_SENDER_ID: 0,
    SMS_CONTENT_KEYWORDS: [],
    SMS_QUERY_WINDOW_DAYS: 5,
    SMS_QUERY_PAGE_SIZE: 50,
    SMS_QUERY_MAX_PAGES: 10,

    // —— 纯本地行为参数（不属于敏感知识，保留本地）——
    CRM_GROUP_ALL: '__GROUP_ALL__',
    CRM_DATE_RANGE_TODAY: 'today',
    CRM_DATE_RANGE_YESTERDAY_TODAY: 'yesterday_today',
    CRM_PAGE_CONCURRENCY: 6,
    RESULT_RENDER_BATCH_SIZE: 160,
    UI_YIELD_EVERY_ROWS: 10,
    SMS_QUERY_URL: 'https://sms.jd.com/sms-query.html',
    BATCH_CONCURRENCY: 16,
    PHONE_LOOKUP_CONCURRENCY: 8,
    SMS_QUERY_CONCURRENCY: 8,
    NO_SMS_HIT_DETAIL: '未查到评价短信',
    NO_PHONE_DETAIL: '未能提取来电号码',
    EXTENSION_CONTEXT_INVALIDATED_TEXT: '插件上下文已失效。通常是扩展被重新加载、更新或停用后，当前页面仍在运行旧脚本。请刷新当前页面后重新查询。'
  };
})(window.SmsApp);
