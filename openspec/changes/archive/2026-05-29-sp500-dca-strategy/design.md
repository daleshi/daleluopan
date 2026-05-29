## Context

用户已在投资组合中长期配置标普 500 指数，操作模式是：
- **场外**：摩根标普500指数(QDII)A（017641，每月按额定投，受 QDII 限购影响小）
- **场内**：博时标普500 ETF（513500，盘中下跌时择机加仓，受溢价影响极大）

现有三套策略引擎（`active-fund-dca-strategy` / `gold-dca-strategy` / `etf-dca-strategy`）都不能直接套用：
- 标普 500 没有可信的 PE 分位口径（A 股 PE 分位 / 蛋卷估值不覆盖美股指数）
- 现有 `etf-dca-strategy` 是"5 档价格区间 + 3 档止盈"，与"场外定投 + 场内加仓"双形态语义不符
- 现有 `gold-dca-strategy` 与"单标的+止盈"匹配，但没有"场内 ETF 溢价"概念

因此需要一个**新 capability**，既能复用项目已积累的"距 N 年高点回撤"衍生指标算法（黄金 capability 已有类似实现），又能加入 QDII ETF 特有的**IOPV 溢价闸门**逻辑。

## Goals / Non-Goals

**Goals:**
- 一个共享指标（距 5Y 高点回撤）驱动两张卡片，UI 视觉上联动、计算上独立
- 场外定投卡片：4 档定投矩阵（暂停 / 减半 / 正常 / 加倍）+ 月推荐金额
- 场内加仓卡片：4 信号灯 + 阶梯溢价闸门（0.5% / 1.5%）+ 建议金额（5K / 10K / 15K 三档递增）
- IOPV 数据零新增依赖：复用东方财富 push2 接口，仅扩展 fields 抓取 `f184/f185`
- 数据失败时双卡片独立降级：场外/场内任一数据源失败，不影响另一卡片
- 与已有 `active-fund / gold / etf` capability 完全解耦，不改动其 spec 行为

**Non-Goals:**
- 不实现 QDII 限购检测（Out of scope；用户在场外申购时由券商/基金 APP 自动反馈）
- 不实现"自动下单"或"通知推送"（仅信号灯展示，由用户手动操作）
- 不实现 Shiller CAPE / VIX / 美元汇率 等外部宏观指标接入（保持指标简洁）
- 不实现"止盈档"（标普 500 长期持有定位，与黄金/ETF 的止盈语义不匹配）
- 不实现批量管理（场外/场内每边各只 1 个标的，单一策略对象足以；不做 strategies[] 数组）
- 不实现自动从 ETF 关注列表挑选场内标的（默认锁定 513500，管理员可改）

## Decisions

### 1. 单 capability，但内部双子卡片（双标的共享指标）

**决策**：作为新 capability `sp500-dca-strategy` 独立存在；内部数据模型采用**单一策略对象**结构：

```jsonc
{
  "name": "标普500投资策略",
  "indexCode": "SPX",          // 用于拉 K 线计算回撤
  "indexSecid": "100.SPX",
  "offsite": {                  // 场外子配置
    "fundCode": "017641",
    "fundName": "摩根标普500指数(QDII)人民币A",
    "monthlyAmount": 1000,      // 月定投基准金额
    "tiers": [                   // 4 档（命中即停）
      { "id": "pause",  "label": "暂停定投", "color": "purple", "multiplier": 0,
        "drawdownLt": 3 },
      { "id": "half",   "label": "减半定投", "color": "yellow", "multiplier": 50,
        "drawdownLt": 10 },
      { "id": "normal", "label": "正常定投", "color": "green",  "multiplier": 100,
        "drawdownLt": 20 },
      { "id": "double", "label": "加倍定投", "color": "red",    "multiplier": 200,
        "drawdownLt": null }     // 兜底无上界
    ]
  },
  "onsite": {                   // 场内子配置
    "etfCode": "513500",
    "etfName": "博时标普500 ETF",
    "etfSecid": "1.513500",
    "signals": [                 // 4 信号灯（命中即停）
      { "id": "idle",   "label": "未到时机",   "color": "gray",   "amount": 0,     "drawdownLt": 3 },
      { "id": "watch",  "label": "可关注",     "color": "yellow", "amount": 5000,  "drawdownLt": 10 },
      { "id": "buy",    "label": "可加仓",     "color": "orange", "amount": 10000, "drawdownLt": 20 },
      { "id": "strong", "label": "强烈加仓",   "color": "red",    "amount": 15000, "drawdownLt": null }
    ],
    "premiumGate": {             // 阶梯溢价闸门
      "fullPassMaxPct": 0.5,     // 溢价 < 0.5% → 全额放行
      "halfPassMaxPct": 1.5      // 0.5%-1.5% → 半额放行；> 1.5% → 拦截
    }
  },
  "updatedAt": "2026-05-29T..."
}
```

**Rationale**:
- 单一策略对象（不是数组）→ API 简化为 plan/recommendation 两端而无需管理多策略
- offsite + onsite 平铺为字典而非数组 → 配置语义自然对应"场外/场内"两张卡片，无需 id 区分
- 各子配置独立有 tiers / signals / premiumGate → 引擎实现简洁，前端渲染一一对应

**Alternatives considered**:
- 复用 `etf-dca-strategy` capability，把 017641 + 513500 各塞一条 → 否决：配置文件结构是 ETF 通用 priceTiers / takeProfitTiers，无法表达"场内独有溢价闸门 + 场外定投"语义
- 用 strategies[] 数组容纳多个标普标的（如未来加纳斯达克）→ 否决：YAGNI，未来加纳斯达克时复制本 capability 改名即可

### 2. 共享指标 — 距 5Y 高点回撤（drawdownFromPeak5Y）

**决策**：只用一个衍生指标 `drawdownFromPeak5Y`：
```
peakClose5Y = max(close in last 5 years)
drawdownFromPeak5Y = (peakClose5Y - latestClose) / peakClose5Y × 100  // 正数
```
- 当前价 = peak → 0
- 当前价 < peak → 正数（百分比，0~100）
- K 线数据不足 60 个交易日 → 返回 null（降级"正常档"兜底）

**Rationale**:
- 与黄金 capability 的 `fundDrawdown1Y` / `fundPricePercentile5Y` 双指标对偶，但简化为单指标（标普指数无止盈语义）
- 与"下跌加仓"的用户心智完全一致："跌得越深，加得越多"
- 数据零依赖外部源 — 标普 500 的 5Y K 线已能从东方财富/腾讯/Yahoo 三级 failover 拿到（dataFetcher 已实现）

**Alternatives considered**:
- 双指标（5Y 价格分位 + 1Y 回撤） → 否决：标普 500 长期向上，5Y 价格分位永远偏高（≥80%），区分度低
- Shiller CAPE → 否决：需新数据源，超出 Goals
- 250 日均线偏离度 → 否决：均线偏离与回撤高度相关，多设无益

### 3. 场外 4 档定投矩阵 — 边界 3% / 10% / 20%

**决策**：按"防御优先 + 命中即停"排序：

| id | label | color | multiplier | 触发条件（drawdown 范围） |
|---|---|---|---|---|
| `pause` | 暂停定投 | purple | 0 | drawdown < 3 |
| `half` | 减半定投 | yellow | 50 | 3 ≤ drawdown < 10 |
| `normal` | 正常定投 | green | 100 | 10 ≤ drawdown < 20 |
| `double` | 加倍定投 | red | 200 | drawdown ≥ 20 |

**Rationale**:
- 边界 3 / 10 / 20 是基于标普 500 历史回撤的常见分位（轻微回调 / 中等回调 / 显著熊市迹象）
- 4 档与现有 active-fund 主档语义对齐（用户已熟悉 pause / half / normal / double 颜色与含义）
- 不引入 boost 加强档（保持 4 档简洁，5 档需要回撤更细分边界，对标普 500 没有强需求）

### 4. 场内 4 信号灯 + 阶梯溢价闸门

**决策**：信号灯档与场外定投档共享同一回撤边界（3 / 10 / 20），但**输出不同**：场外是"金额 = 基准 × 倍率"，场内是"金额 = 信号档预设值"。

| 信号 id | label | 颜色 | 建议金额（基础）| 触发条件 |
|---|---|---|---|---|
| `idle` | 未到时机 | gray | 0 | drawdown < 3 |
| `watch` | 可关注 | yellow | 5000 | 3 ≤ drawdown < 10 |
| `buy` | 可加仓 | orange | 10000 | 10 ≤ drawdown < 20 |
| `strong` | 强烈加仓 | red | 15000 | drawdown ≥ 20 |

**阶梯溢价闸门**对建议金额做二次调整：

```
   premium %        闸门动作                      实际金额
   ───────────────────────────────────────────────
   < 0.5%           ✓ 全额放行                    基础金额 × 1.0
   0.5% - 1.5%      ⚠ 半额放行                    基础金额 × 0.5
   > 1.5%           🚫 拦截                       0（建议改场外）
   == null          ⚠ IOPV 不可用                 基础金额 × 1.0（标 stale）
```

**Rationale**:
- 信号档与场外定投档共享回撤边界 → 用户心智简单（同一回撤值，场外/场内同时变档）
- 阶梯而非单一阈值 → 反映 QDII 溢价的真实分布（0.5% 以下常见、1.5% 以上明显异常）
- 拦截后建议"改场外" → 把场外卡片当作"溢价过高时的避险通道"，两卡天然联动
- IOPV 缺失时全额放行 + stale 标记 → 不误拦截（QDII 数据偶尔失稳是常态，但用户能看到警告）

**Alternatives considered**:
- 单一阈值（溢价 > X% 就拦截）→ 否决：黑白判断不符合现实，用户在 0.8% 时其实仍能接受
- 与回撤档联动（深熊允许更高溢价）→ 否决：复杂度高，且深熊本身就是溢价缩窄的时候，无需调高容忍

### 5. IOPV 数据 — 复用东财 push2 + null 降级链

**决策**：扩展 `services/etfFetcher.js` 的 `fetchETFQuotesEastmoney` fields 字符串：
```
原: 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21,f23,f115,f128,f140,f141,f152'
新: 在末尾追加 ',f184,f185'   // f184=IOPV, f185=折溢价率(%)
```
- 优先用 `f185`（服务端预计算的折溢价率）
- f185 不可用时用 `f184` 自算：`(price - f184) / f184 × 100`
- f184 也不可用 → `premium = null`，闸门降级"全额放行 + stale"
- 暴露新公共导出 `fetchETFIopvBySecid(secid)`：返回 `{ price, iopv, premiumPct }`

**Rationale**:
- 复用同一接口同一鉴权同一降级链 → 零新增依赖
- 服务端计算的 f185 比客户端自算更稳（避免精度问题）
- 三层降级 → 数据噪声不会拖垮闸门可用性

**Alternatives considered**:
- 集思录 ETF 溢价 API → 否决：新数据源 + 限速 + 单一来源
- T-1 净值近似 IOPV → 否决：QDII 隔夜美股大跳，最大失真就在这里
- 只取 f184 自算 → 否决：精度不如服务端 f185

### 6. API 形态 — 单一对象 plan / 单一对象 recommendation

**决策**：

```
GET  /api/strategy/sp500-plans
     → { success: true, data: { strategy: <单对象> } }

POST /api/strategy/sp500-plans  (admin)
     body: <单对象，整体替换>
     → { success: true, data: { strategy: <更新后> } }

GET  /api/strategy/sp500-recommendations
     → {
         success: true,
         data: {
           calculatedAt,
           drawdownFromPeak5Y,        // 共享指标
           peakClose5Y,
           peakDate5Y,
           latestClose,
           offsite: {                  // 场外卡片
             fundCode, fundName,
             hitTier: { id, label, color, multiplier },
             monthlyAmount,
             actualAmount,
             triggerReason,
             tierScans: [...],
             stale: false              // 净值是否陈旧
           },
           onsite: {                   // 场内卡片
             etfCode, etfName,
             hitSignal: { id, label, color, amount },
             premium: { value, status, message },  // 闸门状态
             baseAmount, suggestedAmount,
             triggerReason,
             signalScans: [...],
             stale: false              // IOPV 是否陈旧
           },
           stale                        // 整体（指数 K 线）是否陈旧
         }
       }
```

**Rationale**:
- 与 gold capability 类似的 plan/recommendations 二元结构，但 strategy 是单对象（不是数组），符合"标普只有一个策略"的现实
- offsite / onsite 字段平铺，前端两张卡片直接读对应字段渲染，零适配代码
- `stale` 字段三处独立（顶层 = 指数 K 线 / offsite = 场外净值 / onsite = IOPV），任一卡片可单独降级

**Alternatives considered**:
- strategies[] 数组（如 active-fund） → 否决：未来想加纳斯达克时复制 capability，不在本卡片内塞
- offsite/onsite 各独立 endpoint → 否决：前端要并行两个请求，且共享指标会重复计算

### 7. 前端 — 投资策略 Tab 新增"📈 标普500"子 tab

**决策**：在现有子 tab 列表（💰ETF / 🥇黄金 / 💼主动基金 / 🌡️温度计 / 📊投资基准）中插入"📈 标普500"，位置在"主动基金"和"温度计"之间（与海外主题更接近）。

每张卡片 UI 形态参考既有 `active-fund-card` / `gold-card`，但场内卡片头部多一行"溢价闸门状态条"：

```
┌────────────────────────────────────────────────────────┐
│  ⚡ 场内加仓 · 博时标普500 ETF (513500)                │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  💱 溢价 0.8% · ⚠ 半额放行                             │
├────────────────────────────────────────────────────────┤
│  [🟠 可加仓]   建议金额 5000 元                         │
│                (基础 10000 × 0.5 闸门系数)              │
│                                                        │
│  触发依据：标普500 距 5Y 高点回撤 14.2%（命中"可加仓"档）│
│                                                        │
│  [信号扫描 ▶]                                           │
└────────────────────────────────────────────────────────┘
```

## Risks / Trade-offs

- **[Risk] 东财 f184/f185 字段对 QDII ETF 可能不稳定** → Mitigation: 三层降级（f185 → f184 自算 → null）；测试用例覆盖三种场景；UI 显示 "⚠ IOPV 不可用" 时闸门按"全额放行"处理（避免误拦截让用户错过加仓机会）
- **[Risk] 美股交易时段差异** → 北京时间 21:30 美股开盘后到次日 04:00，IOPV 与现价的"参考点"切换可能让溢价短暂失真 → Mitigation: 不在引擎内做时段过滤（保持简单），UI 显示数据时间，由用户自行判断；用户实际下单是 9:30-15:00 A 股时段，那时美股已收盘，IOPV 较稳定
- **[Risk] 标普 500 长期向上，5Y 高点回撤经常 = 0** → Mitigation: 0% 回撤命中 pause 档（暂停定投）— 这是"用户在新高时不该追"的合理输出，符合"防御优先"原则
- **[Risk] QDII 限购导致场外定投实际不可执行** → Out of scope：策略只负责"该不该买"，"能不能买"由用户在券商/基金 APP 自行处理；策略卡片仅显示推荐金额，不假设可执行
- **[Trade-off] 单一策略对象 vs 数组** → 当前选单对象，简化前后端；未来加纳斯达克时复制 capability 而非塞入数组（符合 capability 命名空间隔离原则）
- **[Trade-off] 4 档 vs 5 档（不引入 boost 加强档）** → 标普 500 历史回撤分布相对均匀，4 档已能覆盖；额外加 boost 增加边界配置但没有显著区分度
