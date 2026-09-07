# 中转站榜单（静态前端复刻）

参考 Gitmba（git.mba / maphub.xyz）的榜单页制作。前台是 GitHub Pages 静态页面；
站长新增和修改卡片时，使用 Cloudflare Worker + D1 保存覆盖数据。

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构，卡片用 `<template>` 定义 |
| `styles.css` | 样式，含深浅色主题变量 |
| `app.js` | 原生 JS，无框架无依赖 |
| `config.js` | 第一站后台的 Worker / Pages 接口地址 |
| `data/resources.json` | 静态数据快照，目前是 14 条基础数据 |
| `.nojekyll` | 关掉 Jekyll，静态文件原样输出 |

## 已实现

- 榜单卡片列表，点击（或回车/空格）展开分组倍率与模型明细
- 搜索（站名 / 描述 / 标签 / 模型名）
- 排序：综合排名、倍率、模型数、延迟、评分、检测时间
- 筛选：接口状态、站点类型、是否有注册福利
- 顶部概览：收录数、接口正常比例、最低倍率、数据更新时间
- 深浅色主题切换，选择存进 `localStorage`
- 响应式布局，移动端指标区换行
- 隐藏式站长后台：新增卡片、修改卡片、撤销覆盖、删除后台新增卡片

## 本地预览

```bash
cd relay_board_site
python -m http.server 8899
# 打开 http://127.0.0.1:8899
```

必须用 HTTP 服务打开，直接双击 `index.html` 会因为 `file://` 的 CORS 限制导致 `fetch` 读不到 JSON。

## 数据格式

`app.js` 里的 `normalize()` 负责把原始字段收敛成前端形状，缺字段一律给默认值。主要字段：

```
resource_name, description, site_url, rank_position,
displayed_multiplier, model_count, model_group_count,
latest_duration_ms, board_votes.rating, current_status,
consumer_category, recharge_ratio, benefit_flags,
site_tags, last_tested_at, group_ratios, models
```

顶层 `generated_at` 用于显示数据新鲜度。

### 额度单位不统一，合计只算美元

`bonus_currency` 各站不同（`USD` / `CNY` / `Gems` / `积分`）。顶部「注册额度合计（$）」
**只累加 `bonus_currency` 为 `USD` 的站**，混着加会算出既错单位又带小数的数字
（收录异常芙芙公益那条 `CNY` 站时踩过：原先不分单位相加得到 `$583.76`）。
卡片上单站的额度仍按各自单位显示，`normalize()` 里 `currency` 负责选符号。

## 站长后台

访问 `https://xrzka.github.io/#admin`（本地预览则是 `http://127.0.0.1:8899/#admin`）。
页面不会展示后台入口，密码通过 Cloudflare Worker Secret 校验。登录后可以：

- 新增站点卡片，保存后立即对所有访客可见；
- 展开任意卡片修改标题、简介、链接、额度、倍率、模型、标签和说明；
- 撤销静态卡片的全部覆盖；删除由后台新增的卡片。

前端只保存当前内存中的短期 token，刷新后需要重新登录。覆盖与新增数据存放在
第二站现有 Worker/D1 的独立 `board_*` 表中；配置地址见 `config.js`，部署与设置密码
见 `../mo_site/worker/README.md` 的“第一站（中转站榜单）共用后台”。

## 安全说明

所有文本都走 `textContent` 写入，没有任何 `innerHTML` 赋值，因此数据里的内容不会被当成 HTML 执行。外链 `href` 做了协议白名单，只放行 `http(s)`，避免 `javascript:` 伪协议。

## 尚未实现

投票、评论和定时接口检测仍未实现。新增站点与卡片修改已通过 Cloudflare Worker + D1 后台实现。

