## ADDED Requirements

### Requirement: ETF 定投策略数据持久化
系统 SHALL 提供持久化的 ETF 定投策略配置存储，独立于现有的三类策略文件。

#### Scenario: 首次启动自动初始化默认 ETF 策略
- **WHEN** 服务首次启动且 `data/etf-strategy.json` 不存在
- **THEN** 系统自动创建文件并写入 4 只默认 ETF 策略：科创50(588080)、创业板50(159949)、有色金属(512400)、恒生科技(513180)
- **AND** 每只 ETF 含完整的 priceTiers（5档）、takeProfitTiers（3档）、crashTiers（3级）

#### Scenario: 已存在配置不被覆盖
- **WHEN** `data/etf-strategy.json` 已包含合法 JSON
- **THEN** 系统加载现有数据，不修改任何用户已配置内容

### Requirement: ETF 持仓数据独立持久化
系统 SHALL 提供独立的 `data/etf-holdings.json` 存储 ETF 持仓事件流，与黄金的 `gold-holdings.json` 完全隔离。

#### Scenario: 首次启动自动创建空持仓表
- **WHEN** 服务启动时 `data/etf-holdings.json` 不存在
- **THEN** 系统创建空 `etf-holdings.json` (`{ "records": [] }`)

#### Scenario: 不影响黄金持仓
- **WHEN** ETF 模块读写持仓数据
- **THEN** 仅读写 `data/etf-holdings.json`，不读写 `data/gold-holdings.json`

#### Scenario: 不修改黄金 API
- **WHEN** 客户端调用 `GET/POST /api/strategy/gold-holdings*`
- **THEN** 系统返回与本次变更前完全相同的响应（黄金 API 完全不变）

### Requirement: 读取 ETF 策略配置（公开）
系统 SHALL 提供 `GET /api/strategy/etf-plans`，未登录用户可读取所有 ETF 策略配置。

#### Scenario: 未登录读取
- **WHEN** 未登录用户 GET 接口
- **THEN** 返回 200 + `{ success: true, data: { strategies: [...] } }`

### Requirement: 创建或更新 ETF 策略（管理员）
系统 SHALL 提供 `POST /api/strategy/etf-plans`，仅管理员可调用，按 fundCode 执行 upsert。

#### Scenario: 未登录返回 401
- **WHEN** 未登录用户 POST
- **THEN** 返回 401

#### Scenario: 普通用户返回 403
- **WHEN** 角色为 user 的用户 POST
- **THEN** 返回 403

#### Scenario: 管理员创建新策略
- **WHEN** 管理员 POST 一个 fundCode 不存在的合法策略
- **THEN** 系统追加到列表并返回 200 + 完整列表

#### Scenario: 管理员更新已有策略
- **WHEN** 管理员 POST 一个 fundCode 已存在的策略
- **THEN** 系统替换该条目，更新 updatedAt 时间戳

#### Scenario: 缺少 fundCode → 400
- **WHEN** POST 缺失 fundCode 字段
- **THEN** 返回 400 + 错误说明

#### Scenario: priceTiers 为空 → 400
- **WHEN** priceTiers 数组为空
- **THEN** 返回 400 + "至少需要一档价格区间"

#### Scenario: priceTiers 区间交叉 → 400
- **WHEN** 任意两档的 [priceMin, priceMax) 区间存在重叠
- **THEN** 返回 400 + "价格区间不能交叉"

#### Scenario: takeProfitTiers 的 sellPct 越界 → 400
- **WHEN** sellPct ≤ 0 或 > 100
- **THEN** 返回 400 + "sellPct 必须在 (0, 100] 之间"

#### Scenario: crashTiers 的 threshold > 0 → 400
- **WHEN** 任一 crashTier 的 threshold > 0
- **THEN** 返回 400 + "暴跌阈值必须 ≤ 0"

#### Scenario: 升级时保留 triggeredAt
- **WHEN** 管理员更新策略，已有某 takeProfitTier 的 triggeredAt 非空
- **THEN** 即使 POST body 中该 tier 的 triggeredAt 是 null，系统也保留原值

### Requirement: 删除 ETF 策略（管理员）
系统 SHALL 提供 `POST /api/strategy/etf-plans/delete`，仅管理员可删除。

#### Scenario: 删除存在的策略
- **WHEN** 管理员发送 `{ fundCode: "588080" }` 且策略存在
- **THEN** 系统从数组中移除并返回 200 + 剩余列表

#### Scenario: 删除不存在的策略 → 404
- **WHEN** fundCode 不在列表
- **THEN** 返回 404 + 错误说明

### Requirement: ETF 实时推荐计算
系统 SHALL 提供 `GET /api/strategy/etf-recommendations`，公开读取，返回每只 ETF 的当前入场档位、推荐定投金额、止盈状态、暴跌信号。

#### Scenario: 数据齐全时返回完整推荐
- **WHEN** ETF 实时行情可获取
- **THEN** 返回每只 ETF 的 currentPrice / hitTier / monthlyAmount / triggerReason / tierScans / holdings / takeProfitStatus / monthChangePct / crashSignal / stale: false

#### Scenario: 暂停档触发（验收用例 — 科创50）
- **GIVEN** 科创50 ETF 当前价 = 1.913
- **WHEN** 用户调用推荐接口
- **THEN** hitTier.id === "pause"，monthlyAmount === 0，triggerReason 包含 "1.913 > 1.60"

#### Scenario: 加倍定投档触发（验收用例 — 恒生科技）
- **GIVEN** 恒生科技 ETF 当前价 = 0.630
- **WHEN** 用户调用推荐接口
- **THEN** hitTier.id === "normal" 或 "double"（取决于当前阈值），actualAmount > 0

#### Scenario: 价格落在区间右开边界
- **GIVEN** ETF 某档区间 priceMin = 1.22 priceMax = 1.60
- **WHEN** 当前价 = 1.60
- **THEN** 不命中该档（区间右开），落入更高档（priceMin = 1.60 ...）

#### Scenario: 价格高于所有档位上限
- **GIVEN** ETF 所有档位的最高 priceMin = 1.60，但当前价 = 5.0
- **WHEN** 用户调用推荐接口
- **THEN** hitTier === 最高档（暂停档，priceMax = null），按该档配置返回 monthlyAmount

#### Scenario: 价格低于所有档位下限
- **GIVEN** ETF 所有档位的最低 priceMax = 0.72，但当前价 = 0.3
- **WHEN** 用户调用推荐接口
- **THEN** hitTier === 最低档（极限档，priceMin = null）

#### Scenario: 实时行情不可用降级
- **WHEN** ETF 行情接口失败且无缓存
- **THEN** 返回 stale: true，currentPrice = null，hitTier = null，triggerReason 包含 "行情数据不可用"

#### Scenario: 持仓汇总集成
- **GIVEN** 该 ETF 在 etf-holdings.json 中有 N 笔 buy 记录
- **WHEN** 用户调用推荐接口
- **THEN** holdings 返回正确的 totalCost / totalShares / marketValue（按当前价）/ totalReturnPct

#### Scenario: 止盈档评估
- **GIVEN** ETF 持仓累计收益率 = 60%，takeProfitTier tp1 触发条件为 fundReturnPct >= 50
- **WHEN** 用户调用推荐接口
- **THEN** takeProfitStatus[tp1].state === "actionable"，附带 suggestion: { shares, amountApprox }

#### Scenario: 月度涨跌幅计算与暴跌信号
- **GIVEN** ETF 当前价相对 22 个交易日前下跌 15%
- **WHEN** 用户调用推荐接口
- **THEN** monthChangePct ≈ -15，crashSignal === lv1 (一级·加倍)，crashSignalText 包含 "下跌 15%" 及 "三倍月投"

#### Scenario: 未触发任何暴跌档
- **WHEN** monthChangePct = -8（未达 lv1 阈值 -12）
- **THEN** crashSignal === null，crashSignalText 包含 "未触发暴跌档"

#### Scenario: 接口缓存
- **WHEN** 同一缓存窗口内（交易 5min / 休市 30min）多次调用
- **THEN** 命中 smartCacheGet，返回相同结果

### Requirement: ETF 持仓记录管理（独立接口）
系统 SHALL 提供 `/api/strategy/etf-holdings*` 系列接口管理 ETF 持仓，与黄金的 `/api/strategy/gold-holdings*` 完全独立。

#### Scenario: 公开读取 ETF 持仓
- **WHEN** 未登录用户 GET `/api/strategy/etf-holdings`
- **THEN** 返回 200 + 持仓记录数组（按日期降序）

#### Scenario: 管理员新增 ETF 持仓
- **WHEN** 管理员 POST `/api/strategy/etf-holdings` body `{ fundCode: "588080", type: "buy", date, amount, shares, nav }`
- **THEN** 系统追加记录到 `data/etf-holdings.json`，返回 200

#### Scenario: 未登录写入返回 401
- **WHEN** 未登录用户 POST `/api/strategy/etf-holdings`
- **THEN** 返回 401

#### Scenario: 普通用户写入返回 403
- **WHEN** 角色为 user 的用户 POST `/api/strategy/etf-holdings`
- **THEN** 返回 403

#### Scenario: 字段校验
- **WHEN** POST body 缺少必填字段（fundCode/type/date/amount/shares/nav）或字段非法
- **THEN** 返回 400 + 错误说明

#### Scenario: ETF sell 记录关联 takeProfitTier
- **WHEN** 管理员 POST sell 类型 + tierId 关联 ETF 的某 takeProfitTier
- **THEN** 系统追加记录并自动将该 tier 的 triggeredAt 设为该 date 的 ISO 时间戳

#### Scenario: 删除关联 tier 的 sell 记录
- **WHEN** 管理员删除一条 sell 类型 + 关联 tierId 的记录
- **THEN** 系统删除记录并将对应 tier 的 triggeredAt 重置为 null

#### Scenario: 删除不存在的记录 → 404
- **WHEN** 管理员 POST `/api/strategy/etf-holdings/delete` body `{ id: "NOT_EXIST" }`
- **THEN** 返回 404

#### Scenario: 黄金 API 不受影响
- **WHEN** 客户端调用 `GET/POST /api/strategy/gold-holdings*`
- **THEN** 系统行为与本次变更前完全一致（黄金持仓接口、数据文件、行为均不变）

### Requirement: 投资策略 Tab 展示 ETF 卡片
系统 SHALL 在「投资策略」Tab 内新增第 4 个 section「ETF 投资策略」，与黄金/主动基金/温度计并列。

#### Scenario: 每只 ETF 一张卡片
- **WHEN** 当前有 N 个 ETF 策略
- **THEN** 渲染 N 张卡片，每张含：当前档位徽章、本月推荐金额、触发依据、5档进度、持仓汇总、止盈进度、暴跌信号、持仓记录折叠区

#### Scenario: 当前入场档徽章颜色
- **WHEN** hitTier.color 为 red/yellow/green/orange/purple
- **THEN** 徽章使用对应配色

#### Scenario: 暴跌信号高亮
- **WHEN** crashSignal 非空（已触发某级暴跌档）
- **THEN** 卡片顶部显示醒目警戒横条 + 该档的 label + executionHint

#### Scenario: stale 数据警告
- **WHEN** API 返回 stale: true
- **THEN** 卡片显示 "⚠ 行情数据陈旧" 灰色标签

#### Scenario: 非管理员看不到管理按钮
- **WHEN** 用户未登录或角色为 user
- **THEN** 不显示添加/编辑/删除策略和持仓记录的按钮，但完整展示推荐内容

#### Scenario: 持仓为空
- **WHEN** 该 ETF 持仓记录为空
- **THEN** holdings 区域显示 "暂无持仓"，止盈档全部 pending

### Requirement: ETF 策略可视化配置
系统 SHALL 为管理员提供 ETF 策略的可视化创建/编辑表单。

#### Scenario: 添加 ETF 策略表单
- **WHEN** 管理员点击 [＋ 添加 ETF 策略]
- **THEN** 弹出表单包含：基金代码、名称、配置比例、5 档价格区间表格、3 档止盈表格、3 级暴跌表格

#### Scenario: 编辑现有策略
- **WHEN** 管理员点击某 ETF 的 [编辑]
- **THEN** 表单预填该 ETF 当前配置，fundCode 锁定不可编辑

#### Scenario: 删除二次确认
- **WHEN** 管理员点击 [删除策略]
- **THEN** 浏览器 confirm() 提示二次确认，用户确认后才发起 API 调用

### Requirement: ETF 暴跌信号检测
系统 SHALL 基于 ETF 近 22 个交易日的价格变化计算月度涨跌幅，并据此判定 3 级暴跌警戒。

#### Scenario: 月度涨跌幅计算
- **WHEN** 计算暴跌信号时
- **THEN** monthChangePct = (currentPrice − price_22_days_ago) / price_22_days_ago × 100

#### Scenario: K线数据不足 22 个交易日
- **WHEN** ETF 上市时间太短或 K 线接口数据不足
- **THEN** monthChangePct = null，crashSignal = null，crashSignalText 包含 "K线数据不足"

#### Scenario: 按防御优先匹配暴跌等级
- **GIVEN** crashTiers 配置 [lv1: -12, lv2: -20, lv3: -30]，monthChangePct = -25
- **WHEN** 评估暴跌信号
- **THEN** crashSignal === lv2（严苛档优先匹配）
