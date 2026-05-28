## Context

主动基金定投 capability 自 2026-05-26 上线后，承载了用户对 2 只主动基金（兴全商业模式 A·乔迁、大成睿享 A·徐彦）的定投决策。规则引擎采用通用 `field/op/value` + AND/OR 组合 + 命中即停的设计，原本支持 4 档（pause/half/normal/double）。本次用户依据图表升级两套规则，引入了引擎不支持的判据：

1. **基金近一年涨幅**（`fundGain1Y`）— 衡量基金本身在近 1 年是否过热
2. **基金距近一年新高的回撤**（`fundDistanceToYearHighPct`）— 衡量基金是否站在新高附近
3. **基金经理是否更换**（`managerChanged`）— 当前经理姓名 ≠ 配置 `managerName` 时触发，且为最高优先级"暂停新增"
4. **加强定投档**（multiplier=150）— 介于 normal(100) 和 double(200) 之间的中间档

这些扩展的共同特点是：**仍能复用现有 `field/op/value` 通用引擎**（前两项是新指标字段、第四项是新档位常量），唯独"经理更换"是策略级一次性比对（不是 condition 字段），需要在引擎主入口做一次 short-circuit 判断。

## Goals / Non-Goals

**Goals:**
- 在不破坏现有 capability 公开 API 形状的前提下扩展引擎，让两条新默认规则 100% 可表达
- 保持"命中即停"语义不变；新增 `boost` 档作为 `multiplier=150 / color=blue` 的标准档
- 经理更换检测自动化（无需管理员手动维护），数据源缺失时降级为不触发（避免误暂停）
- 保留管理员对老策略的自定义修改：仅在策略 `rules` 仍是 v1 默认快照时才覆盖；管理员改过即不动
- 单元测试全量回归 + 新增覆盖（gain1Y / distanceToYearHigh / managerChanged 三个新维度）

**Non-Goals:**
- 不改 capability 名称、不改 API 路径、不改前端整体布局（仅小范围增加徽章配色与经理警示横条）
- 不引入新的外部数据源（fundFetcher 的 pingzhongdata 已含 `managers[0].name`，复用即可）
- 不实现"自动检测经理更换 → 自动暂停 N 个月再恢复"的时间轴逻辑（仍是即时比对，由用户决定何时改 `managerName`）
- 不变更 `data/active-fund-strategy.json` 的 schema（仅增加可选字段，不破坏老结构）
- 不实现"近1年涨幅/距新高"以外的更多衍生指标（如 Sharpe / 波动率），保持作用域聚焦

## Decisions

### 1. 经理更换检测 — 引擎自动比对（Q1=B）

**决策**: 在 `computeRecommendations` 主流程中，每只基金额外暴露 `currentManager`（来自 `fetchEastmoneyFundData` 的 `managers[0].name`），与策略配置 `managerName` 直接做字符串相等比对，输出 `managerChanged: boolean`。该 flag 不进入通用 `indicators` 字段池，而是在主入口直接 **short-circuit**：当 `managerChanged === true` 时跳过整个规则扫描，直接返回一条合成档位 `{ id: "managerChanged", label: "暂停新增", color: "purple", multiplier: 0 }`。

**Rationale**:
- 经理更换是一次性策略级判断，不属于"市场状态条件"；硬塞进 `condition.field` 会污染规则评估的语义边界
- 所有规则前置短路的设计与"防御优先"原则一致；UI 也只需识别一个特殊 hitRule.id 即可加红色警示横条
- 数据源缺失（`managers` 数组为空、name 为空字符串）时 `managerChanged = false` → 视为未更换 → 不暂停（避免数据故障误触发）

**Alternatives considered**:
- 把 `managerChanged` 作为 `ALLOWED_FIELDS` 之一，让默认规则用 `{ field: "managerChanged", op: "==", value: 1 }` 表达 → 否决：bool 与数值字段混用让 condition 语义碎片化，且管理员若忘记在每条策略最顶端加这条规则就无效，可靠性差
- 让管理员手动勾选 `managerChanged` 字段 → 否决（用户选 B 自动检测）

### 2. 基金近一年涨幅与距新高 — 衍生指标，复用 field 白名单（Q2=B）

**决策**: 在 `computeFundIndicators` 中新增两个返回字段：
- `gain1y`: 当前净值相对约 365 天前净值的涨幅（与现有 gain3m/gain6m 同算法，复用 `navAtDaysAgo(365)`）
- `distanceToYearHighPct`: `(yearHigh - latestNav) / yearHigh × 100`，其中 `yearHigh` = 近 365 天内的最高净值

`ALLOWED_FIELDS` 追加 `fundGain1Y` 与 `fundDistanceToYearHighPct`；`FIELD_LABELS` / `FIELD_UNITS` 同步追加。规则引擎本身无需改动（仍走通用 condition 评估路径）。

**Rationale**:
- 与黄金 capability 的 `fundPricePercentile5Y` / `fundDrawdown1Y` 对偶设计完全一致（5Y/1Y 双轨衍生指标），保持引擎心智模型统一
- `distanceToYearHighPct` 比 `近一年价格分位 ≥ 95%` 在表达"创近一年新高附近"上更直观（"距高点 ≤ 2%" 是用户在图中明确表述的语义）
- 数据缺失（净值序列不足 365 天 / 不足 5 个采样点）时返回 `null`，引擎已有降级逻辑可直接处理

**Alternatives considered**:
- 用 `fundPricePercentile1Y ≥ 95%` 替代 `distanceToYearHighPct ≤ 2%` → 用户选 B，已否决
- 让用户手动配置近一年高点价格 → 否决（应自动从净值序列计算）

### 3. `boost` 加强定投档 — multiplier=150，color=blue（Q3=B）

**决策**: 在前端 / API 校验 / 默认策略中均把 `boost` 视为合法档 id；引擎本身不感知具体 id（按 `multiplier` 计算金额），但 UI 需要新增蓝色徽章配色映射：
- 后端：`server.js` POST 校验中，rule.id 不再做白名单（已经如此），multiplier 范围保留 0-500
- 前端：徽章 color → CSS 变量 mapping 增加 `blue → var(--accent-blue, #3b82f6)`；模板下拉框「档位类型」增加"加强定投"选项
- 默认策略：兴全 3 条 boost 档、大成睿享 0 条 boost 档（按图）

**Rationale**:
- 与 ETF capability 的 5 档配色梯度（red/yellow/green/orange/purple）保持视觉差异化（蓝色避免与 ETF 重复 orange，让用户在视觉上一眼区分主动基金 boost 与 ETF normal）
- multiplier=150 与图中"1.5M"完全对应，月定投基准 1000 元 → 实际 1500 元
- 新增档不破坏老策略：老配置中没有 boost 档，仍走 pause/half/normal/double 四档逻辑

**Alternatives considered**:
- color=orange → 否决（与 ETF 5 档配色冲突，用户选 B）
- 复用 dca-mid-* 现有 CSS 变量 → 否决（蓝色无现成变量，需新增 `--accent-blue` 与 `--dca-boost`）

### 4. 默认配置覆盖策略 — 智能升级，仅替换 v1 默认 rules（Q4=A）

**决策**: 在 `ensureDefaultActiveFundStrategies()`（server.js 启动时执行）中追加"v2 升级检测"步骤：

```
对于 fundCode in ['163415', '008269']:
  if 当前策略的 rules 数组特征匹配 v1 默认快照（哈希签名/规则条数/condition 集合相等）:
    覆盖 rules 字段 + 更新 updatedAt
    保留 monthlyAmount / managerName / benchmarkIndex / drawdownBaseline 等其他字段
  else:
    跳过（管理员已自定义，不动）
```

**Rationale**:
- 用户提示明确："只替换 rules 字段 + 更新 updatedAt，保留其他字段"。这是对管理员可能已修改 monthlyAmount 等字段的尊重
- 用 v1 规则签名（如 SHA-1 of `JSON.stringify(rules)`）作为识别口径，比单纯按 `updatedAt` 时间戳更可靠（避免误判管理员手动 save 但内容未实质改变的情况）
- 新装/新初始化场景：如 active-fund-strategy.json 不存在，则按 v2 默认全量写入（与现有逻辑一致）

**Alternatives considered**:
- 完全重写两条策略 → 否决（用户选 A）
- 引入版本号字段 `schemaVersion: 2` → 否决（侵入数据 schema，且老用户的文件无版本号，仍需 fallback 到签名比对，多此一举）

### 5. 规则评估顺序 — 严格"命中即停"，加仓 AND / 减仓 OR 的不对称逻辑

**决策**: 按用户决策矩阵明确：
- **加仓类（double / boost / normal）= AND**：市场便宜 **且** 基金便宜，缺一不可（避免市场低估但基金还在高位的"过早抄底"）
- **减仓类（pause / half）= OR**：市场过热 **或** 基金过热，任一即触发防御（防御从严，避免双重确认延误）
- **经理变更**：始终为最高优先级引擎主入口短路（不进 OR 链 condition），保证语义清晰

两条新默认策略的 rules 数组按以下严格顺序排列（命中即停，越严苛越前）：

**大成睿享 A**（5 条 + 经理变更短路）:
1. `managerChanged`（合成档，引擎短路）
2. `pause` (logic=**OR**): `PE≥90%` OR `近3月涨幅≥15%` → multiplier=0
3. `half` (logic=**OR**): `PE 80-90%` 区间命中 OR `近3月涨幅≥10%` → multiplier=50
4. `double` (logic=**AND**): `PE≤20%` AND `回撤≥15%` → multiplier=200
5. `boost` (logic=**AND**): `PE≤20%` AND `回撤 ∈ [5%, 15%)` → multiplier=150
6. `normal`: 兜底（空 conditions）→ multiplier=100

**兴全商业模式 A**（7 条 + 经理变更短路）:
1. `managerChanged`（合成档）
2. `pause-extreme` (logic=**OR**): `PE≥90%` OR `距近1年新高≤2%` → 0
3. `pause-overheat` (logic=**OR**): `PE≥80%` OR `近1年涨幅>50%` → 0
4. `half` (logic=**OR**): `PE≥60%`（上界由命中即停天然保护）OR `近1年涨幅>40%` → 50
5. `double` (logic=**AND**): `PE≤20%` AND `回撤≥20%` → 200
6. `boost` (logic=**AND**): `PE≤20%` AND `回撤 ∈ [10%, 20%)` → 150
7. `boost-mid` (logic=**AND**): `PE 20-60%` AND `回撤≥15%` → 150
8. `normal`: 兜底 → 100

**关于"PE 区间"在 OR 语义下的表达**:
对于减仓档"PE 80-90%"这类区间约束，由于规则整体 logic=OR，单纯放 `{PE≥80%}` 一条会造成"PE≥90% 时也被 half 命中"的覆盖问题。但因为 **pause 永远排在 half 之前**（命中即停），PE≥90% 会先被 pause OR 链截获，half 不会被错误触发。因此 **half 的 PE 条件只需写下界 `PE≥80%`**，区间上界由命中即停天然保证。同理 boost-mid 的 PE 20-60% 写为 `PE>=20%`（上界由更前置的 boost 与减仓档保护）。

**Rationale**:
- AND/OR 不对称语义符合"加仓需双重确认、减仓需单点警觉"的图中明确决策矩阵
- 命中即停 + 防御优先排序自然消化"OR 区间上界"问题，无需引擎额外支持区间运算符
- 经理变更不进 OR 链，避免在 condition.field 中混入 bool 类型字段（保持 `field/op/value` 语义统一为数值比较）
- 大成 6→5 条、兴全 8→7 条，规则更精简，每条职责更单一

**Alternatives considered**:
- 给 half 写完整区间 `{PE≥80%, PE<90%, 涨幅≥10%}` + logic=OR → 否决：OR 下"PE≥80%"自身就命中，三条件 OR 等价于"PE≥80% OR PE<90% OR 涨幅≥10%"几乎永真，错误的语义
- 引擎扩展第二种 logic（如 `(A AND B) OR C` 嵌套表达式） → 否决：当前架构以"命中即停 + 平铺 conditions"换简洁，引入嵌套破坏可视化配置表单的规则模型

### 6. API 与数据形状 — 仅 ADDITIVE 字段

**决策**: `GET /api/strategy/active-fund-recommendations` 响应每只基金对象 ADD：
- `currentManager: string|null` — 实时基金经理名
- `managerChanged: boolean` — 经理是否变更
- `indicators.fundGain1Y: number|null`
- `indicators.fundDistanceToYearHighPct: number|null`
- `peakNav1Y: number|null` / `peakDate1Y: string|null` — 近一年最高净值与日期（用于 UI 提示）

老字段（hitRule / actualAmount / triggerReason / ruleScans / stale / indicators.*）形状全部不变。

**Rationale**:
- 100% additive，前端老逻辑无需调整即可工作；新 UI 元素读到字段才生效，否则降级为不显示
- 与 ETF / 黄金 capability 的字段命名风格统一（`fundXxx` / `peakXxxNY`）

## Risks / Trade-offs

- **[Risk] 基金经理姓名在数据源偶尔为空** → Mitigation: `currentManager == null/'' → managerChanged = false`，并在 ruleScans 中保留 v1 通用规则评估（不短路）。前端读 `managerChanged !== true` 时不显示警示横条
- **[Risk] 净值序列不足 365 天导致 `gain1y` / `distanceToYearHighPct` 为 null** → Mitigation: 复用现有 `null → 视为不命中` 路径；管理员可在前端规则模板中配置 fallback 行为，但默认策略的兴全/大成均运营 1 年以上，实际场景不会触发
- **[Risk] v1 默认规则签名比对误伤** → Mitigation: 签名只检查 `rules` 字段而非整个策略对象；管理员任何对 rules 的实质性修改（增删条目、改阈值）都会让签名不匹配从而保留其修改；签名生成函数用稳定字段顺序的 JSON 序列化（先按 id 排序再 stringify）
- **[Risk] `boost` 档名 `boost-mid` / `pause-yearGain` 在前端徽章渲染时识别困难** → Mitigation: 前端按 `hitRule.color`（而非 id）映射徽章配色；id 仅用于日志与扫描表格 summary
- **[Trade-off] 新增 2 个衍生字段 = 每次推荐计算多一次 `navAtDaysAgo(365)` 与近一年最高扫描** → 实际开销可忽略（净值序列长度通常 <2000 点，O(n) 一次扫描），不必额外缓存
