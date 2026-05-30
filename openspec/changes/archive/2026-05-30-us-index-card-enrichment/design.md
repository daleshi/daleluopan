## Context

**当前现状（基于实测 cache）：**

```
SPX.US (标普500) 的 cache 状态:
  data/cache/index-quotes.json:
    high52w: null, low52w: null, changeMonth: null, change3Month: null  ❌
  data/cache/indices.json:
    high52w: 7599.38, low52w: 5861.43
    high10y: 7599.38, low10y: 1991.68
    sparkData.length === 30, historySeries.length === 2520  ✅
```

**数据流路径（关键认知）：**

```
启动时:
  fetchAllIndexData()  ──→  K 线全量计算 ──→  data/cache/indices.json (重)
  fetchIndexQuotesForWatchlist()  ──→  快路径仅 quotes ──→  data/cache/index-quotes.json (轻)

前端实时渲染走 /api/indices/quotes  ──→  index-quotes.json
  ⚠ 没合并 indices.json 中的 K 线统计 → 美股卡片字段全 null
```

**约束：**
- 不能新增外部 API 调用（避免延迟与稳定性风险）
- 不能改造 `fetchAllIndexData` 调度（影响面太大）
- 不能引入新依赖（项目坚持极简栈）
- A 股 / 港股 / 主动基金等其他卡片**视觉零变更**

## Goals / Non-Goals

**Goals:**
- 把 `indices.json` 已有的美股 K 线统计数据透出到 watchlist 接口
- 美股卡片新增 4 类决策性信息（52w 区间条、3 列动量、回撤、Sparkline）
- 保持卡片高度可控（移动端不破版）
- 零新增数据请求

**Non-Goals:**
- 不引入 PE TTM / Shiller PE 等新数据源（multpl.com 等单开 change）
- 不引入 VIX 恐慌指数
- 不修改 A 股 / 港股卡片
- 不改造 `openIdxDetailModal` 详情弹窗
- 不实现交互式 sparkline（鼠标 hover 显示具体值），仅静态展示

## Decisions

### 决策 1：数据源 — 读取 `indices.json` 合并到 watchlist 响应

**选择**：在 `fetchIndexQuotesForWatchlist` 末尾合并 `indices.json`，仅美股记录启用。

**备选 A**：在 `fetchAllIndexData` 启动调度里也写入 `index-quotes.json` → 否决，会污染 quotes 缓存职责
**备选 B**：前端发两次请求（一次 quotes 一次 indices）→ 否决，增加前端复杂度且 indices 接口很重

```
合并逻辑：
  const indicesCacheData = readDiskCache('indices');  // 已有工具
  const indicesByCode = new Map(indicesCacheData.indices.map(i => [i.code, i]));
  // 在 results.map 内对美股记录补字段
  if (idx.market === 'US') {
    const fullCode = `${idx.code}.${idx.market}`;
    const enriched = indicesByCode.get(fullCode);
    if (enriched) {
      result.high52w = enriched.high52w;
      result.low52w = enriched.low52w;
      result.sparkData = enriched.sparkData;
      // historySeries 仅用于动量计算，不返回前端（节省 payload）
      Object.assign(result, computeMomentum(enriched.historySeries));
    }
  }
```

**为什么仅美股启用合并**：
- A 股 quotes 已有完整 PE/PB/温度（信息密度足够）
- 港股 quotes 已有 high52w + PE/PB
- 美股是唯一"卡片偏空"的市场
- 限定美股可降低 `index-quotes.json` payload 体积（A股 6 个 + 港股 1 个不增字段）

### 决策 2：动量字段计算逻辑

**选择**：基于 `historySeries`（按日期升序）末尾相对位置计算。

```js
function computeMomentum(historySeries) {
  if (!historySeries || historySeries.length === 0) {
    return { changeMonth: null, change3Month: null, change6Month: null, changeYear: null, drawdownFromHigh52w: null };
  }
  const last = historySeries[historySeries.length - 1].close;
  const pickAgo = (days) => {
    const idx = historySeries.length - 1 - days;
    return idx >= 0 ? historySeries[idx].close : null;
  };
  const pct = (now, prev) => prev ? ((now - prev) / prev) * 100 : null;

  // 交易日近似：1 月 ≈ 21 日，3 月 ≈ 63，6 月 ≈ 126，1 年 ≈ 252
  const m1 = pickAgo(21);
  const m3 = pickAgo(63);
  const m6 = pickAgo(126);
  const y1 = pickAgo(252);

  // 距 52 周高回撤
  const last250 = historySeries.slice(-250);
  const high52w = Math.max(...last250.map(k => k.close));
  const drawdown = high52w > 0 ? ((high52w - last) / high52w) * 100 : null;

  return {
    changeMonth: pct(last, m1),
    change3Month: pct(last, m3),
    change6Month: pct(last, m6),
    changeYear: pct(last, y1),
    drawdownFromHigh52w: drawdown != null ? parseFloat(drawdown.toFixed(2)) : null,
  };
}
```

**注意**：`high52w` 用 `historySeries.slice(-250).max(close)`，与 `indices.json` 中可能存在轻微差异（后者用 `high` 字段）—— 这是**有意设计**：close 高点对动量分析更稳定（剔除盘中插针）。展示用的 `high52w` 仍取 `indices.json` 原值（保持与详情页一致）。

### 决策 3：卡片视觉布局 — 4 块紧凑信息

```
┌───────────────────────────────────────────────────┐
│  [icon]  名称                          价格        │
│  代码     [美股] [水位标签]            涨跌%       │
├───────────────────────────────────────────────────┤
│  ┌─ 区块 1：今开/昨收（保留） ────────────────┐   │
│  │  今开 X.XX    昨收 X.XX                    │   │
│  └────────────────────────────────────────────┘   │
│  ┌─ 区块 2：52w 区间条（新增）──────────────┐    │
│  │  低 5861 ────●──── 高 7599 (距高 -0.25%) │    │
│  │  [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓●░░░]                │    │
│  └────────────────────────────────────────────┘   │
│  ┌─ 区块 3：水位百分位（保留）────────────────┐   │
│  │  52w 价格水位  99.7% [偏高]                │   │
│  │  [████████████████████████░░░]             │   │
│  └────────────────────────────────────────────┘   │
│  ┌─ 区块 4：动量 3 列（改造）───────────────┐    │
│  │  近1月 +2.1%   近3月 +6.4%   近1年 +21.3%│    │
│  └────────────────────────────────────────────┘   │
│  ┌─ 区块 5：30 天 Sparkline（新增）──────────┐   │
│  │  ▁▂▃▅▆▇█▇▆▅▆▇█▇▇█▇▆▇▇▇▇▇▇▇█▇▇▇▇          │   │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

**为什么不做 6 月 / 3年累计涨幅**：避免动量列横向溢出；6 月数据放在详情弹窗即可。

### 决策 4：Sparkline 实现 — 纯 SVG，无依赖

**选择**：用 `<svg viewBox>` + `<polyline points="">` 一行渲染，主色按"近 1 月涨跌"决定（涨绿跌红）。

**否决**：Canvas（需要计算 DPR）、Chart.js（引入新依赖）、ASCII 字符（响应式糟糕）。

```js
function buildSparkline(sparkData, momentumDir) {
  if (!sparkData || sparkData.length < 2) return '';
  const w = 100, h = 28;  // viewBox 单位
  const min = Math.min(...sparkData);
  const max = Math.max(...sparkData);
  const range = max - min || 1;
  const step = w / (sparkData.length - 1);
  const points = sparkData.map((v, i) => {
    const x = (i * step).toFixed(2);
    const y = (h - ((v - min) / range) * h).toFixed(2);
    return `${x},${y}`;
  }).join(' ');
  const stroke = momentumDir === 'up' ? 'var(--accent-green)' : 'var(--accent-red)';
  return `<svg class="idx-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5" />
  </svg>`;
}
```

**色彩选择**：以 `changeMonth >= 0` 判断而非"卡片当日涨跌"，因为 sparkline 本身是 30 天数据，月度方向更自洽。

### 决策 5：52w 区间条视觉 —— 圆点 + 渐变背景

**选择**：水平条 = 灰色背景，深色填充覆盖"低 → 当前价"位置，圆点 ● 标记当前价，右侧文字显示距高回撤。

```css
.idx-range-bar {
  position: relative; height: 6px; border-radius: 3px;
  background: linear-gradient(to right, var(--accent-red-dim), var(--accent-green-dim));
  margin: 4px 0;
}
.idx-range-bar-marker {
  position: absolute; top: -2px; width: 10px; height: 10px;
  border-radius: 50%; background: var(--accent-blue);
  border: 2px solid var(--bg-card);
  transform: translateX(-50%);
}
```

`marker.style.left = (price - low52w) / (high52w - low52w) * 100 + '%'`

**否决**：纯填充进度条（容易被误读为"水位"，与下方水位条职责重复）；渐变改用绿→红方向（红绿色盲不友好）。

### 决策 6：水位标签徽章 — 在头部 [美股] 旁加一个

```
当前: [美股] [—]            ← evaTag 显示 '—' 因为美股 evaType 由水位推导
改为: [美股] [偏高]/[偏低]/[中性]   ← 复用现有 evaType 逻辑（已有 low/mid/high）
```

实际**前端代码已经在做**（第 10008 行 `<span class="idx-eva-tag ${evaTagClass}">${_evaLabel(evaType)}</span>`），只是因为 `evaType` 在 watchlist 接口中通过 `usValuationInfo` 推导，而我们补齐 `pePercentile` 后逻辑会自动生效（详见 `dataFetcher.js:2244-2251`）。**无需新增前端代码**，本次后端补齐 high52w/low52w 即可触发。

### 决策 7：缓存读取的稳健性

`indices.json` 可能不存在（首次启动尚未 fetchAllIndexData）或解析失败 —— 必须优雅降级：

```js
let indicesCacheData = null;
try {
  indicesCacheData = readDiskCache('indices');  // 已有工具
} catch (e) {
  console.warn('  [行情] 读取 indices.json 失败，跳过美股增强:', e.message);
}
const indicesByCode = indicesCacheData?.indices
  ? new Map(indicesCacheData.indices.map(i => [i.code, i]))
  : new Map();
// 后续 indicesByCode.get() 拿不到就跳过增强，不影响主流程
```

## Risks / Trade-offs

- **[Risk] indices.json 比 quotes 更新频率低（默认刷新间隔不同）** → 美股 high52w 可能滞后
  → **Mitigation**：高 52 周变动是低频事件，T+0 滞后可接受；详情弹窗读 indices.json 同源数据无差异

- **[Risk] sparkData 是 30 天 close，但展示时与"近 1 月涨幅"语义略有不同（21 日 vs 30 日）** → 视觉与数字可能轻微不一致
  → **Mitigation**：sparkData 已有，本身是历史决策；本次不动；视觉差异 < 5%，用户不会困惑

- **[Risk] `historySeries.length` 在某些日期下不足 252（如新指数刚上市）** → `changeYear` 会返回 null
  → **Mitigation**：`pickAgo` 已做边界保护，返回 null；前端原本就有 `changeYear == null ? '--' : ...` 的兜底分支

- **[Risk] Sparkline 在极端行情（30 天巨幅涨跌）下，小波动看不清** → 视觉信息损失
  → **Mitigation**：min/max 自适应缩放，不强制 0 基线；信息损失可接受（详细走势进详情弹窗）

- **[Risk] 卡片高度增加，A 股/港股/美股 idx-summary-grid 的格子高度不一致** → 视觉错位
  → **Mitigation**：现有 CSS grid `auto-fill, minmax(360px, 1fr)` 自然容纳不等高卡片；移动端 `< 480px` 全单列；可接受

- **[Trade-off] 仅美股启用合并 vs 全部市场启用** → 选择前者牺牲一致性，换得 payload 体积可控
  → 接受：A 股/港股不需要 sparkline 与回撤（PE/PB/温度更有决策价值）

- **[Trade-off] 不引入 PE TTM** → 美股估值仍只能通过价格水位推断，不够精确
  → 接受：作为单独 change 处理，避免本次外部依赖风险

## Open Questions

- **Q：是否应该在卡片底部加一个"📅 距 ATH X.XX% / 当前 5Y 高位"等长周期信号？**
  → 暂不做；详情弹窗复用 `historySeries` 已能呈现，避免卡片信息超载

- **Q：indices.json 缓存陈旧时是否需要给 sparkline 加 stale 标记？**
  → 暂不做；30 天数据陈旧 1~2 天对决策影响极小；如未来出现极端场景再加
