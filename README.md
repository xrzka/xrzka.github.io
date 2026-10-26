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
| `stars/` | **另一个独立页面**：`https://xrzka.github.io/stars/` GitHub 应用 Stars 榜，见下 |
| `qiu/` | **另一个独立页面**：`https://xrzka.github.io/qiu/` 求资源热榜（B站/抖音/快手/小红书），见下 |
| `.github/workflows/stars-board.yml` | 每天 UTC 02:17 采集 `stars/` 的 star 快照并提交回仓库 |

## 已实现

- 榜单卡片列表，点击（或回车/空格）展开分组倍率与模型明细
- 搜索（站名 / 描述 / 标签 / 模型名）
- 排序：综合排名、倍率、模型数、延迟、评分、检测时间
- 筛选：接口状态、站点类型、是否有注册福利、仅看废站
- 废站（墓园）标记：`☠ 已废` 徽标 + 卡片置灰 + 明细区废站原因，废站统一沉底，
  「当前收录 / 注册额度合计」等统计只算活站，墓园数量单独一格
- 顶部概览：收录数、接口正常比例、最低倍率、数据更新时间
- 深浅色主题切换，选择存进 `localStorage`
- 响应式布局，移动端指标区换行
- 隐藏式站长后台：新增卡片、修改卡片、撤销覆盖、删除卡片与恢复静态卡片

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
- **最快入墓园**：展开卡片就有「☠ 加入废站」按钮，点一下直接生效，不弹窗不填表；
  想补废站原因再用「编辑这条」（编辑器里有「废站原因」字段，编辑器内的一键按钮
  会在加入时提示填原因）；
- 「☠ 新增废站」快速表单：站点名是唯一必填，链接 / 原因 / 补充说明可留空；
- 撤销静态卡片的全部覆盖；删除后台新增卡片；软删除并恢复静态卡片。

废站数据存在覆盖层的 `dead`（布尔）与 `dead_note`（≤200 字）字段里，对静态卡片
和后台新增卡片都生效；勾「仅看废站」可以只看墓园。

前端只保存当前内存中的短期 token，刷新后需要重新登录。覆盖与新增数据存放在
第二站现有 Worker/D1 的独立 `board_*` 表中；配置地址见 `config.js`，部署与设置密码
见 `../mo_site/worker/README.md` 的“第一站（中转站榜单）共用后台”。

## 安全说明

所有文本都走 `textContent` 写入，没有任何 `innerHTML` 赋值，因此数据里的内容不会被当成 HTML 执行。外链 `href` 做了协议白名单，只放行 `http(s)`，避免 `javascript:` 伪协议。

## 尚未实现

投票、评论和定时接口检测仍未实现。新增站点与卡片修改已通过 Cloudflare Worker + D1 后台实现。

## stars/（GitHub 应用 Stars 榜）

挂在同一个 Pages 域名下的**独立子页面**，和第一站的中转站榜单没有代码耦合：自带
`index.html` / `app.js` / `styles.css` / `collect.mjs` / `data/`，只有 `.github/workflows/stars-board.yml`
在仓库根（因为 Actions 的 workflow 只能放这儿）。

- 页面：`https://xrzka.github.io/stars/`
- 完整设计文档与坑：`stars/README.md`（快照差分原理、分片枚举、`--backfill` 回填、参数表、局限）
- 数据：`stars/data/board.json`（清单，~1KB）+ `stars/data/boards/<榜名>.json`（各榜条目，切 tab 才拉）
  + `stars/data/snapshots/<日期>.json`（每日快照）
- 分页：每页 10 / 20 / 50 / 100 / 500 / 1000 / 2000 条，卡片 `#N` 是全局名次

### 在这里改它时的注意点

- **workflow 里两条路径别弄丢**：采集步骤有 `working-directory: stars`，提交步骤是 `git add stars/data`。
- **必须先开写权限**：仓库是 2026 年新建的，`GITHUB_TOKEN` 默认只读，快照提交会失败。去
  Settings → Actions → General → Workflow permissions 选 “Read and write permissions”。
  workflow 里加了一步预检，权限不对会直接报出这句话，不用去猜 `remote: Permission denied`。
  改完 **点一次 Actions → stars-board → Run workflow** 即会重新触发（或推一次 `stars/collect.mjs`）。
- **周/月/年榜不用手动勾 backfill**：`collect.mjs` 在"有任何一期缺基准 + 从没回填过（快照无 `partial` 标记）"
  时会自己补一次回填，跑过就永不重复；回填只覆盖 star 最高的前 80 个仓库，所以增量榜第一天是「部分回填」，
  之后靠每日快照变全。那个 `backfill` 输入框是给"想强制重跑一次回填"用的。
- **`push` 触发只认 `stars/collect.mjs` 和 workflow 文件**（`paths` 白名单 + `github.actor != 'github-actions[bot]'` 双保险），
  数据提交不会自我触发；改前端不会顺手触发一次全量采集。
- **改了 `app.js` / `styles.css` 记得提 `stars/index.html` 里的 `?v=` 版本号**（和第一站同一个 CDN 缓存坑）。
- **改完在仓库里跑验收**（40 项断言，含分页/名次跨页连续/无横向溢出/无 JS 错误/筛选互斥）：
  ```bash
  node stars/test/e2e.mjs                                  # 本地：自带 http 服务
  node stars/test/e2e.mjs --url https://xrzka.github.io/stars/   # 线上冒烟
  node stars/collect.mjs --offline                         # 不联网重算榜单（改分类规则后用）
  ```
- **头像**：`avatars.githubusercontent.com` 在国内/本机可能被拦，卡片已经做了 `onerror` 移除
  （不会留破图标）；e2e 里把这列 CORS 报错算噪声，不算页面 bug。

## qiu/（求资源热榜）

挂在同一个 Pages 域名下的**独立子页面**，目标是一屏看清 B站 / 抖音 / 快手 / 小红书
四个平台上"大家在搜什么"，从而判断哪些资源有需求。页面本身只有
`index.html` / `styles.css` / `app.js` 三个文件，数据全部来自第二站那个
Cloudflare Worker 的 `GET /api/hot`（代码在 `../mo_site/worker/hot.js`）。

- 页面：`https://xrzka.github.io/qiu/`
- 接口：`https://mo-stats.pages.dev/api/hot`（备份 `https://mo-stats.werneruszcb71.workers.dev/api/hot`）
  - `?src=bili|douyin|ks|xhs` 只取一个平台，`?refresh=1` 强制重拉（60s 内仍给缓存），
    `?debug=1` 附上每条上游的尝试结果
  - 响应里 `data.<平台>.provider` 会写明这次用的是哪一路上游，页面卡片上显示为「来源」
- 缓存：Worker 侧 D1 表 `hot_rank` 存快照，TTL 10 分钟；上游全挂时回退到旧快照并标 `stale`
- 前端只读 Worker 的接口，**不直连 uapis / 60s / rebang**（额度、CORS、国内可达性都是理由）

### 数据源为什么要做成链

四个平台都没有「无签名 + 允许跨域 + 国内可达」的统一接口，而且同一个上游从
Cloudflare 出口打和从本机打结果可能完全不同。实测结论（2026-10）：

| 平台 | 链上的顺序 | 实际常用的一路 |
| --- | --- | --- |
| B站 | `bilibili.hotword` → `api.bilibili.com/search/square` → uapis → rebang.today | `bilibili.hotword`（热搜词，带 heat_score） |
| 抖音 | `iesdouyin.billboard` → 60s `/v2/douyin` → uapis → rebang.today | `iesdouyin.billboard` |
| 快手 | 首页 `window.__APOLLO_STATE__` 里的 `visionHotRank` → uapis | 快手首页（偶尔超时，重试即好） |
| 小红书 | 60s `/v2/rednote` → uapis → rebang.today | 60s 与 uapis 轮流（会 403/502） |

- 小红书官方热搜接口要 `x-s` 签名，Worker 里算不出来，所以没走官方。
- uapis.cn 从本机出口正常、从 Cloudflare 出口会 502，所以它虽然在链上但不是主力；
  别因为它在本机好用就以为线上也走它 —— 用 `?debug=1` 看真实结果。
- 链尾的 `rebang.today` 只能顶 B站 / 抖音 / 小红书（没有快手 tab），
  而且给的是「热门内容」+ 可能被截断的标题，兜底时会体现在卡片「来源」上。
- 上游挂掉**不会**让接口返错：要么给缓存的旧快照（`stale: true`），要么给别的上游，
  实在什么都没有才 `ok: false`，页面显示"这个平台暂时取不到数据"。

### 在这里改它时的注意点

- **热门词判断在 `qiu/app.js` 的 `WANT_WORDS`**：命中即打「疑似求资源」标记，
  也能用复选框只筛这些条目。这是粗筛，不是平台官方标签。
- **改了 `app.js` / `styles.css` 记得提 `qiu/index.html` 里的 `?v=` 版本号**（Pages CDN 缓存坑）。
- 改了 Worker 侧（`hot.js` / `index.js` / `schema.sql`）要**两边都部署**：
  `cd ../mo_site/worker && npx wrangler deploy` 和 `cd pages && npx wrangler pages deploy`，
  只部署 Worker 的话 `mo-stats.pages.dev` 那条还是旧代码（踩过）。
- 新表要单独建：`npx wrangler d1 execute mo-stats --remote --file=schema_hot.sql`（可重复执行）。
- 验收：`node ../mo_site/worker/test_hot.mjs`（Worker 侧 16 项）+ 本仓库的 Playwright 脚本
  ```bash
  # 本地（用真实响应样本顶掉 /api/hot，因为本地 Origin 不在 Worker 的 CORS 白名单里）
  python -m http.server 8899
  python D:/gz/_tools/verify_qiu.py http://127.0.0.1:8899/qiu/ --sample sample.json
  # 线上
  python D:/gz/_tools/verify_qiu.py https://xrzka.github.io/qiu/
  ```
- `qiu/app.js` 和第一站共用同一个主题 localStorage key（`board-theme`），两边切换会互相记住。


