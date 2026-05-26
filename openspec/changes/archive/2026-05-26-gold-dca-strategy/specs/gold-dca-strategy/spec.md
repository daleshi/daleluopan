## ADDED Requirements

### Requirement: 黄金定投策略数据持久化
系统 SHALL 提供持久化的黄金定投策略配置存储，独立于现有的指数温度计与主动基金定投策略。

#### Scenario: 首次启动自动初始化默认黄金策略
- **WHEN** 服务首次启动且 `data/gold-strategy.json` 不存在
- **THEN** 系统自动创建文件，写入默认配置：华安黄金ETF联接A (000216) + 4 档买入规则 (pause/double/half/normal) + 3 档止盈 (30%/60%/100%)

#### Scenario: 首次启动自动初始化空持仓表
- **WHEN** 服务首次启动且 `data/gold-holdings.json` 不存在
- **THEN** 系统创建文件并写入 `{ "records": [] }`

#### Scenario: 已存在配置不被覆盖
- **WHEN** `data/gold-strategy.json` 或 `data/gold-holdings.json` 已存在合法 JSON
- **THEN** 系统加载现有数据，不覆盖任何用户已配置内容

### Requirement: 读取黄金策略配置（公开）
系统 SHALL 提供 `GET /api/strategy/gold-plans`，未登录用户可读取所有黄金策略配置。

#### Scenario: 未登录读取策略列表
- **WHEN** 未登录用户 GET `/api/strategy/gold-plans`
- **THEN** 返回 200 + `{ success: true, data: { strategies: [...] } }`

#### Scenario: 空配置列表
- **WHEN** 配置文件存在但 strategies 为空
- **THEN** 返回 `{ success: true, data: { strategies: [] } }`，不抛错

### Requirement: 创建或更新黄金策略（管理员）
系统 SHALL 提供 `POST /api/strategy/gold-plans`，仅管理员可调用，按 `fundCode` 执行 upsert。

#### Scenario: 未登录返回 401
- **WHEN** 未登录用户 POST 一个合法策略
- **THEN** 返回 401

#### Scenario: 普通用户返回 403
- **WHEN** 已登录但角色为 `user` 的用户 POST 策略
- **THEN** 返回 403

#### Scenario: 管理员创建新基金策略
- **WHEN** 管理员 POST 一个 `fundCode` 不存在于策略列表的合法对象
- **THEN** 系统追加该策略并返回 200 + 完整列表

#### Scenario: 管理员更新已有基金策略
- **WHEN** 管理员 POST 一个 `fundCode` 已存在的策略对象
- **THEN** 系统替换该 fundCode 对应的策略条目，更新 `updatedAt` 时间戳

#### Scenario: 缺少 fundCode → 400
- **WHEN** 管理员 POST 缺失 `fundCode` 的对象
- **THEN** 返回 400 + 错误说明

#### Scenario: monthlyAmount ≤ 0 → 400
- **WHEN** `monthlyAmount` 为 0、负数或非数字
- **THEN** 返回 400 + "每月定投金额必须为正数"

#### Scenario: rules 缺少 normal 兜底 → 400
- **WHEN** rules 数组中不存在 `id === "normal"` 的规则
- **THEN** 返回 400 + "必须包含 normal 兜底规则"

#### Scenario: 规则使用未授权 field → 400
- **WHEN** 任一 condition 的 `field` 不在 `["fundPricePercentile5Y", "fundDrawdown1Y"]` 白名单内
- **THEN** 返回 400 + 错误说明

#### Scenario: takeProfitTiers 未按 thresholdReturn 升序 → 400
- **WHEN** `takeProfitTiers` 数组不是按 `thresholdReturn` 严格升序
- **THEN** 返回 400 + "止盈档必须按收益阈值升序排列"

#### Scenario: takeProfitTiers 的 sellPct 超出 [0, 100] → 400
- **WHEN** 任一 tier 的 `sellPct` < 0 或 > 100
- **THEN** 返回 400 + "sellPct 必须在 0-100 之间"

### Requirement: 删除黄金策略（管理员）
系统 SHALL 提供 `POST /api/strategy/gold-plans/delete`，仅管理员可删除。

#### Scenario: 未登录返回 401
- **WHEN** 未登录用户调用删除接口
- **THEN** 返回 401

#### Scenario: 删除已存在的策略
- **WHEN** 管理员发送 `{ fundCode: "000216" }` 且策略存在
- **THEN** 系统从数组中移除并返回 200 + 剩余列表

#### Scenario: 删除不存在的策略 → 404
- **WHEN** 管理员发送的 `fundCode` 不在策略列表
- **THEN** 返回 404 + "该策略不存在"

### Requirement: 实时计算黄金买入档位与止盈状态
系统 SHALL 提供 `GET /api/strategy/gold-recommendations`，公开读取，返回每只黄金基金的当前买入档位、推荐金额、触发依据、持仓汇总与止盈进度。

#### Scenario: 数据齐全时返回完整推荐
- **WHEN** 基金净值可获取且 NAV 序列充足（≥60 天）
- **THEN** 返回 `indicators` (含 `fundPricePercentile5Y` / `fundDrawdown1Y`)、`hitRule`、`actualAmount`、`triggerReason`、`ruleScans`、`holdings`、`takeProfitStatus`、`stale: false`

#### Scenario: 高位暂停档（验收用例）
- **GIVEN** 华安黄金联接A NAV = 3.4561，近5年价格分位 = 92.96%，近1年回撤 = 19.61%
- **WHEN** 用户调用推荐接口
- **THEN** `hitRule.id === "pause"`，`actualAmount === 0`，`triggerReason` 包含 "92.96% ≥ 90%"

#### Scenario: 暂停档优先于加倍档
- **GIVEN** 价格分位 = 91% AND 回撤 = 30%
- **WHEN** 用户调用推荐接口
- **THEN** `hitRule.id === "pause"`（不命中加倍，即使回撤≥25%）

#### Scenario: 加倍档 OR 联结
- **GIVEN** 价格分位 = 50% AND 回撤 = 28%（回撤命中、分位不命中）
- **WHEN** 用户调用推荐接口
- **THEN** `hitRule.id === "double"`，`actualAmount === monthlyAmount * 2`

#### Scenario: 减半档
- **GIVEN** 价格分位 = 80% AND 回撤 = 5%
- **WHEN** 用户调用推荐接口
- **THEN** `hitRule.id === "half"`，`actualAmount === monthlyAmount * 0.5`

#### Scenario: 兜底正常档
- **GIVEN** 价格分位 = 50% AND 回撤 = 5%
- **WHEN** 用户调用推荐接口
- **THEN** `hitRule.id === "normal"`，`actualAmount === monthlyAmount`

#### Scenario: 持仓汇总正确
- **GIVEN** 持仓记录中有 5 笔 buy（合计 5000 元、1500 份额）+ 1 笔 sell（500 元、150 份额）
- **WHEN** 用户调用推荐接口
- **THEN** `holdings.totalCost === 4500`（5000-500），`holdings.totalShares === 1350`（1500-150）

#### Scenario: 持仓为空时返回 null 收益率
- **WHEN** 该基金尚无任何持仓记录
- **THEN** `holdings.totalCost === 0`、`holdings.totalReturnPct === null`，所有 takeProfitTier 状态为 `pending`

#### Scenario: 止盈档状态 — triggered
- **WHEN** 某档的 `triggeredAt` 不为 null
- **THEN** `takeProfitStatus[i].state === "triggered"`，包含 `triggeredAt` 时间

#### Scenario: 止盈档状态 — actionable
- **WHEN** 某档 `triggeredAt` 为 null 且当前 `totalReturnPct >= thresholdReturn`
- **THEN** `takeProfitStatus[i].state === "actionable"`，附带 `suggestion: { shares, amountApprox }`，其中 `shares = totalShares * sellPct / 100`

#### Scenario: 止盈档状态 — pending
- **WHEN** 某档 `triggeredAt` 为 null 且 `totalReturnPct < thresholdReturn`
- **THEN** `takeProfitStatus[i].state === "pending"`

#### Scenario: NAV 数据不可用降级
- **WHEN** 基金净值接口失败且无缓存
- **THEN** 返回 `stale: true`，`indicators.fundPricePercentile5Y === null`，引用该字段的规则均视为不命中，命中兜底 normal 档

#### Scenario: 净值序列不足 60 天
- **WHEN** NAV 序列长度 < 60（基金太新或数据残缺）
- **THEN** `indicators.fundPricePercentile5Y === null`、`indicators.fundDrawdown1Y === null`，命中兜底 normal 档

#### Scenario: 接口缓存
- **WHEN** 同一基准窗口内（交易时段 5 分钟、休市 30 分钟）多次调用
- **THEN** 命中 smartCacheGet，直接返回相同结果

### Requirement: 持仓记录管理（黄金）
系统 SHALL 提供持仓记录的读写接口，所有定投买入和止盈卖出都作为独立事件记录。

#### Scenario: 公开读取持仓记录
- **WHEN** 未登录用户 GET `/api/strategy/gold-holdings`
- **THEN** 返回 200 + `{ records: [...] }`（按日期降序）

#### Scenario: 管理员新增 buy 记录
- **WHEN** 管理员 POST 一条 `{ type: "buy", fundCode, date, amount, shares, nav }` 合法对象
- **THEN** 系统生成 `id`，追加到 records 数组，返回 200

#### Scenario: 管理员新增 sell 记录并联动止盈档
- **WHEN** 管理员 POST 一条 `{ type: "sell", fundCode, tierId: "tp30", date, amount, shares, nav }`
- **THEN** 系统追加记录 AND 将对应基金 strategy 中 `takeProfitTiers[tp30].triggeredAt` 设为 `date` 对应的 ISO 时间戳

#### Scenario: 缺失字段 → 400
- **WHEN** POST body 缺少 `type` 或 `fundCode` 或 `date` 或 `amount` 或 `shares` 或 `nav`
- **THEN** 返回 400 + 错误字段说明

#### Scenario: type 非法值 → 400
- **WHEN** `type` 不在 `["buy", "sell"]`
- **THEN** 返回 400

#### Scenario: 数值字段非正数 → 400
- **WHEN** `amount` 或 `shares` 或 `nav` ≤ 0 或非数字
- **THEN** 返回 400

#### Scenario: 删除 buy 记录
- **WHEN** 管理员 POST `/api/strategy/gold-holdings/delete` body `{ id }` 且该记录是 buy
- **THEN** 系统从 records 中移除该条，返回 200 + 剩余列表

#### Scenario: 删除 sell 记录联动重置止盈档
- **WHEN** 管理员删除一条 type=sell 且 tierId 非空的记录
- **THEN** 系统移除该 record AND 将对应 tier 的 `triggeredAt` 重置为 null

#### Scenario: 删除不存在的记录 → 404
- **WHEN** `id` 不存在于 records 列表
- **THEN** 返回 404

#### Scenario: 普通用户/未登录无写权限
- **WHEN** 未登录或角色为 user 的用户调用 POST/delete 接口
- **THEN** 返回 401 / 403

### Requirement: 投资策略 Tab 展示黄金定投卡片
系统 SHALL 在「投资策略」Tab 内新增独立的「黄金定投策略」section，与现有「主动基金定投」「温度计定投」并列。

#### Scenario: 每只黄金基金一张卡片
- **WHEN** 当前有 N 个黄金策略配置
- **THEN** 渲染 N 张卡片，每张包含买入端 + 持有端 + 止盈进度 + 持仓记录折叠区

#### Scenario: 当前买入档位徽章显示
- **WHEN** 卡片渲染时，`hitRule.color` 为 red/yellow/green/purple
- **THEN** 徽章使用对应配色（与主动基金一致）

#### Scenario: 持仓汇总显示
- **WHEN** 卡片渲染时
- **THEN** 显示累计成本、累计份额、当前市值、累计收益率（百分比，正负染色）

#### Scenario: 止盈进度条 — 3 档显示
- **WHEN** 卡片渲染时
- **THEN** 显示 3 行止盈档，每行带状态徽章：
  - `triggered`：✅ 灰底 + 触发时间 + 已卖出比例
  - `actionable`：⚠ 金色高亮 + 建议份额/金额 + 「已止盈」按钮
  - `pending`：⏳ 灰色 + 距离阈值还差多少百分点

#### Scenario: 管理员可见操作按钮
- **WHEN** 当前用户为管理员
- **THEN** 卡片显示 [编辑] [删除] [＋ 添加持仓记录]；section 顶部显示 [＋ 添加策略]

#### Scenario: 非管理员看不到管理按钮
- **WHEN** 用户未登录或角色为 user
- **THEN** 不显示任何添加/编辑/删除按钮，但能看到推荐内容

#### Scenario: stale 数据警告
- **WHEN** API 返回 `stale: true`
- **THEN** 卡片顶部显示灰色 "⚠ 数据陈旧" 标签

#### Scenario: 空配置态
- **WHEN** 黄金策略列表为空
- **THEN** 显示 "暂无黄金定投策略" + 管理员可见的 "＋ 添加策略" 按钮

### Requirement: 用户确认型止盈
系统 SHALL 在止盈档达到 actionable 状态时提供 UI 确认按钮，用户点击后才标记触发并创建对应 sell 记录。

#### Scenario: 点击「已止盈」弹出确认表单
- **WHEN** 管理员点击 actionable 档的 「已止盈」 按钮
- **THEN** 弹出表单，预填：fundCode、tierId、type="sell"、date=今天、建议金额、建议份额（基于 `sellPct * totalShares`）

#### Scenario: 提交确认表单创建 sell 记录并触发 tier
- **WHEN** 用户确认表单并提交
- **THEN** 系统创建 sell 类型 holding 记录 AND 设置 tier `triggeredAt`，UI 自动刷新显示该档为 triggered

#### Scenario: 取消确认表单不产生副作用
- **WHEN** 用户点击「取消」
- **THEN** 不创建任何记录、tier 状态不变

#### Scenario: 重复触发已 triggered 的档
- **WHEN** 管理员尝试对 `triggeredAt` 非 null 的 tier 再次确认
- **THEN** 后端拒绝并返回错误"该止盈档已触发，请先删除关联的卖出记录"

### Requirement: 管理员可视化配置黄金策略
系统 SHALL 为管理员提供策略与持仓记录的可视化表单，避免直接编辑 JSON。

#### Scenario: 添加/编辑策略表单
- **WHEN** 管理员点击 [＋ 添加策略] 或 [编辑]
- **THEN** 弹出表单包含：基金代码选择器、月定投金额、4 档买入规则阈值、3 档止盈阈值与卖出比例

#### Scenario: 表单提交转译为后端结构
- **WHEN** 用户填写完成并提交
- **THEN** 前端将表单值组装成 `rules[]` + `takeProfitTiers[]`，包含 normal 兜底，POST 给后端

#### Scenario: 添加持仓记录表单
- **WHEN** 管理员点击 [＋ 添加持仓记录]
- **THEN** 弹出表单包含：基金、类型(buy/sell)、日期、金额、份额、净值、备注

#### Scenario: 删除二次确认
- **WHEN** 管理员点击 [删除策略] 或 [删除记录]
- **THEN** 浏览器 `confirm()` 提示二次确认，用户确认后才发起 API 调用
