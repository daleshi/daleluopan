## ADDED Requirements

### Requirement: 网格策略数据文件初始化与持久化

系统 SHALL 将 ETF 网格策略配置持久化到 `data/etf-grid-strategy.json`（结构 `{ strategies: [...] }`），将成交记录持久化到 `data/etf-grid-holdings.json`（结构 `{ records: [...] }`），并使用 `services/db/atomicWrite.js` 的 `writeJsonAtomic` 进行原子写入。

#### Scenario: 首次启动创建空数据文件

- **WHEN** 服务启动且 `data/etf-grid-strategy.json` 或 `data/etf-grid-holdings.json` 不存在
- **THEN** 系统 SHALL 创建对应文件并写入空数组结构，**不预置任何策略数据**，并记录一条 `[ETF网格]` 前缀的启动日志

#### Scenario: 原子写入避免半截文件

- **WHEN** 管理员保存策略配置或成交记录
- **THEN** 系统 SHALL 通过临时文件 + rename 的方式原子替换目标文件，写入过程中进程中断不会留下损坏的 JSON

#### Scenario: 读取损坏文件降级

- **WHEN** 启动或读取时 JSON 解析失败
- **THEN** 系统 SHALL 记录 `[ETF网格]` 警告日志并返回空数组，服务正常启动不崩溃

### Requirement: 网格策略字段校验

系统 SHALL 对提交的网格策略字段执行取值范围与交叉约束校验，校验不通过返回 HTTP 400 及具体错误文案。

| 字段 | 必填 | 约束 |
|---|---|---|
| `fundCode` | 是 | 非空字符串，且存在于当前 ETF 看板 |
| `fundName` | 是 | 非空 |
| `gridStep` | 是 | 数值 `(0, 0.5]`，0.05 表示 5% |
| `gridLevels` | 是 | 整数 `[1, 20]` |
| `basePrice` | 是 | 数值 `> 0` |
| `totalBudget` | 是 | 数值 `> 0` |
| `baseAmount` | 是 | 数值 `≥ 0` 且 `≤ totalBudget` |
| `amountPerGrid` | 是 | 数值 `> 0` |
| `feeRate` | 否 | `[0, 0.02]`，缺省 `0.0015` |
| `pauseWhenTempAbove` | 否 | `[0, 100]` |
| `cooldownAfterConsecutiveBuys` | 否 | `{ n, days }`，均为 `> 0` 整数 |
| `status` | 否 | `running` / `paused` / `archived`，缺省 `running` |

#### Scenario: 步长超出范围被拒绝

- **WHEN** 提交 `gridStep = 0.6`
- **THEN** 系统 SHALL 返回 400 与错误「步长必须在 (0, 50%] 范围（如 0.05 表示 5%）」，且不写入文件

#### Scenario: 底仓金额超过总预算被拒绝

- **WHEN** 提交 `baseAmount > totalBudget`
- **THEN** 系统 SHALL 返回 400 与错误「底仓金额不能超过总预算」

#### Scenario: 满仓资金超预算仅软警告

- **WHEN** 提交的配置满足 `baseAmount + amountPerGrid × gridLevels > totalBudget`
- **THEN** 系统 SHALL 正常保存配置，并在响应的 `warnings` 数组中返回「满仓资金 X 元超出总预算 Y 元」

#### Scenario: 缺字段被拒绝

- **WHEN** 提交对象缺少任一必填字段
- **THEN** 系统 SHALL 返回 400 与错误「缺少字段 <字段名>」

### Requirement: 网格标的只能从严选ETF 看板选择

系统 SHALL 限制网格策略的标的仅能取自 ETF 关注列表（`readEtfWatchlist()`），后端在写入时校验 `fundCode` 存在于当前看板，并从看板项自动带出 `fundName` 与 `secid`。

#### Scenario: 提交不在看板内的 ETF 代码

- **WHEN** 提交的 `fundCode` 不存在于当前 ETF 看板
- **THEN** 系统 SHALL 返回 400 与错误提示该 ETF 不在严选ETF 看板中，且不写入文件

#### Scenario: 前端标的下拉仅展示看板 ETF

- **WHEN** 管理员打开新增 / 编辑网格策略表单
- **THEN** 标的下拉选项 SHALL 只包含当前严选ETF 看板中的条目，且选中后自动填充 `fundName` 与 `secid`

#### Scenario: 已配置网格的 ETF 被移出看板

- **WHEN** 某 ETF 被从看板移除但其网格策略仍存在
- **THEN** 系统 SHALL **保留**该策略配置（不级联删除），推荐视图中现价显示为空并标记 stale，网格价位表仍按静态参数正常展示

### Requirement: 网格策略创建与更新（upsert）

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans`（`requireAdmin`）以 `fundCode` 为唯一键执行 upsert：新增时写入 `createdAt` / `updatedAt`，更新时保留原 `createdAt` 并刷新 `updatedAt`。

#### Scenario: 新增策略

- **WHEN** 管理员提交一个看板中不存在的新 `fundCode` 配置
- **THEN** 系统 SHALL 追加该条配置并写入 `createdAt` 与 `updatedAt` 为当前 ISO 时间，返回更新后的完整策略列表

#### Scenario: 更新已有策略

- **WHEN** 管理员提交已存在 `fundCode` 的配置
- **THEN** 系统 SHALL 合并字段后覆盖原条目，保留原 `createdAt`，将 `updatedAt` 刷新为当前 ISO 时间

#### Scenario: 非管理员提交被拒绝

- **WHEN** 未登录或非管理员用户调用 `POST /api/strategy/etf-grid-plans`
- **THEN** 系统 SHALL 返回 401 / 403，不写入文件

### Requirement: 网格策略删除

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans/delete`（`requireAdmin`）按 `fundCode` 删除策略配置，且**保留**该标的已有的成交记录。

#### Scenario: 删除存在的策略

- **WHEN** 管理员提交存在的 `fundCode`
- **THEN** 系统 SHALL 从 `strategies` 中移除该条目并写回文件，响应返回更新后的列表

#### Scenario: 删除不存在的策略

- **WHEN** 管理员提交的 `fundCode` 不存在
- **THEN** 系统 SHALL 返回 404 与错误「策略不存在」

#### Scenario: 删除后成交记录保留

- **WHEN** 某策略被删除
- **THEN** 该 `fundCode` 下的成交记录 SHALL 仍然保留在 `data/etf-grid-holdings.json` 中，不被级联清理

### Requirement: 重置网格中线

系统 SHALL 提供 `POST /api/strategy/etf-grid-plans/reset-base-price`（`requireAdmin`），将策略的 `basePrice` 设为指定值或该 ETF 的实时价，并刷新 `updatedAt` 开启新一轮。

#### Scenario: 手动指定新中线

- **WHEN** 提交 `{ fundCode, newBasePrice: 2.35 }` 且 `newBasePrice > 0`
- **THEN** 系统 SHALL 将 `basePrice` 设为 2.35 并刷新 `updatedAt`

#### Scenario: 未指定则取实时价

- **WHEN** 提交 `{ fundCode }` 而不带 `newBasePrice`
- **THEN** 系统 SHALL 调用 `fetchETFQuotes` 取该策略 `secid` 的实时价作为新中线；取价失败时返回 400 与错误「无法获取实时价，请手动指定 newBasePrice」

#### Scenario: 策略缺少 secid 且未指定价格

- **WHEN** 策略无 `secid` 且请求未带 `newBasePrice`
- **THEN** 系统 SHALL 返回 400 与错误「策略缺少 secid，无法自动获取实时价，请手动指定 newBasePrice」

### Requirement: 成交记录补录与删除

系统 SHALL 提供 `POST /api/strategy/etf-grid-holdings`（`requireAdmin`）追加成交记录、`POST /api/strategy/etf-grid-holdings/delete`（`requireAdmin`）按 `id` 删除记录，并对记录字段执行严格校验。

#### Scenario: 补录买入记录

- **WHEN** 提交 `{ fundCode, type: 'buy', gridLevel: -2, date: '2026-10-13', price: 2.24, shares: 2200, amount: 4928 }`
- **THEN** 系统 SHALL 生成带 `id` 与 `createdAt` 的记录并追加写盘，返回该记录

#### Scenario: 档位与类型不一致被拒绝

- **WHEN** 提交 `type: 'buy'` 但 `gridLevel >= 0`
- **THEN** 系统 SHALL 返回 400 与错误「buy 类型的 gridLevel 必须 < 0」

#### Scenario: 档位超出策略网数被拒绝

- **WHEN** 提交 `|gridLevel|` 大于该策略配置的 `gridLevels`
- **THEN** 系统 SHALL 返回 400 与错误「gridLevel |N| 超过策略配置的 M」

#### Scenario: 日期格式非法被拒绝

- **WHEN** 提交的 `date` 不匹配 `YYYY-MM-DD`
- **THEN** 系统 SHALL 返回 400 与错误「date 格式必须是 YYYY-MM-DD」

#### Scenario: 删除成交记录

- **WHEN** 管理员提交存在的记录 `id`
- **THEN** 系统 SHALL 移除该记录并写盘，返回更新后的记录列表

### Requirement: 网格推荐视图计算

系统 SHALL 提供 `GET /api/strategy/etf-grid-recommendations`（公开），对每个策略调用 `services/etfGridEngine.js` 的 `buildRecommendation` 组装完整视图，包含网格价位表、下一网买卖点、距中线百分比、持仓与浮盈、保护状态。

#### Scenario: 无策略时快速返回

- **WHEN** 策略列表为空
- **THEN** 系统 SHALL 直接返回 `{ strategies: [], updateTime }`，不发起任何外部行情或温度请求

#### Scenario: 正常计算推荐视图

- **WHEN** 存在至少一个策略且实时行情可用
- **THEN** 系统 SHALL 批量调用 `fetchETFQuotes` 取现价、调用 `fetchYZYXThermometer` 取市场温度，逐策略返回 `currentPrice` / `distanceToBasePct` / `nearestGrid` / `gridTable` / `holdings` / `pnl` / `protection`

#### Scenario: 价位表逐档状态

- **WHEN** 生成某策略的 `gridTable`
- **THEN** 每一档 SHALL 携带 `level` / `targetPrice` / `action`（buy / sell）/ `status`（base / filled / waiting / paused），买入档另携带 `expectedNetPct = (1 + gridStep)² − 1 − 双边手续费`

#### Scenario: 行情或温度取数失败降级

- **WHEN** `fetchETFQuotes` 或 `fetchYZYXThermometer` 抛错
- **THEN** 系统 SHALL 记录 `[ETF网格]` 警告日志，现价传 `null` / 温度传 `null` 继续计算，响应中标记 `stale: true`，接口仍返回 200

### Requirement: 网格轮次切换语义

系统 SHALL 将 `updatedAt` 的变化视为开启新一轮网格：更新配置或重置中线后，`filterCurrentRoundRecords` 只把新一轮之后的成交计入当前轮次，历史成交锁定到旧轮次。

#### Scenario: 修改配置开启新一轮

- **WHEN** 管理员修改已存在策略的 `gridStep` 或 `gridLevels` 并保存
- **THEN** 系统 SHALL 刷新 `updatedAt`，此后推荐视图中当前轮次的已填档位从空白开始计算，旧轮次成交不再计入持仓浮盈

#### Scenario: 重置中线开启新一轮

- **WHEN** 管理员执行重置中线
- **THEN** 系统 SHALL 刷新 `updatedAt` 并产生与上一条相同的轮次切分效果

#### Scenario: 前端二次确认

- **WHEN** 管理员点击编辑保存或重置中线
- **THEN** 前端 SHALL 弹出 `confirm` 提示「修改配置将开启新一轮网格计算，历史成交记录会锁定到旧版本。继续？」，用户取消则不提交

### Requirement: 推荐结果缓存与失效

系统 SHALL 使用 `smartCacheGet('etf-grid-recommendations', ...)` 缓存推荐结果（交易时段 30 秒 / 休市 30 分钟），并在任何写操作成功后主动清除缓存。

#### Scenario: 缓存命中

- **WHEN** 在缓存有效期内再次请求推荐接口
- **THEN** 系统 SHALL 返回缓存结果，不发起外部行情请求

#### Scenario: 写操作清除缓存

- **WHEN** 策略 upsert / 删除 / 重置中线，或成交记录新增 / 删除成功
- **THEN** 系统 SHALL 删除磁盘缓存文件与内存缓存项，下一次请求重新计算

#### Scenario: 强制刷新

- **WHEN** 请求带 `?refresh=1`
- **THEN** 系统 SHALL 跳过缓存重新计算

### Requirement: 严选ETF 页内网格交易区块

系统 SHALL 在严选ETF tab（`data-tab="etf"`）的卡片看板下方新增「ETF 网格交易」区块，包含说明文案、新增按钮与网格标的列表。

#### Scenario: 区块位置与结构

- **WHEN** 用户切到严选ETF tab
- **THEN** 页面 SHALL 在看板 `#etfGrid` 之后展示一个带 `section-header` / `section-title`（ETF 网格交易）/ `section-badge`（ETF Grid）的区块，并附一段 `chart-desc` 说明等比对称网格公式与单轮净利算法

#### Scenario: 列表列展示

- **WHEN** 存在至少一个网格策略
- **THEN** 列表 SHALL 逐行展示：标的（名称 + 代码）、现价、距中线百分比、步长 × 网数、中线价、下一网（买 @X / 卖 @Y）、持仓与浮盈、状态徽章

#### Scenario: 空态展示

- **WHEN** 无任何网格策略
- **THEN** 区块 SHALL 展示空态文案「暂无网格策略」；管理员另附「点击右上角"＋ 添加网格策略"开始配置」提示

#### Scenario: 行情缺失列降级

- **WHEN** 某策略取不到实时价
- **THEN** 该行的现价 / 距中线 / 下一网 SHALL 显示 `--` 并附加 stale 视觉标记，其余列正常展示

### Requirement: 网格价位表折叠展示

系统 SHALL 在网格列表每一项提供可折叠的「📊 网格价位表」，逐档展示目标价、动作、状态与单轮预期净利。

#### Scenario: 展开价位表

- **WHEN** 用户点击某策略行的「📊 网格价位表」标题
- **THEN** 系统 SHALL 展开该策略的完整档位表格，逐档显示 `档位 / 目标价 / 动作 / 状态 / 单轮预期净利`

#### Scenario: 保护生效时买入档标记暂停

- **WHEN** 温度超阈值或连续买入冷却触发（`protection.paused` 为真）
- **THEN** 价位表中所有状态为 `waiting` 的买入档 SHALL 标记为 `paused`，并在列表行显示暂停原因

### Requirement: 网格操作权限控制

系统 SHALL 保证网格列表公开只读，所有增删改操作仅管理员可用；前端按 `isAdmin` 控制操作入口的可见性。

#### Scenario: 游客可见列表

- **WHEN** 未登录用户访问严选ETF tab
- **THEN** 用户 SHALL 能看到网格区块与标的列表的全部数据列，但看不到「＋ 新增网格」按钮及各行的编辑 / 记一笔 / 重置 / 删除按钮，也看不到卡片上的网格快捷入口

#### Scenario: 管理员可见操作入口

- **WHEN** 管理员访问严选ETF tab
- **THEN** 页面 SHALL 显示「＋ 新增网格」按钮、每行操作按钮，以及卡片上的网格快捷入口

#### Scenario: 前端隐藏不等于后端放行

- **WHEN** 非管理员绕过 UI 直接调用写接口
- **THEN** 后端 `requireAdmin` 中间件 SHALL 拦截并返回 401 / 403

### Requirement: ETF 卡片网格快捷入口

系统 SHALL 在严选ETF 看板的每张卡片上提供网格快捷入口，管理员点击后直接进入该标的的网格配置。

#### Scenario: 未配置网格的 ETF

- **WHEN** 管理员点击某张尚未配置网格的 ETF 卡片的快捷入口
- **THEN** 系统 SHALL 打开「新增网格策略」弹窗并预选该 ETF 标的

#### Scenario: 已配置网格的 ETF

- **WHEN** 管理员点击某张已配置网格的 ETF 卡片的快捷入口
- **THEN** 系统 SHALL 打开「编辑网格策略：<标的名称>」弹窗并载入该策略当前配置

### Requirement: 网格配置表单与价位预览

系统 SHALL 提供基于 `auth-modal` + `auth-field` 样式的网格配置弹窗，包含标的选择、网格参数、资金规划、保护机制四组字段，并实时预览网格价位表。

#### Scenario: 打开新增表单

- **WHEN** 管理员点击「＋ 新增网格」或从卡片入口进入
- **THEN** 系统 SHALL 弹出表单，标题为「添加 ETF 网格策略」，字段包含：标的（下拉，仅看板 ETF）、手续费率(%)、每格步长(%)、单侧网数、网格中线、总预算(元)、底仓金额(元)、每格金额(元)，以及温度阈值与连续买入冷却（可选）

#### Scenario: 使用当前价填充中线

- **WHEN** 管理员在表单中点击「使用当前价」
- **THEN** 系统 SHALL 将该 ETF 的实时价填入「网格中线」输入框，并在旁显示当前价提示文案

#### Scenario: 网格价位实时预览

- **WHEN** 管理员填写了步长 / 单侧网数 / 中线
- **THEN** 表单 SHALL 实时渲染对应的网格价位预览表；参数不完整时显示「请填入 步长/单侧网数/中线 以查看网格价位预览」

#### Scenario: 打开编辑表单

- **WHEN** 管理员点击某策略行的编辑按钮
- **THEN** 系统 SHALL 弹出标题为「编辑网格策略：<标的名称>」的表单并预填该策略全部字段
