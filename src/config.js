'use strict';

// 全局配置与运行态。
const IGNORED_CREATORS = new Set(['org.jimi', 'robotlara']);
const CREATOR_COL_CANDIDATES = ['创建人', '创建人账号', '创建人erp', '创建人ERP', '创建者', '建单人', '登记人', '提交人'];
const TRACKER_COL_CANDIDATES = ['追踪人', '跟踪人', '跟进人', '追踪客服', '跟踪客服', '处理人', '责任人'];
const EVENT_COL_CANDIDATES = ['事件号', '事件编号', '事件ID', 'caseId', 'CASEID', 'case id', '工单号', '服务单号', '投诉单号', '问题单号', '单号'];
const ACCOUNT_COL_CANDIDATES = ['客户账户', '客户账号', '客户帐号', '客户帐户', '用户账号', '用户帐号', '用户账户', '客户名称', '账号名', '账户名', '账号', '用户pin', '用户PIN', '客户pin', '客户PIN', 'PIN', 'pin', '会员账号', '买家账号'];
const CRM_GROUP_ALL = '__GROUP_ALL__';
const RESULT_RENDER_BATCH_SIZE = 160;
const UI_YIELD_EVERY_ROWS = 10;

const CRM_DATE_RANGE_TODAY = 'today';
const CRM_DATE_RANGE_YESTERDAY_TODAY = 'yesterday_today';
const CRM_FUN_NAME = 'caseHandleCount';

// 短信查询：senderId=115 即"满意度回访短信"，smsContent 形如"尊敬的***呦~"。
const SMS_QUERY_URL = 'https://sms.jd.com/sms-query.html';
const SMS_TARGET_SENDER_ID = 115;
const SMS_CONTENT_KEYWORDS = ['尊敬的', '呦'];
const SMS_QUERY_WINDOW_DAYS = 5;
const SMS_QUERY_PAGE_SIZE = 50;
const SMS_QUERY_MAX_PAGES = 10;

const BATCH_CONCURRENCY = 16;
const PHONE_LOOKUP_CONCURRENCY = 8;
const SMS_QUERY_CONCURRENCY = 8;
const NO_SMS_HIT_DETAIL = '未查到评价短信';
const NO_PHONE_DETAIL = '未能提取来电号码';

let state = null;
let host = null;
let root = null;
let els = null;
let originalPageCache = null;

function createInitialState() {
  return {
    rows: [],
    headers: [],
    results: [],
    autoDetected: null,
    sourceContext: null,
    crmData: null,
    crmDateRangeMode: CRM_DATE_RANGE_TODAY,
    smsQueryCache: new Map(),
    phoneCache: new Map(),
    appMode: false,
    statsRenderScheduled: false,
    running: false,
    stopped: false,
    stats: { total: 0, done: 0, hit: 0, noHit: 0, error: 0, skipped: 0 },
    resultRenderQueue: [],
    resultRenderScheduled: false,
    columnFilters: {},
    filterPopoverCol: null,
    filterPopoverSelected: null,
    filterPopoverEntries: null
  };
}
