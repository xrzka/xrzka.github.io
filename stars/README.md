# GitHub 应用 Stars 榜（日 / 周 / 月 / 年）

> **线上地址**：<https://xrzka.github.io/stars/>（代码就在本目录 `xrzka.github.io/stars/`，
> 定时任务在仓库根的 `.github/workflows/stars-board.yml`）
> 本文档里的命令默认 **cwd = 本目录**，在站点仓库里就是 `cd stars` 之后再跑。

给 **手机 App** 和 **电脑软件** 做一个 GitHub Stars 排行榜的完整可跑方案：
每天定时抓一次 star 数存快照，用「当前 star − N 天前 star」算出**真实的新增 star 数**，
按日 / 周 / 月 / 年出榜，静态页面直接挂 GitHub Pages。

> 为什么不能直接调一个 API 拿到「本周新增 star」：GitHub 只给你**当前**的 star 总数，
> 没有任何接口返回历史曲线。所以只有两条路 —— ①用现成服务，②自己存快照做差分。本仓库是 ②。

## 0. 先看现成的（能直接用就别自建）

| 方案 | 覆盖 | 说明 |
| --- | --- | --- |
| [OSSInsight](https://ossinsight.io/collections/) | 日 / 月 / 年 star 增长、按语言/领域 | 基于 GH Archive 的全量事件流，最准最全，免费；但**没法按「手机 App / 电脑软件」自定义归类**，也不好嵌进自己的站 |
| [star-history.com](https://star-history.com) | 单仓库历史曲线 | 看具体仓库的曲线很好用，不做排行榜 |
| GitHub Trending | 日 / 周 / 月 | 官方，但只有「趋势」排序，且按语言切分，没有新增 star 数字，不能筛平台 |
| `github.com/search?q=created:>DATE` | 新仓库 | 只能找到「新建」的仓库，老仓库涨星看不到 |

**要自建的理由**：你想按「手机 / 电脑应用」这个维度分类、想放到自己的站上、想加自己的种子仓库。
那就用本方案。

## 1. 原理

```
GitHub Search API  ──按 topic × star 区间分片枚举──▶  候选池（手机/电脑应用）
        │
        ├─ 分类打分（topic + 语言 + 简介关键词）→ mobile / desktop，app / lib
        │
        ▼
data/snapshots/2026-10-19.json   { "owner/name": 12345, ... }   ← 每天一份，永久积累
        │
        ▼  「今天 − 7 天前那份快照」
data/board.json                  清单：各榜条数 + 更新时间（~1KB，首屏只拉它）
data/boards/{day,week,month,year,new90,total}.json   各榜条目，切 tab 时才拉（懒加载）
        │
        ▼
index.html + app.js              静态页面（日/周/月/年 tab + 手机/电脑筛选 + 分页）
```

四个关键设计：

1. **分片枚举绕开 1000 条上限**。GitHub 搜索每个查询最多只给 1000 条结果，所以按
   `stars:500..999`、`1000..1999`、`2000..4999` … `>=100000` 切成区间，再乘上几十个 topic，
   每个查询单独分页，池子才能做到几千个仓库。
2. **快照差分才是「新增 star」**。日榜 = 今天 − 昨天那份快照；年榜 = 今天 − 一年前那份。
   快照文件按天存，90 天内的全留、每月 1 号那份永久留，仓库不会无限膨胀。
3. **`--backfill` 精确回填**。刚建站时没有历史，日/周/月/年榜全是空的。回填用
   `GET /repos/{o}/{r}/stargazers`（`Accept: application/vnd.github.star+json` 会带上 `starred_at`），
   在「按时间倒序的 star 页」上**二分**出某个日期时点的 star 数 —— 一个 10 万星的仓库只要 ~10 次请求，
   而不是翻 1000 页。回填出来的稀疏快照带 `partial: true` 标记，永不被清理。
4. **榜单数据按榜拆文件**。每榜最多 2000 条（对得上最大页 2000 条/页），切 tab 才拉对应那个文件并缓存，
   首屏不会为了看 20 行而拉几 MB。

## 2. 文件结构

```
gh-stars-board/
├─ collect.mjs                    采集器（Node 20+，零依赖，只用内置 fetch）
├─ index.html / app.js / styles.css   静态榜单页（原生 JS，深浅色主题 + 分页）
├─ test/e2e.mjs                   Playwright 前端验收（40 项断言，含分页）
├─ data/
│  ├─ board.json                  清单：更新时间 / 收录数 / 各榜条数 / 可用的每页条数（~1KB）
│  ├─ boards/<key>.json           每个榜单的条目（day/week/month/year/new90/total），前端按 tab 懒加载
│  ├─ repos.json                  所有仓库的元信息（简介/语言/topics/平台分类…）
│  ├─ seeds.txt                   手工补录的仓库（没打 topic 的知名 App）
│  └─ snapshots/2026-10-19.json   每日 star 快照（历史，前端不读）
└─ .github/workflows/stars-board.yml  每天定时跑 + 提交快照
```

> 榜单数据**不塞进 `board.json`**：每榜最多 2000 条（最大页 2000 条/页），一页只需要一个文件。
> 全部塞一起会让首屏拉一个几 MB 的 JSON，而用户第一眼只看 20 行。
> 顺带一提，`data/` 每天被重写，所以 `boards/*.json` 涨得快时就把 `data/` 挪到独立分支。

## 3. 本地跑

```bash
cd gh-stars-board

# 小样本自测（不需要 token，6 个查询，约 1 分钟）
node collect.mjs --smoke

# 起个 http 服务看页面（必须走 HTTP，file:// 读不到 JSON）
python -m http.server 8899
# 打开 http://127.0.0.1:8899
```

正式采集要带 token（不带的话 Search API 只有 10 次/分钟，池子跑不全）：

```bash
# PowerShell
$env:GITHUB_TOKEN="ghp_xxx"; node collect.mjs
# 顺手把日/周/月/年 baseline 精确回填（消耗核心 API 额度，跑一次就够）
node collect.mjs --backfill
```

## 4. 挂到 GitHub Pages（自动更新）

1. 把这个目录推到一个仓库，比如 `xrzka/gh-stars-board`（公开仓库，`GITHUB_TOKEN` 就能用）。
2. 仓库 **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**。
3. 仓库 **Settings → Actions → General → Workflow permissions → Read and write**（提交快照需要）。
   **只差这一步**：默认是只读，采集能跑完但提交那步会被拦（workflow 开头有个预检，5 秒内就报
   「缺少写权限」并给出这句话，不会白跑十几分钟）。改完不用勾任何东西 ——
   再点一次 **Actions → stars-board → Run workflow**，或者随便推一次 `stars/collect.mjs` 就会重新触发。
4. **日/周/月/年榜不用手动回填**：第一次成功运行时，采集器发现这几期还没有历史基准、
   也从未回填过（快照里没有 `partial` 标记），会自己补一次 `--backfill`；跑过一次就永不重复
   （不要去勾那个 `backfill` 输入框，那是给"想强制重跑一次回填"用的）。
   回填只覆盖总 star 最高的前 80 个仓库，所以**四个增量榜第一天上榜的是这 80 个（口径行会标「部分回填」）**，
   之后随着每日快照积累，粒度会自然变全。
5. 之后每天 UTC 02:17 自动跑一次，页面地址 `https://<user>.github.io/gh-stars-board/`。

另外 `push` 触发只认 `stars/collect.mjs` 和 workflow 文件本身 —— 数据提交（`stars/data/**`）故意不在
`paths` 列表里，否则 bot 提交数据 → 触发新一轮 → 又提交，自己转自己；job 上还有一道
`if: github.actor != 'github-actions[bot]'` 兜底。所以改前端不用怕每次推都触发一次全量采集。

想挂成已有站点的子目录（例如 `https://xrzka.github.io/stars/`）：把本目录内容拷进那个仓库的
`stars/` 文件夹，把 workflow 放到**仓库根**的 `.github/workflows/`，并给两处加 `working-directory`：

```yaml
      - name: 采集并计算榜单
        working-directory: stars
        run: node collect.mjs ${{ inputs.backfill && '--backfill' || '' }}
      - name: 提交数据快照
        run: |
          git add stars/data
          ...
```

页面全是相对路径，放根目录或子目录都能直接用。

## 5. 采集器参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--min-stars` | 500 | 候选池最低 star，调低会让池子变大、耗时变长 |
| `--gap` | 2300ms | 请求间隔。认证后 Search API 是 **30 次/分钟**，2300ms ≈ 26 次/分钟，别调太小 |
| `--max-pages` | 3 | 每个「topic × star 区间」查询翻几页（每页 100 条） |
| `--board-size` | 2000 | 每个榜单最多输出多少条（和前端最大页 2000 条/页对齐） |
| `--backfill` | 关 | 回填日/周/月/年 baseline，跑一次就够 |
| `--backfill-repos` | 80 | 只回填总 star 最高的前 N 个仓库（核心 API 额度 5000/小时） |
| `--backfill-budget` | 3000 | 回填请求硬上限，超了自动停 |
| `--offline` | 关 | 不碰 API：用 `repos.json` 的元信息 + 已有快照**重新分类并重算榜单**。改分类正则后用这个秒级验证，不用重跑采集 |
| `--smoke` | — | 小样本自测：2 个 topic、1 页、无 token 也能跑 |

环境变量：`GITHUB_TOKEN`（Actions 里用内置 `secrets.GITHUB_TOKEN` 即可）。

调分类规则的循环就是：

```bash
vim collect.mjs          # 改 MOBILE_TOPIC_RE / DESKTOP_WORD_RE / LIB_RE / META_RE / KNOWN_LIB
node collect.mjs --offline   # 1 秒出结果，看 board.json 里哪个仓库被分错了
```

## 6. 前端有什么

- **六个榜**：日榜 / 周榜 / 月榜 / 年榜 / 新星榜（近 90 天创建）/ 总榜。
  日/周/月/年显示 `+新增` 和总 star；新星榜和总榜显示总 star。
- **平台筛选**：全部 / 📱 手机 / 💻 电脑。
- **默认隐藏「库 / 框架 / 清单」**（名字或简介里带 library/framework/sdk/plugin/awesome/tutorial… 的，
  再加一份 `KNOWN_LIB` 点名表兜住 tauri、electron、react-native 这类认不出来的框架），
  勾上「包含库 / 框架 / 清单」才显示 —— 否则 `flutter/flutter` 这类框架会霸榜。
  分类结果落在 `repos.json` 的 `kind` 字段（`app` / `lib` / `meta`），随时可查、可回改。
- 搜索（仓库名 / 简介 / 语言 / topic）、深浅色主题、归档仓库打「已归档」标。
- **分页**：每页可选 **10 / 20 / 50 / 100 / 500 / 1000 / 2000 条**（选择存 `localStorage`），
  带首页 / 上一页 / 跳页 / 下一页 / 末页，状态行写「第 x / y 页 · 显示 a–b · 共 N 条」。
  **卡片上的 `#N` 是全局名次，不是本页序号** —— 翻到第 3 页（10 条/页）第一张就是 `#21`；
  金银铜配色也跟着全局名次走，不会让每一页的第一张都变金色。列表下方还有一条同样的翻页条，
  只有真正分页时才出现。
- 顶部口径行会写明**当前榜的真实窗口**，例如「近 3 天新增 star（基准快照 2026-10-16）」——
  基准快照不总是精确 N 天前，写出来才不会误导。

## 7. 自动化测试

```bash
node test/e2e.mjs                  # 真实 Playwright（系统 Chrome）跑 40 项前端验收
node test/e2e.mjs --root <dir>     # 指定目录，配合造假快照做「六个榜都有数据」的确定性验收
node test/e2e.mjs --url https://xrzka.github.io/stars/    # 线上冒烟
```

覆盖：tab 与可用榜单一致、默认过滤库/框架/清单、**平台筛选互斥且完备（手机+电脑=全部，按「共 N 条」比而不是卡片数）**、
搜索命中 / 无结果提示 / 搜索后回到第 1 页、口径行窗口天数、
**分页（选项齐全、每页条数、总页数、名次跨页连续、跳页、末页条数、首末页按钮禁用态、2000 条/页一页装完）**、
主题切换、外链 `rel=noopener`、无 JS 报错、桌面与 390px 手机宽度无横向溢出。退出码 0 才算过。

> 改分页逻辑时特别注意：断言要看「共 N 条」这类分页状态，不能拿 `document.querySelectorAll('.card').length` 当总数 ——
> 有每页上限之后这两者不再相等（第一版就是这么写错的）。

想在不联网的情况下验证「日/周/月/年」四个榜，造几份历史快照再离线重算即可：

```bash
# data/snapshots/2026-10-21.json 里随便填一组比今天小的 star 数
node collect.mjs --offline
node test/e2e.mjs
```

## 8. 局限（先说清楚）

- **快照要攒**。没有 `--backfill` 的话，日榜第二天才有，周榜第八天才有，年榜一年后才有。
- **分类靠启发式**。topic / 语言 / 简介关键词打分，个别仓库会分错（比如用 Kotlin 写的后端工具）。
  嫌吵就在 `seeds.txt` 点名补录，或改 `collect.mjs` 里的 `MOBILE_TOPIC_RE` / `MOBILE_WORD_RE`。
- **搜索接口只覆盖打了 topic 的仓库**。所以必须有 `seeds.txt` 兜底，这也是所有同类榜单的通病。
- **star 有水分**。刷星、送星、媒体事件都会让单日增量异常，本方案不做反作弊；要干净就把
  `--min-stars` 调高、或对单日增量设阈值过滤。
- **仓库体积会慢慢长**。每天提交 `snapshots/` 和 `repos.json`（后者 ~700KB，日更）。Git 的 delta 压缩会吃掉绝大部分，
  但真要长太快就把 `data/` 挪到独立的 `data` 分支（workflow 里 checkout/commit 那个分支即可）。
- **每天只跑一次**。定时任务延迟、失败都会让某天缺快照；不过差分是「找最近的那份快照」，
  偶尔缺一天不会让榜单空掉，只会在口径行里显示真实窗口天数。
