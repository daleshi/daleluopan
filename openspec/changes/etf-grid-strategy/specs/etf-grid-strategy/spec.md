## ADDED Requirements

### Requirement: 网格策略配置数据持久化

系统 SHALL 提供独立的 `data/etf-grid-strategy.json` 存储所有 ETF 网格策略配置，与既有 `data/etf-strategy.json`（定投）完全隔离。

#### Scenario: 首次启动自动创建空策略文件

- **GIVEN** 服务首次启动且 `data/etf-grid-strategy.json` 不存在
- **WHEN** 后端初始化数据文件
- **THEN** 系统创建 `data/etf-grid-strategy.json` 并写入 `{ "strategies": [] }`
- **AND** 不预置任何默认策略（所有策略由用户在 UI 内手动添加）

#### Scenario: 已存在配置不被覆盖

- **GIVEN** 文件已含用户配置
- **WHEN** 服务重启
- **THEN** 系统加载现有数据，不修改任何字段

#### Scenario: 与 ETF 定投数据独立

- **WHEN** 用户操作网格策略（读/写/删）
- **THEN** 系统仅读写 `data/etf-grid-strategy.json`，不读写 `data/etf-strategy.json`

---

### Requirement: 网格成交记录数据持久化

系统 SHALL 提供独立的 `data/etf-grid-holdings.json` 存储网格交易的成交事件流。

#### Scenario: 首次启动创建空持仓表

- **GIVEN** 服务启动时 `data/etf-grid-holdings.json` 不存在
- **WHEN** 后端初始化
- **THEN** 系统创建文件并写入 `{ "records": [] }`

#### Scenario: 与既有 ETF 持仓独立

- **WHEN** 用户操作网格持仓
- **THEN** 系统仅读写 `data/etf-grid-holdings.json`，不影响 `data/etf-holdings.json` 或 `data/gold-holdings.json`

---

### Requirement: 网格策略配置字段结构

系统 SHALL 使用统一的结构存储每只 ETF 的网格策略，所有字段均由用户配置，代码不预置默认值。

#### Scenario: 策略对象必需字段

- **GIVEN** 用户提交网格策略
- **WHEN** 后端持久化
- **THEN** 该策略对象 SHALL 至少包含以下字段：
  - `fundCode` (string): ETF 基金代码，如 "588080"
  - `fundName` (string): ETF 全名
  - `shortName` (string): 简称
  - `secid` (string): 东财 secid，用于取行情
  - `gridStep` (number): 每格步长百分比，范围 (0, 0.5]（即 0-50%）
  - `gridLevels` (number): 单侧网格数量，范围 [1, 20] 整数
  - `basePrice` (number): 网格中线价格，> 0
  - `totalBudget` (number): 网格总预算（元），> 0
  - `baseAmount` (number): 底仓资金（元），≥ 0 且 ≤ `totalBudget`
  - `amountPerGrid` (number): 每格触发金额（元），> 0
  - `feeRate` (number|null): 单边手续费率，如 0.0015 表示 0.15%；null 则使用系统默认 0.0015
  - `pauseWhenTempAbove` (number|null): 温度 > N 时暂停买入；null 则无此保护
  - `cooldownAfterConsecutiveBuys` ({ n, days }|null): 连续 N 网买入后暂停 M 天；null 则无此保护
  - `status` (string): "running" | "paused" | "archived"
  - `createdAt` (ISO string)、`updatedAt` (ISO string)

#### Scenario: 修改策略视为新一轮

- **GIVEN** 用户已有 fundCode='588080' 策略，且已录入多条网格成交
- **WHEN** 管理员通过 POST 修改该策略的任一字段
- **THEN** 系统更新配置并将 `updatedAt` 刷新为当前时间
- **AND** 前端在保存前弹窗提示"这将开启新一轮网格计算，历史成交记录会锁定到旧版本"
- **AND** 历史 `etf-grid-holdings` 记录仅保留展示，不参与新网格实时信号计算

---

### Requirement: 读取网格策略配置（公开）

系统 SHALL 提供 `GET /api/strategy/etf-grid-plans`，未登录用户可读取。

#### Scenario: 未登录读取

- **WHEN** 未登录用户 GET
- **THEN** 返回 200 + `{ success: true, data: { strategies: [...] } }`

#### Scenario: 无任何策略时返回空数组

- **GIVEN** 首次启动、无用户配置
- **WHEN** 调用接口
- **THEN** 返回 `data: { strategies: [] }`（不是 null）

---

### Requirement: 创建或更新网格策略（管理员）

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans`，按 fundCode 执行 upsert，仅管理员可调用。

#### Scenario: 未登录 → 401

- **WHEN** 未登录用户 POST
- **THEN** 返回 401 + `{ success: false, error: '请先登录' }`

#### Scenario: 普通用户 → 403

- **WHEN** 角色为 user 的用户 POST
- **THEN** 返回 403 + `{ success: false, error: '需要管理员权限' }`

#### Scenario: 管理员创建新策略

- **WHEN** 管理员 POST 一个 fundCode 不存在的合法策略
- **THEN** 系统追加到列表并返回 200 + 完整列表；新策略 `createdAt` = `updatedAt` = 当前时间；`status = 'running'`

#### Scenario: 管理员更新已有策略

- **WHEN** 管理员 POST 一个 fundCode 已存在的策略
- **THEN** 系统替换该条目、保留 `createdAt` 不变、更新 `updatedAt`

#### Scenario: 缺少必填字段 → 400

- **WHEN** POST 缺少 fundCode / gridStep / gridLevels / basePrice / totalBudget / baseAmount / amountPerGrid 任一字段
- **THEN** 返回 400 + 错误说明具体缺失字段

#### Scenario: gridStep 越界 → 400

- **WHEN** gridStep ≤ 0 或 gridStep > 0.5
- **THEN** 返回 400 + "步长必须在 (0, 50%] 范围"

#### Scenario: gridLevels 越界 → 400

- **WHEN** gridLevels < 1 或 gridLevels > 20 或非整数
- **THEN** 返回 400 + "单侧网数必须是 1-20 的整数"

#### Scenario: basePrice / totalBudget / amountPerGrid ≤ 0 → 400

- **WHEN** 上述任一字段 ≤ 0 或非数字
- **THEN** 返回 400 + 对应字段错误说明

#### Scenario: baseAmount 超过 totalBudget → 400

- **WHEN** baseAmount > totalBudget
- **THEN** 返回 400 + "底仓金额不能超过总预算"

#### Scenario: 资金超配软警告（允许保存）

- **GIVEN** `baseAmount + amountPerGrid × gridLevels > totalBudget`
- **WHEN** 管理员 POST
- **THEN** 系统仍保存策略并返回 200，但响应中 `warnings` 数组包含 "满仓资金 X 元超出总预算 Y 元"

---

### Requirement: 删除网格策略（管理员）

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans/delete`。

#### Scenario: 删除存在的策略

- **WHEN** 管理员 POST `{ fundCode: '588080' }` 且策略存在
- **THEN** 系统移除该条目并返回 200 + 剩余列表；关联的成交记录**不会**被删除（仅保留归档展示）

#### Scenario: 删除不存在 → 404

- **WHEN** fundCode 不在列表
- **THEN** 返回 404 + "策略不存在"

---

### Requirement: 重置网格中线（管理员）

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans/reset-base-price`，允许管理员在单边行情后重置中线以开启新一轮。

#### Scenario: 有效重置

- **WHEN** 管理员 POST `{ fundCode: '588080', newBasePrice: 0.85 }`
- **THEN** 系统更新该策略的 `basePrice` 为 0.85，`updatedAt` 刷新，返回 200 + 更新后策略
- **AND** 与"修改策略视为新一轮"一致：历史成交锁定到旧版本

#### Scenario: 未指定 newBasePrice → 使用当前价

- **WHEN** POST body 缺少 newBasePrice
- **THEN** 系统读取该 ETF 实时价作为新中线；若行情不可得则返回 400 + "无法获取实时价，请手动指定"

---

### Requirement: 网格成交记录管理

系统 SHALL 提供 `/api/strategy/etf-grid-holdings*` 系列接口。

#### Scenario: 公开读取

- **WHEN** 未登录用户 GET `/api/strategy/etf-grid-holdings`
- **THEN** 返回 200 + `{ success: true, data: { records: [...] } }`，按日期降序

#### Scenario: 管理员补录成交

- **WHEN** 管理员 POST `{ fundCode, type, gridLevel, date, price, shares, amount }`（type ∈ {"base", "buy", "sell"}，gridLevel 为整数）
- **THEN** 系统追加 record 到 `etf-grid-holdings.json`，含自动生成的 `id`（UUID）与 `createdAt`

#### Scenario: 底仓成交 gridLevel = 0

- **GIVEN** type = "base"
- **WHEN** 管理员 POST
- **THEN** gridLevel MUST = 0；若非 0 返回 400

#### Scenario: 买入成交 gridLevel < 0

- **GIVEN** type = "buy"
- **WHEN** 管理员 POST
- **THEN** gridLevel MUST < 0 且 |gridLevel| ≤ 对应策略的 gridLevels；否则 400

#### Scenario: 卖出成交 gridLevel > 0

- **GIVEN** type = "sell"
- **WHEN** 管理员 POST
- **THEN** gridLevel MUST > 0 且 gridLevel ≤ 对应策略的 gridLevels；否则 400

#### Scenario: 字段校验

- **WHEN** POST 缺少必填字段（fundCode/type/gridLevel/date/price/shares/amount）或字段非法
- **THEN** 返回 400 + 具体错误

#### Scenario: 未登录写入 → 401；普通用户 → 403

- **WHEN** 未登录/user 角色 POST
- **THEN** 分别返回 401 / 403

#### Scenario: 删除成交记录

- **WHEN** 管理员 POST `/api/strategy/etf-grid-holdings/delete` `{ id }`
- **THEN** 系统删除对应记录并返回 200 + 剩余列表；id 不存在返回 404

---

### Requirement: 网格实时推荐视图

系统 SHALL 提供 `GET /api/strategy/etf-grid-recommendations`，返回每只网格策略的综合运行状态。

#### Scenario: 完整推荐字段

- **WHEN** 客户端 GET
- **THEN** 返回每只策略的对象含以下字段：
  - `fundCode`、`fundName`、`shortName`
  - `currentPrice` (number|null)、`quoteSource`、`stale` (boolean)
  - `basePrice`、`gridStep`、`gridLevels`
  - `distanceToBasePct` (number): 当前价距中线百分比
  - `nearestGrid`: { level, price, action: "buy"|"sell" } — 距当前价最近**未触发**的网线
  - `gridTable`: 完整网格价位表数组，每项 `{ level, targetPrice, action, status, filledCost, filledShares, expectedNetPct }`
  - `holdings`: { baseFilled, gridBuysFilled, gridSellsExecuted, remainingBudget, totalCostBasis }
  - `pnl`: { realized (已实现网格利润), unrealizedFloat (浮动盈亏), totalReturnPct }
  - `protection`: { paused: boolean, reason: string|null } — 保护机制生效状态
  - `updatedAt` (ISO string)

#### Scenario: 网格价位表准确性

- **GIVEN** basePrice = 1.00、gridStep = 0.05、gridLevels = 5
- **WHEN** 后端计算 gridTable
- **THEN** 上侧 +1..+5 的 targetPrice 依次为 1.05、1.1025、1.157625、1.21550625、1.2762815625（保留 4 位小数四舍五入）
- **AND** 下侧 −1..−5 的 targetPrice 依次为 0.9524、0.9070、0.8638、0.8227、0.7835（`1/(1+step)^n` 后四舍五入到 4 位）

#### Scenario: 单轮预期净利率

- **GIVEN** gridStep = 0.05、feeRate = 0.0015
- **WHEN** 后端计算 gridTable 每一档的 expectedNetPct
- **THEN** `expectedNetPct = ((1 + gridStep)² − 1) − 2 × feeRate` = 10.25% − 0.30% = 9.95%

#### Scenario: 已触发网格状态

- **GIVEN** 用户已在 gridLevel = −1 补录一笔 buy 成交
- **WHEN** GET 推荐视图
- **THEN** gridTable 中 level = −1 的 `status = "filled"`，`filledCost`、`filledShares` 取自成交记录汇总；其他未触发档 status = "waiting"

#### Scenario: 距中线百分比

- **GIVEN** currentPrice = 0.980、basePrice = 1.00
- **WHEN** 后端计算
- **THEN** `distanceToBasePct = (0.980 - 1.00) / 1.00 × 100 = -2.0`（保留 1 位小数）

#### Scenario: 最近未触发网线

- **GIVEN** currentPrice = 0.965、basePrice = 1.00、gridStep = 0.05、已触发 -1、-2
- **WHEN** 后端计算 nearestGrid
- **THEN** `nearestGrid = { level: -3, price: 0.8638, action: "buy" }`（跳过已触发档）

#### Scenario: 温度暂停保护生效

- **GIVEN** 策略配置 `pauseWhenTempAbove = 70`，当前市场温度 = 75°
- **WHEN** GET 推荐视图
- **THEN** `protection = { paused: true, reason: "市场温度 75° > 阈值 70°，暂停买入" }`
- **AND** gridTable 中下侧买入档全部标 `status = "paused"`（不影响上侧卖出档）

#### Scenario: 连续买入冷却保护

- **GIVEN** `cooldownAfterConsecutiveBuys = { n: 3, days: 2 }`，最近 2 天内已连续在 3 个网格触发买入
- **WHEN** GET 推荐视图
- **THEN** `protection = { paused: true, reason: "连续 3 网买入后冷却中，剩余 X 天" }`

#### Scenario: 实时行情不可用降级

- **WHEN** ETF 行情接口失败且无缓存
- **THEN** 返回 `stale: true`、`currentPrice = null`、`nearestGrid = null`、`distanceToBasePct = null`

#### Scenario: 接口缓存

- **WHEN** 同一缓存窗口内（交易时段 30 秒 / 休市 30 分钟）多次调用
- **THEN** 命中 `smartCacheGet('etf-grid-recommendations', ...)`

---

### Requirement: 已实现利润与浮动盈亏统计

系统 SHALL 分别计算并透出 3 类盈亏：底仓浮盈、网格已实现利润、网格未平仓浮动盈亏。

#### Scenario: 底仓浮盈

- **GIVEN** 一条 type="base" 成交：price = 1.00、amount = 40000、shares = 40000
- **AND** 当前价 = 1.05
- **WHEN** 后端计算
- **THEN** `holdings.baseFilled = { cost: 40000, shares: 40000, avgPrice: 1.00, marketValue: 42000, floatPnl: 2000, floatPnlPct: 5.0 }`

#### Scenario: 网格已实现利润 — 单轮闭环

- **GIVEN** 用户在 gridLevel = -1 买入 5000 元，之后在 gridLevel = +1 卖出对应份数
- **WHEN** 后端计算
- **THEN** `pnl.realized` 累加该笔完整轮转的净利润（按 FIFO 或先进先出配对）

#### Scenario: 网格未平仓浮动

- **GIVEN** 用户在 gridLevel = -1、-2 各买入 5000 元但未卖出
- **AND** 当前价接近 basePrice
- **WHEN** 后端计算
- **THEN** `pnl.unrealizedFloat` = (当前价 × 累计份数) − 累计成本

#### Scenario: 总收益率

- **GIVEN** totalBudget = 100000、baseFilled.cost = 40000、gridBuys.cost = 10000
- **WHEN** 后端计算
- **THEN** `pnl.totalReturnPct = (realized + unrealizedFloat + baseFloat) / totalCostBasis × 100`（保留 2 位小数）

---

### Requirement: 投资策略 Tab 展示网格 SubTab

系统 SHALL 在"投资策略"Tab 内新增 `data-substrat="etf-grid"` 的 SubTab，与既有 6 个 SubTab（etf、gold、active-fund、sp500、thermometer、benchmark）并列。

#### Scenario: SubTab 按钮存在

- **WHEN** 用户切换到"投资策略"Tab
- **THEN** SubTab 导航栏含"🕸️ ETF 网格"按钮

#### Scenario: 每只策略一张卡片

- **WHEN** 当前有 N 个网格策略
- **THEN** 渲染 N 张卡片；每张卡片含：
  - 头部：ETF 图标 + 名称 + 代码 + 状态徽章（running/paused）+ 管理按钮（管理员可见）
  - 摘要行：当前价、距中线%、下一步动作提示
  - 配置块：步长、单侧网数、中线、总预算、每格金额
  - 运行状态块：已建底仓、已触发买入网数、已触发卖出网数、剩余弹药、已实现利润、浮动盈亏
  - 网格价位表折叠区（默认展开）：每档一行含目标价、状态徽章、成本、单轮净利、[补录]按钮
  - 成交记录折叠区（默认收起）：最近 5 条 + 「查看全部」

#### Scenario: 无策略时的空状态

- **GIVEN** 无任何网格策略
- **WHEN** 用户切换到 SubTab
- **THEN** 显示空状态提示；管理员看到 [＋ 添加网格策略] 按钮；普通用户仅显示提示文本

#### Scenario: 网格价位表状态徽章配色

- **WHEN** 渲染网格价位表某一行
- **THEN** 状态 "waiting" 灰色、"filled" 绿色（买入）或红色（卖出）、"paused" 橙色

#### Scenario: 当前价指示

- **GIVEN** 网格价位表按档位从高到低垂直排列（+N 在顶、−N 在底）
- **WHEN** currentPrice 落在某两档之间
- **THEN** 表格该位置绘制一条横线 + "当前 ¥X.XXX" 标注，视觉上明确当前价的位置

#### Scenario: 保护机制状态展示

- **GIVEN** protection.paused = true
- **WHEN** 渲染卡片
- **THEN** 卡片顶部显示醒目警戒横条 + protection.reason 文字

#### Scenario: stale 数据警告

- **WHEN** API 返回 stale = true
- **THEN** 卡片显示"⚠ 行情数据陈旧"灰色标签

#### Scenario: 非管理员看不到管理按钮

- **WHEN** 用户未登录或角色为 user
- **THEN** 不显示添加/编辑/删除策略、补录/删除成交、重置中线的按钮；但完整展示所有推荐内容与网格价位表

---

### Requirement: 网格策略配置表单

系统 SHALL 为管理员提供网格策略的可视化创建/编辑表单。

#### Scenario: 添加网格策略表单

- **WHEN** 管理员点击 [＋ 添加网格策略]
- **THEN** 弹出表单包含以下输入项：
  - 选择 ETF（下拉：从 ETF 关注列表或全 ETF 池）+ 自动带出 fundName / secid
  - 步长 gridStep（% 输入，默认空）
  - 单侧网数 gridLevels（整数输入，默认空）
  - 中线 basePrice（价格输入；辅助按钮 [使用当前价] / [使用 52 周中位数]）
  - 总预算 totalBudget（元）
  - 底仓金额 baseAmount（元；辅助显示"占比 X%"）
  - 每格金额 amountPerGrid（元；辅助显示"剩余预算 / 网数 = 建议 X 元/格"）
  - 手续费率 feeRate（%；默认 0.15）
  - 保护机制：温度阈值 pauseWhenTempAbove（可选，留空则关闭）
  - 保护机制：连续买入冷却 cooldownAfterConsecutiveBuys（n 网 + m 天，可选）

#### Scenario: 实时预览网格价位表

- **GIVEN** 表单已填入 gridStep / gridLevels / basePrice / amountPerGrid / feeRate
- **WHEN** 任一字段变更
- **THEN** 表单底部实时刷新一张预览表：从 +gridLevels 到 −gridLevels 每档的目标价、单轮预期净利、总资金占用；无需保存即可看到

#### Scenario: 编辑现有策略

- **WHEN** 管理员点击某网格策略的 [编辑]
- **THEN** 表单预填该策略当前配置，fundCode 锁定不可编辑；保存时弹窗二次确认"这将开启新一轮网格计算"

#### Scenario: 删除二次确认

- **WHEN** 管理员点击 [删除策略]
- **THEN** 浏览器 confirm() 提示二次确认，用户确认后才发起 API 调用

#### Scenario: 重置中线操作

- **WHEN** 管理员点击 [重置中线]
- **THEN** 弹出小表单让用户输入新中线（可选，留空则使用当前价）；确认后调用 `/api/strategy/etf-grid-plans/reset-base-price`

---

### Requirement: 网格成交补录表单

系统 SHALL 为管理员提供在网格价位表任一档位快速补录成交的表单。

#### Scenario: 快速补录

- **WHEN** 管理员点击某网格档位的 [补录] 按钮
- **THEN** 弹出表单预填 gridLevel、targetPrice 作为价格建议；用户输入实际成交日期 / 价格 / 份数 / 金额，type 根据 gridLevel 自动确定（<0 → buy、=0 → base、>0 → sell）

#### Scenario: 校验成交金额一致性

- **GIVEN** 用户输入 price = 0.94、shares = 5320
- **WHEN** 用户输入 amount 但值与 price × shares 相差 > 1%
- **THEN** 前端提示"金额与价格×份数不匹配"，但允许保存（考虑到手续费等）

#### Scenario: 补录后自动刷新卡片

- **WHEN** 补录成功
- **THEN** 前端调用推荐接口刷新，网格价位表该档 status 变为 "filled"

---

### Requirement: 移动端响应式

新增的网格 SubTab 与卡片 SHALL 在移动端（≤480px）保持可用，网格价位表可横向滚动或紧凑展示。

#### Scenario: 移动端网格价位表

- **GIVEN** 屏幕宽度 ≤ 480px
- **WHEN** 渲染网格价位表
- **THEN** 表格切换为紧凑模式：字号 11px、只显示核心 3 列（档位、目标价、状态），[补录] 按钮改为图标

#### Scenario: 移动端表单

- **WHEN** 管理员在手机上打开策略配置表单
- **THEN** 输入项自动堆叠为单列，实时预览表格可横向滚动
