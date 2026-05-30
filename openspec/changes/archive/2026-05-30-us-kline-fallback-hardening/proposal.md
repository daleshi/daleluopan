## Why

近期发现一个**短窗口数据失真**问题：用户报告纳斯达克 100 指数显示价 26972.62 而非真实的 30333.18。深挖发现：

```
现状 failover 链 (fetchIndexHistory):  东财 → 腾讯 → Yahoo  ← 链路完整，但有时序盲区
   ├─ 东财对美股 K 线接口已 socket hang up
   ├─ 腾讯 / Yahoo 兜底**实际能拿到正确数据**（NDX 30333.18 ✓）
   └─ 但启动期 / 冷启动 / 缓存过期窗口内，indices.json 仍可能停留在旧 K 线快照
```

**3 个独立但相关的薄弱点**：

1. **冷启动窗口**：服务启动后 Phase 2 后台并行刷新 6 类数据，`fetchAllIndexData` 与 `fetchIndexQuotesForWatchlist` **同时开始**，但 watchlist 读 `indices.json` 时该文件还是旧版本 → 动量/Sparkline 用陈旧 K 线
2. **节奏脱节**：日常运行中两个 cache 各自独立 TTL，可能出现 `index-quotes.json` 已是当日新值，但 `indices.json` 仍是昨日（甚至更早）
3. **盲区无声**：东财 K 线长期失败时仅有 `console.warn`，无聚合告警，运维不易发现"哪些指数已长期靠备用源运行"

## What Changes

**A. 启动期暖启动顺序化（server.js Phase 2）**：
- 把 `getCachedData(true)`（刷 indices.json）从并发组里前置：先 await 它完成，再并发刷其他 5 类数据
- 确保 `fetchIndexQuotesForWatchlist` 后续被请求时，能从已是当日新值的 indices.json 读到准确 K 线
- 启动总耗时几乎不增加（K 线刷新 ~3-5s 是关键路径，其他 5 类原本也要等所有任务完成）

**B. 运行时节奏对齐（services/dataFetcher.js）**：
- 在 `fetchIndexQuotesForWatchlist` 内：当 watchlist 包含美股指数 **且** indices.json 中对应记录的"快照时间"距今超过阈值（默认 30 分钟），主动触发该指数的 K 线刷新（仅美股，限 1~2 个，避免拖慢响应）
- 阈值参数 `INDICES_CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000` 可调
- 主动刷新失败不阻塞主流程（fall-through 用旧数据）

**C. K 线源健康监控（services/dataFetcher.js）**：
- 新增模块级 `_klineSourceHealth: Map<sourceName, {success, failure, lastSuccessAt, lastFailureAt, recentFailures: []}>`
- 在 `setCachedKlines` 与各 fetcher 失败分支记录埋点
- 新增 `getKlineSourceHealthSnapshot()` 公开导出（返回 plain JSON）
- 新增 `GET /api/health/kline-sources` 路由（管理员可见或公开），返回各源的成功率、最近失败次数、最后成功/失败时间
- 控制台聚合告警：每 30 分钟检查一次，若某指数最近 1 小时全部失败次数 ≥ 3 → 输出一行告警

## Capabilities

### New Capabilities

- `kline-source-resilience`: K 线数据源的稳健性能力 —— 启动顺序化、运行时节奏对齐、源健康度监控；保证用户在任何时刻看到的指数行情数据（特别是 K 线衍生字段）都不会被陈旧 K 线快照污染

### Modified Capabilities

（无 — 本次新增独立能力）

## Impact

- **后端 server.js**：Phase 2 启动顺序调整，约 +15 行 / -3 行
- **后端 services/dataFetcher.js**：节奏对齐 + 健康监控，约 +120 行
  - `_klineSourceHealth` Map + `recordKlineSourceSuccess/Failure` 工具
  - `getKlineSourceHealthSnapshot` 公开导出
  - `fetchIndexQuotesForWatchlist` 内 indices.json 陈旧检测 + 主动刷新
  - 30 分钟告警 setInterval（启动一次）
- **新增 API**：`GET /api/health/kline-sources` 返回源健康快照（约 +20 行）
- **数据结构**：无新增 cache 文件，无字段变化
- **依赖**：无新增
- **测试**：项目无前端测试框架，依赖手工验证（启动日志顺序 + indices.json 时间戳对齐 + 健康 API 返回）
- **与上游 change 关系**：`us-index-card-enrichment` 已在运行时层用实时价覆盖动量计算（最终防线），本次从启动/调度/监控三层强化数据正确性，两者互补
