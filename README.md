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
| `qiu/` | **另一个独立页面**：`https://xrzka.github.io/qiu/` 求资源需求看板（本站真实搜索/缺口/帮找/点击 + 四平台热榜线索），见下 |
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

## qiu/（求资源需求看板）

挂在同一个 Pages 域名下的**独立子页面**，只干一件事：回答「大家到底想要什么资源」。
页面只有 `index.html` / `styles.css` / `app.js` 三个文件，数据来自第二站那个
Cloudflare Worker 的两个接口：`GET /api/demand`（本站真实需求）和 `GET /api/hot`
（四平台热榜线索）。

- 页面：`https://xrzka.github.io/qiu/`
- 接口：`https://mo-stats.pages.dev/api/demand`、`/api/hot`
  （备份 `https://mo-stats.werneruszcb71.workers.dev/...`）

### 为什么不是「热搜聚合」

最初这一页是纯热搜聚合，做完发现**没用**：四个平台的热搜榜里时政新闻占大多数，
跟「要什么资源」基本无关；而且**四个平台都不公开「用户在搜什么」**（只有小红书那种
要 `x-s` 签名的内部接口，Worker 里算不出来）。试过的路都不通：网盘搜索引擎
（pansearch / qkpanso / 混合盘 …）全是 SPA 壳没有 SSR 热词，聚合站（vvhan / imsyy /
efefee / rebang API）NXDOMAIN 或 502，B站 `api.bilibili.com` 从 Cloudflare 出口 412。

所以真需求只能从**自己站的行为**里长出来，这也就是上面 `#demand` 那一块：

| 卡片 | 数据来源 | 为什么值钱 |
| --- | --- | --- |
| 站内搜索热词 | D1 `search_events` 明细，由墨站搜索框埋点写 | 唯一能拿到「真实的人在搜什么字」 |
| 搜了没结果（缺口） | 同一张表里 `results = 0` 的行 | **等于「有人要，站里没有」**，补货回报最确定 |
| 求资源帮找 | D1 `requests` 里 `kind='want'`，按票数 | 用户明确提出的需求 |
| 点击最多的资源 | D1 `clicks` 月 / 年榜 + `items.json` 换名 | 已经能拿到的东西里什么最抢手 |

热搜没有删掉，但降级成第二块「四平台热榜线索」，并且**默认只显示带资源属性的词**
（`WANT_WORDS` 粗筛，开关可关）；命中资源向的条目才在默认视图里出现。

### 搜索榜的算法（照 aicu.cc 的「用户名热搜」做的）

2026-10 把 [aicu.cc](https://www.aicu.cc/)（哔哩哔哩查成分）的前端 bundle 拆了，
逆出它的热搜实现：`GET online.aicu.cc/api/community/trending?limit=N` 取榜、
`POST .../search-events {uid, visitor_id}` 上报搜索，站点自己也在弹窗里写着完整口径。
它的设计比「按历史累计次数排」合理得多，这几条直接抄了：

| aicu 的做法 | 本页的对应 |
| --- | --- |
| 最近 2 小时量级 + 相对前 6 小时的动量，量级为主、动量只做加成 | 近 **7** 天量级 + 相对前 7 天的动量（站点日活个位数，2 小时窗口永远空） |
| 同一浏览器 / 同一网络对同一个 UID 10 分钟内最多算一次 | 一位访客对一个词只占一行，**同一个人搜 20 次也只是一个人** |
| 至少 5 位不同访客搜过才上榜 | 门槛降到 **1**（日活个位数，5 位会永远空榜），但把「几位访客」摊在页面上 |
| trend 用同一套算法再算一份 2 小时前的榜，比名次 | 再算一份「前 7 天」的榜比名次：前移 ↑、后移 ↓、持平 ·、没上榜过算新进 |
| 「热搜榜算法说明」弹窗逐条写明口径 | 页面「数据口径」里同样写清公式，别让数字看起来像编的 |

热度值 = `近 7 天访客数 × 2 + max(0, 近 7 天访客数 − 前 7 天访客数)`，纯确定性计算没有随机数。
有一处**故意不一样**：aicu 只统计「查询成功」的 UID（失败的查询多半是输错），
本页反过来 —— 「搜了但站里 0 条」恰恰是最值钱的信号，所以失败的搜索单独排一个缺口榜。

### 站内搜索埋点（第一手数据）

- 墨站 `app.js` 的 `logSearchTerm()`：输入停止 1.5s 后 `POST /api/search/log`
  `{term, results, visitor_id}`；同会话同词只发一次，失败静默。
  `visitor_id` 是浏览器本地随机生成的串（`localStorage["mo-visitor-id"]`），
  **不含任何个人信息**，只用来让 Worker 把「同一个人搜了 20 次」算成一个人。
- Worker `demand.js` 的 `handleSearchLog`：清洗词（长度 2–40、去控制字符 / 零宽字符、拒 URL），
  然后一条 UPSERT 写 `search_events`，主键 `(term, fp)` —— 老访客搜同一个词只更新时间和结果、
  不加次数，1 小时内重复上报直接不动。**一个词有几行就等于几位访客想要它。**
- 隐私：`fp` 是 sha256 摘要，**不存 IP、不存访客 id 原值**；前端没带 `visitor_id` 时兜底摘要
  `IP+UA+当天日期`（跨天无法关联）。明细只留 90 天，Worker 的 cron 每天清一次。
- 表：`npx wrangler d1 execute mo-stats --remote --file=../mo_site/worker/schema_demand.sql`（可重复执行）
- 点击榜**不列成人向条目**（`items.json` 里的 `adult: true`），跟墨站默认藏起来的规矩一致。

### 数据源为什么要做成链（`/api/hot` 部分）

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
- 缓存：Worker 侧 D1 表 `hot_rank` 存快照，TTL 10 分钟；`?refresh=1` 强制重拉（60s 内仍给缓存）。

### 在这里改它时的注意点

- **资源向判断在 `qiu/app.js` 的 `WANT_WORDS`**：命中即打「资源向」标记，也是默认筛选的依据。
  这是粗筛，不是平台官方标签。
- **改了 `app.js` / `styles.css` 记得提 `qiu/index.html` 里的 `?v=` 版本号**（Pages CDN 缓存坑）。
- 改了 Worker 侧（`hot.js` / `demand.js` / `index.js` / `schema*.sql`）要**两边都部署**：
  `cd ../mo_site/worker && npx wrangler deploy` 和 `cd pages && npx wrangler pages deploy`，
  只部署 Worker 的话 `mo-stats.pages.dev` 那条还是旧代码（踩过）。
- 需求区每一块都单独 `try/catch`：表不存在 / 某块查不到只让那一块空着，不会整页 500。
- 验收：Worker 侧两个测试 `node ../mo_site/worker/test_demand.mjs`（42 项）、
  `node ../mo_site/worker/test_hot.mjs`；页面用 Playwright 脚本
  ```bash
  # 本地（用真实响应样本顶掉两个接口，因为本地 Origin 不在 Worker 的 CORS 白名单里）
  # 样本由 node D:/gz/_tools/make_demand_sample.mjs 生成（跑真 demand.js，形状不会和实现脱节）
  python -m http.server 8899
  python D:/gz/_tools/verify_qiu.py http://127.0.0.1:8899/qiu/ \
      --sample D:/gz/_tools/qiu_sample.json --demand D:/gz/_tools/qiu_demand_sample.json
  # 线上（真打接口，搜索埋点可能为空，脚本会接受空状态）
  python D:/gz/_tools/verify_qiu.py https://xrzka.github.io/qiu/
  # 搜索埋点端到端（真浏览器打字 → 接口 200 → 榜里出现；跑完自动清测试词）
  python D:/gz/_tools/verify_search_log.py
  ```
- `qiu/app.js` 和第一站共用同一个主题 localStorage key（`board-theme`），两边切换会互相记住。
- 搜索埋点**要等墨站的 `app.js` 上线后才开始攒数据**；在那之前「站内搜索热词」和
  「缺口」两张卡是空的（有说明文案），帮找榜和点击榜本来就有数据。


