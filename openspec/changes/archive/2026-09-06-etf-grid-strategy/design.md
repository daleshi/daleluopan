## Context

用户希望在项目内新增"ETF 等比对称网格交易策略"功能，与现有的 5 类单向策略（ETF 定投 / 黄金定投 / 主动基金 / 标普500 / 温度计定投）并列。网格交易与定投是**心智模型完全不同**的两套系统：

| 维度 | 现有 ETF DCA | 本次 ETF 网格 |
|---|---|---|
| 触发 | 时间（每月）+ 价格档位（5 档） | 纯价格（触碰网线） |
| 方向 | 只买不卖（累积期） | 双向：涨卖跌买 |
| 收益来源 | 长期价值上涨 + 分红 | 波动率 × 网格数 × 单轮净利 |
| 数学模型 | 阶梯档位（离散分区） | 等比网格 `P = P₀ × (1+δ)^n` |
| 建议决策 | 每月投多少 | 距最近网线多远、下一步买/卖 |

用户在探索过程中明确了以下设计约束：

1. **等比对称网格**：一个 `gridStep` 参数（如 5%）定义步长，上下网线相对中线成等比数列
2. **完全可配置**：所有字段（step、levels、basePrice、totalBudget、baseAmount、amountPerGrid、保护开关）由用户在 UI 表单输入；**代码不预置任何默认策略**，首次启动数据文件为空
3. **无"买卖比例"字段**：等比对称网格天然对称，多一个字段徒增复杂度
4. **手动记账**：与既有 `etf-holdings.json` 模式一致，系统只提供信号提示，不接券商
5. **中线固定 + 可手动重置**：默认锚在启动时价格；单边行情后管理员点"重置中线"开启新一轮
6. **策略修改 = 新一轮**：修改任一配置弹窗二次确认，历史成交锁定不参与新计算
7. **按元金额触发**：`amountPerGrid` 单位为元（如 5000 元/格），触发时估算份数

## Goals / Non-Goals

**Goals:**

1. 新建独立 capability `etf-grid-strategy`，与既有 `etf-dca-strategy` 完全隔离
2. 后端提供 8 个 API 覆盖 CRUD + 重置中线 + 实时推荐
3. 前端在"投资策略"Tab 新增 SubTab，展示每只策略的实时网格状态与完整价位表
4. 完整支持保护机制（温度暂停、连续买入冷却）作为可选配置
5. 分别透出 3 类盈亏统计（底仓浮盈 / 网格已实现 / 网格未平仓浮动）
6. 首次启动零预置，用户完全掌控何时何配置启动

**Non-Goals:**

- 不接入券商 API，不实现自动下单
- 不做等差 / 估值锚定网格（仅等比对称）
- 不做全局资金池管理（每只策略独立预算）
- 不迁移或影响既有 `etf-strategy.json` / `etf-holdings.json`
- 不改变现有 5 类策略的任何行为
- 不支持"部分卖出"（每次触发即按 `amountPerGrid` 全额执行）

## Decisions

### D1：数据模型分层——策略配置 vs 事件流

**选择**：沿用项目已有的"配置 + 事件流"双文件模式：

```
data/etf-grid-strategy.json         ← 策略配置（用户可编辑，upsert）
{
  "strategies": [
    { fundCode, gridStep, gridLevels, basePrice, totalBudget, baseAmount,
      amountPerGrid, feeRate, pauseWhenTempAbove, cooldownAfterConsecutiveBuys,
      status, createdAt, updatedAt }
  ]
}

data/etf-grid-holdings.json         ← 成交事件流（追加 + 可删）
{
  "records": [
    { id, fundCode, type: "base"|"buy"|"sell", gridLevel, date,
      price, shares, amount, note, createdAt }
  ]
}
```

**理由**：
- 与既有 `etf-strategy.json` + `etf-holdings.json` / `gold-holdings.json` 结构对齐，运维和代码复用最佳
- 策略配置 = 用户"意图"；成交流 = 实际执行的账本，两者分离清晰
- 网格档位状态（filled/waiting）由事件流实时聚合派生，不入库、不易出现数据不一致

**Alternatives considered**：
- 把已触发网格状态存到策略里 → 否决：违反单一数据源原则；策略配置一改就要同步清理触发状态

### D2：等比对称网格的数学模型

**核心公式**：

```javascript
// 网格价位表生成
function buildGridTable({ basePrice, gridStep, gridLevels }) {
  const table = [];
  // 上侧：+1 .. +gridLevels（卖出网线）
  for (let n = gridLevels; n >= 1; n--) {
    table.push({
      level: n,
      targetPrice: round(basePrice * Math.pow(1 + gridStep, n), 4),
      action: 'sell',
    });
  }
  // 中线
  table.push({ level: 0, targetPrice: basePrice, action: 'base' });
  // 下侧：-1 .. -gridLevels（买入网线）
  for (let n = 1; n <= gridLevels; n++) {
    table.push({
      level: -n,
      targetPrice: round(basePrice * Math.pow(1 + gridStep, -n), 4),
      action: 'buy',
    });
  }
  return table;
}

// 单轮预期净利率（每个买入档位的"跨越 2 网"闭环）
function expectedNetPct(gridStep, feeRate) {
  const grossPct = Math.pow(1 + gridStep, 2) - 1;  // (1+δ)² - 1
  return grossPct - 2 * feeRate;                    // 扣双边手续费
}
```

**理由**：
- 等比：波动率均匀（越低价越密的心理直觉，同时百分比一致）
- 对称：不需要买卖比例参数，配置简洁
- `(1+δ)² - 1` 是网格交易理论收益的经典公式（买 -1 卖 +1 = 跨 2 网）

### D3：三类盈亏分离统计

网格交易的收益构成复杂，简单地"总市值 - 总成本"会误导用户。分成 3 类：

```
   ┌─────────────────────────────────────────────────────┐
   │ 1. 底仓浮盈 (baseFloat)                             │
   │    = 底仓当前市值 − 底仓成本                        │
   │    反映：中长期持仓的市场表现                       │
   │                                                     │
   │ 2. 网格已实现利润 (realized)                        │
   │    = ∑ (每一轮完整闭环的差价 − 双边手续费)          │
   │    反映：网格波段收割的真实收益                     │
   │                                                     │
   │ 3. 网格未平仓浮动 (unrealizedFloat)                 │
   │    = (当前价 × 网格未平仓份额) − 网格未平仓成本     │
   │    反映：已抄底但还没等到卖点的账面盈亏             │
   └─────────────────────────────────────────────────────┘

   总收益率 = (1 + 2 + 3) / 总投入 × 100
```

**闭环配对策略**：**FIFO 先进先出**。假设用户在 -1、-2 各买 5000 元，然后在 +1 卖出 → 配对最早的 -1 买入（先进），-2 保留浮动。

**理由**：
- 用户能清晰看到"网格战术是否成功"（realized 表现），不被大盘涨跌的底仓浮盈掩盖
- FIFO 是最直观的配对规则，无需用户额外配置

### D4：保护机制作为可选配置

两个可选保护开关：

```javascript
// 温度暂停：与既有温度计模块联动
if (strategy.pauseWhenTempAbove != null) {
  const currentTemp = getYzyxMarketTemperature();
  if (currentTemp > strategy.pauseWhenTempAbove) {
    protection = { paused: true, reason: `温度 ${currentTemp}° > 阈值 ${strategy.pauseWhenTempAbove}°` };
  }
}

// 连续买入冷却：防止单边下跌快速套牢
if (strategy.cooldownAfterConsecutiveBuys != null) {
  const { n, days } = strategy.cooldownAfterConsecutiveBuys;
  const recentBuys = holdings.filter(h =>
    h.fundCode === strategy.fundCode &&
    h.type === 'buy' &&
    daysSince(h.date) <= days
  );
  if (recentBuys.length >= n) {
    const cooldownEndsAt = addDays(recentBuys[recentBuys.length - 1].date, days);
    protection = { paused: true, reason: `连续 ${n} 网买入，冷却至 ${cooldownEndsAt}` };
  }
}
```

**理由**：
- 温度联动利用项目已有的核心心法（"温度定投"），把两套体系打通
- 冷却熔断是网格实操中最经典的自我保护技巧
- 都是可选（`null` 表示关闭），符合"完全可配置"要求

### D5：与既有 ETF 定投并存

**选择**：完全独立的数据文件 + API 前缀 + UI SubTab；同一 fundCode 可同时存在于两处配置中。

```
   /api/strategy/etf-plans           ← 定投（已存在）
   /api/strategy/etf-holdings        ← 定投持仓（已存在）
   /api/strategy/etf-grid-plans      ← 网格（新增）
   /api/strategy/etf-grid-holdings   ← 网格持仓（新增）

   前端 SubTab:
   [ETF 投资] [黄金] [主动基金] [标普500] [🕸️ ETF 网格] [温度计] [投资基准]
                                          ↑ 新增
```

**理由**：
- 零回归风险：定投相关代码一行都不改
- 用户在 UI 上明确看到"我这只 ETF 既做定投又做网格"，两套仓位分开算
- 长期来看，用户可能会想跨策略汇总（如"科创50 总投入""科创50 总收益"），但这是 Phase 2 的事，本次不做

### D6：`etf-grid-recommendations` 缓存策略

复用既有 `smartCacheGet` 框架，缓存键 `etf-grid-recommendations`：

| 交易时段（`isTradingHours()`）| TTL |
|---|---|
| A 股开盘 | 30 秒 |
| 休市 | 30 分钟 |

**理由**：
- ETF 网格触发是价格敏感的，交易时段短 TTL 保证信号及时
- 休市时行情不变，长 TTL 减少无谓计算
- 与既有 `etf-recommendations` 缓存策略一致

### D7：网格价位表的视觉呈现

采用**上到下从高档到低档**的表格布局，配"当前价"横线穿插：

```
   +5   1.276   卖 5   [ 待触发 ]                     ¥5,540
   +4   1.216   卖 4   [ 待触发 ]                     ¥1,381
   +3   1.158   卖 3   [ 待触发 ]                     ¥1,079
   +2   1.103   卖 2   [ 待触发 ]                       ¥788
   +1   1.050   卖 1   [ 待触发 ]                       ¥513
   ───────  🎯 当前 ¥1.020  ─────────────────────────────
   ═══  1.000  底仓  ¥40,000
   -1   0.952   买 1   [ ✓ 已触发 ] ¥5,000 @ 0.941
   -2   0.907   买 2   [ 待触发 ]
   -3   0.864   买 3   [ 待触发 ]
   -4   0.823   买 4   [ 待触发 ]
   -5   0.784   买 5   [ 待触发 ]
```

**理由**：
- 上买下卖的传统 K 线视觉直觉（价格向上就卖、向下就买）
- 当前价"穿插"在表格中间用一条横线定位，视觉上清晰
- 已触发档显示成本，未触发档显示预期净利，行动引导明确

### D8：策略修改的语义 —— "新一轮"

**选择**：修改策略配置视为开启新一轮，历史成交锁定：

```
   触发路径：用户点 [编辑]，修改任一字段，点保存
   → 弹窗 "这将开启新一轮网格计算，历史成交记录会锁定到旧版本"
   → 用户确认 → 后端更新 strategy 的字段与 updatedAt
   → 前端刷新，网格价位表按新配置重新绘制
   → 历史 grid-holdings 记录保留展示，但不参与新的 filled/waiting 判定
```

判定"是否属于当前一轮"的规则：`record.createdAt >= strategy.updatedAt`

**理由**：
- 简单可预测，用户明确知道"改配置 = 重开局"
- 避免复杂的"部分兼容 / 差异合并"逻辑
- 历史数据不删，用户可以查看完整交易史

## Risks / Trade-offs

- **[Risk] 单边行情让下侧网格全部套牢**  
  → 用户配的 5 网只能应对 ±25% 波动，超出后无自动漂移。Mitigation：手动重置中线按钮 + 保护机制（连续买入冷却、温度暂停）。用户教育：网格不适合单边趋势市场，建议在震荡区使用。

- **[Risk] 用户对 `(1+δ)² - 1` 收益公式不理解，误认为 δ = 5% 就是每格 5%**  
  → Mitigation：表单实时预览网格价位表时明确显示"单轮预期净利：X%"（已扣手续费），文案强化"跨越 2 网 = 一轮闭环"。

- **[Risk] FIFO 配对在部分卖出场景可能不合直觉**  
  → 本次不支持部分卖出（每次触发即全额），FIFO 配对退化为简单顺序匹配，不会出问题。

- **[Trade-off] 不做全局资金池管理**  
  → 用户如果三只 ETF 各配 10 万，总占用 30 万，系统不做汇总。若资金不足需要用户自己规划。理由：加全局池会大幅增加复杂度，MVP 不做。

- **[Trade-off] 修改策略即"重开局"**  
  → 用户可能希望微调步长而不清空触发历史。理由：语义清晰性 > 灵活性；如果强需求，后续可以加 "仅调整参数不重开" 的开关。

- **[Trade-off] 保护机制的触发信号来自"当次 API 请求时刻"**  
  → 意味着用户看推荐视图时保护生效，但实际下单成交时可能已解除。这是"信号提示 + 手动录入"模式的固有特性，不改。

## Migration Plan

1. **后端先行**：
   - 新增 `data/etf-grid-strategy.json` 与 `data/etf-grid-holdings.json` 初始化逻辑（首次启动创建空文件）
   - 新增 `services/etfGridEngine.js`（网格价位表生成、单轮净利、盈亏计算、保护判定）
   - `server.js` 新增 8 个 API 路由，共享 `readEtfGridStrategies` / `writeEtfGridStrategies` / `readEtfGridHoldings` / `writeEtfGridHoldings` 辅助函数
   - `smartCacheGet('etf-grid-recommendations', ...)` 集成
2. **前端跟进**：
   - `public/index.html` 新增 `data-substrat="etf-grid"` SubTab 按钮 + 完整 section
   - JS 新增 `loadEtfGridPlans() / loadEtfGridRecommendations()` 与渲染逻辑
   - 新增策略配置表单与成交补录表单
   - 新增 CSS 类 `.grid-card / .grid-price-table / .grid-cell-status-*`
3. **数据初始化**：首次部署无需迁移，`etf-grid-strategy.json` 初始化为 `{ "strategies": [] }`
4. **回滚**：单 commit revert；数据文件保留不删（用户已配置的策略仍在磁盘上）
5. **验证**：
   - 用管理员账号登录，添加科创50 / 恒生科技 / 创业板50 三只网格策略
   - 观察网格价位表数学正确性（对比 `basePrice × (1.05)^n`）
   - 补录几笔虚拟成交，验证 realized / unrealizedFloat 计算
   - 移动端查看网格价位表是否可用

## Open Questions

- **是否需要"网格结束/归档"功能？**  
  策略跑了半年后用户想彻底关闭并锁定收益，是"删除"还是"归档"？本次仅提供 `status = "archived"` 字段但不做归档 UI，Phase 2 再补。
- **成交记录是否需要绑定到"策略快照版本"？**  
  当前用 `record.createdAt >= strategy.updatedAt` 判定归属，够用。若未来支持"多次重置中线的历史回顾"，可能需要 explicit 的 `versionId` 字段。
- **网格历史图表？**  
  用户如果想看"这条网格在过去 X 个月的触发轨迹与总收益曲线"，本次未包含。取决于后续 UX 反馈。
