/**
 * 中转站榜单 —— 纯静态前端。
 * 数据来源：同目录 data/resources.json（由定时任务生成的快照）。
 * 不含任何后端调用，可直接部署到 GitHub Pages。
 */
(() => {
  "use strict";

  const DATA_URL = "data/resources.json";

  const state = {
    items: [],
    generatedAt: null,
    filters: { q: "", sort: "rank", category: "all", checkin: false, direct: false },
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- 工具函数 ---------- */

  const fmtMultiplier = (v) =>
    typeof v === "number" && isFinite(v) && v > 0 ? v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : "—";

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const relTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d)) return "—";
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return mins + " 分钟前";
    if (mins < 1440) return Math.round(mins / 60) + " 小时前";
    return Math.round(mins / 1440) + " 天前";
  };

  const CATEGORY_LABEL = { welfare: "公益", paid: "付费", free: "免费" };
  const BENEFIT_LABEL = { register: "注册赠送", invite: "邀请奖励", checkin: "每日签到", recharge: "充值返利" };
  /* ---------- 数据归一化 ---------- */

  /** 把原始快照字段收敛成前端只关心的形状，缺字段一律给安全默认值。 */
  function normalize(raw, index) {
    const groups = raw.group_ratios && typeof raw.group_ratios === "object" ? raw.group_ratios : {};
    const models = Array.isArray(raw.models) ? raw.models : [];
    return {
      id: raw.resource_id || "item-" + index,
      name: raw.resource_name || "未命名站点",
      description: raw.description || raw.resource_description || "暂无描述",
      url: raw.site_url || "",
      rank: typeof raw.rank_position === "number" ? raw.rank_position : index + 1,
      multiplier: typeof raw.displayed_multiplier === "number" ? raw.displayed_multiplier : null,
      modelCount: typeof raw.model_count === "number" ? raw.model_count : models.length,
      groupCount: typeof raw.model_group_count === "number" ? raw.model_group_count : Object.keys(groups).length,
      latency: typeof raw.latest_duration_ms === "number" ? raw.latest_duration_ms : null,
      rating: raw.board_votes && typeof raw.board_votes.rating === "number" ? raw.board_votes.rating : null,
      status: raw.current_status === "success" ? "success" : raw.current_status === "failed" ? "failed" : "unknown",
      category: ["welfare", "paid", "free"].includes(raw.consumer_category)
        ? raw.consumer_category
        : raw.category === "welfare"
          ? "welfare"
          : "paid",
      ratio: raw.recharge_ratio || "—",
      registerBonus: typeof raw.register_bonus === "number" ? raw.register_bonus : null,
      checkinBonus: typeof raw.checkin_bonus === "number" ? raw.checkin_bonus : null,
      currency: raw.bonus_currency === "USD" ? "$" : raw.bonus_currency === "CNY" ? "¥" : "",
      githubAge: raw.github_age_required || null,
      directConnect: raw.direct_connect !== false,
      benefits: Array.isArray(raw.benefit_flags) ? raw.benefit_flags : [],
      tags: (Array.isArray(raw.site_tags) && raw.site_tags.length ? raw.site_tags : raw.tags || []).slice(0, 6),
      testedAt: raw.last_tested_at || null,
      groups: Object.entries(groups)
        .filter(([, v]) => typeof v === "number")
        .sort((a, b) => a[1] - b[1])
        .slice(0, 12),
      modelNames: models
        .map((m) => (typeof m === "string" ? m : m && (m.display_name || m.model_id)))
        .filter(Boolean)
        .slice(0, 24),
    };
  }

  /** 搜索命中站名、描述、标签或模型名即可。 */
  function matchesQuery(item, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      item.name.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      item.tags.some((t) => String(t).toLowerCase().includes(needle)) ||
      item.modelNames.some((m) => m.toLowerCase().includes(needle))
    );
  }
  const SORTERS = {
    rank: (a, b) => a.rank - b.rank,
    bonus: (a, b) => (b.registerBonus ?? -1) - (a.registerBonus ?? -1),
    checkin: (a, b) => (b.checkinBonus ?? -1) - (a.checkinBonus ?? -1),
    multiplier: (a, b) => (a.multiplier ?? Infinity) - (b.multiplier ?? Infinity),
    models: (a, b) => b.modelCount - a.modelCount,
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
  };

  function applyFilters() {
    const f = state.filters;
    const list = state.items.filter((item) => {
      if (!matchesQuery(item, f.q)) return false;
      if (f.category !== "all" && item.category !== f.category) return false;
      if (f.checkin && !item.benefits.includes("checkin")) return false;
      if (f.direct && !item.directConnect) return false;
      return true;
    });
    return list.sort(SORTERS[f.sort] || SORTERS.rank);
  }

  /* ---------- 渲染 ---------- */

  function renderSummary() {
    const total = state.items.length;
    const bonuses = state.items.map((i) => i.registerBonus).filter((v) => typeof v === "number");
    const totalBonus = bonuses.reduce((s, v) => s + v, 0);
    const withCheckin = state.items.filter((i) => i.benefits.includes("checkin")).length;

    const set = (key, value) => {
      const el = $(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    };
    set("total", String(total).padStart(2, "0"));
    set("bonus", totalBonus ? "$" + totalBonus : "—");
    set("checkin", total ? `${withCheckin}/${total}` : "—");
    set("updated", relTime(state.generatedAt));

    const footer = $("[data-footer-updated]");
    if (footer) footer.textContent = fmtDate(state.generatedAt);
  }

  /** 用 <template> 克隆卡片，全部走 textContent，避免 HTML 注入。 */
  function buildCard(item) {
    const tpl = $("[data-card-template]");
    const node = tpl.content.firstElementChild.cloneNode(true);
    const field = (name) => node.querySelector(`[data-field="${name}"]`);

    field("rank").textContent = item.rank;
    field("name").textContent = item.name;
    field("description").textContent = item.description;

    // 无法直连的站点单独标出来，这是使用前必须知道的信息
    const connEl = field("status");
    if (item.directConnect) {
      connEl.textContent = "可直连";
      connEl.classList.add("ok");
    } else {
      connEl.textContent = "需代理";
      connEl.classList.add("bad");
    }

    field("category").textContent = CATEGORY_LABEL[item.category] || "付费";

    const tagList = field("tags");
    item.tags.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      tagList.appendChild(li);
    });

    const bonusEl = field("bonus");
    bonusEl.textContent = item.registerBonus === null ? "—" : item.currency + item.registerBonus;
    if (item.registerBonus && item.registerBonus >= 100) bonusEl.classList.add("good");
    field("checkin").textContent = item.checkinBonus === null ? "—" : item.currency + item.checkinBonus;
    field("multiplier").textContent = fmtMultiplier(item.multiplier);
    field("models").textContent = item.modelCount || "—";

    field("ratio").textContent = item.ratio;
    field("benefits").textContent = item.benefits.length
      ? item.benefits.map((b) => BENEFIT_LABEL[b] || b).join(" · ")
      : "无";
    field("githubAge").textContent = item.githubAge || "无要求";
    field("connect").textContent = item.directConnect ? "可直连" : "需自备代理";

    const groupList = field("groups");
    if (item.groups.length) {
      item.groups.forEach(([name, ratio]) => {
        const li = document.createElement("li");
        li.textContent = name + " ";
        const b = document.createElement("b");
        b.textContent = "×" + fmtMultiplier(ratio);
        li.appendChild(b);
        groupList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "暂无分组数据";
      groupList.appendChild(li);
    }

    const modelList = field("modelList");
    (item.modelNames.length ? item.modelNames : ["暂无模型数据"]).forEach((m) => {
      const li = document.createElement("li");
      li.textContent = m;
      modelList.appendChild(li);
    });

    const link = field("link");
    // 只放行 http(s)，防止 javascript: 之类的协议
    if (/^https?:\/\//i.test(item.url)) {
      link.href = item.url;
    } else {
      link.remove();
    }
    // 卡片展开/收起：点击与键盘都支持
    const detail = node.querySelector("[data-detail]");
    const toggle = () => {
      const open = node.getAttribute("aria-expanded") === "true";
      node.setAttribute("aria-expanded", String(!open));
      detail.hidden = open;
    };
    node.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // 点链接不触发折叠
      toggle();
    });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });


    return node;
  }

  function renderBoard() {
    const list = applyFilters();
    const board = $("[data-board]");
    const empty = $("[data-empty]");
    const count = $("[data-result-count]");

    board.textContent = "";
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildCard(item)));
    board.appendChild(frag);

    empty.hidden = list.length > 0;
    count.textContent = list.length ? `显示 ${list.length} / ${state.items.length} 个站点` : "";
  }

  /* ---------- 事件绑定 ---------- */

  function bindControls() {
    $$("[data-filter]").forEach((el) => {
      const key = el.dataset.filter;
      const evt = el.type === "search" || el.type === "text" ? "input" : "change";
      el.addEventListener(evt, () => {
        state.filters[key] = el.type === "checkbox" ? el.checked : el.value.trim();
        renderBoard();
      });
    });
    const form = $("[data-controls]");
    if (form) form.addEventListener("submit", (e) => e.preventDefault());
  }

  function bindTheme() {
    const btn = $("[data-theme-toggle]");
    if (!btn) return;
    const saved = localStorage.getItem("board-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const apply = (theme) => {
      document.documentElement.dataset.theme = theme;
      btn.setAttribute("aria-pressed", String(theme === "dark"));
      localStorage.setItem("board-theme", theme);
    };
    apply(saved || (prefersDark ? "dark" : "light"));
    btn.addEventListener("click", () => {
      apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
  }

  /* ---------- 启动 ---------- */

  async function init() {
    bindTheme();
    bindControls();
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      const rawItems = Array.isArray(payload) ? payload : payload.items || [];
      state.items = rawItems.map(normalize);
      state.generatedAt = payload.generated_at || null;
      renderSummary();
      renderBoard();
    } catch (err) {
      const board = $("[data-board]");
      board.textContent = "";
      const p = document.createElement("p");
      p.className = "load-error";
      p.textContent = "数据加载失败：" + err.message + "（请确认 data/resources.json 存在）";
      board.appendChild(p);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();

