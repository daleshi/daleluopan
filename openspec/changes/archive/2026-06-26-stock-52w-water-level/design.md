## Context

`services/stockFetcher.js` 当前为每只关注股票拉取**最近 60 个交易日**的日线 K 线（用于卡片底部的 30 日 sparkline），并基于这 60 条 K 线计算 `high52w` / `low52w` 字段对外透出——**字段名"52w"误导，实际只是近 60 日高低**。

前端 `buildStockCardHtml()` 当前不消费 `high52w` / `low52w`，即使消费也是错误的。要满足"52 周最高/最低 + 当前价格水位"需求，必须：

1. 将 K 线获取条数提升到约 252（一年交易日数），保证字段名实相符。
2. 新增 `pricePosition52w` 字段，避免前端重复计算。
3. 在卡片上加一行"水位条"，复用 ETF 详情模态框已有的视觉模式。

数据源情况：
- 东方财富 push2his K 线接口已支持 `lmt=2520`（指数也用同接口拉 10 年），改 lmt=252 完全没问题。
- 腾讯 K 线 fallback `fetchTencentStockKlines(code, market, limit=60)` 默认 60，调用处改为 252 即可（接口原生支持更高）。
- 内存缓存 `_stockKlineCache` 按 `cacheKey={code}.{market}` 存，不区分 limit；改造后第一次请求每股多拉 192 条数据，耗时增加但只发生一次。

## Goals / Non-Goals

**Goals:**

1. `high52w` / `low52w` 字段语义与名称一致——基于近 ~252 个交易日 K 线计算。
2. 后端集中计算 `pricePosition52w` 百分位，避免前端重复计算 / 多端不一致。
3. 股票卡片新增 52 周水位条 UI，视觉统一，移动端不溢出。
4. 数据缺失时优雅降级（整行隐藏），不影响既有卡片元素。

**Non-Goals:**

- 不引入新的 K 线数据源。
- 不改 sparkline 视觉（仍是 30 日）；只切片复用 K 线尾部。
- 不改造其它市场（指数、ETF、基金）的水位/52w 逻辑——它们已有各自方案。
- 不在卡片上添加日期范围选择（"近 1 年 / 3 年"切换），保持卡片精简；详情模态框可以是后续迭代。
- 不在响应中输出完整 252 条 K 线（仅服务端使用，落到字段后即可丢弃）。

## Decisions

### D1：K 线拉取条数 60 → 252

**选择**：将 `fetchAllStockData()` 中的 `fetchResilientStockKlinesDetailed(stock, 60)` 改为 `fetchResilientStockKlinesDetailed(stock, 252)`；同时把 `fetchResilientStockKlinesDetailed` / `fetchResilientStockKlines` / `fetchStockKlines` / `fetchTencentStockKlines` 的默认 limit 都改为 252，保持调用链一致。

**理由**：

- 252 ≈ 一年交易日数（中国 A 股年度约 244–250 交易日，留余量到 252）。
- 东财 / 腾讯接口都原生支持，无需特殊参数。
- sparkData 仍只截取末尾 30 条（`klines.slice(-30).map(k => k.close)`），前端 mini 走势图无视觉变化。
- 缓存命中后无成本（_stockKlineCache 复用同 key）。

**Alternatives considered**：

- 保留 60 条 K 线 + 单独再发起 252 条请求计算 52w：徒增请求次数；放弃。
- 用 250 条：和"52 周"概念稍微偏差；业界常用 252。

### D2：`pricePosition52w` 在后端计算并以百分比形式（保留 1 位小数）输出

**选择**：

```js
function computePricePosition52w(price, low52w, high52w) {
    if (price == null || low52w == null || high52w == null) return null;
    if (!(high52w > low52w)) return null;  // 区间退化（停牌等）
    const raw = ((price - low52w) / (high52w - low52w)) * 100;
    const clamped = Math.max(0, Math.min(100, raw));
    return Number(clamped.toFixed(1));
}
```

**理由**：

- 保留 1 位小数符合"水位"语义（百分比通常 0–100），减少前端 toFixed 调用。
- 截断到 [0, 100]：盘中价突破历史高点 / 跌破历史低点（K 线尚未更新）时不返回越界值，前端可放心地用作 CSS `left:` 百分比。
- 区间退化时返回 null，前端可整行隐藏（D3）。

### D3：前端"数据缺失整行隐藏"而非占位

**选择**：在 `buildStockCardHtml()` 中，仅当 `s.pricePosition52w != null && s.high52w != null && s.low52w != null` 才输出 `.stock-52w-row` 元素。

**理由**：

- 占位横线会让卡片视觉割裂；新股 / 停牌 / 数据源失败的情形下整行隐藏更干净。
- 卡片高度变化由 CSS Grid 自动处理（不固定高度）。

### D4：复用 ETF 水位条配色，新建独立 CSS 类

**选择**：CSS 类命名 `.stock-52w-row`、`.stock-52w-label`、`.stock-52w-bar`、`.stock-52w-fill`、`.stock-52w-cursor`、`.stock-52w-badge`，配色与 `.etf-detail-52w-*` 一致：

- 背景渐变：`linear-gradient(90deg, var(--green-value), var(--accent-gold), var(--red-danger))`
- 游标：`background: var(--accent-blue); border: 2px solid var(--bg-card)`

**理由**：

- 不复用 `.etf-detail-52w-*` 类名是因为股票卡片更紧凑（高度 6px → 4px、字号缩小），而 ETF 是详情模态框尺寸；保留独立命名空间避免互相干扰。
- CSS 变量保证主题切换自动适配。

### D5：移动端断点 ≤480px 紧凑布局

**选择**：

```css
@media (max-width: 480px) {
    .stock-52w-row { gap: 6px; }
    .stock-52w-label { font-size: 10px; }
    .stock-52w-badge { font-size: 10px; padding: 1px 4px; }
}
```

**理由**：股票总览页常在手机上浏览，紧凑模式确保单卡内容不溢出。

## Risks / Trade-offs

- **[Risk] K 线条数 60→252 导致首次启动 / 强刷拉取时间增加** → Mitigation：仍是单次 HTTP 请求，体积增大约 4 倍；东财批量接口实测响应在 200–400ms（vs 60 条的 100–200ms），可接受。
- **[Risk] 部分港股 / 新股没有完整 252 条 K 线** → Mitigation：用实际可得 K 线数计算 high52w / low52w；scenario "K 线不足 252 时按实际数据计算"明确这一点。
- **[Risk] 内存中 `_stockKlineCache` 单条体积增大** → Mitigation：每 K 线条目约 80 字节 JSON，单股 252 条 ≈ 20KB，关注股票上限 20 只 ≈ 400KB，可忽略。
- **[Trade-off] 不在卡片上加详情模态框入口** → 用户已可点击卡片打开 `/stock/<code>` 看详情；本次只解决"快速一眼判断当前价位是否高位"。

## Migration Plan

1. **后端先行**：
   - 修改 `services/stockFetcher.js` 中 K 线 limit 默认值 → 252。
   - 新增 `computePricePosition52w()` helper 与字段透出。
2. **前端跟进**：
   - 在 `buildStockCardHtml()` 添加 52 周水位条 HTML 模板。
   - 新增 `.stock-52w-*` 样式与移动端断点。
3. **缓存清理**：无需清理，旧缓存 60 条 K 线第一次响应即被新请求覆盖。
4. **回滚**：单 commit revert；K 线 limit 改回 60，前端隐藏新行。
5. **验证**：
   - `curl /api/stocks | jq '.data.stocks[0] | {price, high52w, low52w, pricePosition52w}'` 检查字段；
   - 浏览器对照东方财富个股页面的"52 周最高/最低"，应一致；
   - 手机端打开股票总览，确认水位条不溢出。

## Open Questions

- 是否需要在 hover 时显示距 52w 高/低的百分比偏差（如 "距高 -25%"）？暂不实现，留待后续 UX 迭代。
- 是否要把 historySeries 写入磁盘缓存？暂不需要——只用作衍生统计后即可丢弃，不在响应中携带，节省体积。
