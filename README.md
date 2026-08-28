# 中转站榜单（静态前端复刻）

参考 Gitmba（git.mba / maphub.xyz）的榜单页做的**纯静态**版本，可直接部署到 GitHub Pages。

## 文件

| 文件 | 说明 |
| --- | --- |
| `index.html` | 页面结构，卡片用 `<template>` 定义 |
| `styles.css` | 样式，含深浅色主题变量 |
| `app.js` | 原生 JS，无框架无依赖 |
| `data/resources.json` | 数据快照，目前是 4 条示例数据 |
| `.nojekyll` | 关掉 Jekyll，静态文件原样输出 |

## 已实现

- 榜单卡片列表，点击（或回车/空格）展开分组倍率与模型明细
- 搜索（站名 / 描述 / 标签 / 模型名）
- 排序：综合排名、倍率、模型数、延迟、评分、检测时间
- 筛选：接口状态、站点类型、是否有注册福利
- 顶部概览：收录数、接口正常比例、最低倍率、数据更新时间
- 深浅色主题切换，选择存进 `localStorage`
- 响应式布局，移动端指标区换行

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

## 安全说明

所有文本都走 `textContent` 写入，没有任何 `innerHTML` 赋值，因此数据里的内容不会被当成 HTML 执行。外链 `href` 做了协议白名单，只放行 `http(s)`，避免 `javascript:` 伪协议。

## 尚未实现（需要后端）

投票、评论、提交新站点、定时接口检测。GitHub Pages 只能托管静态文件，这些要靠 GitHub Actions 定时任务生成 JSON，或者接 serverless / Giscus。

