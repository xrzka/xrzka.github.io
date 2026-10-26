/**
 * 求资源热榜（/qiu/）前端。
 *
 * 只做三件事：拉 Worker 的 /api/hot、按平台/关键词筛、渲染成卡片列表。
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

  /** 平台顺序与图标。数据里的 label 优先，这份只是兜底。 */
  const PLATFORMS = [
    { id: "bili", label: "B站", icon: "📺" },
    { id: "douyin", label: "抖音", icon: "🎵" },
    { id: "ks", label: "快手", icon: "⚡" },
    { id: "xhs", label: "小红书", icon: "📕" },
  ];

  /** 自动刷新间隔，和 Worker 的 10 分钟缓存对齐。 */
  const AUTO_REFRESH_MS = 10 * 60 * 1000;

  /**
   * 「求资源」粗筛词。命中任意一个就在条目上打标（也能用开关过滤）。
   * 都是「有人在找某个东西」的味道，不含纯新闻词。
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
    wantOnly: false,
    data: {},        // { src: {label, ok, stale, provider, fetched_at, items[]} }
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

  /* ---------- 渲染 ---------- */

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
        const count = block ? (block.items || []).length : 0;
        btn.append(el("span", "tab-count", count ? String(count) : "—"));
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
      card.append(
        el("p", "board-empty", "这个平台暂时取不到数据，稍后自动重试。")
      );
      return card;
    }
    if (!items.length) {
      card.append(el("p", "board-empty", "当前筛选下没有条目。"));
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
      if (item.want) {
        const flag = el("span", "want-flag", "🔍 疑似求资源");
        body.append(flag);
      }

      const search = el("a", "mini-btn", "找资源");
      search.href = `https://xrzka.github.io/mo/?q=${encodeURIComponent(item.title)}`;
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

  function render() {
    const boards = $("[data-boards]");
    const groups = visibleItems();
    boards.textContent = "";
    boards.dataset.single = String(state.active !== "all");
    boards.setAttribute("aria-busy", "false");

    if (state.error && !groups.some((g) => g.items.length)) {
      boards.append(el("p", "placeholder", state.error));
      return;
    }
    if (!groups.length) {
      boards.append(el("p", "placeholder", "还没有数据，点「刷新」试试。"));
      return;
    }

    let total = 0;
    let wanted = 0;
    for (const group of groups) {
      boards.append(renderBoard(group.src, group.block, group.items));
      total += group.items.length;
      wanted += group.items.filter((i) => i.want).length;
    }

    $('[data-summary="items"]').textContent = String(total);
    $('[data-summary="wanted"]').textContent = String(wanted);
  }

  function renderStatus(text, tone) {
    const node = $("[data-status]");
    node.textContent = text;
    if (tone) node.dataset.tone = tone;
    else delete node.dataset.tone;
  }

  function renderFreshness() {
    $('[data-summary="fresh"]').textContent = state.loadedAt
      ? relativeTime(state.loadedAt)
      : "—";
  }

  /* ---------- 数据加载 ---------- */

  function normalizePayload(json) {
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

  async function requestHot(force) {
    let lastError = "";
    for (const base of API_BASES) {
      const url = `${base}/api/hot${force ? "?refresh=1" : ""}`;
      try {
        const response = await fetch(url, { cache: "no-store" });
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
    renderStatus(force ? "正在强制刷新四个平台…" : "正在加载…");

    try {
      const json = await requestHot(force);
      state.data = normalizePayload(json);
      state.generatedAt = Number(json.generated_at) || Date.now();
      state.loadedAt = Date.now();
      state.error = "";
      const failed = PLATFORMS.filter((p) => !state.data[p.id].ok).map((p) => p.label);
      const stale = PLATFORMS.filter((p) => state.data[p.id].stale).map((p) => p.label);
      const notes = [];
      if (stale.length) notes.push(`${stale.join("、")} 是旧快照`);
      if (failed.length) notes.push(`${failed.join("、")} 暂时取不到`);
      renderStatus(
        `数据时间 ${relativeTime(state.generatedAt)}` +
          (notes.length ? ` · ${notes.join("，")}` : " · 四平台均正常"),
        notes.length ? "warn" : ""
      );
    } catch (err) {
      state.error = `拉取失败：${err.message}。可能是网络或接口临时不可用，稍后自动重试。`;
      renderStatus(state.error, "warn");
    } finally {
      state.loading = false;
      btn.disabled = false;
      renderTabs();
      render();
      renderFreshness();
    }
  }

  /* ---------- 主题 ---------- */

  function initTheme() {
    const KEY = "board-theme";
    let theme = "";
    try {
      theme = localStorage.getItem(KEY) || "";
    } catch (err) {
      theme = "";
    }
    if (!theme) {
      theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
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

  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    const btn = $("[data-theme-toggle]");
    if (btn) btn.setAttribute("aria-pressed", String(theme === "dark"));
  }

  /* ---------- 事件 ---------- */

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

  function bind() {
    $("[data-tabs]").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-tab]");
      if (!btn) return;
      state.active = btn.dataset.tab;
      renderTabs();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
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

    $("[data-boards]").addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-copy]");
      if (!btn) return;
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
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - state.loadedAt > AUTO_REFRESH_MS) {
        load(false);
      }
    });
  }

  function tick() {
    renderFreshness();
    if (Date.now() - state.loadedAt >= AUTO_REFRESH_MS) load(false);
  }

  /* ---------- 启动 ---------- */

  initTheme();
  bind();
  renderTabs();
  load(false);
  setInterval(tick, 30 * 1000);
})();
