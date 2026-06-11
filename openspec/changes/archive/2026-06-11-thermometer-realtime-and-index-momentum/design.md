## Context

`services/dataFetcher.js` 当前通过 HTML 抓取 youzhiyouxing.cn 获取温度计数据，使用固定 10 分钟内存缓存（`_yzyxCache` / `_yzyxDetailCache`）。叠加：

1. 磁盘缓存 `data/cache/daily-eval.json`（无明确过期，启动时直接采用）。
2. `server.js` 两阶段启动：Phase 1 直接喂磁盘缓存，Phase 2 后台异步刷新但**不抢占内存 TTL**。
3. youzhiyouxing.cn 数据本身确为日内多次更新（用户在官网可看到分时变化）。

三者叠加使用户在工作日盘中看到的温度可能仍是数小时前甚至上一交易日的快照，且系统**没有任何 UI 提示**说明数据何时被抓取。同时温度计 Tab 没有"强制刷新"入口，运维难以快速验证修复。

同样的情况也出现在蛋卷 Wind / 亿牛网 / ETF.run 等估值源——它们的 PE 数据虽然变化频率较低，但缺乏 `fetchedAt` 透出，用户与后续维护者无法判断数据新鲜度。

指数卡片现有 momentum：`/api/indices/quotes` 中仅美股指数透出 `momentum1m` / `momentum3m`（在 `enrichUSIndexQuote` 路径），A 股 / 港股的 `historySeries` 已经在后端可得（用于 K 线图与温度详情），但未被复用计算多周期动量。

## Goals / Non-Goals

**Goals:**

1. 让用户在交易时段看到的「有知有行」温度与官网误差不超过 **1 分钟**（A 股开盘时段）/ **5 分钟**（仅港美股开盘）/ **30 分钟**（全部休市）。
2. 在响应与前端 UI 中清晰透出 `fetchedAt` 与 `stale` 状态，可见且可疑问可追溯。
3. 提供管理员可用的强制刷新通道，便于运维排障。
4. 所有市场指数卡片统一展示 4 周期动量（1m / 3m / 6m / 1y），无需用户打开详情模态框即可对比。
5. 后端集中计算 momentum，**不**在前端重复实现，避免 historySeries 双发。

**Non-Goals:**

- 不替换 youzhiyouxing.cn 为第三方付费数据源（HTML 抓取保留）。
- 不改造 `daily-eval.json` 的磁盘缓存结构（仅做向后兼容的字段补充）。
- 不改动既有 `enrichUSIndexQuote` 中的 52 周 / Sparkline 字段口径。
- 不引入新的图表类型（动量仍以文字徽章呈现）。
- 不修改 `isTradingHours()` 的语义（沿用 `unified-data-refresh-scheduler` capability 中已支持的市场数组参数）。

## Decisions

### D1：TTL 计算函数复用 `isTradingHours(['CN','HK','US'])`

**选择**：在 `fetchYZYXThermometer()` 与 `fetchYZYXIndexDetail()` 开头调用统一 helper：

```js
function getThermometerTTL() {
  if (isTradingHours(['CN'])) return 60 * 1000;          // A 股开盘 60s
  if (isTradingHours(['HK','US'])) return 5 * 60 * 1000; // 港美股 5min
  return 30 * 60 * 1000;                                  // 全休市 30min
}
const MAX_TTL = 4 * 60 * 60 * 1000;                       // 兜底 4h
```

**理由**：
- 直接复用现有交易时段判定函数，避免维护两套时区逻辑。
- A 股开盘 60s TTL 与首页/卡片轮询（3~5s）有数量级差距，不会带来明显 HTTP 压力（外站，每分钟一次完全可接受）。
- 4 小时兜底用于防止某个长尾 bug 让缓存永不刷新。

**Alternatives considered**：
- 复用 server.js 的 `getCacheTTL()` —— 但该函数仅区分 A 股开/休市，无法表达"仅美股开盘"的中间态。

### D2：响应字段命名一致沿用 `kline-source-resilience` 风格

`thermometer.source ∈ {'youzhiyouxing-data', 'youzhiyouxing-thermometer', 'stale-cache'}`、`thermometer.stale: boolean`、`thermometer.fetchedAt: ISOString`，与 K 线 API（`source: 'eastmoney' | 'tencent' | 'yahoo' | 'stale-cache'`）保持同形，前端可复用现成 source label 显示组件。

### D3：强制刷新通道双入口

- 公开通道：`GET /api/daily-eval?refresh=1` —— 任何人可触发（同既有用户体验，与 `/api/indices/quotes?refresh=1` 一致）。
- 管理员通道：`POST /api/thermometer/refresh` —— 仅清空 `_yzyxCache` / `_yzyxDetailCache` 并返回拉取结果，便于运维独立验证。

**理由**：公开 GET 用于解决普通用户"看到的不对"，POST 端点用于排障与日后接入"管理员手动刷新"按钮。POST 需 `requireAdmin`。

### D4：momentum 后端计算位置

在 `fetchAllIndexData()` / `fetchIndexQuotes()` 的 results.map 内统一调用：

```js
function calcMomentum(historySeries, days) {
  if (!Array.isArray(historySeries) || historySeries.length <= days) return null;
  const last = historySeries[historySeries.length - 1]?.close;
  const past = historySeries[historySeries.length - 1 - days]?.close;
  if (!last || !past) return null;
  return Number(((last - past) / past * 100).toFixed(2));
}
// 21 / 63 / 126 / 252 交易日
```

适用全市场。美股 `enrichUSIndexQuote` 内现有 `momentum1m/3m` 改为复用该函数（保证口径一致）。

### D5：前端徽章渲染统一在 `renderIndexQuotesGrid`

新增一段 HTML：

```html
<div class="idx-card-momentum-row">
  <span class="idx-mm-cell"><b>1月</b> {{momentum1m}}</span>
  <span class="idx-mm-cell"><b>3月</b> {{momentum3m}}</span>
  <span class="idx-mm-cell"><b>6月</b> {{momentum6m}}</span>
  <span class="idx-mm-cell"><b>1年</b> {{momentum1y}}</span>
</div>
```

CSS Grid `repeat(4, 1fr)`，移动端 `repeat(2, 1fr)` 自动换行。

## Risks / Trade-offs

- **[Risk] 60s TTL 让 youzhiyouxing.cn 一天可能被请求上千次** → Mitigation：仅在 A 股开盘 4h 内生效，外站负担每秒最多 1/60 请求，且 youzhiyouxing.cn 是公开数据页，可接受；如出现风控，回退到 120s。
- **[Risk] HTML 解析破坏** → Mitigation：保留两条 URL（`/data` 与 `/thermometer`）以及磁盘 stale 回退；解析失败时**不更新** `_yzyxCacheTime`，下次请求继续重试。
- **[Risk] 用户高频点击触发 refresh 导致外站封禁** → Mitigation：`GET /api/daily-eval?refresh=1` 在后端加 IP 维度 5 秒节流（同 IP 5 秒内多次 refresh 仅触发一次实际抓取），其余请求直接返回当前内存值。
- **[Risk] momentum 计算 256 个交易日切片在 historySeries 不足的非主流指数上恒为 null** → Mitigation：在响应中保留 null（前端显示 `--`），不影响其他周期；将来可考虑回退到月度收盘价计算近 1 年。
- **[Risk] 前端 4 列徽章在窄屏溢出** → Mitigation：CSS `display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;`，移动端断点切换为 2 列。
- **[Trade-off] 不引入新的"今年以来"字段** → 保留美股已有的 `ytdChange` 在美股 3 列原徽章内，避免与新行重复；其它市场暂不补 YTD，等待用户反馈。

## Migration Plan

1. **后端先行（无 Breaking）**：实现 `getThermometerTTL()`、`calcMomentum()`，扩展响应字段。前端在新字段缺席时仍按旧逻辑渲染（向后兼容）。
2. **前端跟进**：温度计 Tab 增"更新于 + stale 徽章"；指数卡片增多周期动量行。
3. **管理员端点**：`POST /api/thermometer/refresh` 末位接入，避开主链路风险。
4. **回滚**：仅需 `git revert` 单个 commit；磁盘缓存格式向后兼容，无需数据迁移。
5. **验证**：
   - PM2 重启后 `curl /api/daily-eval | jq .thermometer.fetchedAt`，反复请求观察 TTL 触发。
   - 浏览器 DevTools 检查 A 股开盘时段 60s 内是否触发一次新 HTTP（外部域 youzhiyouxing.cn）。
   - 对比 youzhiyouxing.cn 官网温度数字，误差 ≤ 1 分钟波动。

## Open Questions

- 是否给"温度计 Tab 标题旁"也加一个普通用户可见的"立即刷新"按钮？（当前先只接入 `?refresh=1` URL 通道与管理员 POST 端点；按钮可在后续 UX 优化批次再加）
- `dataSources[].fetchedAt` 是否需要持久化到 `daily-eval.json` 以便冷启动也带历史时间？（本次先在响应中标记 `stale=true`，下个改动再考虑）
