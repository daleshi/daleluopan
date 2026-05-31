## Why

「基金总览」下「指数实时行情」面板在管理员使用过程中暴露 3 个相互独立的问题，影响日常运维体验：

**问题 1 · 删除指数后页面仍可见**
- `removeIndexFromPanel` 调用 `loadIndexQuotes(true)`，但 `loadIndexQuotes` 内部的 `fetch('/api/indices/quotes')` **从未传 `?refresh=1`** —— forceRefresh 参数被吞掉
- 后端 `index-quotes` 缓存 TTL 在交易时段 30s / 休市 30min，删除后用户仍看到缓存中包含已删除指数的旧响应，**直到 TTL 自然过期**
- 体验：管理员点击 × 后期待立即生效，实际要等几十秒~几十分钟

**问题 2 · 美股 / 港股延迟严重**
- `isTradingHours()` 实现仅判断 A 股 9:15-15:05；**美股开盘时段（北京时间夜间 21:30-04:00）被错误归为"休市"**
- 休市态下 index-quotes 缓存 TTL = 30 分钟 → 标普 500 / 纳指 100 数据陈旧 30 分钟才更新一次
- 港股盘中（北京时间 9:30-12:00 / 13:00-16:00）部分时间段虽然与 A 股重叠，但中午 12:00-13:00 与 A 股 11:30-13:00 不完全一致，存在小窗口

**问题 3 · 指数顺序无法调整**
- 项目对**基金 / ETF / 股票卡片均已实现拖拽排序**（`drag-handle` + `card-dragging` + `card-drag-over` CSS 类 + `initCardDnD` / `initFundDnD` 完整 JS）
- **后端 `POST /api/indices/reorder` API 也已存在**（`server.js:999`），但前端从未调用
- 用户希望灵活调整顺序，凸显常看的指数

## What Changes

### A. 删除指数 — 立即从前端 UI 移除（乐观更新 + 后端兜底刷新）

- 前端 `removeIndexFromPanel`：API 成功后**先在内存中过滤掉该 code**（`indexQuotesData = indexQuotesData.filter(...)`），立即重渲染网格；再触发 `loadIndexQuotes(true)` 强制刷新（不等结果）
- 修复 `loadIndexQuotes` 的 forceRefresh 参数传递：`fetch('/api/indices/quotes' + (forceRefresh ? '?refresh=1' : ''))`
- 后端 `POST /api/indices/remove` 改造：删除成功后**主动失效 `_smartCache['index-quotes']` 内存缓存**（`delete _smartCache['index-quotes']`），下次请求触发新鲜计算

### B. 全市场交易时段感知（精准缓存 TTL）

- 改造 `services/stockFetcher.js` 的 `isTradingHours()`：**新增可选参数 `markets = ['CN', 'HK', 'US']`** 表示需检查的市场集合
  - A 股：周一~周五 09:15-15:05（保留现有）
  - 港股：周一~周五 09:30-12:00 + 13:00-16:10
  - 美股：考虑夏令时切换，统一用"北京时间 21:30-次日 05:00"作为粗粒度判定（涵盖夏令时 21:30-04:00 与冬令时 22:30-05:00 + 缓冲）
- `getCacheTTL('index-quotes')`：根据 watchlist 中实际包含的市场动态判定
  - 若任一被关注市场处于开盘 → 用交易时段 TTL（30 秒）
  - 全部休市 → 用休市 TTL（30 分钟）
- 不破坏其他 cache key（stocks/etfs 仅看 A 股、active-funds 也仅看 A 股，行为保留）

### C. 指数卡片拖拽排序（接通现有基础设施）

- 复用现有 `.drag-handle` + `.card-dragging` + `.card-drag-over` CSS（不新增样式）
- 复用现有 `initCardDnD(grid, type)` 思路，新增 `'index'` 分支：endpoint = `/api/indices/reorder`、codeAttr = `code`
- 在 `buildIndexQuoteCard` 内：管理员登录态下增加 `draggable="true"` + 注入 `<div class="drag-handle">⠿</div>`
- 在 `loadIndexQuotes` 首次渲染后调用一次 `initCardDnD(grid, 'index')`（用 `_indexDnDInitialized` 标志位避免重复绑定）
- **关键**：拖拽完成后**只更新本地 `indexQuotesData` 顺序 + 重渲染**，不触发 `/api/indices/quotes` 刷新（避免抖动）
- 切换市场分类 Tab 时，拖拽顺序基于 watchlist 全局顺序保持稳定

## Capabilities

### Modified Capabilities

- `index-quotes-panel`: 修复管理员体验 3 个问题（删除立即生效、全市场交易时段感知、拖拽排序）

## Impact

- **后端 server.js**：约 +5 行（`/api/indices/remove` 增加缓存失效）
- **后端 services/stockFetcher.js**：约 +25 行（`isTradingHours` 扩展支持 markets 参数）
- **后端 server.js getCacheTTL**：约 +6 行（基于 watchlist 市场动态判定 index-quotes TTL）
- **前端 public/index.html**：约 +50 行
  - `loadIndexQuotes` 修复 forceRefresh
  - `removeIndexFromPanel` 乐观更新
  - `buildIndexQuoteCard` 美股增强卡片增加拖拽属性
  - 新增 `initIndexDnD(grid)` 函数 + 在 `loadIndexQuotes` 首次渲染调用
- **数据结构**：无新增字段
- **数据源**：无新增
- **依赖**：无
- **测试**：手工验证（删除立即消失、美股盘中 30s 内更新、拖拽落位 + 持久化、刷新后顺序保留）
