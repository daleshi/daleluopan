## 1. K 线源健康监控基础设施（services/dataFetcher.js）

- [x] 1.1 在文件顶部（紧邻 `_klineCache` 与 `_eastmoneyKlineCooldownUntil` 附近）声明 `_klineSourceHealth` 对象，含 3 个键 `eastmoney/tencent/yahoo`，每个值含 `success/failure/lastSuccessAt/lastFailureAt/recentFailures`
- [x] 1.2 实现 `recordKlineSourceSuccess(source, code)` 工具函数：增加 success 计数 + 更新 lastSuccessAt 为 Date.now()
- [x] 1.3 实现 `recordKlineSourceFailure(source, code, errMsg)` 工具函数：增加 failure 计数 + 更新 lastFailureAt + push 到 recentFailures（保持长度 ≤ 50，超出时 shift）
- [x] 1.4 实现 `getKlineSourceHealthSnapshot()` 函数：返回 plain JSON（successRate=success/(success+failure) 或 null；lastSuccessAt/lastFailureAt 转 ISO 字符串）

## 2. 在 fetcher 中埋点（services/dataFetcher.js）

- [x] 2.1 `fetchHistoryKlinesDetailed`：成功（klines.length > 0 且 sourceSecid 有值）时调 `recordKlineSourceSuccess('eastmoney', sid)`；所有 secid 失败时调 `recordKlineSourceFailure('eastmoney', secid, lastErrorMessage)`
- [x] 2.2 `fetchTencentKlines`：成功路径调 `recordKlineSourceSuccess('tencent', code)`；失败路径调 `recordKlineSourceFailure('tencent', code, err.message)`
- [x] 2.3 `fetchYahooKlines`：成功路径调 `recordKlineSourceSuccess('yahoo', yahooCode)`；失败路径调 `recordKlineSourceFailure('yahoo', yahooCode, err.message)`
- [x] 2.4 模块 export 中追加 `getKlineSourceHealthSnapshot`

## 3. 30 分钟聚合告警（services/dataFetcher.js）

- [x] 3.1 实现 `checkKlineSourceHealth()` 函数：遍历 `_klineSourceHealth`，过滤 1 小时内的 recentFailures，按 code 去重，若 ≥ 3 个不同指数则 console.warn
- [x] 3.2 实现 `startKlineSourceHealthMonitor()` 函数：用 `setInterval(checkKlineSourceHealth, 30 * 60 * 1000)`，并把 interval id 保存以便测试用例可清理
- [x] 3.3 模块 export 中追加 `startKlineSourceHealthMonitor`

## 4. 运行时节奏对齐（services/dataFetcher.js）

- [x] 4.1 在 `fetchIndexQuotesForWatchlist` 函数前（与 `_INDICES_CACHE_FILE` 同一区域）声明常量 `INDICES_CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000`
- [x] 4.2 声明模块级闭锁 `let _indicesRefreshInProgress = false`
- [x] 4.3 实现 `triggerLazyUSKlineRefresh(usWatchlist)` 函数：limit=2、用 setImmediate 异步调用 fetchIndexHistory；try/catch + 闭锁；finally 释放闭锁
- [x] 4.4 在 `fetchIndexQuotesForWatchlist` 内 `loadIndicesCacheMap()` 之后增加陈旧检测：读 `wrapper.time`（需要修改 `loadIndicesCacheMap` 也返回时间戳），若 `Date.now() - cacheTime > INDICES_CACHE_STALE_THRESHOLD_MS` 且有美股 watchlist 项 → 调用 `triggerLazyUSKlineRefresh`
- [x] 4.5 修改 `loadIndicesCacheMap` 返回 `{ map, cacheTime }`，调用方更新

## 5. 启动期 K 线优先（server.js）

- [x] 5.1 定位 `Phase 2: 后台异步并行刷新` 区域（约 3930 行）
- [x] 5.2 重构 IIFE：先 `await getCachedData(true).catch(err => console.warn('[启动] Phase 2a K线刷新失败:', err.message))` + 输出 `Phase 2a` 完成日志
- [x] 5.3 之后再 `Promise.allSettled` 剩余 5 类（去掉原 `getCachedData`）+ 输出 `Phase 2b` 完成日志
- [x] 5.4 在 server 启动末尾调 `dataFetcher.startKlineSourceHealthMonitor()`

## 6. 健康 API 路由（server.js）

- [x] 6.1 新增路由 `GET /api/health/kline-sources`，公开访问
- [x] 6.2 路由内调 `dataFetcher.getKlineSourceHealthSnapshot()` 并返回 `{ success: true, snapshot, timestamp: new Date().toISOString() }`
- [x] 6.3 路由位置：紧邻现有 `/api/health` 路由（便于运维查找）

## 7. 集成验证（人工）

- [ ] 7.1 `npm start` 启动，日志应包含 `[启动] Phase 2a: K 线优先刷新完成` + `Phase 2b: 其他数据并发刷新完成`
- [ ] 7.2 访问 `GET /api/health/kline-sources`，返回 200 + 三个源的健康对象
- [ ] 7.3 启动 30 秒后访问 `/api/indices/quotes`，确认 NDX 卡片字段：`price` ≈ 30333、`drawdownFromHigh52w` ≈ 0.45、`changeMonth` ≈ 21、`sparkData` 末尾是 30333.18
- [ ] 7.4 模拟陈旧场景：手动 `touch -d "2 hours ago" data/cache/indices.json`，再请求 `/api/indices/quotes`，观察日志出现"主动触发陈旧刷新"
- [ ] 7.5 多次（10+ 次）失败后访问健康 API，`recentFailures` 数组长度 ≤ 50
- [ ] 7.6 让服务运行 30 分钟以上，观察告警 setInterval 是否正确触发（如确实有失败则看到 `[K线健康]` 告警；正常则无输出）
- [ ] 7.7 内存压力检查：运行数小时后 `process.memoryUsage()` 与启动时对比，增量 < 5MB（健康监控数据 < 50KB）

## 8. 校验与归档准备

- [x] 8.1 `openspec validate us-kline-fallback-hardening --strict` 通过
- [x] 8.2 `git diff --stat` 仅 `services/dataFetcher.js` + `server.js` 两个文件改动
- [ ] 8.3 PM2 reload 后回归全功能（指数行情、严选基金、温度计、投资策略、健康 API 均正常）
- [ ] 8.4 待用户确认是否部署到生产服务器（**待人工**）
