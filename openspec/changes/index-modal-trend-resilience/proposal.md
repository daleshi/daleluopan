## Why

「基金总览」→ 指数实时行情 → 点击卡片打开详情模态框，「区间走势分析」模块**经常显示"历史趋势数据暂未获取到"**，用户多次反馈。深挖根因，发现 4 个相互独立的薄弱点：

### 根因 1：数据源错位 — 模态框查不到当前卡片

```
indexQuotesData (来自 /api/indices/quotes 轻路径)
        ↓ 含 SPX/NDX/HSTECH 等所有 watchlist 指数
        ↓
点击卡片 → openIdxDetailModal(code)
        ↓
getCurrentDashboardCards().find(...)  ← 在 dashboardData / indexData 找
        ↓
dashboardData (来自 /api/indices) ← 只含 DEFAULT_SELECTED_CODES 候选池
        ↓
如果用户关注的指数不在 dashboard 候选池（例如新搜索添加的非主流指数）
    → d === undefined → return → 模态框打不开
```

### 根因 2：historySeries 懒加载未在模态框入口触发

`ensureFullIndexData()`（异步拉 `/api/indices?detail=1` 拿完整 K 线）当前**仅在「市场风向标」上证大卡片渲染时调用**（行 6513）。如果用户首次访问就直接点指数实时行情中的小卡片，懒加载从未触发 → `d.historySeries` 为空 → 显示"暂未获取"。

### 根因 3：无独立的轻量级 K 线接口

需要拉趋势图时只能调用 `/api/indices?detail=1` 把**全部** indices 的 historySeries 都拉回来（每条 2520 条 K 线 × N 个指数 = 数 MB 响应），即使用户只关心点击的那一个指数。带宽浪费 + 易超时。

### 根因 4：无错误反馈与重试入口

`renderIdxModalTrend` 在 `series.length < 2` 时只显示"历史趋势数据暂未获取到"静态文案 — 用户**不知道是数据加载中、加载失败还是该指数确实无数据**，也无重试按钮。

## What Changes

### A. 新增"按指数 code 查询 K 线"轻量后端接口

- 新增 `GET /api/indices/:code/klines`
- 路径参数 `code` 形如 `SPX.US` / `000300.SH`（必带市场后缀）
- 响应：`{ success: true, data: { code, historySeries: [...], source: 'eastmoney'|'tencent'|'yahoo'|'stale-cache', stale: false } }`
- 复用现有 `fetchIndexHistory(cfg)`（已实现完整 failover：东财 → 腾讯 → Yahoo）
- 内存缓存：复用 `_klineCache`（fetchIndexHistory 内部已有）
- 失败时返回 `{ success: false, error: '...' }` 但 HTTP 200（前端可识别）

### B. 前端 openIdxDetailModal 改造为"找不到也兼容 + 自动拉 K 线"

- 模态框打开时若 `getCurrentDashboardCards().find()` 找不到 d → **从 `indexQuotesData` 兜底**构造一个最小的 d 对象
- 若 d.historySeries 缺失 → 调用新接口 `GET /api/indices/:code/klines` 异步拉取并填充
- 趋势区显示**3 种状态**：
  1. **loading**：「📈 正在加载历史趋势数据…」+ 骨架屏动画
  2. **success**：正常渲染 SVG 趋势图
  3. **error**：「⚠️ 历史趋势数据暂时无法获取」+ 「重试」按钮 + 数据源回退链状态

### C. 前端在模态框关闭后不重置 historySeries

成功拉到的 K 线写回 `indexQuotesData[i].historySeries`，下次点同一个指数立即可见（避免重复请求）。

### D. 数据源透明度

模态框底部"数据源"行显示 K 线数据来自 eastmoney/tencent/yahoo/stale-cache 哪一档（复用现有 `ds.kline.label` 机制扩展）。

## Capabilities

### Modified Capabilities

- `index-quotes-panel`: 扩展模态框「区间走势分析」模块的数据获取与展示鲁棒性 — 兜底查找、按需 K 线拉取、loading/error 三态、重试按钮

## Impact

- **后端 server.js**：新增 `GET /api/indices/:code/klines` 路由，约 +35 行
- **前端 public/index.html**：约 +90 行
  - `openIdxDetailModal` 增加 `indexQuotesData` 兜底 + 异步拉取 historySeries
  - `renderIdxModalTrend` 增加 loading/error 状态分支
  - 新增 `ensureModalTrendData(code)` 工具函数
  - 新增 CSS 骨架屏 + 重试按钮样式
- **数据结构**：无新增字段
- **数据源**：复用现有 `fetchIndexHistory` failover 链
- **缓存**：复用 `_klineCache`（内存）
- **依赖**：无
- **测试**：手工验证（弱网、首次打开、关闭重开、缓存命中、强刷重试）
