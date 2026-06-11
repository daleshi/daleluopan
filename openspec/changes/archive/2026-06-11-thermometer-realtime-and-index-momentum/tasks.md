## 1. 后端 — 温度计 TTL 与时效性透出

- [x] 1.1 在 `services/dataFetcher.js` 顶部新增 `getThermometerTTL()` helper（A股开盘 60s / 港美股开盘 5min / 全休市 30min），并定义 `THERMOMETER_MAX_TTL = 4h`
- [x] 1.2 改造 `fetchYZYXThermometer()`：用 `getThermometerTTL()` 替换硬编码 `600000`，并加 4h 兜底强制刷新；解析失败时**不**更新 `_yzyxCacheTime`
- [x] 1.3 改造 `fetchYZYXIndexDetail()`：同样用 `getThermometerTTL()` 计算 TTL，沿用 4h 兜底
- [x] 1.4 在 `fetchYZYXThermometer()` 成功路径将 `result` 上挂 `_meta = { source, fetchedAt }`，并在 `fetchAllIndexData()` 组装 `thermometer` 时透传到响应
- [x] 1.5 解析失败回退磁盘缓存时，将 `_meta = { source: 'stale-cache', stale: true, fetchedAt: <磁盘时间> }`
- [x] 1.6 在 `fetchAllIndexData()` 顶层 `dataSources` 数组的每一项补 `fetchedAt` 与 `stale` 字段（蛋卷 Wind / 亿牛 / ETF.run / 中证 / 天天基金）

## 2. 后端 — 强制刷新通道

- [x] 2.1 在 `server.js` 的 `/api/indices` 路由识别 `?refresh=1`，命中时调用 `fetchAllIndexData(selectedCodes, { forceRefreshThermometer: true })`，内部传递给 `fetchYZYXThermometer({ force: true })`（说明：实际温度计字段在 `/api/indices` 的 `data.thermometer`，`/api/daily-eval` 仅返回估值列表，不含温度，故 force 路径放在 `/api/indices`）
- [x] 2.2 在 `fetchYZYXThermometer()` 增加 `{ force: false }` 参数，`force=true` 时跳过 TTL 比较直接抓取
- [x] 2.3 IP 维度节流：`smartCacheGet` 已自带 `_smartFetchPromises[key]` 并发去重，快速重复 refresh 自然合并为同一 Promise，无需额外节流（原计划方案被现有机制取代）
- [x] 2.4 新增 `POST /api/thermometer/refresh` 路由，挂 `requireAdmin`，调用 `resetYZYXCache()` 清空 `_yzyxCache` / `_yzyxDetailCache` / `_yzyxDetailCacheTime` 后返回 `{ success, fetchedAt, source, stale, marketTemperature, indexCount }`
- [x] 2.5 抓取失败时返回上次缓存并标记 `thermometer.stale = true`，HTTP 保持 200

## 3. 后端 — 全市场指数多周期动量

- [x] 3.1 在 `services/dataFetcher.js` 新增 `calcMomentum(historySeries, days, currentPrice)` 与 `calcMomentumSet(historySeries, currentPrice)` helper（按交易日切片，含边界与 null 防御）
- [x] 3.2 在 `fetchAllIndexData()` 的 results.map 内为**所有**指数计算 `momentum1m=21` / `momentum3m=63` / `momentum6m=126` / `momentum1y=252` 并挂到指数对象
- [x] 3.3 在 `fetchIndexQuotesForWatchlist()` 组装 `quotes` 时同样挂这 4 个字段（保证 `/api/indices/quotes` 与 `/api/indices` 字段一致）
- [x] 3.4 改写 `computeUSMomentum()` 中既有 `momentum1m` / `momentum3m` 计算逻辑，复用 `calcMomentumSet()`，避免双口径

## 4. 前端 — 温度计 Tab 时效性提示

- [x] 4.1 在 `public/index.html` 温度计 Tab 渲染逻辑读取 `data.thermometer.fetchedAt`，在更新时间行追加「本站抓取 HH:MM:SS」
- [x] 4.2 当 `data.thermometer.stale === true` 时，渲染黄色徽章「⚠️ 数据可能滞后」（CSS 类 `.thermo-stale-badge`）
- [x] 4.3 在指数卡片"实时可用来源对比"行为每个 `comparisonSources[].name` 后面追加「HH:MM」，stale 项加 `.ds-stale` 灰色样式
- [x] 4.4 新增 CSS：`.thermo-stale-badge`（黄底深字）/ `.yzyx-fetched-at`（次级文本色）/ `.ds-stale`（灰化）

## 5. 前端 — 指数卡片多周期动量徽章

- [x] 5.1 在 `buildIndexQuoteCard()` 中插入 `<div class="idx-card-momentum-row">` 容器，含 4 列徽章 `1月 / 3月 / 6月 / 1年`
- [x] 5.2 实现 helper `formatMomentumCell(label, value)`：`null` → `--`、`> 0` → `+X.XX%` 红、`< 0` → `-X.XX%` 绿、`= 0` → `0.00%` 次级色
- [x] 5.3 新增 CSS `.idx-card-momentum-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }` 与 `.idx-mm-cell`（小字号、padding 4px）
- [x] 5.4 移动端断点（`@media (max-width: 480px)`）`grid-template-columns: repeat(2, 1fr)`
- [x] 5.5 美股卡片保留原 3 列动量徽章与 52w / Sparkline 元素，新增行追加在原徽章下方（与新 4 列共存）

## 6. 联调与回归

- [x] 6.1 本地 `node server.js` 启动（PORT=3212）。已抓取到 youzhiyouxing.cn 当前温度（55°），`thermometer.fetchedAt` 实时更新
- [x] 6.2 测试 `GET /api/indices?refresh=1`：温度计返回 `fetchedAt: 2026-06-11T02:41:52.660Z, source: 'youzhiyouxing-data', stale: false`
- [x] 6.3 测试 `POST /api/thermometer/refresh` 未登录 → HTTP 401（`requireAdmin` 嵌套 `requireAuth`，未登录走 401，登录但非 admin 走 403；行为与既有约定一致）
- [x] 6.4 测试沪深 300 / 中证 500 / 中证红利等指数：4 列动量徽章渲染数据正确（如 `沪深300 m1m=-4.16% m3m=+0.12% m6m=+3.42% m1y=+22.06%`）
- [x] 6.5 CSS 已添加 480px 媒体查询，4 列自动切换为 2×2 网格
- [x] 6.6 historySeries 不足时 `calcMomentum()` 返回 `null`，前端 `formatMomentumCell()` 显示 `--`
- [x] 6.7 `/api/indices`、`/api/indices/quotes` 响应 JSON 结构兼容性确认（既有字段保留，新增字段 `momentum1m/3m/6m/1y`、`thermometer.fetchedAt/source/stale`、`comparisonSources[].fetchedAt/stale`）
- [x] 6.8 [顺手修复] `services/dataFetcher.js` 的预存 TDZ bug：`processIndex()` 美股估值参考块在 `const quote` 之前使用 `quote.price`，导致首次启动时 indices 数据 fetcher 报 `Cannot access 'quote' before initialization`。已将该块移到 `const quote` 定义之后

## 7. 部署与文档

- [ ] 7.1 `npm run package:deploy` 生成发布包（用户在确认改动后自行触发）
- [ ] 7.2 PM2 重启后查看 `npm run pm2:logs`，确认无 `[知有行]` 异常告警（用户在部署后验证）
- [x] 7.3 在 `CODEBUDDY.md` 的"数据源概览"表中注明知有行温度的 TTL 策略（A股开盘 60s / 港美股 5min / 全休市 30min / 4h 兜底）
- [x] 7.4 在 `CODEBUDDY.md` 的"API 路由结构"中新增 `POST /api/thermometer/refresh`（管理员）
- [ ] 7.5 在用户可见的"功能更新"位置（如温度计 Tab 帮助提示）补一句"数据每分钟自动刷新"（避免修改既有文案风格，留待 UI 微调批次）
