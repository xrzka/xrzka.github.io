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
  const FALLBACK_SIZES = [10, 20, 50, 100, 500, 1000, 2000];
  const LS_SIZE = 'gsb-page-size';
  const LS_THEME = 'gsb-theme';

  const state = {
    manifest: null, period: 'day', platform: 'all', withLib: false, q: '',
    pageSize: 20, page: 1,
    rows: [],            // 当前榜单的全部条目（已加载）
    cache: new Map(),    // period -> entries
    seq: 0,              // 防止快速切 tab 时旧响应覆盖新数据
  };

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board'), emptyEl = $('empty'), metaEl = $('meta');
  const pagerRefs = [];

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
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function pageSizes() {
    const fromManifest = state.manifest?.page_sizes;
    const list = (Array.isArray(fromManifest) && fromManifest.length ? fromManifest : FALLBACK_SIZES)
      .map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (!list.includes(state.pageSize)) list.push(state.pageSize);
    return [...new Set(list)].sort((a, b) => a - b);
  }
  function isDelta() { return state.period !== 'total' && state.period !== 'new90'; }
  function loadPageSize() {
    try {
      const n = Number(localStorage.getItem(LS_SIZE));
      if (FALLBACK_SIZES.includes(n) || (n > 0 && n <= 5000)) state.pageSize = n;
    } catch {}
  }
  function savePageSize() { try { localStorage.setItem(LS_SIZE, String(state.pageSize)); } catch {} }

  /* ------------------------------------------------------------- 数据加载 */
  async function selectPeriod(key) {
    const changed = key !== state.period;
    state.period = key;
    if (changed) state.page = 1;
    buildTabs();

    if (state.cache.has(key)) { state.rows = state.cache.get(key); render(); return; }

    const seq = ++state.seq;
    state.rows = [];
    renderLoading();
    try {
      const r = await fetch(`data/boards/${key}.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (seq !== state.seq) return;                 // 已经被更晚的请求取代
      state.rows = d.entries || [];
      state.cache.set(key, state.rows);
      render();
    } catch (e) {
      if (seq !== state.seq) return;
      renderError(e);
    }
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.rows.filter((r) => {
      if (!state.withLib && r.kind !== 'app') return false;
      if (state.platform !== 'all' && r.platform !== state.platform) return false;
      if (!q) return true;
      return `${r.full_name} ${r.desc} ${r.language} ${(r.topics || []).join(' ')}`.toLowerCase().includes(q);
    });
  }

  /* --------------------------------------------------------------- 渲染 */
  function buildTabs() {
    const periods = PERIOD_ORDER.filter((k) => {
      const meta = state.manifest.periods[k] || {};
      const count = state.manifest.counts?.[k] ?? 0;
      return k === 'total' || k === 'new90' || meta.available || count > 0;
    });
    if (!periods.includes(state.period)) state.period = periods[0] || 'total';

    const pbox = $('periodTabs');
    pbox.textContent = '';
    for (const k of periods) {
      const b = el('button', state.period === k ? 'on' : '', PERIOD_LABEL[k]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.title = `${PERIOD_LABEL[k]} · ${num(state.manifest.counts?.[k] ?? 0)} 条`;
      b.onclick = () => { if (k !== state.period) selectPeriod(k); };
      pbox.appendChild(b);
    }

    const xbox = $('platformTabs');
    xbox.textContent = '';
    for (const p of PLATFORMS) {
      const b = el('button', state.platform === p.key ? 'on' : '', p.label);
      b.type = 'button';
      b.onclick = () => { state.platform = p.key; state.page = 1; buildTabs(); render(); };
      xbox.appendChild(b);
    }
  }

  /** 只把「文本 + <b>」的白名单模式渲染出来，避免任何注入面 */
  function decorate(line) {
    return line.split(/(<b>.*?<\/b>)/g).filter(Boolean).map((seg) => {
      const m = seg.match(/^<b>(.*?)<\/b>$/s);
      return m ? el('b', '', m[1]) : el('span', '', seg);
    });
  }

  function renderMeta(shown) {
    const pmeta = state.manifest.periods[state.period] || {};
    const total = state.manifest.counts?.[state.period] ?? state.rows.length;
    let line = `榜单更新时间 <b>${fmtTime(state.manifest.generated_at)}</b>`
      + ` · 收录 <b>${num(state.manifest.tracked)}</b> 个应用`
      + ` · 本榜 <b>${num(total)}</b> 条`;
    if (isDelta() && pmeta.available) {
      line += ` · 近 <b>${pmeta.window_days}</b> 天新增 star（基准快照 ${pmeta.baseline_date}${pmeta.partial_baseline ? '，部分回填' : ''}）`;
    } else {
      line += ` · ${PERIOD_HINT[state.period] || ''}`;
    }
    if (shown !== total) line += ` · 筛选后 <b>${num(shown)}</b> 条`;
    metaEl.textContent = '';
    metaEl.append(...decorate(line));
  }

  function renderLoading() {
    boardEl.textContent = '';
    emptyEl.hidden = true;
    const p = el('p', 'empty', '加载榜单数据…');
    boardEl.appendChild(p);
  }

  function renderError(e) {
    boardEl.textContent = '';
    emptyEl.hidden = true;
    boardEl.appendChild(el('p', 'empty', `读取榜单失败：${e.message}。本地请用 http 服务打开（例如 python -m http.server 8899），不要双击 file:// 打开。`));
  }

  function render() {
    const rows = filtered();
    const size = state.pageSize;
    const totalPages = Math.max(1, Math.ceil(rows.length / size));
    state.page = Math.min(Math.max(1, state.page), totalPages);
    const start = (state.page - 1) * size;
    const slice = rows.slice(start, start + size);

    renderMeta(rows.length);

    boardEl.textContent = '';
    if (!slice.length) {
      emptyEl.hidden = false;
      const pmeta = state.manifest.periods[state.period] || {};
      emptyEl.textContent = (isDelta() && !pmeta.available)
        ? '这个榜单还没攒够历史快照 —— 采集器连续跑几天后自动出现，或先跑一次 node collect.mjs --backfill 精确回填。'
        : '没有匹配的仓库，换个筛选或关键词试试。';
    } else {
      emptyEl.hidden = true;
      slice.forEach((r, i) => boardEl.appendChild(card(r, start + i + 1)));
    }
    updatePagers(rows.length, totalPages);
  }

  function card(r, rank) {
    const isDeltaRow = isDelta();
    const wrap = el('article', `card${rank <= 3 ? ` top${rank}` : ''}`);
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
    a.href = safeUrl(r.url) || `https://github.com/${r.full_name}`;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
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
    if (isDeltaRow) {
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

  /* --------------------------------------------------------------- 分页 */
  function buildPagers() {
    pagerRefs.length = 0;
    for (const [hostId, showSize] of [['pagerTop', true], ['pagerBottom', false]]) {
      const host = $(hostId);
      if (!host) continue;
      host.textContent = '';

      const refs = { host, showSize };
      if (showSize) {
        const wrap = el('label', 'psz');
        wrap.appendChild(el('span', '', '每页'));
        const sel = document.createElement('select');
        sel.className = 'pszsel';
        for (const s of pageSizes()) {
          const o = document.createElement('option');
          o.value = String(s);
          o.textContent = `${s} 条`;
          sel.appendChild(o);
        }
        sel.value = String(state.pageSize);
        sel.onchange = () => { state.pageSize = Number(sel.value); state.page = 1; savePageSize(); render(); };
        wrap.appendChild(sel);
        wrap.appendChild(el('span', '', '条'));
        host.appendChild(wrap);
        refs.sel = sel;
      }

      refs.stat = el('span', 'pstat');
      host.appendChild(refs.stat);

      const navBox = el('span', 'pnav');
      const mk = (navKey, label, title, fn) => {
        const b = el('button', 'ghost', label);
        b.type = 'button'; b.title = title;
        b.dataset.nav = navKey;                       // 稳定钩子：验收脚本按 data-nav 找按钮
        b.onclick = fn;
        navBox.appendChild(b);
        return b;
      };
      refs.first = mk('first', '⏮', '首页', () => goPage(1));
      refs.prev = mk('prev', '上一页', '上一页', () => goPage(state.page - 1));

      const jump = document.createElement('input');
      jump.type = 'number'; jump.min = '1'; jump.className = 'jump';
      jump.setAttribute('aria-label', '跳到的页码');
      jump.onkeydown = (e) => { if (e.key === 'Enter') goPage(Number(jump.value)); };
      jump.onchange = () => goPage(Number(jump.value));
      navBox.appendChild(jump);
      refs.jump = jump;

      refs.next = mk('next', '下一页', '下一页', () => goPage(state.page + 1));
      refs.last = mk('last', '⏭', '末页', () => goPage(Number.MAX_SAFE_INTEGER));
      host.appendChild(navBox);

      pagerRefs.push(refs);
    }
  }

  function updatePagers(total, totalPages) {
    const multi = totalPages > 1;
    for (const refs of pagerRefs) {
      if (refs.showSize && refs.sel) refs.sel.value = String(state.pageSize);
      const from = total ? (state.page - 1) * state.pageSize + 1 : 0;
      const to = Math.min(state.page * state.pageSize, total);
      refs.stat.textContent = total
        ? `第 ${state.page} / ${totalPages} 页 · 显示 ${num(from)}–${num(to)} · 共 ${num(total)} 条`
        : '共 0 条';
      if (refs.jump) { refs.jump.max = String(totalPages); refs.jump.value = String(state.page); refs.jump.disabled = !multi; }
      for (const [k, disabled] of [['first', !multi || state.page <= 1], ['prev', !multi || state.page <= 1],
                                   ['next', !multi || state.page >= totalPages], ['last', !multi || state.page >= totalPages]]) {
        if (refs[k]) refs[k].disabled = disabled;
      }
      // 内容一页装得下时，底部那条整行藏起来，省得占地方
      if (!refs.showSize) refs.host.hidden = !multi;
    }
  }

  function goPage(p) {
    if (!Number.isFinite(p)) return;
    state.page = Math.max(1, Math.trunc(p));
    render();
    const y = boardEl.getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------- 启动 */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(LS_THEME, t); } catch {}
  }

  function boot() {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
    try {
      const t = localStorage.getItem(LS_THEME);
      if (t) applyTheme(t);
    } catch {}
    loadPageSize();

    $('themeBtn').onclick = () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    };
    $('q').oninput = (e) => { state.q = e.target.value; state.page = 1; render(); };
    $('withLib').onchange = (e) => { state.withLib = e.target.checked; state.page = 1; render(); };

    fetch('data/board.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((m) => {
        state.manifest = m;
        $('stamp').textContent = `生成于 ${fmtTime(m.generated_at)}`;
        buildTabs();
        buildPagers();
        return selectPeriod(state.period);
      })
      .catch((e) => {
        metaEl.textContent = `读取 data/board.json 失败：${e.message}。本地请用 http 服务打开（例如 python -m http.server 8899），不要双击 file:// 打开。`;
      });
  }
  boot();
})();
