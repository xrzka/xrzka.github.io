/* GitHub 应用 Stars 榜 — 前端（原生 JS，无依赖） */
(() => {
  'use strict';

  const PERIOD_ORDER = ['day', 'week', 'month', 'year', 'new90', 'total'];
  const PERIOD_LABEL = { day: '日榜', week: '周榜', month: '月榜', year: '年榜', new90: '新星榜', total: '总榜' };
  const PERIOD_HINT = { new90: '近 90 天创建', total: 'star 总量' };
  const PLATFORMS = [
    { key: 'all', label: '全部' },
    { key: 'mobile', label: '📱 手机' },
    { key: 'desktop', label: '💻 电脑' },
  ];

  const state = { data: null, period: 'day', platform: 'all', withLib: false, q: '' };

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board'), emptyEl = $('empty'), metaEl = $('meta');

  /* ---------------------------------------------------------------- 工具 */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  function safeUrl(u) {
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(+d)) return '—';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} UTC+8`
      .replace(/UTC\+8/, '本地');
  }
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('gsb-theme', t); } catch {}
  }

  /* --------------------------------------------------------------- 渲染 */
  function buildTabs() {
    const periods = PERIOD_ORDER.filter((k) => state.data.boards[k] && (k === 'total' || k === 'new90' || state.data.periods[k]?.available));
    const pbox = $('periodTabs');
    pbox.textContent = '';
    for (const k of periods) {
      const b = el('button', state.period === k ? 'on' : '', PERIOD_LABEL[k]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.onclick = () => { state.period = k; buildTabs(); render(); };
      pbox.appendChild(b);
    }
    if (!periods.includes(state.period)) state.period = periods[0] || 'total';

    const xbox = $('platformTabs');
    xbox.textContent = '';
    for (const p of PLATFORMS) {
      const b = el('button', state.platform === p.key ? 'on' : '', p.label);
      b.type = 'button';
      b.onclick = () => { state.platform = p.key; buildTabs(); render(); };
      xbox.appendChild(b);
    }
  }

  function rowsFor() {
    const all = state.data.boards[state.period] || [];
    const q = state.q.trim().toLowerCase();
    return all.filter((r) => {
      if (!state.withLib && r.kind !== 'app') return false;
      if (state.platform !== 'all' && r.platform !== state.platform) return false;
      if (!q) return true;
      return `${r.full_name} ${r.desc} ${r.language} ${(r.topics || []).join(' ')}`.toLowerCase().includes(q);
    });
  }

  function render() {
    const rows = rowsFor();
    const pmeta = state.data.periods[state.period] || {};
    const isDelta = state.period !== 'total' && state.period !== 'new90';

    let line = `榜单更新时间 <b>${fmtTime(state.data.generated_at)}</b> · 收录 <b>${num(state.data.tracked)}</b> 个应用 · 快照 <b>${state.data.snapshots.length}</b> 份`;
    if (isDelta) {
      line += ` · 本榜是 <b>近 ${pmeta.window_days} 天</b>新增 star（基准快照 ${pmeta.baseline_date}${pmeta.partial_baseline ? '，部分回填' : ''}）`;
    } else {
      line += ` · ${PERIOD_HINT[state.period] || ''}`;
    }
    metaEl.textContent = '';                     // 不碰 innerHTML：只按「文本 + <b>」白名单拼装
    metaEl.append(...decorate(line));

    boardEl.textContent = '';
    if (!rows.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = isDelta && !pmeta.available
        ? '这个榜单还没攒够历史快照 —— 采集器连续跑几天后自动出现，或先跑一次 node collect.mjs --backfill 精确回填。'
        : '没有匹配的仓库，换个筛选或关键词试试。';
      return;
    }
    emptyEl.hidden = true;
    rows.forEach((r, i) => boardEl.appendChild(card(r, i + 1, isDelta)));
  }

  /** 只把「文本 + <b>」的白名单模式渲染出来，避免任何注入面 */
  function decorate(line) {
    return line.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((seg) => {
      const m = seg.match(/^<b>(.*?)<\/b>$/s);
      return m ? el('b', '', m[1]) : el('span', '', seg);
    });
  }

  function card(r, rank, isDelta) {
    const wrap = el('article', 'card');
    wrap.appendChild(el('div', 'rank', `#${rank}`));

    const main = el('div', 'main');
    const title = el('div', 'title');
    const av = safeUrl(r.avatar);
    if (av) {
      const img = el('img', 'avatar');
      img.src = av; img.alt = ''; img.loading = 'lazy';
      // 头像 CDN（avatars.githubusercontent.com）被墙或被 CORS 拦时，别在标题前留一个破图标
      img.onerror = () => img.remove();
      title.appendChild(img);
    }
    const a = el('a', 'repo', r.full_name);
    const href = safeUrl(r.url) || `https://github.com/${r.full_name}`;
    a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    title.appendChild(a);
    main.appendChild(title);

    if (r.desc) main.appendChild(el('p', 'desc', r.desc));

    const tags = el('div', 'tags');
    tags.appendChild(el('span', `tag p-${r.platform}`, r.platform === 'mobile' ? '📱 手机' : '💻 电脑'));
    if (r.language) tags.appendChild(el('span', 'tag', r.language));
    if (r.license) tags.appendChild(el('span', 'tag', r.license));
    if (r.archived) tags.appendChild(el('span', 'tag dead', '已归档'));
    if (r.kind === 'lib') tags.appendChild(el('span', 'tag warn', '库/框架'));
    if (r.kind === 'meta') tags.appendChild(el('span', 'tag warn', '清单/教程'));
    main.appendChild(tags);
    wrap.appendChild(main);

    const score = el('div', 'score');
    if (isDelta) {
      score.appendChild(el('div', 'delta', `+${num(r.delta)}`));
      score.appendChild(el('div', 'total', `共 ${num(r.stars)} ★`));
    } else {
      score.appendChild(el('div', 'delta plain', `${num(r.stars)} ★`));
      if (r.created_at) {
        const days = Math.round((Date.now() - new Date(r.created_at)) / 86400000);
        score.appendChild(el('div', 'total', days < 365 ? `创建 ${days} 天` : `创建 ${(days / 365).toFixed(1)} 年`));
      }
    }
    wrap.appendChild(score);
    return wrap;
  }

  /* ---------------------------------------------------------------- 启动 */
  function boot() {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
    try {
      const t = localStorage.getItem('gsb-theme');
      if (t) applyTheme(t);
    } catch {}
    $('themeBtn').onclick = () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    };
    $('q').oninput = (e) => { state.q = e.target.value; render(); };
    $('withLib').onchange = (e) => { state.withLib = e.target.checked; render(); };

    const stamp = $('stamp');
    fetch('data/board.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        state.data = data;
        stamp.textContent = `生成于 ${fmtTime(data.generated_at)}`;
        buildTabs();
        render();
      })
      .catch((e) => {
        metaEl.textContent = `读取 data/board.json 失败：${e.message}。本地请用 http 服务打开（例如 python -m http.server 8899），不要双击 file:// 打开。`;
      });
  }
  boot();
})();
