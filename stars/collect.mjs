#!/usr/bin/env node
/**
 * collect.mjs — GitHub 手机/电脑应用 Stars 排行榜采集器
 *
 * 原理：
 *   1) 用 Search API 按「topic × star 区间」分片枚举候选仓库（绕开 1000 条结果上限）
 *   2) 每天存一份快照 data/snapshots/<YYYY-MM-DD>.json  {repo: stars}
 *   3) 排行榜 = 当前 stars - N 天前快照里的 stars（日/周/月/年）
 *   4) 历史不足时，可用 --backfill 调 stargazers(starred_at) 二分回填精确baseline
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node collect.mjs              # 每天跑
 *   GITHUB_TOKEN=xxx node collect.mjs --backfill   # 手动跑一次，回填日/周/月/年 baseline
 *   node collect.mjs --smoke                       # 本地小样本自测（无需 token）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(HERE, 'data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const META_FILE = path.join(DATA_DIR, 'repos.json');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');
const SEED_FILE = path.join(DATA_DIR, 'seeds.txt');

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };

const SMOKE = hasFlag('--smoke');
const DO_BACKFILL = hasFlag('--backfill');
const OFFLINE = hasFlag('--offline');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GSB_TOKEN || process.env.GH_TOKEN || '';
const GAP_MS = Number(opt('--gap', SMOKE ? 6600 : 2300));       // search API: 认证 30 次/分钟
const MAX_PAGES = Number(opt('--max-pages', SMOKE ? 1 : 3));
const MIN_STARS = Number(opt('--min-stars', 500));
const BACKFILL_REPOS = Number(opt('--backfill-repos', 80));
const BACKFILL_BUDGET = Number(opt('--backfill-budget', 3000));
const BOARD_SIZE = Number(opt('--board-size', 200));

const MOBILE_TOPICS = SMOKE
  ? ['android', 'flutter']
  : ['android', 'android-app', 'ios', 'ios-app', 'flutter', 'flutter-app', 'react-native',
     'mobile-app', 'apk', 'termux', 'kotlin-android', 'swiftui', 'ionic', 'expo'];
const DESKTOP_TOPICS = SMOKE
  ? ['desktop-app']
  : ['desktop-app', 'electron', 'tauri', 'windows', 'macos', 'linux-app', 'gtk',
     'qt', 'wpf', 'winui', 'gui-app', 'cross-platform', 'webview', 'flutter-desktop'];

// 日/周/月/年：daysAgo 目标回看天数；tol 允许的 baseline 日期误差（天）
const PERIODS = [
  { key: 'day',   label: '日榜', days: 1,   tol: 2 },
  { key: 'week',  label: '周榜', days: 7,   tol: 3 },
  { key: 'month', label: '月榜', days: 30,  tol: 8 },
  { key: 'year',  label: '年榜', days: 365, tol: 45 },
];

const DAY_MS = 86400000;
const now = new Date();
const todayStr = isoDay(now);

/* ------------------------------------------------------------------ utils */
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
}
function log(...a) { console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); }

/* ------------------------------------------------------------------- 网络 */
let rlRemaining = Infinity, rlReset = 0;
let archivedQualifierOk = true;

async function api(url, { expectJson = true } = {}) {
  const headers = {
    'User-Agent': 'gh-stars-board/1.0',
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  for (let attempt = 0; attempt < 6; attempt++) {
    if (rlRemaining <= 2 && rlReset > Date.now()) {
      const wait = Math.min(rlReset - Date.now() + 1500, 90000);
      log(`限速保护：剩余 ${rlRemaining}，等待 ${Math.round(wait / 1000)}s`);
      await sleep(wait);
    }
    let res;
    try {
      res = await fetch(url, { headers });
    } catch (e) {
      log(`网络错误 ${e.message}，重试`);
      await sleep(3000 + attempt * 4000);
      continue;
    }
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem != null) rlRemaining = Number(rem);
    const reset = res.headers.get('x-ratelimit-reset');
    if (reset != null) rlReset = Number(reset) * 1000;

    if (res.status === 422) {                       // 查询语法被拒 → 返回给调用方处理
      return { status: 422, data: await res.json().catch(() => ({})) };
    }
    if (res.status === 403 || res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after') || 0) * 1000;
      // 额度重置时间可能已过（时钟/共享额度），统一夹到 [3s, 90s]，别算出负数或死等
      const wait = Math.min(Math.max(ra || (rlReset - Date.now() + 2000), 3000), 90000);
      log(`HTTP ${res.status}，等待 ${Math.round(wait / 1000)}s 后重试（${attempt + 1}/6）`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return { status: res.status, data: expectJson ? await res.json() : await res.text() };
  }
  throw new Error(`重试耗尽: ${url}`);
}

async function searchRepos(q, page) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}`
    + `&sort=stars&order=desc&per_page=100&page=${page}`;
  const { status, data } = await api(url);
  if (status === 422) return { total: 0, items: [], error: 'unprocessable' };
  return data;
}

/* -------------------------------------------------------------- 枚举候选池 */
function bucketsFor(minStars) {
  const edges = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const out = [];
  let lo = minStars;
  for (const e of edges) {
    if (e <= lo) continue;
    out.push([lo, e - 1]);
    lo = e;
  }
  out.push([lo, null]);
  return out;
}

function starQuery([lo, hi]) {
  return hi == null ? `stars:>=${lo}` : `stars:${lo}..${hi}`;
}

async function enumerate() {
  const pool = new Map();               // full_name -> raw repo
  const buckets = bucketsFor(MIN_STARS);
  const topics = [
    ...MOBILE_TOPICS.map((t) => ({ t, hint: 'mobile' })),
    ...DESKTOP_TOPICS.map((t) => ({ t, hint: 'desktop' })),
  ];

  let queries = 0;
  for (const { t, hint } of topics) {
    for (const b of buckets) {
      let q = `topic:${t} ${starQuery(b)} fork:false`;
      if (archivedQualifierOk) q += ' archived:false';
      for (let page = 1; page <= MAX_PAGES; page++) {
        await sleep(GAP_MS);
        let data = await searchRepos(q, page);
        if (data.error === 'unprocessable' && archivedQualifierOk) {
          archivedQualifierOk = false;
          log('⚠ archived:false 不被接受，后续查询去掉该限定');
          q = `topic:${t} ${starQuery(b)} fork:false`;
          data = await searchRepos(q, page);
        }
        queries++;
        const items = data.items || [];
        for (const r of items) if (!pool.has(r.full_name)) pool.set(r.full_name, r);
        log(`查询 #${queries} topic:${t} ${starQuery(b)} p${page} → ${items.length}（池 ${pool.size}）`);
        if (items.length < 100) break;
      }
    }
  }
  return pool;
}

const seedFulls = new Set();
function loadSeedNames() {
  if (!fs.existsSync(SEED_FILE)) return [];
  const lines = fs.readFileSync(SEED_FILE, 'utf8').split(/\r?\n/)
    .map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  for (const l of lines) seedFulls.add(l);
  return lines;
}

async function fetchSeedRepos(pool) {
  const lines = loadSeedNames();
  for (const full of lines) {
    if (pool.has(full)) continue;
    await sleep(GAP_MS);
    try {
      const { data } = await api(`https://api.github.com/repos/${full}`);
      if (data && data.full_name) pool.set(data.full_name, data);
    } catch (e) {
      log(`⚠ 种子 ${full} 拉取失败，跳过：${e.message}`);
    }
  }
  log(`种子仓库补齐后池大小 ${pool.size}`);
}

/* ------------------------------------------------------------------ 分类 */
const MOBILE_TOPIC_RE = /^(android|android-app|ios|ios-app|iphone|ipad|flutter|flutter-app|react-native|mobile|mobile-app|apk|termux|kotlin-android|swiftui|ionic|expo|xamarin|capacitor|harmonyos|wechat-miniprogram)$/;
const DESKTOP_TOPIC_RE = /^(desktop-app|electron|tauri|windows|win32|winui|wpf|macos|osx|cocoa|appkit|linux-app|gtk|qt|kde|gnome|x11|wayland|gui-app|cross-platform|nwjs|wxwidgets|avalonia|webview|flutter-desktop|desktop)$/;
const MOBILE_WORD_RE = /\b(android|ios|iphone|ipad|flutter|react[- ]?native|kotlin|swiftui|xamarin|maui|ionic|capacitor|expo|apk|mobile|harmonyos)\b/i;
const DESKTOP_WORD_RE = /\b(desktop|electron|tauri|windows|winui|wpf|macos|mac os|appkit|cocoa|linux|gtk|qt6?|kde|gnome|x11|wayland|gui|cross[- ]platform|avalonia|nw\.js|wxwidgets|tray|menubar)\b/i;

// 「不是应用」两大类：清单/教程（meta）与库/框架（lib）。默认都不上桌，前端勾选后才显示。
const META_RE = /\b(awesome[- ]|cheat-?sheets?|roadmap|tutorials?|courses?|interview|curated|collecting|study (guide|notes)|dotfiles|learning (path|notes)|free (books?|programming))\b/i;
const LIB_RE = /\b(library|framework|sdk|toolkit|bindings?|plugins?|components?|wrapper|engine|boilerplate|templates?|starter|app-?framework|ui (kit|toolkit)|makes it easy|for building|ui library)\b/i;
const LIB_TOPIC_RE = /^(sdk|framework|library|app-framework|toolkit|ui-toolkit|engine|component-library|ui-components)$/;
// 靠简介关键词认不出来的知名「框架/壳」，直接点名（它们常年霸榜，值得单独维护这几行）
const KNOWN_LIB = new Set([
  'tauri-apps/tauri', 'electron/electron', 'flutter/flutter', 'facebook/react-native',
  'wailsapp/wails', 'nodegui/nodegui', 'ionic-team/ionic-framework', 'neutralinojs/neutralinojs',
  'dotnet/maui', 'nwjs/nw.js', 'webview/webview', 'qt/qtbase', 'expo/expo',
  'appium/appium', 'NativeScript/NativeScript', 'dcloudio/uni-app',
]);

function classify(r, forced = false) {
  const topics = (r.topics || []).map((s) => s.toLowerCase());
  const text = `${r.name} ${r.description || ''}`;
  const bag = `${text} ${topics.join(' ')} ${r.language || ''}`;

  let m = 0, d = 0, topicHit = false;
  for (const t of topics) {
    if (MOBILE_TOPIC_RE.test(t)) { m += 3; topicHit = true; }
    if (DESKTOP_TOPIC_RE.test(t)) { d += 3; topicHit = true; }
  }
  if (MOBILE_WORD_RE.test(bag)) m += 1;
  if (DESKTOP_WORD_RE.test(bag)) d += 1;
  const lang = (r.language || '').toLowerCase();
  if (lang === 'kotlin' || lang === 'swift' || lang === 'dart') { m += 2; topicHit = true; }
  if (lang === 'c#' || lang === 'objective-c') { d += 1; topicHit = true; }

  let platform = 'other';
  if (m > d) platform = 'mobile';
  else if (d > m) platform = 'desktop';
  else if (m > 0) platform = 'mobile';

  // 类别优先级：清单/教程 > 库/框架 > 应用
  let kind = 'app';
  if (META_RE.test(text) || topics.includes('awesome-list') || topics.includes('awesome')) kind = 'meta';
  else if (LIB_RE.test(text) || topics.some((t) => LIB_TOPIC_RE.test(t)) || KNOWN_LIB.has(r.full_name)) kind = 'lib';

  // 至少要有结构性信号（命中 topic 或主流 App 语言），否则只是简介里出现 android 字样
  if (!topicHit && !forced) platform = 'other';
  return { platform, kind };
}

/* ------------------------------------------------------------------ 快照 */
function loadSnapshots() {
  if (!fs.existsSync(SNAP_DIR)) return [];
  return fs.readdirSync(SNAP_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      const date = f.slice(0, 10);
      const j = readJson(path.join(SNAP_DIR, f), null);
      return j ? { date, repos: j.repos || {}, partial: !!j.partial } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function writeSnapshot(date, repos, partial = false) {
  const file = path.join(SNAP_DIR, `${date}.json`);
  const old = readJson(file, null);
  // 已有全量快照时，别用稀疏的 partial 回填把它盖掉
  if (partial && old && !old.partial) return;
  // 同一天重复跑（比如先 --smoke 再全量）取并集：后写的值覆盖同 key，没跑到的仓库保留
  writeJson(file, {
    generated_at: new Date().toISOString(),
    partial: !!partial,
    repos: { ...(old?.repos || {}), ...repos },
  });
}

function pruneSnapshots() {
  if (!fs.existsSync(SNAP_DIR)) return;
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    const p = path.join(SNAP_DIR, f);
    const j = readJson(p, null);
    if (!j || j.partial) continue;                       // 回填的稀疏快照永久保留
    const age = (now - new Date(`${f.slice(0, 10)}T00:00:00Z`)) / DAY_MS;
    const isMonthStart = f.slice(8, 10) === '01';
    if (age > 95 && !isMonthStart) fs.unlinkSync(p);
  }
}

/** 找离「今天 - days 天」最近、且误差在 tol 天内的历史快照作为 baseline */
function baselineFor(snaps, days, tol) {
  const t = new Date(`${todayStr}T00:00:00Z`).getTime() - days * DAY_MS;
  let best = null, bestDiff = Infinity;
  for (const s of snaps) {
    if (s.date === todayStr) continue;                 // 今天这份不能当 baseline
    const diff = Math.abs(new Date(`${s.date}T00:00:00Z`).getTime() - t) / DAY_MS;
    if (diff <= tol && diff < bestDiff) { best = s; bestDiff = diff; }
  }
  return best;
}

/* --------------------------------------------------------- starred_at 回填 */
let backfillUsed = 0;
async function stargazersPage(full, page) {
  const url = `https://api.github.com/repos/${full}/stargazers?per_page=100&page=${page}`;
  const headers = {
    'User-Agent': 'gh-stars-board/1.0',
    'Accept': 'application/vnd.github.star+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  backfillUsed++;
  const rem = res.headers.get('x-ratelimit-remaining');
  if (rem != null) rlRemaining = Number(rem);
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset != null) rlReset = Number(reset) * 1000;
  if (res.status === 403 || res.status === 429) { await sleep(3000); return null; }
  if (!res.ok) return [];
  return res.json();
}

/** 二分找到「截止 isoDate 时该仓库的 star 数」 */
async function starsAt(full, isoDate, totalStars) {
  const target = new Date(`${isoDate}T23:59:59Z`).getTime();
  const maxPage = Math.max(1, Math.ceil(totalStars / 100));
  let lo = 1, hi = maxPage, hit = null, hitItems = null;
  while (lo <= hi) {
    if (backfillUsed > BACKFILL_BUDGET) return null;
    const mid = (lo + hi) >> 1;
    const items = await stargazersPage(full, mid);
    if (items == null) { await sleep(2000); continue; }
    if (!items.length) { hi = mid - 1; continue; }
    const last = new Date(items[items.length - 1].starred_at).getTime();
    if (last <= target) { hit = mid; hitItems = items; hi = mid - 1; }
    else { lo = mid + 1; }
  }
  if (hit == null) {
    const items = await stargazersPage(full, 1);
    if (!items || !items.length) return 0;
    const first = new Date(items[0].starred_at).getTime();
    return first > target ? 0 : items.length;
  }
  const idx = hitItems.findIndex((it) => new Date(it.starred_at).getTime() <= target);
  return (hit - 1) * 100 + (idx < 0 ? hitItems.length : idx);
}

async function backfill(metaRepos) {
  if (!TOKEN) { log('⚠ 无 token，跳过 --backfill（stargazers 需要认证且额度 5000/h）'); return; }
  const top = Object.entries(metaRepos)
    .filter(([, m]) => !m.archived)
    .sort((a, b) => b[1].stars - a[1].stars)
    .slice(0, BACKFILL_REPOS);
  log(`回填 ${top.length} 个仓库的 baseline（预算 ${BACKFILL_BUDGET} 次请求）…`);
  const per = new Map();                                  // date -> {repo: stars}
  for (const [full, m] of top) {
    if (backfillUsed > BACKFILL_BUDGET) { log('预算耗尽，提前结束回填'); break; }
    for (const p of PERIODS) {
      const date = isoDay(new Date(now.getTime() - p.days * DAY_MS));
      const file = path.join(SNAP_DIR, `${date}.json`);
      const exist = readJson(file, null);
      if (exist && !exist.partial && exist.repos && exist.repos[full] != null) continue;
      const n = await starsAt(full, date, m.stars);
      if (n == null) continue;
      if (!per.has(date)) per.set(date, {});
      per.get(date)[full] = n;
      log(`  回填 ${full} @ ${date} → ${n}`);
    }
  }
  for (const [date, repos] of per) writeSnapshot(date, repos, true);
  log(`回填完成，实际消耗 ${backfillUsed} 次请求，写入 ${per.size} 个日期`);
}

/* --------------------------------------------------------------- 主流程 */
/** 榜单里每条只保留前端要渲染的字段，board.json 才不至于几 MB */
function pick(m, full, stars, delta) {
  return {
    full_name: full, stars, delta,
    url: m.url, avatar: m.avatar, desc: m.desc, language: m.language,
    license: m.license, archived: m.archived, platform: m.platform, kind: m.kind,
    created_at: m.created_at, topics: (m.topics || []).slice(0, 6),
  };
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  if (!TOKEN && !OFFLINE) log('⚠ 未检测到 GITHUB_TOKEN：Search API 限速 10 次/分钟，只适合小样本自测');

  const metaRepos = { ...(readJson(META_FILE, { repos: {} }).repos || {}) };
  const todayStars = {};

  if (OFFLINE) {
    // 离线重算：不碰 API，用 repos.json 的元信息 + 已有快照重新分类并重算榜单
    // 改分类规则（MOBILE_TOPIC_RE / LIB_RE / META_RE …）后就靠这个秒级验证，不用重跑采集
    loadSeedNames();
    for (const [full, m] of Object.entries(metaRepos)) {
      const { platform, kind } = classify(
        { full_name: full, name: m.name, description: m.desc, topics: m.topics, language: m.language },
        seedFulls.has(full),
      );
      metaRepos[full] = platform === 'other' ? { ...m, kind } : { ...m, platform, kind };
      todayStars[full] = m.stars;
    }
    log(`离线模式：复用 repos.json 的 ${Object.keys(todayStars).length} 个仓库重算分类与榜单`);
  } else {
    log(`开始枚举候选池（min-stars=${MIN_STARS}, maxPages=${MAX_PAGES}, gap=${GAP_MS}ms）`);
    const pool = await enumerate();
    await fetchSeedRepos(pool);

    for (const [full, r] of pool) {
      const { platform, kind } = classify(r, seedFulls.has(full));
      if (platform === 'other') continue;
      metaRepos[full] = {
        name: r.name,
        owner: r.owner?.login || full.split('/')[0],
        avatar: r.owner?.avatar_url || '',
        url: r.html_url,
        desc: (r.description || '').slice(0, 220),
        language: r.language || '',
        stars: r.stargazers_count,
        forks: r.forks_count,
        topics: (r.topics || []).slice(0, 12),
        platform,
        kind,
        license: r.license?.spdx_id || '',
        archived: !!r.archived,
        created_at: r.created_at,
        pushed_at: r.pushed_at,
        homepage: r.homepage || '',
      };
      todayStars[full] = r.stargazers_count;
    }
    log(`分类后有效仓库 ${Object.keys(todayStars).length} 个（手机/电脑应用）`);
  }

  writeSnapshot(todayStr, todayStars);
  pruneSnapshots();
  const snaps = loadSnapshots();
  log(`快照：${snaps.length} 份，${snaps[0]?.date || '-'} → ${snaps[snaps.length - 1]?.date || '-'}`);

  if (DO_BACKFILL) await backfill(metaRepos);
  const snaps2 = loadSnapshots();

  /* 计算榜单 */
  const boards = {};
  const periodMeta = {};
  for (const p of PERIODS) {
    const base = baselineFor(snaps2, p.days, p.tol);
    if (!base) {
      boards[p.key] = [];
      periodMeta[p.key] = { available: false, reason: '历史快照不足' };
      log(`${p.label}: 无可用 baseline（需要 ${p.days} 天前附近的快照）`);
      continue;
    }
    const rows = [];
    for (const [full, stars] of Object.entries(todayStars)) {
      const before = base.repos[full];
      if (before == null) continue;
      const delta = stars - before;
      if (delta <= 0) continue;
      rows.push(pick(metaRepos[full], full, stars, delta));
    }
    rows.sort((a, b) => b.delta - a.delta || b.stars - a.stars);
    boards[p.key] = rows.slice(0, BOARD_SIZE);
    periodMeta[p.key] = {
      available: true,
      baseline_date: base.date,
      window_days: Math.max(1, Math.round((now - new Date(`${base.date}T00:00:00Z`)) / DAY_MS)),
      candidates: rows.length,
      partial_baseline: !!base.partial,
    };
    log(`${p.label}: baseline ${base.date}（${periodMeta[p.key].window_days} 天窗口），上榜 ${boards[p.key].length} / 有增量 ${rows.length}`);
  }

  // 总榜（总 star）与新星榜（近 90 天创建）——第一天就有内容
  const all = Object.entries(metaRepos)
    .filter(([full]) => todayStars[full] != null)
    .map(([full, m]) => pick(m, full, todayStars[full], null));
  boards.total = [...all].sort((a, b) => b.stars - a.stars).slice(0, BOARD_SIZE);
  boards.new90 = [...all]
    .filter((r) => (now - new Date(r.created_at)) / DAY_MS <= 90)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, BOARD_SIZE);
  periodMeta.total = { available: true };
  periodMeta.new90 = { available: true, window_days: 90 };

  const board = {
    generated_at: new Date().toISOString(),
    source: 'github-search-api + snapshot-diff',
    min_stars: MIN_STARS,
    tracked: Object.keys(todayStars).length,
    snapshots: snaps2.map((s) => s.date),
    periods: periodMeta,
    boards,
  };
  writeJson(BOARD_FILE, board);
  writeJson(META_FILE, { generated_at: board.generated_at, repos: metaRepos });
  log(`✅ 写出 ${path.relative(HERE, BOARD_FILE)}（${(fs.statSync(BOARD_FILE).size / 1024).toFixed(0)} KB）`);
}

main().catch((e) => { console.error('❌ 采集失败：', e); process.exit(1); });
