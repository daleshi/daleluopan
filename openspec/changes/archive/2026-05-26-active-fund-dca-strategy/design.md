## Context

「投资策略」Tab 当前只承载「温度计定投策略」（指数定投，按温度区间分档）。
用户实际持有两只主动基金（兴全商业模式 163415 / 大成睿享 A 008269），分别采用乔迁、徐彦两套截然不同的动态定投规则：
- **乔迁**：双因子（沪深300 PE 分位 + 基金回撤/近期涨幅），AND/OR 混用
- **徐彦**：以 PE 分位单因子为主，仅"加倍"档加上回撤≥15% 的附加条件

在 explore 阶段对原始规则跑了一次实证（数据：2026-05-25 PE 分位=92.08%，两只基金净值=2026-05-22），
发现：
1. 乔迁规则的"减半"档（PE 80-90% AND 涨3月≥15%）与"暂停"档（PE≥90% AND 涨6月≥40%）使用 AND 联结，
   且"正常"档（PE 20-50% OR 回撤 10-20%）覆盖范围有限，导致 **PE 50%~80% 全空白 + PE≥90% 但涨幅不达标也空白**。
   实证显示当前 92.08% 的 PE 在原规则下无法触发任何防御档位，与"高估时降仓"的策略初衷相违。
2. 徐彦规则的 PE 80%~85% 是 5 个百分点的窄缝空白。

用户决策（已确认）：
- **走套餐 ②**（保留原规则精神，只补漏洞）
- **乔迁的"暂停"档使用 OR 联结**：`PE ≥ 90%` 单独成立即触发，去掉"涨6月≥40%"附加条件
- 徐彦的 80%~85% 归并到"减半"档（即减半区扩展为 [80%, 95%)）

## Goals / Non-Goals

**Goals**
- 在「投资策略」Tab 中**新增**「主动基金定投策略」展示区域，与现有「温度计定投策略」并列
- 实时（≤1 分钟延迟）计算两只主动基金当前应执行的定投档位 + 推荐金额 + 触发依据
- 提供管理员可视化配置接口（CRUD），无需改代码即可新增基金或调整阈值
- 数据可降级：底层数据不可用时仍展示最近一次成功结果（带 stale 标记）

**Non-Goals**
- ❌ 不引入完全通用的"任意条件 + 任意操作符"规则编辑器（Level 3）；本期采用 **Level 2 模板化**：
  通用 JSON 结构（预留 Level 3 升级路径）+ UI 端只暴露"单因子 PE 模板"和"双因子 PE+基金 模板"
- ❌ 不实现历史档位变化日志（"今天从减半切到暂停"），下期再做
- ❌ 不引入黄金投资策略（独立 change 处理）
- ❌ 不修改现有「温度计定投策略」的任何代码与数据

## Decisions

### Decision 1: 数据存储 — 独立 JSON 文件

**选择**：新建 `data/active-fund-strategy.json`，与 `data/dca-plan.json`（指数温度计策略）分开存储。

**理由**：
- 两套策略的领域模型差异大（温度区间 vs 多条件规则集），结构难以统一
- 分离存储便于独立 CRUD、独立缓存、独立校验
- 删除/重置任一方不影响另一方

**备选方案**：合并到 `dca-plan.json` 用 `type` 字段区分 — 否决，前端要分支渲染、后端要分支校验，复杂度高于收益。

### Decision 2: 规则结构 — Level 2 模板化（预留 Level 3 通用结构）

**选择**：用通用规则数组结构存储，但 UI 端只暴露两个预设模板。

```json
{
  "fundCode": "163415",
  "rules": [
    {
      "id": "pause",
      "label": "暂停定投",
      "color": "purple",
      "multiplier": 0,
      "logic": "OR",
      "conditions": [
        { "field": "indexPePercentile", "op": ">=", "value": 90 }
      ]
    },
    ...
  ]
}
```

**理由**：
- 数据结构通用 → 未来升级成可视化规则编辑器无需迁移数据
- 第一版 UI 简单 → 用户只在"模板A/模板B"中选 + 填阈值，不暴露条件构造器
- 引擎只需实现一种通用 evaluator → 代码不重复

**备选方案**：
- 完全硬编码两套规则函数 — 否决，任何阈值调整都要发版
- 上来就做完整规则编辑器 — 否决，UI 复杂度高，本期不必要

### Decision 3: 规则优先级 — "防御优先，命中即停"

**选择**：规则按数组顺序匹配，**严苛档在前**：
```
顺序：暂停(pause) → 减半(half) → 加倍(double) → 正常(normal/默认兜底)
```
首条命中即返回，剩余规则不再判断。

**理由**：
- 防御性策略的核心是"宁可错过、不可踩高位"，严苛档优先体现这一原则
- 避免当多档同时命中时的歧义（虽然修订后规则互斥，但保留安全网）
- 「正常」作为兜底（"无 conditions 或 conditions 永真"）保证 100% 覆盖

### Decision 4: 衍生指标计算 — 后端集中算

**选择**：基金的"当前回撤""近3月涨幅""近6月涨幅"在 `services/activeFundStrategyEngine.js` 中
基于 `fundFetcher.js` 的 `netWorthTrend` 序列实时计算，前端不重算。

**理由**：
- 一处计算，避免前后端逻辑漂移
- 净值序列原本就被 fundFetcher 拉取并缓存，零额外网络成本
- "回撤"口径默认采用「**从历史最高净值**」（与乔迁/徐彦原文表述一致）

### Decision 5: 缓存策略 — 与现有缓存层对齐

**选择**：用 `smartCacheGet('active-fund-recommendations', ...)` 接入现有缓存层。

**TTL 策略**：
- 交易时段：5 分钟（基金净值 T+1，PE 也 T+1，无需更频繁）
- 休市时段：30 分钟
- 失败时回退 stale 缓存 + 显式标记

**理由**：净值与 PE 都是日级数据，过频刷新无意义且浪费数据源调用。

### Decision 6: 基准指数（benchmark）当前固定为沪深300，但字段化预留扩展

**选择**：策略配置中 `benchmarkIndex` 字段默认值 `"000300"`，但允许配置（未来可选 000905 中证500 等）。

**理由**：两位基金经理的策略原文都明确指明用沪深300，但下次再加风格不同的基金时（科创/创业板风格），字段已经在了。

## 数据结构

### `data/active-fund-strategy.json`

```json
{
  "strategies": [
    {
      "fundCode": "163415",
      "fundName": "兴全商业模式混合(LOF)A",
      "managerName": "乔迁",
      "benchmarkIndex": "000300",
      "benchmarkName": "沪深300",
      "monthlyAmount": 1000,
      "drawdownBaseline": "history",
      "rules": [
        {
          "id": "pause",
          "label": "暂停定投",
          "color": "purple",
          "multiplier": 0,
          "logic": "OR",
          "conditions": [
            { "field": "indexPePercentile", "op": ">=", "value": 90 }
          ]
        },
        {
          "id": "half",
          "label": "减半定投",
          "color": "yellow",
          "multiplier": 50,
          "logic": "AND",
          "conditions": [
            { "field": "indexPePercentile", "op": ">=", "value": 80 },
            { "field": "indexPePercentile", "op": "<", "value": 90 },
            { "field": "fundGain3M", "op": ">=", "value": 15 }
          ]
        },
        {
          "id": "double",
          "label": "加倍定投",
          "color": "red",
          "multiplier": 200,
          "logic": "AND",
          "conditions": [
            { "field": "indexPePercentile", "op": "<=", "value": 20 },
            { "field": "fundDrawdownAbs", "op": ">=", "value": 20 }
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
      "updatedAt": "2026-05-25T12:08:00.000Z"
    },
    {
      "fundCode": "008269",
      "fundName": "大成睿享混合A",
      "managerName": "徐彦",
      "benchmarkIndex": "000300",
      "benchmarkName": "沪深300",
      "monthlyAmount": 1000,
      "drawdownBaseline": "history",
      "rules": [
        {
          "id": "pause",
          "label": "暂停定投",
          "color": "purple",
          "multiplier": 0,
          "conditions": [
            { "field": "indexPePercentile", "op": ">=", "value": 95 }
          ],
          "logic": "AND"
        },
        {
          "id": "half",
          "label": "减半定投",
          "color": "yellow",
          "multiplier": 50,
          "logic": "AND",
          "conditions": [
            { "field": "indexPePercentile", "op": ">=", "value": 80 },
            { "field": "indexPePercentile", "op": "<", "value": 95 }
          ]
        },
        {
          "id": "double",
          "label": "加倍定投",
          "color": "red",
          "multiplier": 200,
          "logic": "AND",
          "conditions": [
            { "field": "indexPePercentile", "op": "<=", "value": 20 },
            { "field": "fundDrawdownAbs", "op": ">=", "value": 15 }
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
      "updatedAt": "2026-05-25T12:08:00.000Z"
    }
  ]
}
```

### 字段语义

| 字段 | 含义 |
|---|---|
| `field` | 待计算的指标，本期支持枚举：`indexPePercentile` / `indexPbPercentile` / `fundDrawdownAbs`（回撤绝对值，正数）/ `fundGain3M` / `fundGain6M` |
| `op` | 比较运算符，本期支持：`>=` / `>` / `<=` / `<` / `==` |
| `value` | 阈值（数值） |
| `logic` | 同一规则内多 conditions 的联结：`AND` 或 `OR` |
| `multiplier` | 命中时的定投倍数（百分比，整数）。100 = 100% = 满额。0 = 暂停 |
| `conditions: []` | 空条件数组视为永真（用于 normal 兜底档） |

### 引擎计算流程

```
┌─────────────────────────────────────────────────────────┐
│ /api/strategy/active-fund-recommendations               │
└──────────────────────┬──────────────────────────────────┘
                       │
            ┌──────────▼──────────┐
            │ 读取 strategies[]   │
            └──────────┬──────────┘
                       │
       ┌───────────────┴───────────────┐
       ▼                               ▼
┌──────────────┐                ┌──────────────┐
│ fetchPePctMap│                │ 各基金 NAV   │
│ 蛋卷指数估值 │                │ fundFetcher  │
└──────┬───────┘                └──────┬───────┘
       │                               │
       └───────────────┬───────────────┘
                       ▼
            ┌──────────────────────┐
            │ 衍生指标计算         │
            │  - drawdownAbs       │
            │  - gain3m / gain6m   │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │ 规则引擎逐条匹配     │
            │ (顺序：pause→half→   │
            │  double→normal)      │
            └──────────┬───────────┘
                       ▼
            ┌──────────────────────┐
            │ 返回每基金:          │
            │  hitRule + amount    │
            │  + ruleScans[]       │
            │  + indicators        │
            └──────────────────────┘
```

## API 设计

### `GET /api/strategy/active-fund-plans`（公开）

```jsonc
{
  "success": true,
  "data": {
    "strategies": [ /* 同 active-fund-strategy.json */ ]
  }
}
```

### `POST /api/strategy/active-fund-plans`（管理员）

Body：单只基金的策略对象（含 `fundCode` + `rules[]` + `monthlyAmount` 等）。
Upsert 语义：`fundCode` 已存在则更新，不存在则插入（上限 20 只）。

校验：
- `fundCode` 必须存在于基金 watchlist
- `rules` 至少包含 1 条 `id="normal"` 兜底规则
- 每条 condition 的 `field` / `op` 必须在白名单内
- `multiplier` 必须 ∈ [0, 500]

### `POST /api/strategy/active-fund-plans/delete`（管理员）

Body：`{ fundCode }`，软删除（直接从数组移除）。

### `GET /api/strategy/active-fund-recommendations`（公开）

```jsonc
{
  "success": true,
  "data": {
    "calculatedAt": "2026-05-25T20:08:00.000Z",
    "marketContext": {
      "benchmarks": {
        "000300": {
          "name": "沪深300",
          "pe": 14.64,
          "pePercentile": 92.08,
          "date": "2026-05-25"
        }
      }
    },
    "recommendations": [
      {
        "fundCode": "163415",
        "fundName": "兴全商业模式混合(LOF)A",
        "managerName": "乔迁",
        "navDate": "2026-05-22",
        "indicators": {
          "indexPePercentile": 92.08,
          "fundDrawdownAbs": 5.47,
          "fundGain3M": 8.33,
          "fundGain6M": 26.95
        },
        "hitRule": {
          "id": "pause",
          "label": "暂停定投",
          "color": "purple",
          "multiplier": 0
        },
        "monthlyAmount": 1000,
        "actualAmount": 0,
        "triggerReason": "沪深300 PE分位 92.08% ≥ 90%",
        "ruleScans": [
          { "id": "pause", "label": "暂停定投", "hit": true, "summary": "PE分位 92.08% ≥ 90%" },
          { "id": "half", "label": "减半定投", "hit": false, "summary": "PE 92.08% 已超出 [80%,90%)" },
          { "id": "double", "label": "加倍定投", "hit": false, "summary": "PE 92.08% 不满足 ≤20%" },
          { "id": "normal", "label": "正常定投", "hit": false, "summary": "已被前置规则命中" }
        ],
        "stale": false
      },
      { /* ... 008269 ... */ }
    ]
  }
}
```

## UI 设计

### 投资策略 Tab 结构（修订后）

```
┌──────────────────────────────────────────────┐
│  投资策略                                      │
│                                                │
│  ┌─ 主动基金定投策略 ──────────────────────┐  │
│  │ 市场状态：沪深300 PE 14.64 / 分位 92.08%│  │
│  │  ┌─ 兴全商业模式 · 乔迁 ──────────────┐│  │
│  │  │ 🟣 暂停定投   本月 0 元           ││  │
│  │  │ 触发依据：PE 分位 92.08% ≥ 90%    ││  │
│  │  │ ▼ 规则一览（默认折叠）            ││  │
│  │  └────────────────────────────────────┘│  │
│  │  ┌─ 大成睿享A · 徐彦 ──────────────────┐│ │
│  │  │ 🟡 减半定投   本月 500 元          ││  │
│  │  │ 触发依据：PE 分位 92.08% ∈ [80,95) ││  │
│  │  └────────────────────────────────────┘│  │
│  └────────────────────────────────────────┘  │
│                                                │
│  ┌─ 温度计定投策略（指数）─────────────────┐ │
│  │ ... 现状不变 ...                          │ │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 卡片视觉规则

档位徽章颜色（复用 `dca-thermometer-recommendation` 已有 CSS 变量）：
- 🔴 红：`--dca-low`（加倍）
- 🟢 绿：`--dca-mid-low`（正常）
- 🟡 黄：`--dca-mid-high`（减半）
- 🟣 紫：`--dca-high`（暂停）

「规则一览」默认折叠，点击展开显示 4 条规则的扫描结果（hit=⚠ 当前 / 未触发），每条带简短 summary。

### 管理员配置入口

复用现有"添加策略"按钮模式，在主动基金 section 右上角加 `＋ 添加主动基金策略`。
弹出表单包含：
1. 基金选择器（从已关注的主动基金中选）
2. 模板选择：[ ] 单因子 PE 模板（徐彦风格） / [ ] 双因子 PE+基金 模板（乔迁风格）
3. 阈值表单（按所选模板渲染对应字段）
4. 月定投基准金额输入

提交后后端将 UI 表单转成通用 `rules[]` 结构存储。

## Risks / 边界情况

| 风险 | 处理 |
|---|---|
| 蛋卷估值 API 返回空，无法获取 PE 分位 | 返回最近一次缓存（带 stale 标记），UI 显示"⚠ PE 数据陈旧"灰色提示，不阻塞渲染 |
| 基金净值 API 失败，无法计算回撤/涨幅 | 同上，使用 stale；若衍生指标缺失，跳过引用该字段的规则（视为不命中），降级匹配 |
| 用户配置了引用某字段的规则，但该字段当前不可用 | 规则扫描中标记 `hit=false`，summary="数据不可用"，确保不会因数据缺失而错误命中 |
| 多档同时命中（理论上修订后规则互斥，但代码安全网） | "命中即停"逻辑天然处理 |
| `monthlyAmount` 与 `multiplier` 计算出小数 | `actualAmount = Math.round(monthlyAmount * multiplier / 100)` |
| 兜底规则 `normal` 缺失 | 后端校验阻止保存（必须包含 `id="normal"`），前端表单也强制保留该档 |

## Migration / 兼容性

- 首次启动时，若 `data/active-fund-strategy.json` 不存在，**自动写入两只基金的预设规则**（按本文档"数据结构"小节给出的 JSON）
- 已关注的主动基金 watchlist 不变；本变更只是在 watchlist 之上叠加策略层
- 现有 `/api/strategy/dca-plans*` 系列接口完全不动，前端「温度计定投策略」section 不变
