## Context

「投资策略」Tab 已经支持 3 类资产（指数温度计 / 主动基金 / 黄金）。本次新增第 4 类——
**ETF 动态定投**，基于 4ETF.md 的康波周期策略，覆盖 4 只精选 ETF。

与现有 3 类策略的核心区别：

| 维度 | 指数温度计 | 主动基金 | 黄金 | **ETF（本次）** |
|---|---|---|---|---|
| 触发因子 | 知有行温度 | PE 分位 + 基金回撤 | 价格分位 + 1年回撤 | **绝对价格区间** |
| 档位数量 | 4 档 | 4 档 | 4 档 | **5 档**（多了「极限」） |
| 止盈机制 | 无 | 无 | 3 档（30/60/100% 收益） | **3 档**（PE/价格/PB 各 ETF 不同） |
| 暴跌加仓 | 无 | 无 | 无 | **3 级**（单月跌 12/20/30%） |
| 规则通用性 | 按指数配 | 按基金配 | 按基金配（默认模板） | **每只 ETF 完全独立**（阈值差异极大） |

经实证：
- 4 只 ETF 的价格区间数值范围从 0.4 到 2.5 不等，**无法用统一阈值百分比表达**
- 必须支持「每只 ETF 各自独立的绝对价格阈值数组」

## Goals / Non-Goals

**Goals**
- 在「投资策略」Tab 内增加第 4 个 section（ETF 投资策略）
- 实时（≤30s 延迟）展示 4 只 ETF 当前的入场档位、推荐定投金额、触发依据
- 提供 3 档分批止盈评估（用户确认型，复用黄金的模式）
- 提供 3 级暴跌加仓信号（基于月度涨跌幅，纯提示不自动算金额）
- 使用独立的 `data/etf-holdings.json` 存储 ETF 持仓事件流（与黄金完全隔离，零迁移风险）

**Non-Goals**
- ❌ 不实现自动交易（仅显示建议）
- ❌ 不计算"投入资金累计已用 N% / 子弹剩 78%"等仓位管理（用户文档第三节"资金来源"暂不落地，等后续版本）
- ❌ 不实现"暴跌信号触发后自动按 3 倍/6 倍金额自动入账"（保留为人工执行）
- ❌ 不修改现有 ETF 总览 Tab 的功能

## Decisions

### Decision 1: 入场端用「绝对价格档位数组」存储

**选择**：每只 ETF 配置一个有序的 `priceTiers` 数组，每档包含 `[label, priceMin, priceMax, monthlyAmount, color, multiplier]`。
档位匹配时按数组顺序遍历，找到第一个 `priceMin ≤ price < priceMax` 的档（最后一档无 priceMax）。

```json
"priceTiers": [
  { "id": "pause",   "label": "暂停",   "priceMin": 1.60, "priceMax": null,  "monthlyAmount": 0,     "color": "red"    },
  { "id": "watch",   "label": "观望",   "priceMin": 1.22, "priceMax": 1.60,  "monthlyAmount": 700,   "color": "yellow" },
  { "id": "normal",  "label": "定投",   "priceMin": 0.92, "priceMax": 1.22,  "monthlyAmount": 2100,  "color": "green"  },
  { "id": "double",  "label": "加倍",   "priceMin": 0.72, "priceMax": 0.92,  "monthlyAmount": 4200,  "color": "orange" },
  { "id": "extreme", "label": "极限",   "priceMin": null, "priceMax": 0.72,  "monthlyAmount": 12600, "color": "purple" }
]
```

**理由**：
- 4 只 ETF 的价格阈值绝对值差异大（恒生科技 0.4-0.8 vs 有色金属 1.1-2.3），无法用"分位百分比"通用模板表达
- 数组顺序天然解决"档位边界"问题（命中即停，无灰色地带）
- 单价格阈值结构最简单、最直观，与 4ETF.md 文档表格一一对应

**备选方案**：复用 active-fund 引擎的通用 `rules[]` 结构（含 conditions + logic）——拒绝，因为 ETF 档位本质就是简单数轴分段，用通用规则反而过度复杂化。

### Decision 2: 卖出端用「条件数组」（保留通用规则引擎风格）

**选择**：每只 ETF 配置 `takeProfitTiers` 数组，每档配 `triggerConditions`（数组 = AND，命中后建议卖出 `sellPct`）。
触发字段支持：`fundReturnPct`（自基金视角收益率，主要触发器）、未来可扩展 `etfPe`、`etfPb`。

```json
"takeProfitTiers": [
  {
    "id": "tp1", "label": "第一批", "sellPct": 33.3, "triggeredAt": null,
    "triggerConditions": [
      { "field": "fundReturnPct", "op": ">=", "value": 50 }
    ]
  },
  ...
]
```

**理由**：
- 与黄金策略保持一致（评估器复用 `evaluateTakeProfitTiers`，但增强为支持 condition 数组）
- 卖出条件天然多样（PE / PB / 价格 / 收益率），需要通用结构

**简化处理**：v1 仅实现 `fundReturnPct` 触发器（最常用）。对于 4ETF.md 中"PE > 150x"、"价格 > 2.40"这类**ETF 级**的触发条件，v1 转化为对应的**收益率门槛**展示（按当前持仓成本反算）。
完整的 PE/PB 触发支持留作 v2，等需要再加 `etfPe` / `etfPb` 字段。

### Decision 3: 暴跌信号用「月度涨跌幅」作为唯一触发器

**选择**：基于 ETF 的"近 1 个月（约 22 个交易日）涨跌幅"判定 3 级警戒：

```json
"crashTiers": [
  { "id": "lv1", "label": "一级·加倍", "threshold": -12, "multiplier": 3, "executionHint": "次日开盘" },
  { "id": "lv2", "label": "二级·极限", "threshold": -20, "multiplier": 6, "executionHint": "次日开盘" },
  { "id": "lv3", "label": "三级·史诗", "threshold": -30, "multiplier": null, "executionHint": "当日尾盘", "note": "全部可用资金" }
]
```

**理由**：
- 4ETF.md 明确写"单月跌超 12%/20%/30%"是硬数字
- 月度涨跌幅 = (当前价 − 22日前价) / 22日前价 × 100，K 线接口可算
- 三级"史诗"档不预设具体金额（user 自定义"可用资金"），仅展示信号 + executionHint

### Decision 4: 持仓数据独立存储（A 方案，零迁移）

**选择**：新建独立的 `data/etf-holdings.json` 存储 ETF 持仓事件流，与黄金的 `gold-holdings.json` **完全隔离**。

```json
// data/etf-holdings.json（新建）
{
  "records": [
    {
      "id": "e1abc23",
      "fundCode": "588080",
      "type": "buy",
      "date": "2026-05-15",
      "amount": 2100,
      "shares": 1097.75,
      "nav": 1.913,
      "tierId": null,
      "note": "",
      "createdAt": "..."
    }
  ]
}
```

**理由**：
- 不动黄金已发布的稳定模块 → 零迁移风险
- 数据结构与 gold-holdings 完全一致，可以复用 `summarizeHoldings` 工具函数
- 黄金继续用 `data/gold-holdings.json` + `/api/strategy/gold-holdings*` 接口
- ETF 用 `data/etf-holdings.json` + `/api/strategy/etf-holdings*` 接口

**备选方案（已拒绝）**：
- 合并到 fund-holdings.json 通过 fundCode 区分 — 拒绝，迁移成本高、动到稳定模块风险大

**代价**：两份存储相互独立，将来若想统一查询所有基金持仓需要新增聚合接口（v2 再说，当前无需求）。

### Decision 5: 实时价格用 `/api/etfs` 现有接口

**选择**：ETF 推荐接口内部调用 `fetchAllETFData()`，从中提取目标 4 只 ETF 的 `latestPrice`。

**理由**：
- 数据已被现有缓存层（key=`etfs`，交易时段 15s TTL）覆盖
- 无需新建数据源
- 用户已选"A 实时行情（T+0）"

### Decision 6: 引擎模块组织 — 新建 etfStrategyEngine，复用 gold 引擎的工具

**选择**：
- 新建 `services/etfStrategyEngine.js` 处理 ETF 特有的「5 档价格匹配」+「3 级暴跌信号」
- **复用** `goldStrategyEngine.summarizeHoldings`（持仓汇总，因为持仓表已统一）
- **新增** `evaluateGenericTakeProfitTiers(tiers, indicators)` —— 升级版的止盈评估器（支持 condition 数组），供 ETF 用；黄金的旧 `evaluateTakeProfitTiers` 保留兼容

**理由**：
- 持仓汇总逻辑（buy-sell 净计算）完全通用
- 止盈触发器需要支持多字段，但 v1 用单字段简化即可
- 不修改黄金引擎的现有接口，保证向后兼容

## 数据结构

### `data/etf-strategy.json`

```json
{
  "strategies": [
    {
      "fundCode": "588080",
      "fundName": "科创50 ETF",
      "shortName": "科创50",
      "allocationPct": 35,
      "secid": "1.588080",
      "priceTiers": [
        { "id": "pause",   "label": "暂停",   "priceMin": 1.60, "priceMax": null,  "monthlyAmount": 0,     "color": "red",    "note": "PE>150x，估值极高" },
        { "id": "watch",   "label": "观望",   "priceMin": 1.22, "priceMax": 1.60,  "monthlyAmount": 700,   "color": "yellow", "note": "PE 100-150x" },
        { "id": "normal",  "label": "定投",   "priceMin": 0.92, "priceMax": 1.22,  "monthlyAmount": 2100,  "color": "green",  "note": "PE 70-100x" },
        { "id": "double",  "label": "加倍",   "priceMin": 0.72, "priceMax": 0.92,  "monthlyAmount": 4200,  "color": "orange", "note": "PE 50-70x" },
        { "id": "extreme", "label": "极限",   "priceMin": null, "priceMax": 0.72,  "monthlyAmount": 12600, "color": "purple", "note": "PE<50x，打6个月额度" }
      ],
      "takeProfitTiers": [
        { "id": "tp1", "label": "第一批", "sellPct": 33.3, "triggeredAt": null,
          "triggerConditions": [{ "field": "fundReturnPct", "op": ">=", "value": 50 }],
          "displayHint": "PE>150x（约>1.60）" },
        { "id": "tp2", "label": "第二批", "sellPct": 33.3, "triggeredAt": null,
          "triggerConditions": [{ "field": "fundReturnPct", "op": ">=", "value": 100 }],
          "displayHint": "PE>180x（约>1.90）" },
        { "id": "tp3", "label": "清仓",   "sellPct": 100, "triggeredAt": null,
          "triggerConditions": [{ "field": "fundReturnPct", "op": ">=", "value": 150 }],
          "displayHint": "PE>200x 或价格翻倍" }
      ],
      "crashTiers": [
        { "id": "lv1", "label": "一级·加倍", "threshold": -12, "multiplier": 3 },
        { "id": "lv2", "label": "二级·极限", "threshold": -20, "multiplier": 6 },
        { "id": "lv3", "label": "三级·史诗", "threshold": -30, "multiplier": null, "note": "全部可用资金" }
      ],
      "updatedAt": "2026-05-27T00:00:00.000Z"
    }
    // ... 其它 3 只 ETF 同结构
  ]
}
```

### `data/etf-holdings.json`（新建）

```json
{
  "records": [
    {
      "id": "e1abc23",
      "fundCode": "588080",
      "type": "buy",
      "date": "2026-05-15",
      "amount": 2100,
      "shares": 1097.75,
      "nav": 1.913,
      "tierId": null,
      "note": "",
      "createdAt": "..."
    }
  ]
}
```

字段语义与 `gold-holdings.json` 完全相同，但内容独立维护。

## API 设计

### `GET /api/strategy/etf-plans`（公开）
返回所有 ETF 策略配置列表。

### `POST /api/strategy/etf-plans`（管理员）

Upsert 单只 ETF 策略。校验：
- `fundCode` 必填，必须在 ETF watchlist 中
- `priceTiers` 至少 1 档，且 priceMin/priceMax 不能交叉（保证档位严格分段）
- `takeProfitTiers` 中 `sellPct` ∈ (0, 100]
- `crashTiers` 中 `threshold` 必须 ≤ 0
- 升级时保留旧 `triggeredAt`（与黄金策略一致）

### `POST /api/strategy/etf-plans/delete`（管理员）
按 fundCode 删除。

### `GET /api/strategy/etf-recommendations`（公开 + 缓存）

```jsonc
{
  "success": true,
  "data": {
    "calculatedAt": "2026-05-27T00:51:00.000Z",
    "recommendations": [
      {
        "fundCode": "588080",
        "fundName": "科创50 ETF",
        "currentPrice": 1.913,
        "allocationPct": 35,
        // 入场端
        "hitTier": { "id": "pause", "label": "暂停", "monthlyAmount": 0, "color": "red" },
        "monthlyAmount": 0,
        "triggerReason": "当前价 1.913 > 1.60（暂停档下限）",
        "tierScans": [ /* 5 档扫描结果，每档命中/未命中 */ ],
        // 持有端
        "holdings": { "totalCost": 0, "totalShares": 0, "marketValue": null, "totalReturnPct": null, "buyCount": 0, "sellCount": 0 },
        "takeProfitStatus": [ /* 3 档止盈评估，同黄金结构 */ ],
        // 暴跌信号
        "monthChangePct": -8.5,
        "crashSignal": null,    // 当前未触发任何暴跌档；触发时返回对应 tier 对象
        "crashSignalText": "近 1 月跌幅 -8.5%，未触发暴跌档",
        // 元数据
        "stale": false
      }
    ]
  }
}
```

### 持仓 API（ETF 独立）

- `GET /api/strategy/etf-holdings`（公开）
- `POST /api/strategy/etf-holdings`（管理员）
- `POST /api/strategy/etf-holdings/delete`（管理员）

接口字段与行为与 `/api/strategy/gold-holdings*` 完全一致，但读写不同的数据文件。
黄金模块的 API 路径**不变**。

## UI 设计

### 「ETF 投资策略」section 结构

```
┌─ ETF 投资策略 (4 只) ──────────────────────────────────────┐
│  ┌─ 科创50 (588080) · 35% 配置 ────────────────────────┐  │
│  │ 🔴 暂停定投   本月 ¥0                              │  │
│  │ 当前价 1.913 > 1.60（暂停档下限）                  │  │
│  │                                                     │  │
│  │ ▼ 5档进度（默认折叠）                              │  │
│  │   ┌──────────────────────────────────────────────┐ │  │
│  │   │ 🔴 暂停 >1.60      ¥0      ⚠ 当前           │ │  │
│  │   │ 🟡 观望 1.22-1.60  ¥700    未触发           │ │  │
│  │   │ 🟢 定投 0.92-1.22  ¥2,100  未触发           │ │  │
│  │   │ 🟠 加倍 0.72-0.92  ¥4,200  未触发           │ │  │
│  │   │ 🟣 极限 <0.72      ¥12,600 未触发           │ │  │
│  │   └──────────────────────────────────────────────┘ │  │
│  │                                                     │  │
│  │ 持仓: ¥0 / 0 份 · 收益率 N/A                       │  │
│  │                                                     │  │
│  │ 💰 止盈进度（3 档）                                │  │
│  │   tp1 (收益≥50% / PE>150x) ⏳ 未触发              │  │
│  │   tp2 (收益≥100%)          ⏳ 未触发              │  │
│  │   tp3 (清仓)               ⏳ 未触发              │  │
│  │                                                     │  │
│  │ 🚨 暴跌信号                                         │  │
│  │   近 1 月跌幅 -8.5%，未触发暴跌档                  │  │
│  │                                                     │  │
│  │ ▼ 持仓记录 [展开]                                  │  │
│  └─────────────────────────────────────────────────────┘  │
│  ┌─ 创业板50 (159949) · 25% 配置 ──────────────────────┐  │
│  │ ... 同结构 ...                                       │  │
│  └─────────────────────────────────────────────────────┘  │
│  ... 另 2 只 ETF                                           │
│  [＋ 添加 ETF 策略]                                        │
└────────────────────────────────────────────────────────────┘
```

### UI 关键决策
- **5 档徽章配色**：red / yellow / green / orange / purple（5 个不同色阶）
- **价格进度条**：可选——v1 不做，仅以表格列出 5 档；v2 可加水平进度条 + 当前价指示线
- **暴跌信号高亮**：触发时整张卡顶部出现金色警戒横条 + 闪烁动画
- **持仓表**：复用黄金已有的折叠表格组件（因为持仓表已统一）

## Risks / 边界情况

| 风险 | 处理 |
|---|---|
| ETF 实时价格不可用（数据源失败） | stale 标记，使用最近一次缓存价格；档位匹配跳过 |
| 当前价正好落在档位边界（如 1.60） | 按"区间右开"约定：1.60 落入"观望"档（[1.22, 1.60) 中），1.60 严格大于触发暂停 |
| 用户配置的 priceTiers 区间交叉 | POST 校验阶段拒绝 + 返回明确错误信息 |
| 月度涨跌幅计算需要 K 线，但 K 线接口失败 | crashSignal = null，UI 显示"近 1 月数据不可用，无法计算暴跌信号" |
| 清仓档（tp3）的 sellPct = 100，但当前持仓为 0 | UI 显示"无持仓"，按钮 disable |
| 用户手工调整某只 ETF 的 priceTiers 但忘记加 normal 档 | 校验时不强制（与黄金不同——ETF 5 档全由用户决定），但 UI 提示"无兜底档位时，价格落在配置范围外将显示「未命中」" |

## Migration

**无迁移**。本次新增的 ETF 模块完全独立：
- 新建 `data/etf-strategy.json` + `data/etf-holdings.json`
- 黄金模块的 `data/gold-strategy.json` + `data/gold-holdings.json` 文件与 API 不动
- 现有 4 个 capability（指数温度计 / 主动基金 / 黄金 / ETF）相互独立，互不影响

**首次启动行为**：
- `data/etf-strategy.json` 不存在 → 自动注入 4 只默认 ETF 配置
- `data/etf-holdings.json` 不存在 → 创建空 `{ records: [] }`


