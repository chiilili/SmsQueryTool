'use strict';

// 文件完整性校验：在 background service worker 中读取扩展自身脚本 + manifest，
// 计算 SHA-256，给 content script 用以上报"当前包"的指纹。
// 服务端把指纹与该版本登记的 bundle_hash 对比，不一致即视为文件被篡改/损坏，
// 强制弹出升级提示。

const HASH_CACHE = { value: null, pending: null };

function bytesToHex(arr) {
  let hex = '';
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i].toString(16);
    hex += v.length === 1 ? '0' + v : v;
  }
  return hex;
}

async function sha256Hex(view) {
  const digest = await crypto.subtle.digest('SHA-256', view);
  return bytesToHex(new Uint8Array(digest));
}

async function readText(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path), { cache: 'no-store' });
    if (!res.ok) return '';
    return await res.text();
  } catch (_) { return ''; }
}

// 扫描 background service worker 文件里所有 importScripts(...) 引用的脚本路径，
// 它们在 manifest 顶层不可见，但仍是真实被执行的代码，必须纳入完整性校验。
function extractImportScripts(source) {
  if (!source) return [];
  const out = [];
  // 匹配 importScripts('a', 'b', "c"...) 任意个参数，处理空格 / 换行 / 注释边界
  const callRe = /importScripts\s*\(([^)]*)\)/g;
  let m;
  while ((m = callRe.exec(source))) {
    const argsBlob = m[1];
    const strRe = /["']([^"']+)["']/g;
    let s;
    while ((s = strRe.exec(argsBlob))) out.push(s[1]);
  }
  return out;
}

async function collectManifestFiles() {
  const m = chrome.runtime.getManifest();
  const files = new Set();
  files.add('manifest.json');
  const swPath = m.background && m.background.service_worker;
  if (swPath) {
    files.add(swPath);
    // 递归把 background 用 importScripts 拉进来的模块也加入校验集合
    const src = await readText(swPath);
    for (const dep of extractImportScripts(src)) files.add(dep);
  }
  for (const cs of (m.content_scripts || [])) {
    for (const js of (cs.js || [])) files.add(js);
    for (const css of (cs.css || [])) files.add(css);
  }
  if (m.declarative_net_request && Array.isArray(m.declarative_net_request.rule_resources)) {
    for (const r of m.declarative_net_request.rule_resources) {
      if (r && r.path) files.add(r.path);
    }
  }
  return Array.from(files).sort();
}

async function fetchFileBytes(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('fetch_failed:' + res.status);
  return await res.arrayBuffer();
}

async function computeBundleHashInner() {
  const files = await collectManifestFiles();
  const lines = [];
  const perFile = {};
  let missing = 0;
  for (const path of files) {
    let hash;
    try {
      const buf = await fetchFileBytes(path);
      hash = await sha256Hex(new Uint8Array(buf));
    } catch (_) {
      hash = 'MISSING';
      missing++;
    }
    perFile[path] = hash;
    lines.push(path + ':' + hash);
  }
  const finalHash = await sha256Hex(new TextEncoder().encode(lines.join('\n')));
  return {
    bundle_hash: finalHash,
    file_count: files.length,
    missing,
    files: perFile,
    version: chrome.runtime.getManifest().version || '',
    computed_at: Date.now()
  };
}

function getBundleHash() {
  if (HASH_CACHE.value) return Promise.resolve(HASH_CACHE.value);
  if (HASH_CACHE.pending) return HASH_CACHE.pending;
  HASH_CACHE.pending = computeBundleHashInner()
    .then(v => { HASH_CACHE.value = v; HASH_CACHE.pending = null; return v; })
    .catch(e => { HASH_CACHE.pending = null; throw e; });
  return HASH_CACHE.pending;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'JD_SMS_TOOL_BUNDLE_HASH') return false;
  getBundleHash()
    .then(data => sendResponse({ ok: true, data }))
    .catch(err => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
  return true;
});
