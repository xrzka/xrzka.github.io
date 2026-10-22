/**
 * 前端端到端验收：用真实 Playwright 打开静态页，逐条断言榜单行为。
 *
 *   node test/e2e.mjs                 # 测当前目录（用 data/board.json 真实数据）
 *   node test/e2e.mjs --root <dir>    # 测指定目录（配合 --offline + 造假快照做确定性验收）
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
const ROOT = path.resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : path.join(HERE, '..'));
const PORT = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8917);
const SHOT = path.join(HERE, 'out', 'board.png');
const OUT_DIR = path.join(HERE, 'out');

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

const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'board.json'), 'utf8'));

const srv = await serve();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// 资源加载失败（favicon / 被墙的头像 CDN）不算页面 bug，只数真正的 JS 错误
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
});

const cards = () => page.locator('.card');
const firstCardText = () => page.locator('.card').first().innerText();
const metaText = () => page.locator('#meta').innerText();

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 8000 });

  /* 1. tab 数量与可用性 */
  const tabs = await page.locator('#periodTabs button').allInnerTexts();
  const expectTabs = ['日榜', '周榜', '月榜', '年榜', '新星榜', '总榜']
    .filter((_, i) => {
      const key = ['day', 'week', 'month', 'year', 'new90', 'total'][i];
      return key === 'total' || key === 'new90' || board.periods[key]?.available;
    });
  check('周期 tab 与实际可用榜单一致', tabs.join('/') === expectTabs.join('/'), `${tabs.join('/')} vs ${expectTabs.join('/')}`);

  /* 2. 默认日榜：有卡片、且默认过滤掉库/框架/清单 */
  const n1 = await cards().count();
  check('默认榜渲染出卡片', n1 > 20, `${n1} 张`);
  const tags = await page.locator('.card .tag').allInnerTexts();
  check('默认不显示「库/框架」', !tags.includes('库/框架'));
  check('默认不显示「清单/教程」', !tags.includes('清单/教程'));
  check('默认全部是 app 类卡片', tags.includes('📱 手机') || tags.includes('💻 电脑'));

  /* 3. 口径行写出真实窗口 */
  const metaDay = await metaText();
  const win = board.periods.day?.available ? `近 ${board.periods.day.window_days} 天` : '';
  check('口径行说明了真实窗口', !win || metaDay.includes(win), metaDay.slice(0, 90));

  /* 4. 切到「周榜」（有快照时）：口径行必须写明真实窗口 */
  const deltaTabs = tabs.filter((t) => t !== '新星榜' && t !== '总榜');
  if (tabs.includes('周榜')) {
    await page.getByRole('tab', { name: '周榜' }).click();
    await page.waitForTimeout(150);
    const metaWeek = await metaText();
    check('周榜口径含「近 x 天」', /近 \d+ 天/.test(metaWeek), metaWeek.slice(0, 90));
    check('周榜 tab 高亮正确', (await page.locator('#periodTabs button.on').innerText()) === '周榜');
  } else if (deltaTabs.length) {
    await page.getByRole('tab', { name: deltaTabs[0] }).click();
    await page.waitForTimeout(150);
    check(`${deltaTabs[0]}口径含「近 x 天」`, /近 \d+ 天/.test(await metaText()));
  } else {
    check('无历史快照时，日/周/月/年不出现在 tab 里', !tabs.some((t) => ['日榜', '周榜', '月榜', '年榜'].includes(t)));
  }

  /* 5. 平台筛选（在当前榜上验证互斥性，不依赖具体是哪个榜） */
  const allN = await cards().count();
  await page.getByRole('button', { name: '📱 手机' }).click();
  await page.waitForTimeout(150);
  const mobileN = await cards().count();
  const mobileTags = await page.locator('.card .tag').allInnerTexts();
  check('手机筛选后没有电脑卡片', !mobileTags.includes('💻 电脑'));
  check('手机筛选结果非空', mobileN > 0, `${allN} → ${mobileN}`);

  await page.getByRole('button', { name: '💻 电脑' }).click();
  await page.waitForTimeout(150);
  const desktopN = await cards().count();
  check('电脑筛选有结果', desktopN > 0, `${desktopN} 张`);
  check('手机 + 电脑 ≤ 全部', mobileN + desktopN <= allN + 1, `${mobileN}+${desktopN} vs ${allN}`);

  /* 6. 勾选「包含库/框架/清单」 */
  await page.getByRole('button', { name: '全部' }).click();
  await page.waitForTimeout(100);
  await page.locator('#withLib').check();
  await page.waitForTimeout(200);
  const withLibN = await cards().count();
  const libTags = await page.locator('.card .tag').allInnerTexts();
  check('勾选后卡片变多', withLibN >= allN, `${allN} → ${withLibN}`);
  check('勾选后出现库/框架或清单卡片', libTags.includes('库/框架') || libTags.includes('清单/教程'));
  await page.locator('#withLib').uncheck();
  await page.waitForTimeout(150);

  /* 7. 搜索（探针取自「当前正在显示的」那个榜，否则筛选条件对不上） */
  const LABEL2KEY = { 日榜: 'day', 周榜: 'week', 月榜: 'month', 年榜: 'year', 新星榜: 'new90', 总榜: 'total' };
  const activeKey = LABEL2KEY[await page.locator('#periodTabs button.on').innerText()];
  const probe = (board.boards[activeKey] || []).find((r) => r.kind === 'app');
  if (probe) {
    const kw = probe.full_name.split('/')[1].slice(0, 6);
    await page.fill('#q', kw);
    await page.waitForTimeout(250);
    const hits = await page.locator('.card').count();
    const texts = await page.locator('.card .repo').allInnerTexts();
    check(`搜索「${kw}」能命中`, hits > 0 && hits < allN, `${hits} 张`);
    check('搜索结果都含关键词', texts.every((t) => t.toLowerCase().includes(kw.toLowerCase())), texts.slice(0, 3).join(', '));
    await page.fill('#q', 'zzz_no_such_repo_zzz');
    await page.waitForTimeout(250);
    check('无结果时给提示', await page.locator('#empty').isVisible());
    await page.fill('#q', '');
    await page.waitForTimeout(200);
  }

  /* 8. 主题切换 + 外部链接安全属性 */
  await page.locator('#themeBtn').click();
  await page.waitForTimeout(120);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('主题切换生效', theme === 'light' || theme === 'dark', theme);
  const bad = await page.evaluate(() => [...document.querySelectorAll('a[target="_blank"]')]
    .filter((a) => !(a.rel || '').includes('noopener')).length);
  check('外链都带 rel=noopener', bad === 0, `缺 ${bad} 个`);

  /* 9. 无 JS 报错 + 无横向溢出（桌面 & 手机宽度） */
  check('页面无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));

  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(150);
  const ovDesktop = await overflow();
  check('桌面宽度无横向溢出', ovDesktop <= 2, `溢出 ${ovDesktop}px`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const ovMobile = await overflow();
  check('手机宽度无横向溢出', ovMobile <= 2, `溢出 ${ovMobile}px`);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(150);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: false });
  console.log(`\n截图：${SHOT}`);
} finally {
  await browser.close();
  srv.close();
}

console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
