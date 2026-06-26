## Why

用户反馈"基金总览 → 指数总览"中的美股两个指数（标普 500、纳斯达克 100）数据不准。经过对比东方财富、腾讯行情（`qt.gtimg.cn`）的真值，确认存在两个独立缺陷：

1. **纳斯达克 100 指数被映射成了纳斯达克综合指数**：`POOL_MAP['NDX.US']` 配置 `secid: '100.NDX'`，但东方财富 `secid=100.NDX` 实际返回的是 `f58=纳斯达克`（即 IXIC，纳斯达克综合指数 25809.66），并非真正的纳斯达克 100（真值约 29446.18）。结果导致：
   - 站内 NDX 卡片所有字段（price / changePercent / high52w / low52w / momentum / sparkData / historySeries）全部是**纳斯达克综合指数的数据**，与用户认知中的"纳指 100 / QQQ 跟踪指数"严重不一致。
   - 52w 高 27190.21、52w 低 19334.98 也是综合指数的范围，远低于纳斯达克 100 的真实区间（约 21532–30762）。

2. **美股指数缺少"腾讯优先"实时通道**：当前 `fetchRealtimeQuotes()` 主源采用东方财富批量接口；只有当主源**漏掉**某个指数时才用腾讯补漏。对美股而言，东方财富有时返回数据但**滞后 15+ 分钟**或**指向错误的指数**（如 `100.NDX` → IXIC 这种语义错位），主源既不"missing"也不"failed"，于是补漏链不触发，错误数据被沉默地缓存到 `indices.json` → 进一步通过 `loadIndicesCacheMap()` 渗透到 `/api/indices/quotes` 的所有美股动量与 52w 字段。

## What Changes

- **修复 NDX secid 错位**：
  - 将 `POOL_MAP['NDX.US']` 的 `secid` 从 `'100.NDX'` 改为指向真正的 NASDAQ-100 的 secid（候选：`'100.NDX_'` / `'105.NDX'`，需现场验证），并将原 `100.NDX` 加入 `altSecids` 作为备用而非主源。
  - 同步更新 K 线接口（`fetchIndexHistory`）的 `primarySecid` 选择逻辑，使 NDX 历史数据从正确指数拉取，避免历史 K 线持续注入 IXIC 的数据点。
  - 提供 secid 健康检查工具：在 `fetchRealtimeQuotesEastmoney()` 收到响应后，比对 `f58`（指数名）与 cfg.name 是否吻合（如 cfg.name="纳斯达克100" 但 f58="纳斯达克" 应记录告警），便于今后此类映射漂移自动可见。
- **美股指数走腾讯优先通道**：
  - 在 `fetchRealtimeQuotes()` 内，对 `cfg.market === 'US'` 的 configs **优先**调用 `fetchRealtimeQuotesTencent()`（基于 `qt.gtimg.cn` 的 GBK 接口），将东方财富降级为美股 fallback。
  - 腾讯接口为美股提供 52 周高/低（`yearHigh`/`yearLow` 字段，对应索引位置）、上次交易时间（`updateTime`）等字段，可直接覆盖现在依赖 `indices.json` 才能拿到的 high52w/low52w，省去对 `indicesByCode` 缓存的强依赖，**消除"昨日 indices.json 渗透"问题**。
  - 保持 A 股、港股的现有"东财主源 → 腾讯补漏"链不变，零回归。
- **响应字段时效性透出**：
  - 美股指数对象新增 `quoteSource` 字段（`'tencent' | 'eastmoney' | 'sina' | 'stale-cache'`）与 `quoteFetchedAt`（ISO 8601），与温度计 `fetchedAt`/`source` 保持一致风格，前端可在卡片角标显示数据来源与抓取时间。
  - K 线层面在 historySeries 末尾如果晚于今日北京时间 06:00（美股已收盘）但仍是昨日数据，自动追加东财/腾讯的"今日实时价"作为最新点，避免动量 1m/3m 等基于陈旧 tail 计算。
- **失败兜底与告警**：
  - 当腾讯也失败时，回退东财；当东财结果与预期 `cfg.name` 不匹配（secid 错位再次发生），标记 `quoteSource = 'eastmoney-mismatch'` 并在响应中加 `staleNote = '数据源映射可能漂移'`，前端展示"数据可能不准"提示。
  - 后端日志增加 `[美股映射]` 前缀的 WARNING，便于运维监控。

## Capabilities

### New Capabilities

无（本次仍归属现有 capability）。

### Modified Capabilities

- `index-quotes-panel`: 新增"美股指数行情数据准确性"相关 Requirement——明确美股优先腾讯源、secid 健康校验、`quoteSource`/`quoteFetchedAt` 字段透出、historySeries 末尾对齐当日实时价。

## Impact

- **后端**: `services/dataFetcher.js`
  - `POOL_MAP['NDX.US']` 配置（核心修复）
  - `fetchRealtimeQuotes()` 路径决策（按 market 路由）
  - `fetchRealtimeQuotesEastmoney()` 增加 secid/name 健康校验
  - `fetchAllIndexData()` 与 `fetchIndexQuotesForWatchlist()` 透出新字段
- **前端**: `public/index.html` 美股卡片可选展示 `quoteSource` 角标（小修）
- **缓存**: 启动时若发现 `indices.json` 中 NDX 仍是旧值（IXIC），自动失效该条目并触发刷新；不删除整个 cache 文件
- **API 兼容性**: 仅新增字段，不删除/重命名既有字段，向后兼容
- **数据源依赖**: 强化对 `qt.gtimg.cn`（GBK）的依赖，需确保 iconv-lite 可用（已存在）
- **测试 / 部署**: 无 lint / 单元测试框架变更；PM2 重启即可生效；首次重启会触发一次 K 线全量重抓（NDX 真值入缓存）
