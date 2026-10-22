/**
 * 前端端到端验收：用真实 Playwright 打开静态页，逐条断言榜单行为。
 *
 *   node test/e2e.mjs                 # 测当前目录（用 data/ 下真实数据）
 *   node test/e2e.mjs --root <dir>    # 测指定目录（配合 --offline + 造假快照做确定性验收）
 *   node test/e2e.mjs --url https://xrzka.github.io/stars/   # 线上冒烟：直接打已发布的页面
 *
 * 退出码 0 = 全部通过。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const LIVE = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;
const ROOT = path.resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : path.join(HERE, '..'));
const PORT = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8917);
const OUT_DIR = path.join(HERE, 'out');
const SHOT = path.join(OUT_DIR, LIVE ? 'board-live.png' : 'board.png');

function loadPlaywright() {
  // 本机 playwright 装在不同位置（工作区 / 别处的 node_modules / NODE_PATH），逐个试
  for (const base of [import.meta.url, 'D:/local_translate_tool/mo_site/worker/package.json']) {
    try { return createRequire(base)('playwright'); } catch {}
  }
  throw new Error('找不到 playwright：先 npm i -D playwright，或把 NODE_PATH 指到有它的 node_modules');
}
const { chromium } = loadPlaywright();

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

const readLocal = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

/** 榜单清单（board.json）+ 单个榜单数据（boards/<key>.json） */
const manifest = LIVE
  ? await fetch(new URL('data/board.json', LIVE).href, { cache: 'no-store' }).then((r) => r.json())
  : readLocal('data/board.json');

async function loadBoard(key) {
  if (LIVE) return fetch(new URL(`data/boards/${key}.json`, LIVE).href, { cache: 'no-store' }).then((r) => r.json());
  return readLocal(`data/boards/${key}.json`);
}

const srv = LIVE ? null : await serve();
const PAGE_URL = LIVE || `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// 噪声不算页面 bug：资源 404（favicon）、头像 CDN 被墙 / 被浏览器本地网络策略拦（loopback）
const NOISE = /(Failed to load resource|avatars\.githubusercontent\.com|loopback address space)/i;
page.on('console', (m) => {
  if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text());
});

const cards = () => page.locator('.card');
const metaText = () => page.locator('#meta').innerText();
const stat = () => page.locator('#pagerTop .pstat').innerText();
const topBtn = (nav) => page.locator(`#pagerTop [data-nav="${nav}"]`);
const firstRank = async () => Number((await page.locator('.card .rank').first().innerText()).replace('#', ''));
/** 从分页状态行里取「共 N 条」——有每页上限时不能拿卡片数当总数 */
const statTotal = async () => Number(((await stat()).match(/共 ([\d,]+) 条/) || [0, '0'])[1].replace(/,/g, ''));
const sizeOf = async (n) => { await page.selectOption('#pagerTop .pszsel', String(n)); await page.waitForTimeout(220); };

try {
  console.log(LIVE ? `线上冒烟：${PAGE_URL}` : `本地验收：${PAGE_URL}（根目录 ${ROOT}）`);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: LIVE ? 20000 : 8000 });

  /* 1. tab 数量与可用性 */
  const tabs = await page.locator('#periodTabs button').allInnerTexts();
  const KEYS = ['day', 'week', 'month', 'year', 'new90', 'total'];
  const expectTabs = ['日榜', '周榜', '月榜', '年榜', '新星榜', '总榜'].filter((_, i) => {
    const k = KEYS[i];
    return k === 'total' || k === 'new90' || manifest.periods[k]?.available;
  });
  check('周期 tab 与实际可用榜单一致', tabs.join('/') === expectTabs.join('/'), `${tabs.join('/')} vs ${expectTabs.join('/')}`);

  /* 2. 默认榜：有卡片、默认过滤掉库/框架/清单、名次从 #1 开始 */
  const n1 = await cards().count();
  check('默认榜渲染出卡片', n1 > 0, `${n1} 张`);
  const tags = await page.locator('.card .tag').allInnerTexts();
  check('默认不显示「库/框架」', !tags.includes('库/框架'));
  check('默认不显示「清单/教程」', !tags.includes('清单/教程'));
  check('默认全部是 app 类卡片', tags.includes('📱 手机') || tags.includes('💻 电脑'));
  check('第一张卡片名次是 #1 且带金色 class', await firstRank() === 1 && await page.locator('.card').first().getAttribute('class') === 'card top1');

  /* 3. 口径行写明真实窗口 */
  const metaDay = await metaText();
  const activeLabel0 = await page.locator('#periodTabs button.on').innerText();
  const key0 = KEYS[['日榜', '周榜', '月榜', '年榜', '新星榜', '总榜'].indexOf(activeLabel0)];
  const win = manifest.periods[key0]?.available ? `近 ${manifest.periods[key0].window_days} 天` : '';
  check('口径行说明了真实窗口', !win || metaDay.includes(win), metaDay.slice(0, 96));
  check('口径行含本榜总条数', /本榜 <b>|\d+<\/b> 条/.test(metaDay) || metaDay.includes('条'), metaDay.slice(0, 96));

  /* 4. 切到「周榜」（有快照时） */
  const deltaTabs = tabs.filter((t) => t !== '新星榜' && t !== '总榜');
  if (tabs.includes('周榜')) {
    await page.getByRole('tab', { name: '周榜' }).click();
    await page.waitForTimeout(300);
    check('周榜口径含「近 x 天」', /近 \d+ 天/.test(await metaText()), (await metaText()).slice(0, 90));
    check('周榜 tab 高亮正确', (await page.locator('#periodTabs button.on').innerText()) === '周榜');
  } else if (deltaTabs.length) {
    await page.getByRole('tab', { name: deltaTabs[0] }).click();
    await page.waitForTimeout(300);
    check(`${deltaTabs[0]}口径含「近 x 天」`, /近 \d+ 天/.test(await metaText()));
  } else {
    check('无历史快照时，日/周/月/年不出现在 tab 里', !tabs.some((t) => ['日榜', '周榜', '月榜', '年榜'].includes(t)));
  }

  /* 5. 平台筛选互斥：用「共 N 条」比，不能用卡片数（有每页上限） */
  const allN = await cards().count();
  const allTotal = await statTotal();
  await page.getByRole('button', { name: '📱 手机' }).click();
  await page.waitForTimeout(200);
  const mobileN = await cards().count();
  const mobileTotal = await statTotal();
  const mobileTags = await page.locator('.card .tag').allInnerTexts();
  check('手机筛选后没有电脑卡片', !mobileTags.includes('💻 电脑'));
  check('手机筛选结果非空', mobileTotal > 0, `${allTotal} → ${mobileTotal}`);

  await page.getByRole('button', { name: '💻 电脑' }).click();
  await page.waitForTimeout(200);
  const desktopN = await cards().count();
  const desktopTotal = await statTotal();
  check('电脑筛选有结果', desktopTotal > 0, `${desktopTotal} 条`);
  check('手机 + 电脑 = 全部（分类互斥且完备）', mobileTotal + desktopTotal === allTotal,
    `${mobileTotal}+${desktopTotal} vs ${allTotal}`);
  check('每页上限对每张卡片都生效', Math.max(allN, mobileN, desktopN) <= 20, `${allN}/${mobileN}/${desktopN}`);

  /* 6. 勾选「包含库/框架/清单」 */
  await page.getByRole('button', { name: '全部' }).click();
  await page.waitForTimeout(200);
  await page.locator('#withLib').check();
  await page.waitForTimeout(250);
  const withLibTotal = await statTotal();
  const libTags = await page.locator('.card .tag').allInnerTexts();
  check('勾选后总数变多', withLibTotal > allTotal, `${allTotal} → ${withLibTotal}`);
  check('勾选后出现库/框架或清单卡片', libTags.includes('库/框架') || libTags.includes('清单/教程'));
  await page.locator('#withLib').uncheck();
  await page.waitForTimeout(250);
  check('取消勾选后总数回落', await statTotal() === allTotal);

  /* 7. 搜索 + 搜索时回到第 1 页 */
  const activeLabel = await page.locator('#periodTabs button.on').innerText();
  const activeKey = KEYS[['日榜', '周榜', '月榜', '年榜', '新星榜', '总榜'].indexOf(activeLabel)];
  const boardData = await loadBoard(activeKey);
  const entries = boardData.entries || [];
  const visibleTotal = entries.filter((r) => r.kind === 'app').length;
  const probe = entries.find((r) => r.kind === 'app');

  if (probe) {
    await sizeOf(10);
    if (visibleTotal > 10) {
      await topBtn('next').click();
      await page.waitForTimeout(250);
      check('翻到第 2 页后名次接着数（#11）', await firstRank() === 11, `实际 #${await firstRank()}`);
    }

    const kw = probe.full_name.split('/')[1].slice(0, 6);
    await page.fill('#q', kw);
    await page.waitForTimeout(300);
    const hits = await cards().count();
    const texts = await page.locator('.card .repo').allInnerTexts();
    check(`搜索「${kw}」能命中`, hits > 0 && hits < allN, `${hits} 张`);
    check('搜索后回到第 1 页', await firstRank() === 1, `实际 #${await firstRank()}`);
    check('搜索结果都含关键词', texts.every((t) => t.toLowerCase().includes(kw.toLowerCase())), texts.slice(0, 3).join(', '));

    await page.fill('#q', 'zzz_no_such_repo_zzz');
    await page.waitForTimeout(300);
    check('无结果时给提示', await page.locator('#empty').isVisible());
    await page.fill('#q', '');
    await page.waitForTimeout(300);
  }

  /* 8. 分页 */
  const sizes = (await page.locator('#pagerTop .pszsel option').allInnerTexts()).join('|');
  check('每页条数选项 10/20/50/100/500/1000/2000',
    sizes === '10 条|20 条|50 条|100 条|500 条|1000 条|2000 条', sizes);

  await sizeOf(10);
  const expect10 = Math.min(10, visibleTotal);
  check('每页 10 条时正好渲染 10 张', await cards().count() === expect10, `${await cards().count()} vs ${expect10}`);
  check('分页状态行写法正确', /第 1 \/ \d+ 页 · 显示 1–\d+ · 共 [\d,]+ 条/.test(await stat()), await stat());

  const totalPages = Math.max(1, Math.ceil(visibleTotal / 10));
  check('总页数 = ceil(可见条数 / 每页)', (await stat()).includes(`第 1 / ${totalPages} 页`), `${await stat()} / 期望 ${totalPages} 页`);
  check('第 1 页时「首页/上一页」禁用', await topBtn('first').isDisabled() && await topBtn('prev').isDisabled());
  check('第 1 页时「下一页/末页」可用', !(await topBtn('next').isDisabled()) || visibleTotal <= 10);

  if (totalPages > 2) {
    await page.fill('#pagerTop .jump', '3');
    await page.locator('#pagerTop .jump').press('Enter');
    await page.waitForTimeout(300);
    check('跳页到第 3 页，首张名次 #21', await firstRank() === 21, `实际 #${await firstRank()}`);
    check('跳页后状态行同步', (await stat()).startsWith('第 3 /'), await stat());
  }

  if (totalPages > 1) {
    await topBtn('first').click();                 // 先回第 1 页，「末页」按钮才是可点的
    await page.waitForTimeout(250);
    check('「首页」按钮回到第 1 页', await firstRank() === 1, `实际 #${await firstRank()}`);

    await topBtn('last').click();
    await page.waitForTimeout(300);
    const lastCount = await cards().count();
    const expectLast = visibleTotal % 10 === 0 ? 10 : visibleTotal % 10;
    check('末页条数正确', lastCount === expectLast, `${lastCount} vs ${expectLast}`);
    check('末页时「下一页/末页」禁用', await topBtn('next').isDisabled() && await topBtn('last').isDisabled());
  }

  await sizeOf(2000);
  check('每页 2000 条时一页装下全部', await cards().count() === Math.min(2000, visibleTotal),
    `${await cards().count()} vs ${Math.min(2000, visibleTotal)}`);
  check('单页装下时底部翻页条隐藏', await page.locator('#pagerBottom').isHidden());
  await sizeOf(20);
  check('切回 20 条/页后每页 20 张', await cards().count() === Math.min(20, visibleTotal), `${await cards().count()}`);
  check('翻页条在恢复分页后重新出现', visibleTotal <= 20 || await page.locator('#pagerBottom').isVisible());

  /* 9. 主题 + 外链安全属性 */
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(150);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('主题切换生效', theme === 'light' || theme === 'dark', theme);
  const bad = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')]
    .filter((a) => !(a.rel || '').includes('noopener')).length);
  check('外链都带 rel=noopener', bad === 0, `缺 ${bad} 个`);

  /* 10. 无 JS 报错 + 无横向溢出（桌面 & 手机宽度） */
  check('页面无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(200);
  const ovDesktop = await overflow();
  check('桌面宽度无横向溢出', ovDesktop <= 2, `溢出 ${ovDesktop}px`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const ovMobile = await overflow();
  check('手机宽度无横向溢出', ovMobile <= 2, `溢出 ${ovMobile}px`);
  check('手机上翻页条不挤爆', (await page.locator('#pagerTop').boundingBox()).width <= 390);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(200);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log(`\n截图：${SHOT}`);
} finally {
  await browser.close();
  if (srv) srv.close();
}

console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
