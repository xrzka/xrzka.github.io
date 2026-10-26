/**
 * 求资源需求看板（/qiu/）前端。
 *
 * 两块数据：
 *   1. `/api/demand` —— 本站真实需求（搜索词 / 缺口 / 帮找 / 点击），Worker 侧见 demand.js
 *   2. `/api/hot`    —— 四平台热榜，只当线索（见 hot.js）
 *
 * 只做三件事：拉、按平台或关键词筛、渲染成卡片列表。
 * 所有文本走 textContent，外链 href 只白名单放行 http(s) —— 和第一站一个规矩。
 */
(() => {
  "use strict";

  /* ---------- 配置 ---------- */

  const FALLBACK_API = [
    "https://mo-stats.pages.dev",
    "https://mo-stats.werneruszcb71.workers.dev",
  ];
  const API_BASES = (() => {
    const cfg = (window.BOARD_CONFIG && window.BOARD_CONFIG.adminApi) || [];
    const list = (Array.isArray(cfg) ? cfg : [cfg]).filter(
      (v) => typeof v === "string" && /^https:\/\//.test(v)
    );
    return list.length ? list : FALLBACK_API;
  })();

  const MO_HOME = "https://xrzka.github.io/mo/";

  /** 平台顺序与图标。数据里的 label 优先，这份只是兜底。 */
  const PLATFORMS = [
    { id: "bili", label: "B站", icon: "📺" },
    { id: "douyin", label: "抖音", icon: "🎵" },
    { id: "ks", label: "快手", icon: "⚡" },
    { id: "xhs", label: "小红书", icon: "📕" },
  ];

  /** 分区 id → 中文名，点击榜里标一下这条属于哪个区。 */
  const SECTION_LABEL = {
    novel: "小说",
    manga: "漫画",
    anime: "动画",
    game: "游戏",
    music: "音乐",
    tool: "工具",
    ai: "AI",
    forum: "论坛",
    guide: "指南",
    collection: "合集",
    office2: "办公",
    life: "生活",
    study: "学习",
    pickup: "推荐",
  };

  const WANT_STATUS = { open: "待找", found: "已找到", closed: "已关闭" };

  /** 自动刷新间隔，和 Worker 的 10 分钟缓存对齐。 */
  const AUTO_REFRESH_MS = 10 * 60 * 1000;

  /**
   * 「资源向」粗筛词。命中任意一个就算一条资源线索（也能用开关过滤）。
   * 热搜里大部分是时政新闻，这一层是把它压回「跟要资源有关」的那部分。
   */
  const WANT_WORDS = [
    "资源", "求", "找", "谁有", "哪里有", "入口", "在线看", "全集", "合集",
    "完整版", "未删减", "无删减", "无修", "原版", "番外",
    "下载", "网盘", "百度云", "夸克", "阿里云盘", "磁力", "种子",
    "教程", "教学", "攻略", "配方", "做法", "食谱", "笔记", "资料", "素材",
    "模板", "表格", "真题", "试卷", "答案", "课件", "讲义", "电子书", "书单",
    "小说", "漫画", "动漫", "番剧", "电影", "剧集", "综艺", "短剧", "美剧",
    "游戏", "mod", "补丁", "汉化", "中文版", "破解", "白嫖", "免费",
    "壁纸", "头像", "字体", "表情包", "伴奏", "音源", "铃声", "曲谱",
    "课程", "网课", "考研", "四六级", "考公", "副业", "兼职",
    "源码", "插件", "脚本", "工具", "软件", "app", "ai", "prompt",
    "高清", "4k", "超清", "原片", "生肉", "熟肉", "字幕", "配音", "国语",
    "复刻", "搬运", "打包", "流出",
  ];

  /* ---------- 状态 ---------- */

  const state = {
    active: "all",
    query: "",
    wantOnly: true, // 默认只看资源向：热搜里新闻太多，不筛几乎没法用
    data: {},       // { src: {label, ok, stale, provider, fetched_at, items[]} }
    demand: null,   // /api/demand 的原始响应
    generatedAt: 0,
    loadedAt: 0,
    loading: false,
    error: "",
  };

  const $ = (sel, root = document) => root.querySelector(sel);

  /* ---------- 工具 ---------- */

  function safeUrl(value) {
    const raw = String(value || "").trim();
    if (!/^https?:\/\//i.test(raw)) return "";
    return raw;
  }

  function wantHit(title) {
    const text = String(title || "").toLowerCase();
    return WANT_WORDS.some((word) => text.includes(word));
  }

  function relativeTime(ts) {
    if (!ts) return "未知";
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (sec < 90) return "刚刚";
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    return `${Math.round(hour / 24)} 天前`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** 墨站的搜索深链。 */
  function moSearch(keyword) {
    return `${MO_HOME}?q=${encodeURIComponent(keyword)}`;
  }

  function visibleItems() {
    const srcs = state.active === "all" ? PLATFORMS.map((p) => p.id) : [state.active];
    const q = state.query.trim().toLowerCase();
    const out = [];
    for (const src of srcs) {
      const block = state.data[src];
      if (!block) continue;
      const items = (block.items || []).filter((item) => {
        if (state.wantOnly && !item.want) return false;
        if (q && !item.title.toLowerCase().includes(q)) return false;
        return true;
      });
      out.push({ src, block, items });
    }
    return out;
  }

  /* ---------- 渲染：热榜线索 ---------- */

  function renderTabs() {
    const host = $("[data-tabs]");
    host.textContent = "";
    const entries = [{ id: "all", label: "全部", icon: "🔥" }].concat(PLATFORMS);
    for (const entry of entries) {
      const btn = el("button", "tab-btn");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(state.active === entry.id));
      btn.dataset.tab = entry.id;

      const icon = el("span", null, entry.icon);
      icon.setAttribute("aria-hidden", "true");
      btn.append(icon, document.createTextNode(` ${entry.label} `));

      if (entry.id !== "all") {
        const block = state.data[entry.id];
        const items = (block && block.items) || [];
        const count = items.filter((i) => !state.wantOnly || i.want).length;
        btn.append(el("span", "tab-count", items.length ? String(count) : "—"));
      }
      host.append(btn);
    }
  }

  function renderBoard(src, block, items) {
    const card = el("article", "board");
    card.dataset.board = src;

    const head = el("div", "board-head");
    const meta = PLATFORMS.find((p) => p.id === src) || { label: src, icon: "" };
    const icon = el("span", null, meta.icon);
    icon.setAttribute("aria-hidden", "true");
    head.append(icon, el("span", "board-title", block.label || meta.label));

    if (block.stale) head.append(el("span", "board-badge", "数据偏旧"));
    else if (block.provider) head.append(el("span", "board-badge", "实时"));

    const metaBox = el("div", "board-meta");
    metaBox.append(el("div", null, `更新于 ${relativeTime(block.fetched_at)}`));
    if (block.provider) metaBox.append(el("div", null, `来源 ${block.provider}`));
    head.append(metaBox);
    card.append(head);

    if (!block.ok) {
      card.append(el("p", "board-empty", "这个平台暂时取不到数据，稍后自动重试。"));
      return card;
    }
    if (!items.length) {
      // 默认开着「只看资源向」，某些平台某轮热榜可能一条资源向都没有。
      // 这时候要说清「是筛没了，不是没数据」，并告诉他有几条可以放开看。
      const total = (block.items || []).length;
      card.append(
        el(
          "p",
          "board-empty",
          state.wantOnly && total
            ? `这轮没有资源向线索（该平台共 ${total} 条，关掉「只看资源向线索」可看全量）。`
            : "当前筛选下没有条目。"
        )
      );
      return card;
    }

    const list = el("ol", "board-list");
    for (const item of items) {
      const li = el("li", "item");
      if (item.rank <= 3) li.dataset.top = String(item.rank);
      li.append(el("span", "item-rank", String(item.rank)));

      const body = el("div", "item-body");
      const link = el("a", "item-title", item.title);
      const href = safeUrl(item.url);
      if (href) {
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer nofollow";
      }
      body.append(link);

      const foot = el("div", "item-foot");
      if (item.hot) foot.append(el("span", "item-hot", `🔥 ${item.hot}`));
      if (item.want && state.wantOnly) body.append(el("span", "want-flag", "资源向"));

      const search = el("a", "mini-btn", "找资源");
      search.href = moSearch(item.title);
      search.target = "_blank";
      search.rel = "noopener";
      search.title = "去墨小说漫画搜这个关键词";
      foot.append(search);

      const copy = el("button", "mini-btn", "复制词");
      copy.type = "button";
      copy.dataset.copy = item.title;
      foot.append(copy);

      body.append(foot);
      li.append(body);
      list.append(li);
    }
    card.append(list);
    return card;
  }

  /* ---------- 渲染：本站真实需求 ---------- */

  /** 一张需求卡的外壳：标题 + 角标 + 说明 + 内容容器。 */
  function demandCard(title, badge, note) {
    const card = el("article", "board demand-card");
    const head = el("div", "board-head");
    head.append(el("span", "board-title", title));
    if (badge) head.append(el("span", "board-badge", badge));
    card.append(head);
    if (note) card.append(el("p", "board-note", note));
    const body = el("div", "demand-body");
    card.append(body);
    return { card, body };
  }

  /** 词条行：词 + 搜索次数/结果数 + 复制/去墨站搜。两处（搜索热词、缺口）共用。 */
  function termRow(entry, opts) {
    const li = el("li", "term");
    if (opts && opts.gap) li.dataset.gap = "1";

    const main = el("div", "term-main");
    main.append(el("span", "term-text", entry.term));
    const parts = [`搜 ${entry.searches} 次`];
    if (entry.zero_results) parts.push(`${entry.zero_results} 次没结果`);
    parts.push(`上次结果 ${entry.last_results}`);
    main.append(el("span", "term-meta", parts.join(" · ")));
    li.append(main);

    const actions = el("div", "term-actions");
    const go = el("a", "mini-btn", "去墨站搜");
    go.href = moSearch(entry.term);
    go.target = "_blank";
    go.rel = "noopener";
    actions.append(go);
    const copy = el("button", "mini-btn", "复制");
    copy.type = "button";
    copy.dataset.copy = entry.term;
    actions.append(copy);
    li.append(actions);
    return li;
  }

  function wantedRow(item) {
    const li = el("li", "want");
    li.append(el("span", "want-votes", `${item.votes} 票`));

    const body = el("div", "want-main");
    body.append(el("span", "want-title", item.title));
    if (item.note) body.append(el("span", "want-note", item.note));
    if (item.reply) body.append(el("span", "want-reply", `站长回复：${item.reply}`));
    li.append(body);

    const badge = el("span", "board-badge", WANT_STATUS[item.status] || item.status);
    badge.dataset.tone = item.status === "open" ? "warn" : "ok";
    li.append(badge);
    return li;
  }

  /** 点击榜：把「本月」「本年」两份 id 表并成一条列表，展示月/年两个数。 */
  function clickRows(clicks) {
    const names = clicks.names || {};
    const merged = new Map();
    for (const row of clicks.month || []) {
      merged.set(row.id, { id: row.id, month: row.n, year: 0 });
    }
    for (const row of clicks.year || []) {
      const cur = merged.get(row.id) || { id: row.id, month: 0, year: 0 };
      cur.year = row.n;
      merged.set(row.id, cur);
    }
    const rows = [...merged.values()].sort((a, b) => b.month - a.month || b.year - a.year);

    const list = el("ol", "board-list click-list");
    let shown = 0;
    for (const row of rows) {
      const info = names[row.id];
      // 成人向条目不列：墨站默认藏起来，这里也不替它曝光
      if (info && info.adult) continue;
      const li = el("li", "click");
      const name = info && info.name ? info.name : row.id;
      li.append(el("span", "click-name", name));
      if (info && info.section) {
        li.append(el("span", "click-sec", SECTION_LABEL[info.section] || info.section));
      }
      li.append(el("span", "click-n", `月 ${row.month} · 年 ${row.year}`));
      list.append(li);
      if (++shown >= 15) break;
    }
    if (!shown) return null;
    return list;
  }

  function renderDemand() {
    const host = $("[data-demand]");
    const demand = state.demand;
    host.textContent = "";
    host.setAttribute("aria-busy", "false");

    if (!demand) {
      host.append(
        el("p", "placeholder", state.error || "本站需求数据暂时取不到，点「刷新」重试。")
      );
      return;
    }

    const search = demand.search || { terms: [], gaps: [], searches: 0, gaps_total: 0 };
    const wanted = demand.wanted || { items: [], summary: { want: {} } };
    const clicks = demand.clicks || { month: [], year: [], names: {} };

    /* 1. 站内搜索热词 */
    {
      const { card, body } = demandCard(
        "站内搜索热词",
        search.terms_total ? `${search.terms_total} 个词` : "",
        "墨站搜索框里访客搜过的词，按去重后的人次数排。"
      );
      if (!search.terms.length) {
        body.append(
          el(
            "p",
            "board-empty",
            "还没有数据。从这次上线起，墨站的每次搜索都会记一笔（只记词和结果数，不记人），攒起来就会有。"
          )
        );
      } else {
        const list = el("ol", "board-list term-list");
        for (const entry of search.terms) {
          list.append(termRow(entry, { gap: entry.zero_results > 0 }));
        }
        body.append(list);
      }
      host.append(card);
    }

    /* 2. 搜了没结果 —— 最值钱的一栏 */
    {
      const { card, body } = demandCard(
        "搜了没结果（缺口）",
        search.gaps_total ? `${search.gaps_total} 个词` : "",
        "有人搜、站里却一条都没有的词。补给这些最省事，回报也最确定。"
      );
      if (!search.gaps.length) {
        body.append(
          el(
            "p",
            "board-empty",
            search.terms.length
              ? "暂时没有缺口：搜过的词站里都有货。"
              : "先要有搜索数据才能算出缺口。"
          )
        );
      } else {
        const list = el("ol", "board-list term-list");
        for (const entry of search.gaps) list.append(termRow(entry, { gap: true }));
        body.append(list);
      }
      host.append(card);
    }

    /* 3. 求资源帮找 */
    {
      const summary = (wanted.summary && wanted.summary.want) || {};
      const open = Number(summary.open) || 0;
      const { card, body } = demandCard(
        "求资源帮找",
        open ? `${open} 条待找` : "",
        "用户在墨站「资源帮找」里明确提交的求助，按票数排。"
      );
      if (!wanted.items.length) {
        body.append(el("p", "board-empty", "还没有人提交求资源。"));
      } else {
        const list = el("ol", "board-list want-list");
        for (const item of wanted.items) list.append(wantedRow(item));
        body.append(list);
      }
      host.append(card);
    }

    /* 4. 点击最多 */
    {
      const rows = clickRows(clicks);
      const { card, body } = demandCard(
        "点击最多的资源",
        rows ? "" : "本月无点击",
        "墨站上真实被点开的资源（月 / 年）。成人向条目按墨站惯例不在这里列出。"
      );
      if (rows) body.append(rows);
      else body.append(el("p", "board-empty", "本月还没有点击记录。"));
      host.append(card);
    }
  }

  /* ---------- 渲染：总入口 ---------- */

  function render() {
    const boards = $("[data-boards]");
    const groups = visibleItems();
    boards.textContent = "";
    boards.dataset.single = String(state.active !== "all");
    boards.setAttribute("aria-busy", "false");

    if (state.error && !groups.some((g) => g.items.length)) {
      boards.append(el("p", "placeholder", state.error));
    } else if (!groups.length) {
      boards.append(el("p", "placeholder", "还没有数据，点「刷新」试试。"));
    } else {
      for (const group of groups) {
        boards.append(renderBoard(group.src, group.block, group.items));
      }
    }

    renderTabs();
    renderDemand();

    const search = (state.demand && state.demand.search) || {};
    const wanted = (state.demand && state.demand.wanted) || { items: [], summary: { want: {} } };
    let clues = 0;
    for (const group of groups) clues += group.items.length;

    $('[data-summary="searches"]').textContent = search.searches
      ? String(search.searches)
      : "—";
    $('[data-summary="gaps"]').textContent = search.gaps_total
      ? String(search.gaps_total)
      : "0";
    $('[data-summary="wanted"]').textContent = String(
      (wanted.summary && wanted.summary.want && wanted.summary.want.open) ||
        wanted.items.length ||
        0
    );
    $('[data-summary="clues"]').textContent = String(clues);
  }

  function renderStatus(text, tone) {
    const node = $("[data-status]");
    node.textContent = text;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  /* ---------- 数据加载 ---------- */

  function normalizeHot(json) {
    const data = {};
    const raw = (json && json.data) || {};
    for (const platform of PLATFORMS) {
      const block = raw[platform.id];
      if (!block) {
        data[platform.id] = {
          label: platform.label,
          ok: false,
          stale: false,
          provider: "",
          fetched_at: 0,
          items: [],
        };
        continue;
      }
      const items = (block.items || [])
        .map((item) => ({
          rank: Number(item.rank) || 0,
          title: String(item.title || ""),
          hot: item.hot == null ? "" : String(item.hot),
          url: safeUrl(item.url),
          want: wantHit(item.title),
        }))
        .filter((item) => item.title);
      items.forEach((item, index) => {
        if (!item.rank) item.rank = index + 1;
      });
      data[platform.id] = {
        label: block.label || platform.label,
        ok: block.ok !== false && items.length > 0,
        stale: !!block.stale,
        provider: String(block.provider || ""),
        fetched_at: Number(block.fetched_at) || 0,
        items,
      };
    }
    return data;
  }

  /** 依次试每个入口，第一个成功的就用（主入口偶发不可用时自动换）。 */
  async function getJson(path) {
    let lastError = "";
    for (const base of API_BASES) {
      try {
        const response = await fetch(`${base}${path}`, { cache: "no-store" });
        if (!response.ok) {
          lastError = `接口返回 ${response.status}`;
          continue;
        }
        return await response.json();
      } catch (err) {
        lastError = err && err.message ? err.message : String(err);
      }
    }
    throw new Error(lastError || "接口不可用");
  }

  async function load(force) {
    if (state.loading) return;
    state.loading = true;
    const btn = $("[data-refresh]");
    btn.disabled = true;
    renderStatus(force ? "正在强制刷新…" : "正在加载…");

    // 需求数据不随 refresh 变（都是实时查库），热榜才需要强制刷新
    const jobs = [getJson("/api/demand"), getJson(`/api/hot${force ? "?refresh=1" : ""}`)];
    const [demand, hot] = await Promise.all(jobs.map((p) => p.catch((err) => err)));

    if (demand instanceof Error) {
      state.error = `本站需求数据拉取失败：${demand.message}`;
    } else {
      state.demand = demand;
      state.error = "";
    }

    if (hot instanceof Error) {
      state.error = state.error || `热榜拉取失败：${hot.message}`;
      if (!state.demand) {
        renderStatus(state.error + "，稍后自动重试。", "warn");
        btn.disabled = false;
        state.loading = false;
        render();
        return;
      }
    } else {
      state.data = normalizeHot(hot);
      state.generatedAt = Number(hot.generated_at) || Date.now();
    }

    state.loadedAt = Date.now();

    const failed = hot instanceof Error
      ? []
      : PLATFORMS.filter((p) => !state.data[p.id].ok).map((p) => p.label);
    const stale = hot instanceof Error
      ? []
      : PLATFORMS.filter((p) => state.data[p.id].stale).map((p) => p.label);
    const notes = [];
    if (stale.length) notes.push(`${stale.join("、")} 是旧快照`);
    if (failed.length) notes.push(`${failed.join("、")} 暂时取不到`);
    if (hot instanceof Error) notes.push("热榜取不到");
    if (state.error) notes.push("需求数据部分取不到");
    renderStatus(
      `线索更新于 ${relativeTime(state.generatedAt)}` +
        (notes.length ? ` · ${notes.join("，")}` : " · 四平台均正常"),
      notes.length ? "warn" : ""
    );

    btn.disabled = false;
    state.loading = false;
    render();
  }

  /* ---------- 复制 ---------- */

  /**
   * 复制到剪贴板。navigator.clipboard 要 https + 用户手势，沙箱/内嵌预览里
   * 常常直接抛错，所以退回选中 + execCommand 的老办法。
   */
  async function copyText(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* 往下走兜底 */
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.top = "-1000px";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  async function onCopy(btn) {
    const text = btn.dataset.copy || "";
    if (await copyText(text)) {
      const old = btn.textContent;
      btn.textContent = "已复制";
      setTimeout(() => {
        btn.textContent = old;
      }, 1200);
    } else {
      renderStatus("复制失败，可以长按条目文字手动复制。", "warn");
    }
  }

  /* ---------- 主题 ---------- */

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    const btn = $("[data-theme-toggle]");
    if (btn) btn.setAttribute("aria-pressed", String(theme === "dark"));
  }

  function initTheme() {
    const KEY = "board-theme"; // 和第一站共用，两个页面互相记住
    let theme = "";
    try {
      theme = localStorage.getItem(KEY) || "";
    } catch (err) {
      theme = "";
    }
    if (!theme) {
      theme =
        window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    }
    applyTheme(theme);
    const btn = $("[data-theme-toggle]");
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch (err) {
        /* 隐私模式忽略 */
      }
    });
  }

  /* ---------- 事件 ---------- */

  function bind() {
    $("[data-tabs]").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab]");
      if (!btn) return;
      state.active = btn.dataset.tab;
      render();
    });

    const input = $("#q");
    let timer = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = input.value;
        render();
      }, 120);
    });

    $("[data-want-only]").addEventListener("change", (event) => {
      state.wantOnly = event.target.checked;
      render();
    });

    $("[data-refresh]").addEventListener("click", () => load(true));

    // 复制按钮分布在两块里（线索条目 + 需求词条），统一委托到 document
    document.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-copy]");
      if (btn) onCopy(btn);
    });

    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - state.loadedAt > AUTO_REFRESH_MS
      ) {
        load(false);
      }
    });
  }

  function tick() {
    if (Date.now() - state.loadedAt >= AUTO_REFRESH_MS) load(false);
  }

  /* ---------- 启动 ---------- */

  initTheme();
  bind();
  load(false);
  setInterval(tick, 60 * 1000);
})();
