## Context

黄金作为长周期资产，与股票的估值逻辑根本不同：
- **无内在估值**：黄金不生息、无现金流，PE/PB 不适用
- **驱动因子复杂**：实际利率（最强反向）、美元指数、避险需求
- **高位震荡可能持续多年**：2011-2020 的 9 年熊市 + 高位震荡是典型例子
- **必须主动止盈才能锁定收益**：单纯定投 + 长期持有可能错过波段获利的机会

用户画像：长期定投（10+ 年），每月固定 1000 元，标的为黄金 ETF 联接基金（如华安联接 A 000216）。
通过实证（2021-01 起 5.4 年定投 65000 元，当前市值 12.75 万，总收益 96.23%，年化 28.38%）确认：
- 过去 5 年黄金属于历史级牛市，未来若不主动减仓可能吐回大部分利润
- 当前价格分位（92.96%）已是历史绝对高位，需要"暂停定投"机制保护
- 应通过分层止盈（30%/60%/100%）逐步锁定收益

本次方案在 explore 阶段已用真实数据 dry-run 多次，确认规则**无灰色地带、无自相矛盾**。

## Goals / Non-Goals

**Goals**
- 在「投资策略」Tab 新增独立的「黄金定投策略」section，与现有两个策略并列
- 实时（≤1 分钟延迟）计算每只黄金基金当前的**买入档位**与**止盈档位**
- 提供持仓记录管理（每月定投 / 止盈卖出），自动汇总成本、份额、市值、收益率
- 止盈采用"用户确认"机制：UI 显示建议但不自动标记触发，用户点击「已止盈」后才记录 `triggeredAt`
- 复用 `active-fund-dca-strategy` 已有的规则引擎，减少重复代码

**Non-Goals**
- ❌ 不引入宏观因子（实际利率、美元指数）作为规则字段 —— 留作 v2
- ❌ 不自动执行交易（仅提示建议，用户去基金 APP 自行操作）
- ❌ 不引入"滚动止盈"（每涨 N% 卖 M%）—— 阈值触发即可，避免操作过频
- ❌ 不实现历史档位变化日志（与 active-fund 一样下期再做）

## Decisions

### Decision 1: 数据源 — 复用基金净值（NAV），不直接拉金价

**选择**：从东方财富 pingzhongdata 拉取黄金 ETF 联接基金的净值序列（如 000216），用 NAV 序列计算"价格分位"。

**理由**：
- 项目已有 `fetchEastmoneyFundData()`，0 额外开发
- 联接基金本就是用户实际买入的标的，NAV 走势 = 用户实际收益走势
- 跟踪误差极小（黄金 ETF 是被动型，<0.5%/年）
- 国际金价（伦敦金、COMEX）数据源不稳定，pingzhongdata 才是项目目前唯一稳定可用的金价代理

**备选方案**：
- 直接拉 518880 华安黄金 ETF K 线 —— 否决：东方财富 K 线接口对外网部分不稳定（实测 socket hang up）
- 拉 sina 加密接口 —— 否决：需要逆向解密
- 自建数据采集服务 —— 否决：超出本期范围

### Decision 2: 暂停档优先于加倍档（防御优先）

**选择**：当价格分位 ≥ 90% 时直接进入暂停，**即使从近1年高点已回撤 25%+ 也不触发加倍档**。

**理由**：
- 用户画像：10+ 年长期持有 → 优先避免"接飞刀"
- 历史数据：2011 年金价历史最高后，经历了 9 年下行 + 横盘才完成下一轮起飞
- 在 90% 分位回撤 25% 时抄底，如果是真正下跌周期开始，可能要再跌 30-50% 才见底
- "宁可错过、不可踩高位"——用户对 10% 年化的期待是用 10 年实现，单年踏空可接受

**备选方案（已拒绝）**：
- 深跌优先（25%+ 回撤即使分位高也加倍）—— 拒绝，原因如上

### Decision 3: 价格分位窗口选「近 5 年」

**选择**：用最近 1250 个交易日（约 5 年）的 NAV 序列计算当前价格分位。

**理由**：
- 近 1 年（250 日）窗口过短，无法反映完整牛熊周期
- 全历史窗口受远期数据稀释，2013-2015 黄金熊市数据在长期统计中影响过大
- 近 5 年能涵盖一个完整的 3-5 年周期，既能反映"是否高位"也能反映"是否极端"
- 实测：当前 NAV 在近 5 年分位 92.96% vs 全历史 97.16%，近 5 年更敏感、更早触发暂停档

**备选方案**：近 3 年（750 日）—— 拒绝，部分时段会被单边市场扭曲。

### Decision 4: 止盈使用"用户确认"机制（非自动）

**选择**：止盈档触发后，UI 显示"建议止盈 X 份 / 约 Y 元"，用户在基金 APP 真正卖出后回到本系统点击「已止盈」按钮，
系统将该档的 `triggeredAt` 置为当前时间，并自动创建一条 `type: "sell"` 的持仓记录（份额/金额由用户填写）。

**理由**：
- 系统不能自动执行交易（无券商对接）
- 单纯"显示建议 + 时间戳"会导致：用户没操作但下次评估时已被标记触发，建议消失
- "用户确认"既保证了不漏提示，也防止重复提示
- 自动创建对应卖出记录，让总成本/总份额计算保持一致

**备选方案**：
- 纯建议（系统自动标记触发）—— 拒绝，会导致"提示了但用户没操作"的尴尬
- 让用户自己手动新增卖出记录 —— 拒绝，链路太长易遗漏

### Decision 5: 持仓数据用"持仓记录表"，独立于现有 position-records

**选择**：新建 `data/gold-holdings.json`，存储所有定投买入 + 止盈卖出的事件流。系统每次评估时实时汇总成本、份额、市值、收益率。

**理由**：
- 现有 `position-records.json` 是为"指数加仓基准"设计的（字段：`indexCode`/`value`/`pe`/`waterLevel`），语义和字段都不匹配
- 黄金需要的字段：基金代码、操作类型（buy/sell）、金额、份额、净值、日期
- 独立文件清晰，未来其他基金长期持仓也能复用这套表结构（甚至改名为 `fund-holdings.json`）
- 不污染现有指数加仓功能

### Decision 6: 复用 active-fund-dca-strategy 规则引擎

**选择**：黄金的"买入档位匹配"完全复用 `services/activeFundStrategyEngine.js` 中的
`evaluateRule` / `matchStrategy` / `buildTriggerReason` 工具函数。

**理由**：
- 黄金的 4 档规则结构（pause/double/half/normal）与主动基金完全一致
- 唯一新增的是字段白名单：`fundPricePercentile5Y` / `fundDrawdown1Y`
- 引擎能力是稳定的：condition.field 增加新枚举值即可
- 减少代码重复，统一升级路径

**实现路径**：
- 在 `activeFundStrategyEngine.js` 的 `ALLOWED_FIELDS` 中增加 2 个新字段
- 在 `FIELD_LABELS` / `FIELD_UNITS` 中增加显示文案
- 新建 `services/goldStrategyEngine.js`，只负责：
  - 拉取基金净值
  - 计算 `fundPricePercentile5Y` / `fundDrawdown1Y` 两个指标
  - 调用复用引擎的 `matchStrategy`
  - 汇总持仓记录、评估止盈档位

## 数据结构

### `data/gold-strategy.json`

```json
{
  "strategies": [
    {
      "fundCode": "000216",
      "fundName": "华安黄金ETF联接A",
      "monthlyAmount": 1000,
      "priceWindow": 1250,
      "drawdownWindow": 250,
      "rules": [
        {
          "id": "pause",
          "label": "暂停定投",
          "color": "purple",
          "multiplier": 0,
          "logic": "AND",
          "conditions": [
            { "field": "fundPricePercentile5Y", "op": ">=", "value": 90 }
          ]
        },
        {
          "id": "double",
          "label": "加倍定投",
          "color": "red",
          "multiplier": 200,
          "logic": "OR",
          "conditions": [
            { "field": "fundPricePercentile5Y", "op": "<=", "value": 20 },
            { "field": "fundDrawdown1Y",         "op": ">=", "value": 25 }
          ]
        },
        {
          "id": "half",
          "label": "减半定投",
          "color": "yellow",
          "multiplier": 50,
          "logic": "AND",
          "conditions": [
            { "field": "fundPricePercentile5Y", "op": ">=", "value": 70 },
            { "field": "fundPricePercentile5Y", "op": "<",  "value": 90 }
          ]
        },
        {
          "id": "normal",
          "label": "正常定投",
          "color": "green",
          "multiplier": 100,
          "logic": "AND",
          "conditions": []
        }
      ],
      "takeProfitTiers": [
        { "id": "tp30",  "label": "30% 止盈",  "thresholdReturn": 30,  "sellPct": 10, "triggeredAt": null },
        { "id": "tp60",  "label": "60% 止盈",  "thresholdReturn": 60,  "sellPct": 20, "triggeredAt": null },
        { "id": "tp100", "label": "100% 止盈", "thresholdReturn": 100, "sellPct": 30, "triggeredAt": null }
      ],
      "updatedAt": "2026-05-26T00:00:00.000Z"
    }
  ]
}
```

### `data/gold-holdings.json`

```json
{
  "records": [
    {
      "id": "g1abc23",
      "fundCode": "000216",
      "type": "buy",          // "buy" | "sell"
      "date": "2026-05-15",
      "amount": 1000,         // 金额（元）— sell 类型为正数（卖出回收金额）
      "shares": 289.5,        // 份额变动（buy 为正、sell 为正数但语义为减仓）
      "nav": 3.4561,          // 当时的单位净值
      "tierId": null,         // sell 类型时关联触发的止盈档 id，buy 时为 null
      "note": "",
      "createdAt": "2026-05-15T08:00:00.000Z"
    }
  ]
}
```

### 衍生指标（在 `goldStrategyEngine.js` 中计算）

| 指标 | 公式 |
|---|---|
| `fundPricePercentile5Y` | 最新 NAV 在最近 1250 个交易日 NAV 序列中的排名百分位（%） |
| `fundDrawdown1Y` | (近1年最高 NAV − 最新 NAV) / 近1年最高 NAV × 100，正数 |
| `totalCost` | Σ records where type='buy' .amount  −  Σ records where type='sell' .amount |
| `totalShares` | Σ records where type='buy' .shares  −  Σ records where type='sell' .shares |
| `marketValue` | totalShares × 最新 NAV |
| `totalReturnPct` | (marketValue − totalCost) / totalCost × 100  *（注：避免分母为 0；空持仓时为 null）* |

> 注：`totalCost` 在止盈卖出后会减少（卖出金额视为成本回收），这样 `totalReturnPct` 反映"剩余资金的盈亏"。
> 另一种口径是"累计投入金额（不减卖出）",我们选择第一种——因为这是用户视角的"还剩多少钱在赚"。

## API 设计

### `GET /api/strategy/gold-plans`（公开）

返回：`{ success, data: { strategies: [...] } }`

### `POST /api/strategy/gold-plans`（管理员）

Upsert 单只基金的策略配置。校验：
- `fundCode` 必填
- `monthlyAmount` > 0
- `rules` 必含 `id="normal"` 兜底
- `rules` 中 conditions 的 field 必须是 `fundPricePercentile5Y` / `fundDrawdown1Y`（其他被拒绝）
- `takeProfitTiers` 必须按 `thresholdReturn` 升序排列
- 每个 tier 的 `sellPct` ∈ [0, 100]

### `POST /api/strategy/gold-plans/delete`（管理员）

Body: `{ fundCode }`，找不到返回 404。

### `GET /api/strategy/gold-recommendations`（公开）

```jsonc
{
  "success": true,
  "data": {
    "calculatedAt": "2026-05-26T01:13:00.000Z",
    "recommendations": [
      {
        "fundCode": "000216",
        "fundName": "华安黄金ETF联接A",
        "navDate": "2026-05-24",
        "latestNav": 3.4561,
        "indicators": {
          "fundPricePercentile5Y": 92.96,
          "fundDrawdown1Y": 19.61
        },
        // ─── 买入端 ───
        "hitRule": { "id": "pause", "label": "暂停定投", "color": "purple", "multiplier": 0 },
        "monthlyAmount": 1000,
        "actualAmount": 0,
        "triggerReason": "近5年价格分位 92.96% ≥ 90%",
        "ruleScans": [ /* 同 active-fund 结构 */ ],
        // ─── 持有端 ───
        "holdings": {
          "totalCost": 65000,
          "totalShares": 36905.05,
          "marketValue": 127547.56,
          "totalReturnPct": 96.23
        },
        "takeProfitStatus": [
          { "id": "tp30",  "label": "30% 止盈",  "thresholdReturn": 30,  "sellPct": 10,
            "state": "triggered",   "triggeredAt": "2025-12-01T..." },
          { "id": "tp60",  "label": "60% 止盈",  "thresholdReturn": 60,  "sellPct": 20,
            "state": "actionable",  "triggeredAt": null,
            "suggestion": { "shares": 7381.01, "amountApprox": 25509.51 } },
          { "id": "tp100", "label": "100% 止盈", "thresholdReturn": 100, "sellPct": 30,
            "state": "pending",     "triggeredAt": null }
        ],
        "stale": false
      }
    ]
  }
}
```

`takeProfitStatus[i].state` 取值：
- `"triggered"`：已确认（`triggeredAt != null`）
- `"actionable"`：当前收益已达阈值且未确认，UI 高亮显示"建议止盈"
- `"pending"`：当前收益未达阈值

### `GET /api/strategy/gold-holdings`（公开）

返回：`{ success, data: { records: [...] } }`，按日期降序排列。

### `POST /api/strategy/gold-holdings`（管理员）

新增一条持仓记录。Body:
```json
{ "fundCode": "000216", "type": "buy", "date": "2026-05-15", "amount": 1000, "shares": 289.5, "nav": 3.4561, "tierId": null, "note": "" }
```

校验：
- `type` ∈ {"buy", "sell"}
- `date` 是 YYYY-MM-DD
- `amount` > 0
- `shares` > 0
- `nav` > 0
- 如果 `type === "sell"` 且 `tierId` 非空：自动将策略中对应 tier 的 `triggeredAt` 设为该 record 的 `date`

### `POST /api/strategy/gold-holdings/delete`（管理员）

Body: `{ id }`，根据 record id 删除。
如果该记录关联了某 tier（type=sell + tierId 非空），同时将 tier 的 `triggeredAt` 重置为 null。

## UI 设计

```
┌──────────────────────────────────────────────────────────────────┐
│  投资策略                                                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─ 黄金定投策略 ───────────────────────────────────────────┐    │
│  │ ┌─ 华安黄金ETF联接A (000216) ────────────────────────────┐│   │
│  │ │ ▼ 买入端                                                 ││   │
│  │ │   🟣 暂停定投    本月 0 元                              ││   │
│  │ │   触发: 近5年分位 92.96% ≥ 90%                          ││   │
│  │ │   ▶ 规则一览（折叠）                                     ││   │
│  │ │                                                          ││   │
│  │ │ ▼ 持有端（持仓 5.4 年 / 65 期）                          ││   │
│  │ │   累计成本: 65,000 元   累计份额: 36,905.05             ││   │
│  │ │   当前市值: 127,547 元  累计收益: +96.23%               ││   │
│  │ │                                                          ││   │
│  │ │   💰 止盈进度                                            ││   │
│  │ │   ┌────────────────────────────────────────────┐        ││   │
│  │ │   │ 30%  ✅ 已止盈 (2025-12-01) 卖出 10%        │        ││   │
│  │ │   │ 60%  ⚠ 当前可止盈 → 建议卖 7,381 份 ≈25.5K  │ [已止盈]│   │
│  │ │   │ 100% ⏳ 未触发 (差 3.77 个百分点)            │        ││   │
│  │ │   └────────────────────────────────────────────┘        ││   │
│  │ │                                                          ││   │
│  │ │ ▼ 持仓记录 [展开]                                        ││   │
│  │ └────────────────────────────────────────────────────────┘│   │
│  │ [＋ 添加策略]  [＋ 添加持仓记录]                            │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                    │
│  ┌─ 主动基金定投策略 ──────────────────────────────────────┐    │
│  │ ... 现状不变 ...                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                    │
│  ┌─ 温度计定投策略 ────────────────────────────────────────┐    │
│  │ ... 现状不变 ...                                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 关键 UI 行为

- **当前定档徽章**：复用 `.afund-badge.color-{red,yellow,green,purple}` 4 档 + 新增 `.color-gold` 用于"止盈"主题色
- **止盈进度条**：3 档纵向列出，每档状态用图标区分
  - `triggered` → ✅ 灰底，显示 triggeredAt 与卖出比例
  - `actionable` → ⚠ 金色高亮 + 「已止盈」按钮（点击弹出确认表单）
  - `pending` → ⏳ 灰色，显示离触发还差多少
- **持仓记录表**：默认折叠，展开后按日期降序列出，buy/sell 用不同颜色区分
- **「已止盈」确认表单**：弹出小模态框，预填建议卖出金额/份额，用户调整后保存 → 同时创建 sell 记录 + 标记 tier triggered
- **管理员控制**：沿用 `body.role-admin` CSS 控制可见性（与 active-fund 一致）

## Risks / 边界情况

| 风险 | 处理 |
|---|---|
| 基金净值 API 失败 | stale 缓存回退，UI 显示"⚠ 数据陈旧"；指标缺失时所有规则视为不命中→ 兜底 normal 档 |
| 用户尚未录入任何持仓 | `holdings.totalCost = 0`，止盈档全部显示为 pending；UI 提示"暂无持仓数据，请先录入定投记录" |
| 历史数据不足 1250 天（基金成立<5年） | 自动降级到全历史窗口，UI 提示"分位窗口已降级（成立<5年）" |
| 止盈触发后用户误删 sell 记录 | 删除接口同步将 tier 的 `triggeredAt` 重置为 null，UI 重新显示为 actionable |
| 用户重复点击"已止盈"按钮 | 后端 `triggeredAt` 非空时拒绝再次触发，返回明确错误 |
| `totalCost = 0` 但 `totalShares > 0`（极端：仅卖出无买入） | `totalReturnPct = null`，止盈档全部 pending（无法计算收益率） |
| 多档同时达标（如累计 70% 一次性达成） | 仍按数组顺序提示，但用户可在 UI 上逐个或一次性确认（每个 tier 独立按钮） |
| 净值 NAV 序列点数过少（<60 个） | 分位计算失败，indicators 字段为 null，兜底正常档 |

## Migration / 兼容性

- 首次启动时，若 `data/gold-strategy.json` 不存在，自动写入默认配置（000216 华安黄金联接A + 标准 4 档规则 + 3 档止盈）
- 若 `data/gold-holdings.json` 不存在，自动创建空记录 `{ "records": [] }`
- 现有「主动基金定投策略」「指数温度计定投」完全不动
- 复用 `activeFundStrategyEngine.js` 时**只追加字段白名单**，不修改任何现有函数签名
