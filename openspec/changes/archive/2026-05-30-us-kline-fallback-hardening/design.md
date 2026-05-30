## Context

**当前 K 线 failover 链（已存在）：**

```
fetchIndexHistory(cfg)
  ├─ 内存缓存命中？ → fresh-cache 直接返回
  ├─ 东方财富冷却中？ → 跳到腾讯
  ├─ 东方财富主源 (push2his /stock/kline/get)
  │    ├─ 成功 → 缓存 + 返回 'eastmoney'
  │    └─ 失败 → 标记 10 分钟冷却 + fall through
  ├─ 历史 stale 缓存？ → 'stale-cache' 返回（避免抖动）
  ├─ 腾讯 K 线 (qt.gtimg.cn /finance/usstock/kline)
  │    ├─ 成功 → 缓存 + 返回 'tencent-fallback'
  │    └─ 失败 → fall through
  └─ Yahoo Finance (query1.finance.yahoo.com，仅美股)
       ├─ 成功 → 缓存 + 返回 'yahoo-fallback'
       └─ 失败 → 返回空 + 'all-failed'
```

**当前两阶段启动（已存在）：**

```
Phase 1: 同步加载磁盘缓存 (毫秒级，6 类 cache key)
Phase 2: Promise.allSettled 并发刷新：
  ├─ getCachedData(true)               ← 刷 indices.json (含 K 线计算)
  ├─ getCachedIndexQuotes(true)        ← 刷 index-quotes.json (依赖 indices.json)
  ├─ active-funds / stocks / etfs / daily-eval
  └─ ALL 同时开始 ⚠️ 时序盲区
```

**用户报告时刻的故障序列复现**：

```
T0 启动      | indices.json 仍为昨日快照（NDX 5/29 close=26972.62）
T0+50ms     | Phase 2 并发开始
T0+200ms    | fetchIndexQuotesForWatchlist 完成 (走腾讯实时拿到 30333.18)
            | 但内部 loadIndicesCacheMap() 读到的是 T0 旧文件
            | → 写入 index-quotes.json：price=30333.18 但 sparkData 末尾仍是 26972
T0+5000ms   | fetchAllIndexData 完成，indices.json 终于更新
            | 但 index-quotes.json 已被定型，TTL 内不会再刷新
            | → 用户看到错位（直到 index-quotes 缓存过期）
```

**约束：**
- 不能新增外部 API（项目极简栈坚持）
- 不能引入新 cache key（保持磁盘文件结构稳定）
- 不能让启动总耗时显著增加（用户对秒开很敏感）
- 不能阻塞 quote 主流程（API 响应时间不能因兜底逻辑增长 > 500ms）

## Goals / Non-Goals

**Goals:**
- 启动后第一次 `fetchIndexQuotesForWatchlist` 调用时，indices.json 已是最新 K 线快照
- 运行时若发现 indices.json 严重陈旧（> 30min），主动触发美股 K 线刷新（限量）
- 提供可见的健康度 API + 控制台告警，便于发现长期数据源故障
- 整体启动总耗时不增加超过 1 秒

**Non-Goals:**
- 不修改现有 failover 链的优先级与冷却逻辑（已稳定）
- 不修改 indices.json / index-quotes.json 的字段结构
- 不改造 A 股 / 港股的 K 线刷新路径（仅本次专注美股）
- 不实现持久化的健康指标（重启清零，避免引入存储依赖）
- 不实现自动告警通道（短信/邮件等），仅控制台 + API

## Decisions

### 决策 1：启动期顺序化策略 — "K 线优先 + 其余并发"

**选择**：Phase 2 改为两阶段：

```
Phase 2a (sequential): await getCachedData(true)            ← K 线优先
Phase 2b (parallel):   Promise.allSettled([
                         getCachedIndexQuotes(true),
                         active-funds / stocks / etfs / daily-eval,
                       ])
```

**否决方案 A**：完全串行 → 启动时间从 5s 涨到 ~30s，不可接受
**否决方案 B**：将 `getCachedIndexQuotes` 也排到 K 线之后 → 部分场景多 1-2s，对秒开影响微小，**采纳**

```
Phase 2a + 2b 总耗时 ≈ max(K线 ~5s, 其他 ~10s) ≈ 10s（与原版 8-10s 几乎无差异）
```

**关键洞察**：`getCachedIndexQuotes` 本就依赖 indices.json（用于动量计算），等待 K 线完成是逻辑上正确的。

### 决策 2：运行时节奏对齐 — 软触发主动刷新

**选择**：在 `fetchIndexQuotesForWatchlist` 内：

```js
// 检查 indices.json 中美股记录是否陈旧
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const usWatchlist = indices.filter(i => i.market === 'US');
const cacheTime = indicesCacheData?.time || 0;
if (usWatchlist.length > 0 && (Date.now() - cacheTime) > STALE_THRESHOLD_MS) {
    // 异步触发刷新但不 await，下次请求即可受益
    setImmediate(async () => {
        try {
            for (const idx of usWatchlist.slice(0, 2)) { // 限 2 个，避免压力
                const cfg = POOL_MAP[`${idx.code}.${idx.market}`] || {...};
                await fetchIndexHistory(cfg);
            }
        } catch (e) { /* 静默 */ }
    });
}
```

**为什么不 await**：API 响应延迟敏感；用户本次请求看到的可能仍是旧数据，但下次（几秒后）就更新了 —— 接受。

**为什么仅美股**：A 股/港股有完整 quote 字段，不依赖 K 线计算动量。

**否决方案**：在 indices.json 陈旧时**同步等待 K 线刷新** → 用户响应延迟 5s+，体感糟糕。

### 决策 3：健康监控数据结构 — 内存 Map，重启清零

**选择**：

```js
const _klineSourceHealth = {
    eastmoney: { success: 0, failure: 0, lastSuccessAt: null, lastFailureAt: null, recentFailures: [] },
    tencent:   { ... },
    yahoo:     { ... },
};

function recordKlineSourceSuccess(source, code) { ... }
function recordKlineSourceFailure(source, code, errMsg) {
    h.failure++;
    h.lastFailureAt = Date.now();
    h.recentFailures.push({ code, time: Date.now(), err: errMsg });
    // 保留最近 50 条
    if (h.recentFailures.length > 50) h.recentFailures.shift();
}
```

**为什么不持久化**：
- 重启后归零是合理行为（新一轮观察）
- 避免引入新 cache 文件 / SQLite
- 健康度本质是**实时观察值**，不需要长期历史

### 决策 4：埋点位置 — 集中在 fetchIndexHistory 与 fetchTencentKlines/fetchYahooKlines

**选择**：在 3 个 fetcher 内部成功/失败分支调用 `recordKlineSourceXxx`：

```
fetchHistoryKlinesDetailed     → recordKlineSourceSuccess('eastmoney', cfg.code) 或 Failure
fetchTencentKlines             → recordKlineSourceSuccess('tencent', cfg.code) 或 Failure
fetchYahooKlines               → recordKlineSourceSuccess('yahoo', cfg.code) 或 Failure
```

**否决**：在 `fetchIndexHistory` 顶层统一埋点 → 无法区分腾讯/Yahoo 哪个具体失败，颗粒度不够。

### 决策 5：聚合告警节奏 — 30 分钟一次 setInterval

**选择**：服务启动时启动一个 `setInterval(checkKlineSourceHealth, 30 * 60 * 1000)`：

```js
function checkKlineSourceHealth() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    Object.entries(_klineSourceHealth).forEach(([src, h]) => {
        const recentFails = h.recentFailures.filter(f => f.time > oneHourAgo);
        const failedCodes = [...new Set(recentFails.map(f => f.code))];
        if (failedCodes.length >= 3) {
            console.warn(`[K线健康] ${src} 最近 1 小时失败 ${recentFails.length} 次，影响 ${failedCodes.length} 个指数: ${failedCodes.join(',')}`);
        }
    });
}
```

**为什么 30 分钟而非 5 分钟**：避免频繁刷屏；K 线源故障是中长期问题，30 分钟粒度足够。

**否决**：每次失败立即告警 → 在源整体宕机时会刷屏。

### 决策 6：API 路由 — 公开但只读

**选择**：`GET /api/health/kline-sources` 公开（与 `/api/health` 一致），返回 plain JSON：

```json
{
  "success": true,
  "snapshot": {
    "eastmoney": { "success": 12, "failure": 8, "successRate": 0.6, "lastSuccessAt": "...", "lastFailureAt": "...", "recentFailures": [{ "code": "NDX", "time": "...", "err": "socket hang up" }] },
    "tencent":   { ... },
    "yahoo":     { ... }
  },
  "timestamp": "..."
}
```

**为什么不 requireAdmin**：健康度数据非敏感，公开有助于第三方监控集成（uptime robot 等）。

### 决策 7：与上游 change 的协作

`us-index-card-enrichment` 已在 `fetchIndexQuotesForWatchlist` 内做了"运行时层"防御（用实时价覆盖动量计算 + sparkData 末尾追加）。本次从更上游做加固：

```
本次 (us-kline-fallback-hardening):
  保证 indices.json 数据本身尽可能新

上游 (us-index-card-enrichment):
  即使 indices.json 还是有滞后，运行时层用实时价矫正

两者形成防御纵深 (Defense in Depth)
```

## Risks / Trade-offs

- **[Risk] Phase 2a 的 K 线刷新 await 失败导致 Phase 2b 不执行** → 全部数据停留在磁盘缓存
  → **Mitigation**：用 try/catch 包住 await，无论成功失败都进入 Phase 2b

- **[Risk] 节奏对齐的 setImmediate 异步刷新可能并发触发多次（高并发场景）** → 浪费资源
  → **Mitigation**：模块级 `_indicesRefreshInProgress` 闭锁；进行中跳过新触发

- **[Risk] 健康监控的 recentFailures 数组无限增长** → 内存泄漏
  → **Mitigation**：硬限制每个源 50 条 + 1 小时窗口过滤；P99 内存增量 < 50KB

- **[Risk] 30 分钟 setInterval 在 PM2 cluster 模式下重复执行** → 重复告警
  → **Mitigation**：项目当前是单进程模式，未启用 cluster；如未来启用需用 `cluster.isPrimary` 判断

- **[Trade-off] 启动顺序化牺牲并发度，为换取启动后立刻数据正确**
  → 接受：K 线刷新本来就是关键路径，串行 ≈ 并发耗时（其他任务受 K 线限制）

- **[Trade-off] 公开健康 API 可能被外部探测**
  → 接受：返回数据无敏感信息，且能力上对外有运维价值

## Open Questions

- **Q：30 分钟告警阈值是否应可配置？**
  → 暂硬编码；如未来发现需要调整再做配置化

- **Q：是否需要给前端做"数据源不健康"的可见提示？**
  → 不在本次范围；优先让数据本身正确，UI 提示是另一层
