/**
 * 中转站榜单 —— 纯静态前端。
 * 数据来源：同目录 data/resources.json（由定时任务生成的快照）。
 * 不含任何后端调用，可直接部署到 GitHub Pages。
 */
(() => {
  "use strict";

  const DATA_URL = "data/resources.json";
  const API_CANDIDATES = (() => {
    const raw = (window.BOARD_CONFIG || {}).adminApi;
    return (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .map((x) => String(x || "").replace(/\/$/, ""))
      .filter(Boolean);
  })();

  const state = {
    items: [],
    rawItems: [],
    customItems: [],
    overrides: {},
    generatedAt: null,
    filters: { q: "", sort: "rank", category: "all", checkin: false, direct: false },
  };

  let apiBase = "";
  let adminToken = "";
  let adminFlash = null;

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
    const override = state.overrides[raw.resource_id] || {};
    const source = { ...raw, ...override };
    const groups = source.group_ratios && typeof source.group_ratios === "object" ? source.group_ratios : {};
    const models = Array.isArray(source.models) ? source.models : [];
    return {
      id: source.resource_id || "item-" + index,
      name: source.resource_name || "未命名站点",
      description: source.description || source.resource_description || "暂无描述",
      url: source.site_url || "",
      rank: typeof source.rank_position === "number" ? source.rank_position : index + 1,
      multiplier: typeof source.displayed_multiplier === "number" ? source.displayed_multiplier : null,
      modelCount: typeof source.model_count === "number" ? source.model_count : models.length,
      groupCount: typeof source.model_group_count === "number" ? source.model_group_count : Object.keys(groups).length,
      latency: typeof source.latest_duration_ms === "number" ? source.latest_duration_ms : null,
      rating: source.board_votes && typeof source.board_votes.rating === "number" ? source.board_votes.rating : null,
      status: source.current_status === "success" ? "success" : source.current_status === "failed" ? "failed" : "unknown",
      category: ["welfare", "paid", "free"].includes(source.consumer_category)
        ? source.consumer_category
        : source.category === "welfare"
          ? "welfare"
          : "paid",
      ratio: source.recharge_ratio || "—",
      registerBonus: typeof source.register_bonus === "number" ? source.register_bonus : null,
      checkinBonus: typeof source.checkin_bonus === "number" ? source.checkin_bonus : null,
      currency:
        source.bonus_currency === "USD"
          ? "$"
          : source.bonus_currency === "CNY"
            ? "¥"
            : source.bonus_currency
              ? " " + source.bonus_currency
              : "",
      currencyCode: source.bonus_currency || "",
      githubAge: source.github_age_required || null,
      accountRequirement: source.account_requirement || "",
      directConnect: source.direct_connect !== false,
      caveat: source.caveat || "",
      caveatTag: source.caveat_tag || "",
      extraNote: source.extra_note || "",
      benefits: Array.isArray(source.benefit_flags) ? source.benefit_flags : [],
      tags: (Array.isArray(source.site_tags) && source.site_tags.length ? source.site_tags : source.tags || []).slice(0, 6),
      testedAt: source.last_tested_at || null,
      groups: Object.entries(groups)
        .filter(([, v]) => typeof v === "number")
        .sort((a, b) => a[1] - b[1])
        .slice(0, 12),
      modelNames: models
        .map((m) => (typeof m === "string" ? m : m && (m.display_name || m.model_id)))
        .filter(Boolean)
        .slice(0, 50),
      edited: Object.keys(override).some((key) => key !== "updated"),
      isCustom: String(source.resource_id || "").startsWith("custom-"),
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
    // 只合计美元额度。站点的赠送额度单位并不统一（有 $ / ¥ / Gems / 积分），
    // 早先这里把所有 registerBonus 不分单位地相加再前缀一个 "$"，
    // 混进一个 ¥ 站就会算出「$583.76」这种既错单位又带小数的数字。
    const usd = state.items.filter((i) => i.currency === "$" && typeof i.registerBonus === "number");
    const totalBonus = usd.reduce((s, i) => s + i.registerBonus, 0);
    const withCheckin = state.items.filter((i) => i.benefits.includes("checkin")).length;

    const set = (key, value) => {
      const el = $(`[data-stat="${key}"]`);
      if (el) el.textContent = value;
    };
    set("total", String(total).padStart(2, "0"));
    // 非整数才保留两位小数，避免 "$575.00" 这种啰嗦写法
    set("bonus", totalBonus ? "$" + (Number.isInteger(totalBonus) ? totalBonus : totalBonus.toFixed(2)) : "—");
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
    // 禁忌标签追加在末尾并高亮，不参与 tags 的 6 个上限
    if (item.caveatTag) {
      const li = document.createElement("li");
      li.className = "tag-warn";
      li.textContent = "⚠ " + item.caveatTag;
      tagList.appendChild(li);
    }

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
    // GitHub 年限是最常见的门槛，但也有站要求别的身份源（如 Linux DO）。
    // 标题已改成通用的「账号要求」，所以这里要把 GitHub 补回文案里，
    // 否则只显示「1年以上」看不出是什么账号满一年。
    field("githubAge").textContent = item.githubAge
      ? "GitHub 账号满" + item.githubAge
      : item.accountRequirement || "无要求";
    field("connect").textContent = item.directConnect ? "可直连" : "需自备代理";

    // 使用禁忌：插在明细区最前面，展开就能看到
    const caveatEl = node.querySelector("[data-field='caveat']");
    if (caveatEl) {
      if (item.caveat) {
        caveatEl.textContent = "⚠ " + item.caveat;
      } else {
        caveatEl.remove();
      }
    }

    // 站点补充说明：中性信息，样式比禁忌弱
    const extraEl = node.querySelector("[data-field='extraNote']");
    if (extraEl) {
      if (item.extraNote) {
        extraEl.textContent = item.extraNote;
      } else {
        extraEl.remove();
      }
    }

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
    if (/^https?:\/\//i.test(item.url)) {
      link.href = item.url;
    } else {
      link.remove();
    }

    const adminWrap = field("adminWrap");
    if (adminToken) {
      adminWrap.hidden = false;
      const btn = field("adminBtn");
      const msg = field("adminMsg");
      const box = field("adminForm");
      const openEditor = () => {
        box.hidden = false;
        btn.textContent = "收起编辑";
        buildAdminEditor(item, box, msg);
      };
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        if (box.hidden) openEditor();
        else {
          box.hidden = true;
          btn.textContent = "编辑这条";
        }
      });
      if (adminFlash && adminFlash.id === item.id) {
        openEditor();
        msg.textContent = adminFlash.text;
        msg.className = "card-admin-msg " + adminFlash.kind;
      }
    } else {
      adminWrap.remove();
    }

    // 卡片展开/收起：点击与键盘都支持
    const detail = node.querySelector("[data-detail]");
    const toggle = () => {
      const open = node.getAttribute("aria-expanded") === "true";
      node.setAttribute("aria-expanded", String(!open));
      detail.hidden = open;
    };
    const interactive = "a, button, input, textarea, select, label, code";
    node.addEventListener("click", (e) => {
      if (e.target.closest && e.target.closest(interactive)) return;
      toggle();
    });
    node.addEventListener("keydown", (e) => {
      if (e.target !== node) return;
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

  function rebuild() {
    state.items = state.rawItems.concat(state.customItems).map(normalize);
    renderSummary();
    renderBoard();
  }

  async function loadRemote(path, fallback) {
    const candidates = apiBase
      ? [apiBase, ...API_CANDIDATES.filter((base) => base !== apiBase)]
      : API_CANDIDATES;
    for (const base of candidates) {
      try {
        const res = await fetch(base + path, { cache: "no-store" });
        if (!res.ok) continue;
        apiBase = base;
        return await res.json();
      } catch {
        // 国内线路偶发超时，继续试备用入口。
      }
    }
    return fallback;
  }

  async function refreshRemote() {
    const [overrideData, itemData] = await Promise.all([
      loadRemote("/api/board/overrides", { overrides: {} }),
      loadRemote("/api/board/items", { items: [] }),
    ]);
    state.overrides = overrideData.overrides || {};
    state.customItems = Array.isArray(itemData.items) ? itemData.items : [];
    rebuild();
  }

  async function adminFetch(path, body) {
    if (!apiBase) await loadRemote("/api/board/overrides", {});
    if (!apiBase) return { ok: false, error: "后台接口暂时连不上" };
    const bases = adminToken
      ? [apiBase]
      : [apiBase, ...API_CANDIDATES.filter((base) => base !== apiBase)];
    for (const base of bases) {
      try {
        const res = await fetch(base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(adminToken ? { Authorization: "Bearer " + adminToken } : {}),
          },
          body: JSON.stringify(body || {}),
        });
        const data = await res.json().catch(() => ({}));
        apiBase = base;
        if (res.status === 401 && adminToken) {
          adminToken = "";
          renderAdmin();
          renderBoard();
          return { ok: false, error: "登录已过期，请重新登录" };
        }
        return res.ok ? { ok: true, data } : { ok: false, error: data.error || "操作失败" };
      } catch {
        // 当前入口连不上时试备用入口。会话只在登录成功的入口使用。
      }
    }
    return { ok: false, error: "网络不通" };
  }

  const ADMIN_FIELDS = [
    { key: "resource_name", prop: "name", label: "站点名", type: "text", required: true },
    { key: "description", prop: "description", label: "简介", type: "textarea" },
    { key: "site_url", prop: "url", label: "站点链接", type: "text" },
    { key: "rank_position", prop: "rank", label: "综合排名", type: "number" },
    { key: "register_bonus", prop: "registerBonus", label: "注册送额度", type: "number-null" },
    { key: "checkin_bonus", prop: "checkinBonus", label: "签到额度", type: "number-null" },
    { key: "bonus_currency", prop: "currencyCode", label: "额度单位（USD / CNY / Gems）", type: "text" },
    { key: "displayed_multiplier", prop: "multiplier", label: "倍率", type: "number-null" },
    { key: "model_count", prop: "modelCount", label: "模型数量", type: "number-null" },
    { key: "models", prop: "modelNames", label: "模型（每行或逗号分隔）", type: "list" },
    { key: "consumer_category", prop: "category", label: "站点类型", type: "category" },
    { key: "direct_connect", prop: "directConnect", label: "可直连", type: "checkbox" },
    { key: "github_age_required", prop: "githubAge", label: "GitHub 账号要求", type: "text" },
    { key: "account_requirement", prop: "accountRequirement", label: "其他账号要求", type: "text" },
    { key: "recharge_ratio", prop: "ratio", label: "充值比例", type: "text" },
    { key: "benefit_flags", prop: "benefits", label: "福利（register / checkin 等）", type: "list" },
    { key: "site_tags", prop: "tags", label: "标签（每行或逗号分隔）", type: "list" },
    { key: "caveat_tag", prop: "caveatTag", label: "警示标签", type: "text" },
    { key: "caveat", prop: "caveat", label: "警示内容", type: "textarea" },
    { key: "extra_note", prop: "extraNote", label: "补充说明", type: "textarea" },
  ];

  const splitList = (value) => String(value || "").split(/[\n,，]+/).map((x) => x.trim()).filter(Boolean);

  function addAdminField(box, field, value, changed) {
    const row = document.createElement("label");
    row.className = field.type === "checkbox" ? "admin-field admin-field-inline" : "admin-field";
    const label = document.createElement("span");
    label.textContent = field.label + (field.required ? " *" : "");
    if (changed) {
      const em = document.createElement("em");
      em.textContent = "已改";
      label.appendChild(em);
    }
    let input;
    if (field.type === "textarea" || field.type === "list") {
      input = document.createElement("textarea");
      input.rows = field.type === "list" ? 3 : 2;
      input.value = Array.isArray(value) ? value.join("\n") : value || "";
    } else if (field.type === "category") {
      input = document.createElement("select");
      [["welfare", "公益"], ["free", "免费"], ["paid", "付费为主"]].forEach(([id, text]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = text;
        input.appendChild(option);
      });
      input.value = value || "paid";
    } else {
      input = document.createElement("input");
      input.type = field.type === "checkbox" ? "checkbox" : field.type.startsWith("number") ? "number" : "text";
      if (field.type === "checkbox") input.checked = value !== false;
      else input.value = value === null || value === undefined ? "" : value;
      if (field.type.startsWith("number")) input.step = "any";
    }
    row.append(label, input);
    box.appendChild(row);
    return input;
  }

  function readAdminValue(field, input) {
    if (field.type === "checkbox") return input.checked;
    if (field.type === "list") return splitList(input.value);
    if (field.type === "number") return Number(input.value);
    if (field.type === "number-null") return input.value.trim() === "" ? null : Number(input.value);
    return input.value.trim();
  }

  function buildAdminNewForm(box, msg) {
    box.textContent = "";
    const inputs = {};
    ADMIN_FIELDS.forEach((field) => {
      const defaults = { rank: state.items.length + 1, category: "welfare", directConnect: true };
      inputs[field.key] = addAdminField(box, field, defaults[field.prop], false);
    });
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "admin-save";
    submit.textContent = "添加";
    actions.appendChild(submit);
    box.appendChild(actions);
    const say = (text, kind = "") => {
      msg.textContent = text;
      msg.className = "admin-new-msg" + (kind ? " " + kind : "");
    };
    submit.addEventListener("click", async () => {
      const body = {};
      ADMIN_FIELDS.forEach((field) => { body[field.key] = readAdminValue(field, inputs[field.key]); });
      if (!body.resource_name) return say("站点名不能为空", "bad");
      submit.disabled = true;
      say("添加中…");
      const result = await adminFetch("/api/board/admin/item", body);
      submit.disabled = false;
      if (!result.ok) return say(result.error, "bad");
      say("已添加，所有访客立即可见", "ok");
      await refreshRemote();
    });
  }

  function buildAdminEditor(item, box, msg) {
    box.textContent = "";
    const override = state.overrides[item.id] || {};
    const inputs = {};
    ADMIN_FIELDS.forEach((field) => {
      inputs[field.key] = addAdminField(box, field, item[field.prop], field.key in override);
    });
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "admin-save";
    save.textContent = "保存";
    actions.appendChild(save);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "admin-reset";
    reset.textContent = "撤销全部改动";
    reset.hidden = !Object.keys(override).some((key) => key !== "updated");
    actions.appendChild(reset);
    if (item.isCustom) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "admin-delete";
      del.textContent = "删除这条";
      actions.appendChild(del);
      del.addEventListener("click", async () => {
        if (!confirm(`确定删除「${item.name}」？此操作不可撤销。`)) return;
        del.disabled = true;
        const result = await adminFetch("/api/board/admin/item/delete", { id: item.id });
        if (!result.ok) { del.disabled = false; return say(result.error, "bad"); }
        await refreshRemote();
      });
    }
    box.appendChild(actions);
    const say = (text, kind = "") => {
      msg.textContent = text;
      msg.className = "card-admin-msg" + (kind ? " " + kind : "");
    };
    save.addEventListener("click", async () => {
      const fields = {};
      ADMIN_FIELDS.forEach((field) => {
        const next = readAdminValue(field, inputs[field.key]);
        const current = item[field.prop];
        if (JSON.stringify(next) !== JSON.stringify(current)) fields[field.key] = next;
      });
      if (!Object.keys(fields).length) return say("没有改动");
      save.disabled = true;
      say("保存中…");
      const result = await adminFetch("/api/board/admin/override", { item_id: item.id, fields });
      save.disabled = false;
      if (!result.ok) return say(result.error, "bad");
      adminFlash = { id: item.id, text: "已保存，所有访客立即可见", kind: "ok" };
      await refreshRemote();
      adminFlash = null;
    });
    reset.addEventListener("click", async () => {
      reset.disabled = true;
      const result = await adminFetch("/api/board/admin/override", {
        item_id: item.id,
        fields: {},
        clear_fields: ADMIN_FIELDS.map((field) => field.key),
      });
      reset.disabled = false;
      if (!result.ok) return say(result.error, "bad");
      adminFlash = { id: item.id, text: "已恢复静态数据原值", kind: "ok" };
      await refreshRemote();
      adminFlash = null;
    });
  }

  function renderAdmin() {
    const panel = $("[data-admin-panel]");
    if (!panel) return;
    const visible = location.hash === "#admin";
    panel.hidden = !visible;
    if (!visible) return;
    const logged = !!adminToken;
    const input = $("[data-admin-input]");
    const submit = $("[data-admin-submit]");
    const logout = $("[data-admin-logout]");
    const label = panel.querySelector('label[for="admin-pw"]');
    input.hidden = logged;
    submit.hidden = logged;
    logout.hidden = !logged;
    label.hidden = logged;
    $("[data-admin-new]").hidden = !logged;
    $("[data-admin-sub]").textContent = logged
      ? "已登录。可新增站点；展开卡片后点「编辑这条」修改，保存立即生效。"
      : "登录方式与第二站相同：密码在 Cloudflare Secret 中校验。";
  }

  function bindAdmin() {
    const form = $("[data-admin-login]");
    const input = $("[data-admin-input]");
    const submit = $("[data-admin-submit]");
    const msg = $("[data-admin-msg]");
    const say = (text, kind = "") => {
      msg.textContent = text;
      msg.className = "admin-msg" + (kind ? " " + kind : "");
    };
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = input.value;
      if (!password) return say("请输入密码", "bad");
      submit.disabled = true;
      say("登录中…");
      const result = await adminFetch("/api/board/admin/login", { password });
      submit.disabled = false;
      input.value = "";
      if (!result.ok) return say(result.error, "bad");
      adminToken = result.data.token;
      say("登录成功", "ok");
      renderAdmin();
      renderBoard();
    });
    $("[data-admin-logout]").addEventListener("click", async () => {
      await adminFetch("/api/board/admin/logout", {});
      adminToken = "";
      say("已退出", "ok");
      renderAdmin();
      renderBoard();
    });
    const toggle = $("[data-admin-new-toggle]");
    const box = $("[data-admin-new-form]");
    const newMsg = $("[data-admin-new-msg]");
    toggle.addEventListener("click", () => {
      const open = !box.hidden;
      box.hidden = open;
      toggle.textContent = open ? "+ 新增一个站点" : "收起";
      if (!open) buildAdminNewForm(box, newMsg);
    });
    window.addEventListener("hashchange", renderAdmin);
    renderAdmin();
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
    bindAdmin();
    try {
      const [res, overrideData, itemData] = await Promise.all([
        fetch(DATA_URL, { cache: "no-cache" }),
        loadRemote("/api/board/overrides", { overrides: {} }),
        loadRemote("/api/board/items", { items: [] }),
      ]);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const payload = await res.json();
      state.rawItems = Array.isArray(payload) ? payload : payload.items || [];
      state.overrides = overrideData.overrides || {};
      state.customItems = Array.isArray(itemData.items) ? itemData.items : [];
      state.generatedAt = payload.generated_at || null;
      rebuild();
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

