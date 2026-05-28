## Why

主动基金定投策略上线后，用户依据自身研究迭代了「兴全商业模式 A·乔迁」与「大成睿享 A·徐彦」两只基金的定投矩阵。新规则引入更细的市场分层（5~7 档而非 4 档）、新增「加强定投」中间档（150% 强度）、并加入两个当前引擎不支持的判定维度：基金接近近一年新高、基金经理是否更换。当前规则引擎与默认配置无法表达这些新规则，必须扩展引擎能力并刷新两条默认策略才能让用户看到与图表完全一致的推荐档位。

## What Changes

- 规则引擎 `services/activeFundStrategyEngine.js` 扩展：
  - **ADD** 衍生指标 `fundGain1Y`（近 1 年涨幅，% 可正负）
  - **ADD** 衍生指标 `fundDistanceToYearHighPct`（当前净值距近一年最高净值的回撤绝对值，% 正数；用于"创近一年新高附近"判定）
  - **ADD** 策略级数据源：从基金接口读取最新基金经理名 → 与配置 `managerName` 比对 → 输出 `managerChanged: boolean`，引擎以此作为最高优先级"暂停新增"判据
  - **ADD** 触发依据中文文案对新字段/经理更换的支持
- 规则档位枚举扩展：新增 `boost`（加强定投，multiplier=150，color=`blue`），与现有 `pause / half / normal / double` 共存；档位语义：`pause(purple) < half(yellow) < normal(green) < boost(blue) < double(red)`
- 默认策略 `data/active-fund-strategy.json` 升级（仅替换 `rules` 数组并刷新 `updatedAt`，保留 fundCode/fundName/managerName/benchmarkIndex/monthlyAmount/drawdownBaseline）：
  - **AND/OR 不对称语义**：加仓类（double/boost/normal）保持 **AND**（市场便宜 AND 基金便宜，缺一不可）；减仓类（pause/half）改为 **OR**（市场过热 OR 基金过热，任一即触发，符合用户决策矩阵中"防御从严"原则）
  - **大成睿享 A**（5 条规则 + 经理变更短路）：经理变更 → pause(OR)：PE≥90% OR 近3月涨幅≥15% → half(OR)：PE≥80% OR 近3月涨幅≥10% → double(AND)：PE≤20% AND 回撤≥15% → boost(AND)：PE≤20% AND 回撤 ∈ [5%, 15%) → 兜底 normal
  - **兴全商业模式 A**（7 条规则 + 经理变更短路）：经理变更 → pause-extreme(OR)：PE≥90% OR 距近1年新高≤2% → pause-overheat(OR)：PE≥80% OR 近1年涨幅>50% → half(OR)：PE≥60% OR 近1年涨幅>40% → double(AND)：PE≤20% AND 回撤≥20% → boost(AND)：PE≤20% AND 回撤 ∈ [10%, 20%) → boost-mid(AND)：PE 20-60% AND 回撤≥15% → 兜底 normal
- API `POST /api/strategy/active-fund-plans` 校验扩展：白名单字段 + 接受 `boost` 作为合法 rule.id（无强制校验，仅文档化）
- 前端「投资策略」Tab 主动基金 section：
  - 卡片徽章新增 `boost` 蓝色样式
  - 规则扫描表格支持新字段中文显示（"近1年涨幅" / "距近1年新高"）
  - 卡片头部增加"经理更换"红色警示横条（当 `managerChanged === true`）
  - 管理员编辑表单的"档位下拉"新增"加强定投"选项；condition.field 下拉新增两个新字段
- 单元测试 `tests/activeFundEngine.test.js` 增加：
  - 新衍生指标计算正确性（gain1y / distanceToYearHigh）
  - 经理更换检测的 happy/missing/equal 三种路径
  - 两条新默认规则的命中场景验收（参考图中各档典型值）

## Capabilities

### New Capabilities

（无 — 复用现有 capability）

### Modified Capabilities

- `active-fund-dca-strategy`: 规则引擎扩展两个衍生字段 + 经理更换检测；新增 `boost` 档位枚举；默认配置规则刷新；API 字段白名单同步扩展。

## Impact

- **代码**：
  - `services/activeFundStrategyEngine.js`（核心修改：~120 行新增/调整）
  - `services/fundFetcher.js`（小修改：在公开导出中确保 `currentManager`/`managerName` 字段可用 — 若已可用则不改动）
  - `data/active-fund-strategy.json`（数据迁移：覆盖两条记录的 `rules` 字段）
  - `server.js`（小修改：白名单字段同步 + ensureDefaultActiveFundStrategies 刷新）
  - `public/index.html`（前端：徽章配色 + 经理更换横条 + 表单档位/字段下拉 + 触发依据中文）
  - `tests/activeFundEngine.test.js` / `tests/activeFundStrategy.test.js`（新增 ~15 用例）
- **API 兼容性**：
  - `GET /api/strategy/active-fund-plans` / `recommendations` 响应结构 ADDITIVE：仅追加新字段（`indicators.fundGain1Y` / `fundDistanceToYearHighPct` / `managerChanged` / `currentManager`），老字段不变 → **非破坏性**
  - `POST /api/strategy/active-fund-plans` 仍支持只用旧字段构造的策略 → **非破坏性**
- **数据兼容性**：
  - `active-fund-strategy.json` 旧规则中如残留旧档位（pause/half/normal/double），引擎完全兼容；新增 `boost` 仅在新默认配置中出现
  - 服务首次启动时 `ensureDefaultActiveFundStrategies()` 检测两条默认策略 `rules` 是否仍是旧版本（特征：缺失 `boost` 档），是则覆盖 `rules` 字段；管理员手动修改过的策略（`updatedAt` > 默认刷新时间或规则结构与新默认不同）则保留，不覆盖
- **前端兼容性**：管理员可视化表单需识别新档位/新字段；非管理员视图自动降级（经理更换横条仅依赖 API 返回，无需前端配置）
- **运行依赖**：基金经理名信息已由 `services/fundFetcher.js` 在 pingzhongdata 中提取（已有 `currentManager` 字段），无新外部依赖
- **风险**：基金经理姓名字段在数据源个别情况下可能为空 → 引擎降级策略：`currentManager == null` 时 `managerChanged = false`（视为未更换，避免误触发暂停）
