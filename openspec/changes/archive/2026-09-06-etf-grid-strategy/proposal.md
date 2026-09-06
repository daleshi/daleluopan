## Why

用户希望在"投资策略"Tab 内新增**指数 ETF 网格交易策略**功能。当前项目已有 5 类策略（ETF 定投 / 黄金定投 / 主动基金 / 标普500 / 温度计定投），但都是**单向累积**模型——只买不卖或按估值触发卖。而"网格交易"是完全不同的心智模型：

- **触发条件**：纯价格触发（不看时间、不看估值）
- **方向**：双向——价格上涨 X% 卖一格、下跌 X% 买一格
- **收益来源**：震荡波动 ×（1+X%)² − 1 的每轮毛利
- **数学模型**：等比对称网格，`价格 = 中线 × (1 + 步长)^档位`

用户计划配置科创50 (588080)、恒生科技 (513180)、创业板50 (159949) 三只 ETF 做网格。核心诉求：

1. 能够选择指数 ETF、设置网格金额目标、计划多少网、每网多少钱
2. 设置底仓资金
3. 保存策略后能看到**未来所有网格触发点的价格与单轮收益率**
4. 与现有 ETF 定投策略**并存但独立**（同一 ETF 可以既做定投又做网格）

## What Changes

- **新增 `etf-grid-strategy` capability**：
  - 独立数据文件 `data/etf-grid-strategy.json`（策略配置）与 `data/etf-grid-holdings.json`（成交事件流）
  - 与既有 `etf-strategy.json` / `etf-holdings.json` 完全隔离，互不影响
  - **首次启动不预置任何策略**——文件初始化为 `{ "strategies": [] }`、`{ "records": [] }`，全部策略由用户在 UI 内手动添加
- **等比对称网格数据模型**：
  - 核心参数：`gridStep`（每格步长%）、`gridLevels`（单侧网数）、`basePrice`（中线）、`totalBudget`（总预算）、`baseAmount`（底仓）、`amountPerGrid`（每格金额）
  - 派生量（不入库，实时计算）：网格价位表 = `basePrice × (1 + gridStep)^n`，n ∈ [−gridLevels, +gridLevels]
  - 单轮毛利率 = `(1 + gridStep)² − 1`
  - 无"买卖比例"字段（等比网格默认对称）
- **配置完全可编辑，不写死默认值**：
  - 所有字段（步长、层数、中线、总预算、底仓、每格金额、保护开关）均通过 UI 表单输入
  - 保护机制作为**可选配置项**：`pauseWhenTempAbove`（温度 > N 时暂停买入）、`cooldownAfterConsecutiveBuys`（连续 N 网买入后暂停 M 天）
- **后端 API**（管理员写、公开读，遵循既有 `etf-plans` 风格）：
  - `GET /api/strategy/etf-grid-plans` — 公开读取所有网格策略
  - `POST /api/strategy/etf-grid-plans` — 管理员 upsert（按 fundCode）
  - `POST /api/strategy/etf-grid-plans/delete` — 管理员删除
  - `POST /api/strategy/etf-grid-plans/reset-base-price` — 管理员手动重置中线（触发新一轮）
  - `GET /api/strategy/etf-grid-holdings` — 公开读取成交记录
  - `POST /api/strategy/etf-grid-holdings` — 管理员补录 buy/sell（含 gridLevel 关联）
  - `POST /api/strategy/etf-grid-holdings/delete` — 管理员删除记录
  - `GET /api/strategy/etf-grid-recommendations` — 综合视图：每只 ETF 的实时价、距最近网线距离、下一步动作、已实现利润、浮动利润
- **前端新增 "🕸️ ETF 网格" SubTab**（投资策略 Tab 内第 7 个）：
  - 每只网格策略一张卡片
  - 卡片显示：当前价 / 距中线% / 下一步动作（买入 XXX 价 或 卖出 XXX 价）/ 已建底仓 / 已触发买入网数 / 剩余弹药 / 已实现利润
  - 展开区：**完整网格价位表**（从 +N 到 −N 每一档：目标价、状态[待触发/已触发]、单轮预期净利、操作按钮）
  - 成交记录折叠区（最近 5 条 + 「查看全部」）
- **策略修改语义**：修改策略配置视为"新一轮开始"，历史成交锁定不参与新网格计算（弹窗提醒用户）
- **手续费默认参数**：`feeRate = 0.15%`（单边），可在策略级配置覆盖，用于单轮净利预估
- **金额触发单位**：按元金额（`amountPerGrid` 元），触发时估算份数 = `amountPerGrid / 当前价`
- **不引入自动执行**：系统只提供"信号提示 + 手动补录"，不接券商，与既有 ETF 定投的运行模式一致

## Capabilities

### New Capabilities

- `etf-grid-strategy`: 指数 ETF 等比对称网格交易策略的配置管理、成交记账、可视化与实时信号

### Modified Capabilities

无（与现有 `etf-dca-strategy` 独立并存，同一 ETF 可同时存在两类策略）。

## Impact

- **后端**: 
  - `server.js` 新增 8 个 API 路由（`/api/strategy/etf-grid-*`）与配套 `readEtfGridStrategies` / `writeEtfGridStrategies` / `readEtfGridHoldings` / `writeEtfGridHoldings` 辅助函数
  - 新增计算模块（如 `services/etfGridEngine.js`）：网格价位表生成、单轮净利计算、实时信号推荐
  - 与既有 `smartCacheGet` 集成：`etf-grid-recommendations` 缓存键（交易时段 30s / 休市 30min）
- **数据文件**（新建，首次启动为空）:
  - `data/etf-grid-strategy.json` = `{ "strategies": [] }`
  - `data/etf-grid-holdings.json` = `{ "records": [] }`
- **前端**: 
  - `public/index.html` 新增 `data-substrat="etf-grid"` SubTab + 完整 section + 表单模态框 + JS 渲染逻辑
  - 新增 CSS 类 `.grid-*`（配色借鉴现有 `.afund-*` 与 `.etf-detail-52w-*`）
- **API 兼容性**: 全部新增路由，不改动既有接口；`etf-dca-strategy` 完全不受影响
- **测试 / 部署**: 无 lint / 单元测试框架变更；PM2 重启即生效；首次部署无需数据迁移（文件不存在时自动创建为空）
- **风险控制**: 
  - 修改策略清空未来网格状态，弹窗二次确认
  - 表单校验：`gridStep ∈ (0, 50]%`、`gridLevels ∈ [1, 20]`、`baseAmount + amountPerGrid × gridLevels ≤ totalBudget`（软警告，允许保存）
