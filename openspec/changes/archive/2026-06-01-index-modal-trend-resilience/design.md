## Context

**当前数据流图谱（实测代码定位）：**

```
GET /api/indices/quotes  ← 轻接口 (无 historySeries)
       ↓
indexQuotesData (含所有 watchlist 指数，包括用户搜索添加的非主流指数)
       ↓ #indexSummaryGrid 渲染卡片，用户点击
openIdxDetailModal(code)
       ↓
getCurrentDashboardCards() → dashboardData || indexData
       ↓
来自 /api/indices  ← 重接口 (默认 detail=0，无 historySeries)
       ↓
仅含 DEFAULT_SELECTED_CODES 候选池中的指数
       ↓
.find(item => item.code === code)
       ↓
❌ 找不到 → return → 模态框打不开
✅ 找到但 historySeries 为空（未调 ensureFullIndexData）
   → renderIdxModalTrend → series.length < 2 → "历史趋势数据暂未获取到"
```

**关键函数与行号：**
- `public/index.html:5963` `getCurrentDashboardCards()`
- `public/index.html:6004` `ensureFullIndexData()` 当前仅在行 6513 触发（市场风向标渲染时）
- `public/index.html:6706` `openIdxDetailModal()`
- `public/index.html:6877` `renderIdxModalTrend()`
- `public/index.html:9932` `indexQuotesData`（首屏卡片数据源）
- `server.js:829` `GET /api/indices`（detail=0 默认裁掉 historySeries）
- `services/dataFetcher.js` `fetchIndexHistory(cfg)` ← 已实现 failover：东财→腾讯→Yahoo

**约束：**
- 不能修改 `/api/indices` 默认响应结构（避免影响其他模块）
- 不能拉 K 线时阻塞模态框打开（用户体验差）
- 不能引入新依赖
- 不能强制刷新整页（轮询会自然同步行情，不应中断）

## Goals / Non-Goals

**Goals:**
- 点击任何 watchlist 指数（包括非主流指数）都能打开模态框
- 模态框打开时**立即**显示已有的元信息（价格、PE、52w 高低），趋势图独立异步加载
- 趋势区有 loading / success / error **三态可见**反馈
- error 态有「重试」按钮可一键再拉
- 拉到的 K 线缓存到内存，下次打开同一指数瞬间渲染
- 后端 K 线接口带 failover（继承现有 fetchIndexHistory 链）

**Non-Goals:**
- 不实现"分钟级 K 线"（仍日 K）
- 不实现 K 线绘图升级（保留现有 SVG 折线）
- 不修改"市场风向标"上证大卡片的渲染逻辑
- 不实现客户端 K 线 IndexedDB 持久化（页面刷新后重新拉，可接受）
- 不为非美股指数额外引入 Yahoo（保持现状）

## Decisions

### 决策 1：后端新增 `GET /api/indices/:code/klines` 而非扩展 `/api/indices`

**选择**：独立轻量端点

```
GET /api/indices/SPX.US/klines
→ {
    success: true,
    data: {
      code: 'SPX.US',
      historySeries: [...2520 条],
      source: 'tencent',
      sourceLabel: '腾讯财经备用源',
      stale: false,
      fetchedAt: '...'
    }
  }
```

**否决方案 A**：扩展 `/api/indices/quotes` 让它也返回 historySeries
→ 否决：会让所有 watchlist 指数的 K 线都被拉一次（实际只点开 1 个），浪费

**否决方案 B**：让前端直接调 `/api/indices?detail=1&code=SPX.US`
→ 否决：仍需要后端支持 code 过滤，等价于新建轻量端点；不如直接定义 RESTful 路径

**核心理由**：
- RESTful 设计（资源路径 `/api/indices/:code/klines`）清晰
- 仅在用户点击时按需触发
- 复用 `fetchIndexHistory` 的内存缓存（`_klineCache`），二次请求毫秒返回

### 决策 2：路径参数 code 用 `SPX.US` 形式而非 secid

```
✅ GET /api/indices/SPX.US/klines           ← 用户友好
✅ GET /api/indices/000300.SH/klines        
❌ GET /api/indices/100.SPX/klines          ← secid 是东财内部表示，不暴露
```

后端通过 `code.market` 查 `POOL_MAP` 拿 `cfg`，再调 `fetchIndexHistory(cfg)`：

```js
const fullCode = req.params.code;  // 'SPX.US'
const cfg = POOL_MAP[fullCode];
if (!cfg) {
    // 不在候选池但在 watchlist → 动态构造
    const w = readIndexWatchlist();
    const item = w.find(i => `${i.code}.${i.market}` === fullCode);
    if (!item) return res.status(404).json({...});
    cfg = { code: item.code, market: item.market, secid: item.secid, name: item.name };
}
const result = await fetchIndexHistory(cfg);
```

### 决策 3：前端"找不到 d"兜底策略

```js
function openIdxDetailModal(code) {
    let d = getCurrentDashboardCards().find(item => item.code === code);
    if (!d) {
        // 兜底：从 indexQuotesData 构造最小 d（行情字段可用，缺 historySeries / pe / pb）
        const quote = indexQuotesData.find(i => i.code === code 
                                              || `${i.code}.${i.market}` === code);
        if (quote) {
            d = { ...quote, historySeries: [], dataSources: {} };
        }
    }
    if (!d) return; // 真的找不到才放弃
    // ... 打开模态框
    ensureModalTrendData(d);  // 异步拉 K 线
}
```

### 决策 4：异步 K 线加载策略

```
渲染顺序：
1. 立即渲染模态框 header + body（含 loading 占位的趋势区）
2. setTimeout 80ms 后 renderIdxModalTrend(d)
   - 如果 d.historySeries.length >= 2 → 直接渲染
   - 否则 → 显示 loading 骨架屏 + 触发 ensureModalTrendData
3. ensureModalTrendData 完成后回写 d.historySeries
   → 再次 renderIdxModalTrend
```

**关键：**
- loading 状态有明确视觉反馈（骨架屏 + "正在加载历史趋势数据…"文案）
- 拉取成功后回写 `indexQuotesData[i].historySeries` 与 `dashboardData[i].historySeries`（如有）
- 失败后趋势区显示 error + 「重试」按钮，点击后重新触发 ensureModalTrendData

### 决策 5：K 线缓存写回多个数据池

```js
async function ensureModalTrendData(d) {
    if (Array.isArray(d.historySeries) && d.historySeries.length >= 2) return d;
    const fullCode = `${d.code}.${d.market || _inferMarket(d.code)}`;
    try {
        const r = await fetch(`/api/indices/${encodeURIComponent(fullCode)}/klines`);
        const json = await r.json();
        if (!json.success) throw new Error(json.error);
        const history = json.data.historySeries || [];
        d.historySeries = history;
        d.dataSources = d.dataSources || {};
        d.dataSources.kline = {
            label: json.data.sourceLabel,
            source: json.data.source,
            usedStaleCache: json.data.stale,
        };
        // 回写其他数据池（让下次访问命中）
        _patchHistorySeries(indexQuotesData, d.code, history);
        _patchHistorySeries(dashboardData, d.code, history);
        _patchHistorySeries(indexData, d.code, history);
        return d;
    } catch (err) {
        throw err; // 让调用方决定显示 error 还是 fallback
    }
}
```

### 决策 6：错误态设计 — 三段式信息

```
┌─────────────────────────────────────────────────┐
│  ⚠️ 历史趋势数据暂时无法获取                     │
│                                                  │
│  原因：东方财富 / 腾讯 / Yahoo 三方数据源均超时   │
│                                                  │
│  [🔄 重试]                                       │
└─────────────────────────────────────────────────┘
```

**重试按钮逻辑**：
- 重置该范围按钮（保留用户选择的 range）
- 设置趋势区 loading 状态
- 再调一次 `ensureModalTrendData(d)`
- 后端的 `_klineCache` 仍有 10 分钟 stale 缓存窗口 → 重试不一定走外网，可能秒返回

### 决策 7：loading 视觉 — 骨架屏 + 文案

```html
<div class="featured-chart-loading">
    <div class="kline-skeleton-svg">
        <div class="kline-skeleton-bar"></div>
        <div class="kline-skeleton-bar" style="height:60%"></div>
        ...
    </div>
    <div class="kline-skeleton-label">📈 正在加载历史趋势数据…</div>
</div>
```

CSS 用 `@keyframes shimmer` 制造扫光动画。骨架屏高度 = 趋势图高度 220px，避免 layout shift。

### 决策 8：避免重复请求（请求级去重）

```js
const _modalTrendInFlight = new Map(); // code → Promise

async function ensureModalTrendData(d) {
    const key = d.code;
    if (_modalTrendInFlight.has(key)) return _modalTrendInFlight.get(key);
    const p = (async () => { ...fetch... })();
    _modalTrendInFlight.set(key, p);
    try { return await p; } finally { _modalTrendInFlight.delete(key); }
}
```

防止用户快速切换 range 时多次并发请求同一 code。

## Risks / Trade-offs

- **[Risk] 后端 fetchIndexHistory 单指数仍可能 3-5s（首次未缓存）** → 用户感知"加载慢"
  → **Mitigation**：loading 骨架屏有动画反馈；模态框其他区域（价格、PE）立即可见，体验上 trend 区是"渐进增强"

- **[Risk] watchlist 中含异常指数（如代码错误）→ 后端 404** → 前端需要正确显示 error
  → **Mitigation**：error 提示包含"该指数可能数据源暂不支持"文案

- **[Risk] 用户快速点击多个不同指数 → 多个 inflight 请求并发** → 服务器压力
  → **Mitigation**：服务端 `_klineCache` 已有"同 cacheKey 复用 Promise"逻辑（getFreshKlinesEntry）；客户端再加一层去重，双保险

- **[Risk] 内存缓存写回多个数据池时性能** → 看似 3 次数组遍历
  → **Mitigation**：每个数据池最多 20 项（watchlist 上限），3 次遍历 < 1ms，可忽略

- **[Trade-off] 不做 IndexedDB 持久化**
  → 接受：页面刷新后重新拉，但有服务端缓存命中，多数情况 < 200ms

- **[Trade-off] 仍保留 ensureFullIndexData 路径**
  → 接受：市场风向标的批量加载逻辑不动；新接口只为模态框打开的单指数按需加载服务，两者互补

## Open Questions

- **Q：是否需要"自动重试"机制（如 1 次失败后 3 秒自动重试）？**
  → 暂不做；用户感知 loading 5s 已极限，自动重试可能拖到 10s+ 反而更糟
  → 让用户手动点「重试」按钮，可控

- **Q：是否要在错误态展示具体失败的数据源（"东财超时，腾讯成功"）？**
  → 暂不做；用户主要看图，技术细节可在控制台 console.warn
