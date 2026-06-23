'use strict';
(function (A) {
  // 脱机版：业务知识全部内置在本地，不再依赖服务端 /api/runtime-config 下发。
  // 单机即可运行，无需联网到授权服务器。
  A.constants = {
    // —— 内置业务知识（原由服务端下发，现改为本地常量）——
    IGNORED_CREATORS: new Set(['org.jimi', 'robotlara']),
    CREATOR_COL_CANDIDATES: ['创建人', '创建人账号', '创建人erp', '创建人ERP', '创建者', '建单人', '登记人', '提交人'],
    TRACKER_COL_CANDIDATES: ['追踪人', '跟踪人', '跟进人', '追踪客服', '跟踪客服', '处理人', '责任人'],
    EVENT_COL_CANDIDATES: ['事件号', '事件编号', '事件ID', 'caseId', 'CASEID', 'case id', '工单号', '服务单号', '投诉单号', '问题单号', '单号'],
    ACCOUNT_COL_CANDIDATES: ['客户账户', '客户账号', '客户帐号', '客户帐户', '用户账号', '用户帐号', '用户账户', '客户名称', '账号名', '账户名', '账号', '用户pin', '用户PIN', '客户pin', '客户PIN', 'PIN', 'pin', '会员账号', '买家账号'],
    CRM_FUN_NAME: 'caseHandleCount',
    CRM_TREE_ENDPOINT_GUESSES: [],
    SMS_TARGET_SENDER_ID: 115,
    SMS_CONTENT_KEYWORDS: ['尊敬的', '呦'],
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
