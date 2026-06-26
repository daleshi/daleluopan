## Context

线上"基金总览 → 指数总览"中的美股指数显示不准。经实测对比腾讯行情（`qt.gtimg.cn`）与东方财富 push2，确认两条独立缺陷：

| 指数 | 当前 watchlist secid | 东财 push2 返回 | 真值（腾讯）| 性质 |
|---|---|---|---|---|
| SPX.US | `100.SPX` | `f58='标普500'`、7394.30 | 7394.30 | 正确 |
| NDX.US | `100.NDX` | `f58='纳斯达克'`、25809.66 | 29446.18 | **错位**（指向 IXIC） |

通过东方财富搜索 API（`searchapi.eastmoney.com/api/suggest/get?input=纳斯达克100`）得到真正的纳斯达克 100 代码 `NDX100`（MktNum=100，Classify=UniversalIndex），即 secid `100.NDX100`。已实测 `https://push2.eastmoney.com/api/qt/stock/get?secid=100.NDX100` 返回 `f58='纳斯达克100'`、价格 29446.18，与腾讯一致。

错位的影响放大路径：
- `fetchRealtimeQuotesEastmoney()` 主源拿到错位数据 → `fetchAllIndexData()` 落入 `cachedData.indices` → 写入 `data/cache/indices.json`
- `fetchIndexQuotesForWatchlist()` 通过 `loadIndicesCacheMap()` 把陈旧/错位的 historySeries / high52w / low52w / sparkData 注入 `/api/indices/quotes` 响应
- 前端美股卡片所有"美股专属增强字段"（52w 区间条、3 列动量徽章、Sparkline）以及"全市场 4 列动量"均基于错误数据
- "纳斯达克 100"用户看到的所有数字其实都是"纳斯达克综合（IXIC）"

## Goals / Non-Goals

**Goals:**

1. 修复 NDX 价格、52w、动量、Sparkline 全部数字与真实纳斯达克 100 一致（误差 ≤ 0.5%）。
2. 美股指数从腾讯 `qt.gtimg.cn` 优先取数（更准确、52w 高/低/换手等字段齐全），东财与新浪降级。
3. 引入 secid/name 一致性自检，未来再发生数据源映射漂移时能被日志立即捕获。
4. 透出 `quoteSource`/`quoteFetchedAt` 字段，与温度计 `source`/`fetchedAt` 保持一致风格，前端可见。
5. A 股、港股链路零回归。

**Non-Goals:**

- 不更换 `fetchHistoryKlines` 的主源（K 线仍沿用东方财富，腾讯/Yahoo 兜底）—— K 线源稳定性已由 `kline-source-resilience` capability 保证。
- 不引入第三方付费数据源。
- 不修改 watchlist 文件结构（`code`、`market`、`secid` 字段语义保持兼容）。
- 不改造前端美股卡片视觉（仅在显示层可选增加 `quoteSource` 角标）。

## Decisions

### D1：NDX.US secid 改为 `100.NDX100`，旧值挪到 altSecids

**选择**：

```js
// services/dataFetcher.js POOL_MAP 中
{
  name: '纳斯达克100', code: 'NDX', market: 'US',
  secid: '100.NDX100',          // 改为真正的纳斯达克 100
  altSecids: ['100.NDX'],       // 旧错位值作为最后兜底（仅当东财下线 NDX100 时回退）
  txCode: 'usNDX',
  txKlineCode: 'us.NDX',
  yahooCode: '^NDX',
  ...
}
```

**理由**：
- 东方财富搜索 API 返回 `NDX100` 是 UniversalIndex 类型（type=11，与 SPX 一致），是平台内规范的"纳斯达克 100"代码。
- 实测 `100.NDX100` 返回真值 29446.18，与腾讯 `us.NDX` 一致。
- 保留 `100.NDX` 作 `altSecids` 是为了在东财数据源未来调整时不至于完全断流，但通过名称自检（D3）会拒绝错位值入缓存，因此这条 fallback 实际可视为"装饰性"。

**Alternatives considered**：
- 完全删除 NDX 在东财的依赖，只用腾讯。**否决理由**：东方财富 K 线接口仍是主源，需要正确的 secid 才能拉到真 K 线；纯腾讯无 60 个交易日批量 K 线接口（只有按月/年），改造成本过高。

### D2：`fetchRealtimeQuotes()` 按 market 分流

**选择**：

```js
async function fetchRealtimeQuotes(allConfigs) {
    const usConfigs = allConfigs.filter(c => c.market === 'US');
    const otherConfigs = allConfigs.filter(c => c.market !== 'US');
    let quotes = {};

    // 美股：腾讯优先
    if (usConfigs.length > 0) {
        try {
            const usQuotes = await fetchRealtimeQuotesTencent(usConfigs);
            Object.assign(quotes, usQuotes);
            for (const cfg of usConfigs) if (quotes[cfg.code]) {
                quotes[cfg.code]._quoteSource = 'tencent';
                quotes[cfg.code]._quoteFetchedAt = new Date().toISOString();
            }
        } catch (e) {
            console.warn('[美股] 腾讯失败:', e.message);
        }
        // 腾讯漏掉的美股 → 东财兜底
        const usMissing = usConfigs.filter(c => !quotes[c.code]);
        if (usMissing.length > 0) {
            try {
                const fb = await fetchRealtimeQuotesEastmoney(usMissing);
                Object.assign(quotes, fb);
                for (const cfg of usMissing) if (quotes[cfg.code]) {
                    quotes[cfg.code]._quoteSource = 'eastmoney';
                    quotes[cfg.code]._quoteFetchedAt = new Date().toISOString();
                }
            } catch (e) { /* 继续 */ }
        }
    }

    // A 股 / 港股 / CSI：保持原链路（东财主源 → 腾讯补漏 → 新浪）
    if (otherConfigs.length > 0) {
        // 原有逻辑原封不动 …
    }

    return quotes;
}
```

**理由**：
- 腾讯 `qt.gtimg.cn/q=us.SPX,us.NDX` 单次请求即返回包含 52w 高、52w 低、上次更新时间、年初至今涨幅、近 1 月/3 月动量等丰富字段，**单次调用就能覆盖目前 indices.json 才有的所有美股增强字段**，可大幅减少对历史缓存的依赖。
- A 股、港股的链路一字不动 → 零回归保证。

### D3：东财响应名称自检

**选择**：在 `fetchRealtimeQuotesEastmoney()` 解析每条 `data.diff[i]` 时增加：

```js
const expectedName = configByCode[item.f12]?.name;  // 'NDX' → '纳斯达克100'
if (expectedName && item.f14 && !item.f14.includes(expectedName.replace(/\d+$/, '')) && item.f14 !== expectedName) {
    console.warn(`[美股映射] ${item.f12} 期望"${expectedName}"但收到"${item.f14}"，secid 可能漂移，丢弃该条`);
    continue;  // 不写入 quotes
}
```

**理由**：
- 同样的错位漂移（不同 secid 指向不同指数）未来仍可能发生（东财内部代码体系不稳定）。一道便宜的运行时校验能让此类问题"立即可见"，不沉默。
- 容忍策略：纳斯达克 100 期望名"纳斯达克100"，腾讯传回 "纳斯达克"（不含 100）→ **拒绝**；标普 500 期望"标普500"，腾讯返回"标普500"→ **接受**。基本判据：cfg.name 中的核心字（去除尾部数字）必须是 f14 的子串，**或** f14 完全等于 cfg.name。

### D4：indices.json 启动时一致性体检

**选择**：在 `loadIndicesCacheMap()` 末尾增加：

```js
// 启动时检测美股 historySeries 末尾是否与 q.price（实时）严重背离（>5%）
// 严重背离 → 标记 needsForceRefresh，下次 fetchAllIndexData 触发刷新
```

**理由**：本次修复后首次部署，已写入磁盘的 `indices.json` 中 NDX 数据是错的。启动时通过一次轻量化对比避免错位数据继续渗透，**不删除文件**（保留其它字段如 sparkData/high52w 直到正确数据回来）。

### D5：响应字段命名沿用既有约定

`quoteSource: 'tencent' | 'eastmoney' | 'sina' | 'eastmoney-mismatch'`、`quoteFetchedAt: ISOString`、`staleNote: string|null` —— 与温度计 `source`/`fetchedAt`/`stale` 风格一致，前端复用现有 `.yzyx-fetched-at` / `.thermo-stale-badge` 样式。

## Risks / Trade-offs

- **[Risk] 腾讯 `qt.gtimg.cn` 风控** → Mitigation：腾讯只承担美股（最多 10 个指数，请求节奏与现有"补漏"路径相同），频次仍受 smartCacheGet TTL 控制，不超过既有压力。
- **[Risk] D3 自检误伤** → Mitigation：名称比较使用宽松规则（核心字 substring），并在日志中打印实际值便于人工 review；丢弃的报价会触发腾讯/新浪兜底，不会让指数完全没行情。
- **[Risk] altSecids 失效** → Mitigation：`altSecids` 仅在主 secid 失败时使用，且自检拒绝错位值，故即便 altSecids 也错位也不会污染缓存。
- **[Trade-off] 启动时 indices.json 体检会增加 ~50ms 启动延迟** → 可接受（启动只发生一次，且非关键路径）。
- **[Trade-off] `quoteSource` 字段对 A 股/港股暂不输出** → 仅美股需要（其他市场已有腾讯补漏机制），降低字段噪声。

## Migration Plan

1. **后端先行**：
   - 修改 `POOL_MAP['NDX.US'].secid`（D1）。
   - `fetchRealtimeQuotes()` 引入 market 分流（D2）。
   - 增加 D3 名称自检（仅美股触发，避免影响 A 股 / 港股）。
   - `fetchIndexQuotesForWatchlist` 与 `fetchAllIndexData` 透出 `quoteSource`/`quoteFetchedAt`/`staleNote`。
2. **缓存清理**：发布脚本不强制删 `data/cache/indices.json`，依赖 D4 的启动体检与 PM2 重启后第一次 `fetchAllIndexData()` 自动覆盖。
3. **前端跟进**（可选最小集）：在美股卡片底部"数据源行"显示 `quoteSource + quoteFetchedAt HH:MM`，与温度计样式一致。
4. **回滚**：单 commit 即可 `git revert`；`secid` 改回 `100.NDX` 即恢复（但用户看到错值）；磁盘缓存格式向后兼容。
5. **验证**：
   - `curl /api/indices/quotes | jq '.data.indices[] | select(.market=="US")'` 检查 NDX.US 价格 ≈ 29446、SPX.US ≈ 7394。
   - 浏览器对比 youzhiyouxing.cn / Yahoo Finance NDX 真值，误差 ≤ 0.5%。

## Open Questions

- 是否需要把 SPX 也改成腾讯优先？当前 SPX 数据正确，但同样存在"东财滞后 15 分钟"的隐患。本设计 D2 已统一让所有美股走腾讯优先（SPX 一并受益），无需单独评估。
- altSecids 中保留 `100.NDX` 是否会让自检误抓？答：不会，因为自检在调用方（`fetchRealtimeQuotesEastmoney`）做，无论使用哪个 secid，最终入库前都会校验 f14 名称。
