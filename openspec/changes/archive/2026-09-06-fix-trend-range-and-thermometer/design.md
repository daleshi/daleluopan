## Context

### 问题 1：趋势图时间范围不可切换

前端 `getTrendDataCoverage`（`public/index.html:6475-6488`）依据 `historySeries` 条数决定按钮可用性：

- `3y` 需 ≥ 500 条、`5y` 需 ≥ 1000 条、`10y` 需 ≥ 2000 条
- 不满足时按钮渲染为 `disabled title="数据不足，当前仅覆盖约 N 年"`，点击无响应

后端链路：`fetchAllIndexData`（`dataFetcher.js:1724`）调用 `fetchIndexHistory(cfg)` **未传 range** → `sliceByRange` 走 `sizeMap[range] || sizeMap['1y']` 取 **252 条** → `historySeries = klines.slice(-2520)` 实际只有 252 条。

实测：`/api/indices?detail=1` 返回的 `historySeries` 为 `list[252]`，而源数据本身充足（腾讯 2000 条、Yahoo 2514 条）—— 数据是被默认 range 截断的，不是源里没有。

附带影响：同一批 `klines` 也用于 `high10y` / `low10y` 计算（`dataFetcher.js:1808-1809`），因此"近10年"高低实际是 1 年口径。

### 问题 2：温度计无数据

链路：`GET /api/thermometer/detail` → `fetchYZYXIndexDetail` → `fetchYZYXThermometer` → `tryFetch('/data')` → `parseYZYXPage`。

`parseYZYXPage` 用 `data-event-params="idx_code:..."` 属性匹配指数行（第 2201 行）。实测当前页面：

- `data-event-params` 出现 **0 次**、`idx_code` 出现 **0 次**
- 指数行现为 `<tr class="tw-cursor-pointer tw-border-b ...">`，指数代码体现在 `/data/indices/{code}` 详情链接中（如 `/data/indices/000932.SH`）
- 页面本身正常（HTTP 200、约 51KB、含温度数值如 51°/30°/70°，title 为"知行温度计"）

`indices` 为空时 `tryFetch` 直接 `return null`，**既不打印成功日志也不打印失败告警**，导致该失效长期不可见。

## Goals / Non-Goals

**Goals:**

- 让趋势图"近3年 / 近5年 / 近10年"在源数据充足时可切换。
- 让 `high10y` / `low10y` 回归真实 10 年口径。
- 恢复有知有行温度计数据（指数列表与温度详情）。
- 让温度计解析失败在日志中可见。

**Non-Goals:**

- 不调整前端 `getTrendDataCoverage` 的阈值判定（数据补足后按钮自然可用）。
- 不修改 `sliceByRange` 的默认 range（避免影响 `dataFetcher.js:2718` 的美股异步刷新等其他调用方）。
- 不处理东方财富接口 `socket hang up`（独立的上游/网络问题，另立 change）。
- 不为温度计引入新的备用数据源。

## Decisions

### 决策 1：在 `fetchAllIndexData` 调用处显式传 `range: '10y'`

将 `dataFetcher.js:1724` 的 `fetchIndexHistory(cfg)` 改为 `fetchIndexHistory(cfg, { range: '10y' })`。

- **为什么改调用方而非 `sliceByRange` 默认值**：`sliceByRange` 被多处复用（含 2718 行的美股异步刷新），改默认值会让所有 K 线请求返回 10 倍数据量。只改生成 `historySeries` 的这一处调用，影响面最小。
- **备选方案（否决）**：前端点击 range 时按需请求新后端 API —— 需新增接口 + 前端改造，成本高；而 `?detail=1` 本就是"按需取全量"的既有设计路径（server.js 注释：`?detail=1 返回完整数据（含10年K线historySeries）`）。

### 决策 2：保留 `/api/indices` 的精简模式

默认请求仍剔除 `historySeries`（响应体 ~4.6MB → ~200KB），趋势图按需走 `?detail=1`。实施时需确认前端趋势图确实使用该参数，若否则需一并调整前端取数方式。

### 决策 3：有知有行指数行改用详情链接解析

放弃已移除的 `data-event-params` 属性，改为匹配含 `href="/data/indices/{code}"` 的 `<tr>` 行，从中提取指数代码、名称与温度数值。

- **为什么用详情链接**：实测该链接在当前页面稳定存在，且天然携带规范化的指数代码（如 `000932.SH`、`H11136.CSI`），比依赖易变的埋点属性稳健。
- **备选方案（否决）**：改用 JSON 接口 —— 未发现有知有行提供公开 JSON API，页面为服务端渲染 HTML。

### 决策 4：解析为空时输出告警日志

在 `tryFetch` 判定 `indices` 为空并返回 null 前，输出包含 HTML 长度与关键特征命中情况（是否含 `/data/indices/`、是否含温度数值）的告警。

- **为什么必要**：本次问题正是因为静默失效而长期未被发现，日志中"知有行"出现 0 次。

### 决策 5：修复前端懒加载死锁（实现期新增）

浏览器实测发现：即便后端 `historySeries` 已有 2000 条，页面按钮**仍全部禁用**，且网络请求中**从未出现** `/api/indices?detail=1`。排查确认前端存在死锁：

1. range 按钮的 `disabled` 在卡片 HTML（`buildFeaturedIndexHTML`）渲染时即确定，依据是 `d.historySeries`——而该字段只有 `?detail=1` 返回，精简模式恒为 `undefined`。
2. 懒加载 `ensureFullIndexData()` 仅在 `renderFeaturedTrendView` 的 `series.length < 2` 分支触发，而该函数只在**详情展开**（`featuredDetailOpen`，默认 `false`）或 range 切换时执行。
3. range 切换本身又依赖按钮可点击 → 按钮禁用 → 无法切换 → 懒加载永不触发。
4. 即使手动展开详情触发了懒加载，其回调也**只重绘图表**（`renderFeaturedTrendView`），不重绘按钮所在的卡片 HTML，按钮仍是 `disabled`。

修复（`public/index.html`）：

- `renderIndexCards()` 末尾主动触发 `ensureFullIndexData()`，新增 `_fullIndexDataRequested` 防重标记（`renderAll` 会被轮询反复调用，避免重复请求 4.6MB 响应体）。
- 加载成功后重绘 `renderIndexCards()`（刷新上证指数卡片按钮）与 `renderIndexQuotesGrid()`（刷新核心指数卡片按钮）。递归安全：重绘时 `_fullIndexDataLoaded` 已为 `true`，不会再次触发。
- 加载失败则不重绘，等待下次 `renderAll` 自然重试。

- **备选方案（否决）**：改为点击 range 时按需请求 `/api/indices/:code/klines?range=`（详情弹窗已用此接口）—— 需重构 featured/核心卡片两条渲染链路，改动远大于补一个主动懒加载。

### 决策 6：懒加载必须回填 `indexQuotesData`（实现期新增）

修复 featured 卡片后，用户反馈"指数实时行情"面板内各指数的趋势图 range 按钮仍不可点击。排查确认：

- 该面板由 `renderIndexQuotesGrid({ indices: indexQuotesData })` 渲染，数据源是 `indexQuotesData`（来自 `/api/indices/quotes`）。
- 实测 `/api/indices/quotes` 的响应字段**不含 `historySeries`**（只有 `sparkData`、动量等）。
- `ensureFullIndexData()` 原先只回填 `indexData` / `dashboardData`，**遗漏 `indexQuotesData`** → 该面板各指数的 `historySeries` 恒为空 → 按钮全禁用。

修复：`ensureFullIndexData()` 中一并回填 `indexQuotesData`。两个数据源的 `code` 格式一致（均为 `000300.SH` 带后缀），可直接用 `fullMap` 匹配，无需额外转换。

实测修复后 9 个指数的按钮可用性（`O`=可点击 / `D`=禁用，顺序 1y/3y/5y/10y）：

| 指数 | 按钮 | 数据量 |
|---|---|---|
| 沪深300 / 中证500 / 中证红利 / 中证消费 / 标普500 | `OOOO` | 2000 |
| 科创50 | `OOOD` | 1620 |
| 恒生科技 | `OOOD` | 1504 |
| 纳斯达克100 | `ODDD` | 0 |
| 中证红利低波 | `DDDD` | 0 |

科创50 / 恒生科技的 10y 因数据不足 2000 条而禁用，符合前端阈值设计（`10y` 需 ≥2000），非缺陷。

剩余 2 个为**数据源限制**，非前端问题，不在本 change 修复范围：

- **纳斯达克100**：腾讯 `usNDX` 仅返回 1 条（已按决策被判定无效），Yahoo `^NDX` 持续返回 HTTP 429（实测多次均为 429，双域名重试亦失败）。
- **中证红利低波（H30269）**：属"特殊 CSI 指数"（`isSpecialCSIIndex` → `allowTencentFallback = false`），东财 `socket hang up` 后无兜底；实测腾讯无该指数数据（`shH30269` / `szH30269` / `H30269` 均无返回）。

## Risks / Trade-offs 补充（实现期新增）

- [风险] `?detail=1` 响应体约 4.6MB，懒加载在页面加载后触发会增加流量 → 缓解：`_fullIndexDataRequested` 保证整个会话只请求一次；精简模式首屏不受影响。
- [风险] 懒加载失败时按钮保持禁用 → 缓解：失败后下次 `renderAll` 自动重试；失败时 `ensureFullIndexData` 内部有 warn 日志可排查。

## Risks / Trade-offs

- [风险] `historySeries` 增至最多 2520 条，`?detail=1` 响应体增大 → 缓解：精简模式默认不含 `historySeries`；实施阶段实测响应时间与前端渲染性能。
- [风险] 源数据不足时（如腾讯仅 2000 条）10y 仍不可用 → 缓解：2000 条恰好满足 `≥ 2000` 阈值，Yahoo 源 2514 条更充足。
- [风险] 有知有行再次改版导致解析失效 → 缓解：新增告警日志使失效可立即被发现；正则以"详情链接 + 温度数值"双重条件过滤，降低误匹配。
- [风险] 新正则可能匹配到非指数行 → 缓解：以 `/data/indices/` 链接为必要条件，并要求行内可提取 `(\d+)°` 温度值。

## Migration Plan

1. 代码合并后 `npm run package:deploy` 打包 → `deploy.sh` 部署 → `pm2 restart`。
2. 回滚：`git revert` 对应提交并重新部署；无数据结构变更，不涉及数据迁移。

## Open Questions

- 前端趋势图当前是否通过 `?detail=1` 获取 `historySeries`？实施时需先确认；若否，需同步调整前端取数，可能扩大本 change 范围。
