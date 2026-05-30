## Why

当前美股指数（标普 500、纳斯达克 100）的卡片信息密度严重不足 —— 仅显示`今开/昨收`两个字段，`52 周高/低`、`近 1 月/3 月涨幅`等关键字段在前端虽已写好渲染逻辑、但实际数据**全为 null**。原因是 `fetchIndexQuotesForWatchlist()` 走快路径（仅调用 `fetchRealtimeQuotes`）没有合并 `data/cache/indices.json` 中已存在的 K 线统计数据。

实际上 `fetchAllIndexData()` 已为美股缓存了完整 10 年 K 线（`historySeries.length === 2520`）和 `high52w/low52w/sparkData[30]` 等字段 —— **数据零成本可用**。本次改动把"已有数据"补齐到看板卡片，并新增动量、回撤、走势缩略图等高价值指标，让用户在卡片层面即可判断市场温度。

参照 A 股有 PE/PB/ROE/温度（强项）、港股有 PE/PB（强项），本次让美股突出**价格水位 + 动量 + 趋势**，发挥指数本身的强项数据。

## What Changes

**后端（services/dataFetcher.js · `fetchIndexQuotesForWatchlist`）**：
- 在合并 quotes/估值之后，**额外读取 `data/cache/indices.json` 的对应记录**，将 K 线衍生统计字段同步到响应（仅美股启用，避免 A 股/港股冗余）：
  - `high52w` / `low52w`（来自 indices.json）
  - `changeMonth` / `change3Month` / `change6Month` / `changeYear`（基于 historySeries 末尾收盘价计算）
  - `drawdownFromHigh52w`（距 52 周高回撤百分比，正数）
  - `sparkData`（最近 30 天 close 数组，直接复用）
- 字段缺失时优雅降级（不阻塞 quotes 主流程，只是对应字段为 null）

**前端（public/index.html · `buildIndexQuoteCard` 美股分支）**：
- 重构美股卡片详情区域为 4 个紧凑信息块：
  - **52 周区间条**：单行展示`低 — ●(当前) — 高 (距高 -X.XX%)`，替代原"52周高/52周低"两行
  - **52 周价格水位条**：保留现有进度条，文案微调（"价格水位"→"52w 价格水位 · 偏高/偏低/中性"）
  - **3 列动量徽章**：`近1月 / 近3月 / 近1年`涨跌幅，对齐排版，正数绿/负数红
  - **30 天 Sparkline**：纯 SVG 绘制的微缩走势图（高度 28px），主色按"近1月涨跌"渲染
- A 股 / 港股卡片**完全不受影响**

**视觉与样式**：
- 新增 CSS：`.idx-range-bar`（区间条）、`.idx-momentum-row`（3 列动量）、`.idx-sparkline`（缩略图容器）
- 移动端响应式：< 480px 时 sparkline 高度缩减到 22px，3 列动量保持单行不换行

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `index-quotes-panel`: 扩展美股指数卡片的展示要求（新增 52 周区间条、动量 3 列、回撤、Sparkline）+ 后端 `fetchIndexQuotesForWatchlist` 字段产出约束。

  **注**：该 capability 主 spec 当前不存在（首次创建发生在并行的 `index-quotes-market-tabs` change 归档时）。本次 delta 仍使用 `ADDED Requirements` 写法 —— 两个 change 的需求集合无冲突，归档时按时间顺序合并即可。

## Impact

- **后端**: `services/dataFetcher.js` 的 `fetchIndexQuotesForWatchlist`，约 +60 行（读 indices.json + 计算 4 个动量字段 + 转引用 sparkData）
- **前端**: `public/index.html` 美股分支 + 新 CSS，约 +120 行
- **数据结构**: `/api/indices/quotes` 响应中美股记录新增 `change6Month / changeYear / drawdownFromHigh52w / sparkData` 字段（向后兼容，A 股/港股保持 null）
- **数据源**: 零新增（完全复用 `indices.json` 与 `historySeries`）
- **缓存**: 无新缓存键
- **依赖**: 无
- **测试**: 项目无前端测试框架，依赖人工浏览器验证（卡片渲染、4 个新元素显示正确、移动端响应式）
- **与 `index-quotes-market-tabs` change 关系**: 两个 change 同时改 `public/index.html`，但作用区域不同（前者改 Tab 切换，本次改美股分支卡片渲染），git 层面无冲突可能
