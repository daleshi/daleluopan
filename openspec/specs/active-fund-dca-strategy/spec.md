## ADDED Requirements

### Requirement: 主动基金定投策略数据持久化
系统 SHALL 提供持久化的主动基金定投策略配置存储，独立于现有指数温度计定投策略。

#### Scenario: 首次启动自动初始化两只默认基金的策略
- **WHEN** 服务首次启动且 `data/active-fund-strategy.json` 不存在
- **THEN** 系统自动创建文件并写入兴全商业模式（163415，乔迁规则）和大成睿享A（008269，徐彦规则）的预设策略配置

#### Scenario: 配置文件存在时按现有内容加载
- **WHEN** `data/active-fund-strategy.json` 已存在且包含合法的 strategies 数组
- **THEN** 系统读取并解析该文件，作为活动策略列表，不覆盖任何现有数据

### Requirement: 读取主动基金定投策略配置（公开）
系统 SHALL 提供 `GET /api/strategy/active-fund-plans` 接口，未登录用户也可读取当前所有主动基金策略配置。

#### Scenario: 未登录用户读取策略列表
- **WHEN** 未登录的用户调用 `GET /api/strategy/active-fund-plans`
- **THEN** 系统返回 200 状态码与 `{ success: true, data: { strategies: [...] } }`

#### Scenario: 策略列表为空
- **WHEN** 配置文件不存在或 strategies 数组为空（极端情况）
- **THEN** 系统返回 `{ success: true, data: { strategies: [] } }`，不抛错

### Requirement: 创建或更新主动基金策略（管理员）
系统 SHALL 提供 `POST /api/strategy/active-fund-plans` 接口，仅管理员可创建或更新单只基金的定投策略，使用 upsert 语义。

#### Scenario: 未登录用户尝试创建策略
- **WHEN** 未登录用户 POST 一个有效策略对象
- **THEN** 系统返回 401 状态码

#### Scenario: 普通用户尝试创建策略
- **WHEN** 已登录但角色为 `user` 的用户 POST 策略
- **THEN** 系统返回 403 状态码（requireAdmin 中间件拦截）

#### Scenario: 管理员创建新基金的策略
- **WHEN** 管理员 POST 一个 `fundCode` 未存在于策略列表的合法策略对象
- **THEN** 系统将其追加到 strategies 数组并返回 200 + 完整列表

#### Scenario: 管理员更新已存在基金的策略
- **WHEN** 管理员 POST 一个 `fundCode` 已存在的策略对象
- **THEN** 系统替换该 fundCode 对应的策略条目（不新增），并更新其 `updatedAt` 时间戳

#### Scenario: 缺少必填字段时拒绝
- **WHEN** 管理员 POST 缺失 `fundCode` 或 `monthlyAmount` 或 `rules` 的对象
- **THEN** 系统返回 400 状态码及具体错误信息

#### Scenario: 月定投基准金额非正数时拒绝
- **WHEN** `monthlyAmount` ≤ 0 或非数字
- **THEN** 系统返回 400 + 错误信息"每月定投基准金额必须为正数"

#### Scenario: 规则中缺少 `normal` 兜底档时拒绝
- **WHEN** rules 数组中不存在 `id === "normal"` 的规则
- **THEN** 系统返回 400 + 错误信息"必须包含 normal 兜底规则"

#### Scenario: 规则中包含未知字段时拒绝
- **WHEN** 任一 condition 的 `field` 不在白名单（`indexPePercentile` / `indexPbPercentile` / `fundDrawdownAbs` / `fundGain3M` / `fundGain6M`）
- **THEN** 系统返回 400 + 错误信息"未知 field"

#### Scenario: multiplier 超出范围时拒绝
- **WHEN** 任一规则的 `multiplier` < 0 或 > 500
- **THEN** 系统返回 400 + 错误信息"multiplier 必须在 0-500 之间"

#### Scenario: 策略数量达到上限时拒绝新增
- **WHEN** 当前策略数 ≥ 20 且尝试新增（非更新）
- **THEN** 系统返回 400 + 错误信息"最多支持 20 个主动基金策略"

### Requirement: 删除主动基金策略（管理员）
系统 SHALL 提供 `POST /api/strategy/active-fund-plans/delete` 接口，仅管理员可删除单只基金的策略。

#### Scenario: 未登录尝试删除
- **WHEN** 未登录用户调用删除接口
- **THEN** 系统返回 401

#### Scenario: 普通用户尝试删除
- **WHEN** 已登录但角色为 `user` 的用户调用删除接口
- **THEN** 系统返回 403

#### Scenario: 管理员删除存在的策略
- **WHEN** 管理员发送 `{ fundCode: "163415" }` 且该 fundCode 存在
- **THEN** 系统从数组中移除该策略并返回 200 + 剩余策略列表

#### Scenario: 删除不存在的策略
- **WHEN** 管理员发送的 `fundCode` 不在策略列表中
- **THEN** 系统返回 404 + 错误信息"该策略不存在"

### Requirement: 实时计算主动基金当前定投档位
系统 SHALL 提供 `GET /api/strategy/active-fund-recommendations` 接口，根据当前指数估值与基金净值，计算每只配置基金当前应执行的定投档位、推荐金额与触发依据。

#### Scenario: 数据齐全时返回完整推荐
- **WHEN** 沪深300 PE 分位与目标基金净值序列均可用
- **THEN** 系统对每只策略基金返回：当前指标值（`indicators`）、命中规则（`hitRule`）、推荐金额（`actualAmount`）、规则扫描结果（`ruleScans[]`）、`stale: false`

#### Scenario: 高估区暂停定投（验收用例 — 乔迁版）
- **GIVEN** 沪深300 PE 分位 = 92.08%，兴全商业模式当前回撤 = 5.47%、近3月涨幅 = 8.33%、近6月涨幅 = 26.95%
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式的 `hitRule.id` = `"pause"`，`actualAmount` = 0，`triggerReason` 包含 "PE 分位 92.08% ≥ 90%"

#### Scenario: 高估区减半定投（验收用例 — 徐彦版）
- **GIVEN** 沪深300 PE 分位 = 92.08%
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` = `"half"`，`actualAmount` = 500，`triggerReason` 包含 "PE 分位 92.08% ∈ [80%, 95%)"

#### Scenario: 命中即停（多档同时满足）
- **WHEN** 一只基金的状态同时满足"暂停"和"减半"档（理论上修订规则互斥，但作为安全网）
- **THEN** 系统按 `pause → half → double → normal` 顺序匹配，命中第一条即返回，剩余规则的 `ruleScans[i].hit = false` 且 summary 为"已被前置规则命中"

#### Scenario: 兜底规则触发
- **WHEN** 一只基金的状态不满足任何严苛档（pause/half/double）
- **THEN** 系统返回 `hitRule.id = "normal"`，`actualAmount = monthlyAmount * 100 / 100`

#### Scenario: PE 数据获取失败时降级
- **WHEN** 蛋卷估值 API 失败且无任何缓存
- **THEN** 系统对所有策略返回 `stale: true`，`indicators.indexPePercentile = null`，跳过引用该字段的规则（视为不命中），并明确返回 `triggerReason` = "PE 数据不可用，建议手动判断"

#### Scenario: 基金净值数据获取失败时部分降级
- **WHEN** 某只基金的净值序列不可用，但 PE 数据正常
- **THEN** 系统对该基金返回 `stale: true`，缺失的衍生指标值为 `null`，引用 fundDrawdownAbs / fundGain3M / fundGain6M 的规则视为不命中

#### Scenario: 接口具备缓存
- **WHEN** 短时间内（交易时段 5 分钟内、休市 30 分钟内）多次调用推荐接口
- **THEN** 系统命中缓存层并直接返回相同结果，不重复请求底层数据源

### Requirement: 投资策略 Tab 展示主动基金定投卡片
系统 SHALL 在「投资策略」Tab 中新增独立的「主动基金定投策略」section，与现有「温度计定投策略」并列。

#### Scenario: section 顶部显示市场基准状态
- **WHEN** 用户进入「投资策略」Tab 且推荐接口返回成功
- **THEN** section 顶部显示当前沪深300 PE 与 PE 分位（数据日期），让用户在看具体基金前先理解整体市场状态

#### Scenario: 每只基金一张卡片
- **WHEN** 当前共有 N 只主动基金策略
- **THEN** 系统渲染 N 张策略卡片，每张包含：基金名 + 经理 + 档位徽章 + 本月实际金额 + 触发依据 + "规则一览"折叠区

#### Scenario: 档位徽章颜色与档位一致
- **WHEN** 卡片渲染时，命中规则的 `color` 字段为 `red`/`green`/`yellow`/`purple`
- **THEN** 徽章背景色对应使用 dca-low（红）/dca-mid-low（绿）/dca-mid-high（黄）/dca-high（紫）CSS 变量

#### Scenario: 规则一览展示扫描结果
- **WHEN** 用户点击"规则一览"折叠区域
- **THEN** 系统展示该基金所有规则（按存储顺序），每条标注「⚠ 当前」或「未触发」徽章 + summary 文本

#### Scenario: stale 数据带视觉警告
- **WHEN** 推荐接口返回某基金 `stale: true`
- **THEN** 卡片顶部显示灰色"⚠ 数据陈旧"标签，并展示数据时间，但仍渲染最近一次成功结果

#### Scenario: 配置为空时引导添加
- **WHEN** 当前主动基金策略列表为空
- **THEN** section 显示空态："暂无主动基金定投策略" + 管理员可见的"＋ 添加主动基金策略"按钮

### Requirement: 管理员可视化配置主动基金策略
系统 SHALL 为管理员提供主动基金策略的可视化创建/编辑表单，使用预设模板降低配置复杂度。

#### Scenario: 普通用户看不到管理按钮
- **WHEN** 已登录但角色为 `user` 的用户查看「主动基金定投策略」section
- **THEN** 不显示"＋ 添加策略"、"编辑"、"删除"按钮

#### Scenario: 管理员选择模板
- **WHEN** 管理员点击"＋ 添加主动基金策略"
- **THEN** 弹出表单包含模板选择：「单因子 PE 模板」或「双因子 PE+基金 模板」

#### Scenario: 选择单因子模板填阈值
- **WHEN** 管理员选择单因子模板
- **THEN** 表单显示 4 个 PE 分位阈值输入（加倍上限 / 正常上限 / 减半上限 / 暂停下限）+ 加倍档的回撤阈值

#### Scenario: 选择双因子模板填阈值
- **WHEN** 管理员选择双因子模板
- **THEN** 表单显示加倍/减半/暂停档各自的 PE 区间 + 基金回撤/涨幅阈值，正常档作为兜底无需配置

#### Scenario: 提交后后端转译为通用规则结构
- **WHEN** 管理员填完表单提交
- **THEN** 前端将表单值映射为 `rules[]` 通用结构 POST 给后端，存储至 `data/active-fund-strategy.json`

#### Scenario: 编辑现有策略
- **WHEN** 管理员点击某基金卡片上的"编辑"
- **THEN** 系统弹出已填充当前策略字段的表单，允许修改后保存

#### Scenario: 删除二次确认
- **WHEN** 管理员点击"删除"
- **THEN** 系统弹出确认对话框 "确定删除该主动基金定投策略？"，确认后才调用删除接口
