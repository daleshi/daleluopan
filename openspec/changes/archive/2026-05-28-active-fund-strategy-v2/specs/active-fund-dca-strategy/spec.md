## ADDED Requirements

### Requirement: 主动基金近一年涨幅衍生指标
系统 SHALL 在主动基金推荐计算中产出 `fundGain1Y` 衍生指标（近 365 天涨幅，% 可正负），并将其纳入规则引擎可用 condition 字段白名单。

#### Scenario: 净值序列充足时正确计算近一年涨幅
- **GIVEN** 某基金净值序列覆盖至少 365 天，且 365 天前净值 = 1.0、当前净值 = 1.55
- **WHEN** 引擎计算该基金的衍生指标
- **THEN** 返回 `indicators.fundGain1Y` ≈ 55.00（百分比，保留两位小数），且 `latestNav` / `navDate` 与现有逻辑一致

#### Scenario: 净值序列不足 365 天降级
- **GIVEN** 基金净值序列只有 200 天数据
- **WHEN** 引擎计算衍生指标
- **THEN** 返回 `indicators.fundGain1Y === null`，规则中引用该字段的 condition 视为不命中

#### Scenario: 规则可引用 fundGain1Y
- **WHEN** 管理员 POST 包含 `{ field: "fundGain1Y", op: ">", value: 50 }` 的合法策略
- **THEN** 后端校验通过（field 在白名单内），策略写入成功

### Requirement: 主动基金距近一年新高衍生指标
系统 SHALL 在主动基金推荐计算中产出 `fundDistanceToYearHighPct` 衍生指标（当前净值距近 365 天最高净值的回撤绝对值，% 正数；为 0 表示当前即为近一年新高），并将其纳入规则引擎可用 condition 字段白名单。

#### Scenario: 当前为近一年新高
- **GIVEN** 基金近一年最高净值 = 1.50，当前净值 = 1.50
- **WHEN** 引擎计算衍生指标
- **THEN** `indicators.fundDistanceToYearHighPct === 0`

#### Scenario: 当前距近一年高点 1.5%
- **GIVEN** 基金近一年最高净值 = 2.00，当前净值 = 1.97
- **WHEN** 引擎计算衍生指标
- **THEN** `indicators.fundDistanceToYearHighPct ≈ 1.50`，规则 `{ field: "fundDistanceToYearHighPct", op: "<=", value: 2 }` 命中

#### Scenario: 净值序列不足导致降级
- **GIVEN** 基金净值序列覆盖不足 60 天（无法识别近一年高点）
- **WHEN** 引擎计算衍生指标
- **THEN** `fundDistanceToYearHighPct === null`，规则中引用该字段的 condition 视为不命中

#### Scenario: 响应同时返回 peakNav1Y 与 peakDate1Y
- **WHEN** 推荐接口对一只数据齐全的基金返回结果
- **THEN** 响应除 `indicators.fundDistanceToYearHighPct` 外，还包含 `peakNav1Y`（近一年最高净值，4 位小数）与 `peakDate1Y`（YYYY-MM-DD）

### Requirement: 主动基金经理更换自动检测
系统 SHALL 在主动基金推荐计算中自动比对当前实时基金经理名与策略配置的 `managerName`，输出 `managerChanged: boolean`，并在 `managerChanged === true` 时优先返回合成的"暂停新增"档位，跳过其余规则扫描。

#### Scenario: 实时经理与配置一致
- **GIVEN** 策略配置 `managerName = "乔迁"`，基金接口返回 `managers[0].name = "乔迁"`
- **WHEN** 引擎计算推荐
- **THEN** 响应 `currentManager === "乔迁"`，`managerChanged === false`，正常执行后续规则扫描

#### Scenario: 实时经理已变更
- **GIVEN** 策略配置 `managerName = "乔迁"`，基金接口返回 `managers[0].name = "李四"`
- **WHEN** 引擎计算推荐
- **THEN** 响应 `currentManager === "李四"`，`managerChanged === true`，`hitRule = { id: "managerChanged", label: "暂停新增", color: "purple", multiplier: 0 }`，`actualAmount = 0`，`triggerReason` 包含 "基金经理已变更" 且原始规则数组的 ruleScans 全部标记 `hit: false / summary: "经理变更短路"`

#### Scenario: 数据源缺失经理姓名时降级
- **GIVEN** 基金接口返回的 `managers` 数组为空或 `managers[0].name` 为空字符串
- **WHEN** 引擎计算推荐
- **THEN** 响应 `currentManager === null`，`managerChanged === false`（不误触发暂停），其余规则扫描正常执行

#### Scenario: 配置 managerName 为空时跳过比对
- **WHEN** 策略配置 `managerName` 字段缺失或为空
- **THEN** `managerChanged === false`，引擎不做经理变更短路

### Requirement: 加强定投（boost）档位支持
系统 SHALL 支持 `boost` 作为标准定投档位，multiplier 约定为 150，颜色映射为 `blue`，与现有 `pause / half / normal / double` 档共存。

#### Scenario: boost 档命中时按 1.5 倍执行
- **GIVEN** 策略 monthlyAmount = 1000，规则数组含 `{ id: "boost", multiplier: 150, color: "blue", logic: "AND", conditions: [...] }`
- **WHEN** 该规则命中
- **THEN** 响应 `actualAmount === 1500`，`hitRule.color === "blue"`，`hitRule.multiplier === 150`

#### Scenario: 同一策略允许多条 boost 规则
- **WHEN** 一只基金的策略 rules 数组中存在两条 id 以 `boost` 开头（如 `boost`、`boost-mid`）的规则
- **THEN** 引擎按数组顺序"命中即停"匹配，无强制 id 唯一约束

#### Scenario: 前端徽章使用蓝色配色
- **WHEN** 前端渲染卡片，命中规则的 `color === "blue"`
- **THEN** 徽章使用 CSS 变量 `--dca-boost`（默认 `#3b82f6` 或类似蓝色）

## MODIFIED Requirements

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
- **WHEN** 任一 condition 的 `field` 不在白名单（`indexPePercentile` / `indexPbPercentile` / `fundDrawdownAbs` / `fundGain3M` / `fundGain6M` / `fundGain1Y` / `fundDistanceToYearHighPct` / `fundPricePercentile5Y` / `fundDrawdown1Y`）
- **THEN** 系统返回 400 + 错误信息"未知 field"

#### Scenario: multiplier 超出范围时拒绝
- **WHEN** 任一规则的 `multiplier` < 0 或 > 500
- **THEN** 系统返回 400 + 错误信息"multiplier 必须在 0-500 之间"

#### Scenario: 策略数量达到上限时拒绝新增
- **WHEN** 当前策略数 ≥ 20 且尝试新增（非更新）
- **THEN** 系统返回 400 + 错误信息"最多支持 20 个主动基金策略"

#### Scenario: 接受 boost 档位
- **WHEN** 管理员 POST 包含 `{ id: "boost", multiplier: 150, color: "blue", ... }` 规则的策略
- **THEN** 后端校验通过并写入

### Requirement: 实时计算主动基金当前定投档位
系统 SHALL 提供 `GET /api/strategy/active-fund-recommendations` 接口，根据当前指数估值与基金净值，计算每只配置基金当前应执行的定投档位、推荐金额与触发依据。

#### Scenario: 数据齐全时返回完整推荐
- **WHEN** 沪深300 PE 分位与目标基金净值序列均可用
- **THEN** 系统对每只策略基金返回：当前指标值（`indicators` 含 `indexPePercentile / fundDrawdownAbs / fundGain3M / fundGain6M / fundGain1Y / fundDistanceToYearHighPct`）、命中规则（`hitRule`）、推荐金额（`actualAmount`）、规则扫描结果（`ruleScans[]`）、`currentManager`、`managerChanged`、`peakNav1Y`、`peakDate1Y`、`stale: false`

#### Scenario: 经理变更短路（最高优先级）
- **GIVEN** 任一策略的 `managerName` 与基金接口实时经理名不一致
- **WHEN** 用户调用推荐接口
- **THEN** 该基金的 `hitRule.id === "managerChanged"`，`actualAmount = 0`，`triggerReason` 包含 "基金经理已变更"，且其余 ruleScans 标记为短路未执行

#### Scenario: 大成睿享 A — PE 高估 + 涨幅过热 暂停（OR 任一即触发）
- **GIVEN** 沪深300 PE 分位 = 92%、近3月涨幅 = 5%（涨幅未达阈值）、经理仍是"徐彦"
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` = `"pause"`、`hitRule.logic === "OR"`、`actualAmount` = 0、`triggerReason` 包含 "PE 分位 92.00% >= 90%"（仅 PE 命中即触发，不要求基金同时过热）

#### Scenario: 大成睿享 A — 基金涨幅过热但 PE 不高 暂停（OR 单边触发）
- **GIVEN** 沪深300 PE 分位 = 50%（PE 不高）、近3月涨幅 = 18%（基金过热）、经理"徐彦"未变
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` = `"pause"`、`actualAmount` = 0、`triggerReason` 包含 "近3月涨幅 18.00% >= 15%"

#### Scenario: 大成睿享 A — 加倍定投（双低，AND 必须同时满足）
- **GIVEN** 沪深300 PE 分位 = 18%（低估）、基金回撤 = 22%（深回撤）、经理"徐彦"未变
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` = `"double"`、`hitRule.logic === "AND"`、`actualAmount` = 2000、`triggerReason` 包含 "PE ... <= 20%" 且 "回撤 22.00% >= 15%"

#### Scenario: 大成睿享 A — PE 低但基金未回撤不加仓（AND 缺一不命中）
- **GIVEN** 沪深300 PE 分位 = 15%（低估）、基金回撤 = 1%（未回撤）、经理"徐彦"未变
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` = `"normal"`（不触发 double / boost，因基金未回撤；落入兜底正常定投）

#### Scenario: 大成睿享 A — 加强定投（boost 档验收）
- **GIVEN** 沪深300 PE 分位 = 18%、基金回撤 = 8%、经理"徐彦"未变
- **WHEN** 用户调用推荐接口
- **THEN** 大成睿享A 的 `hitRule.id` 包含 "boost"，`hitRule.color === "blue"`，`actualAmount` = 1500

#### Scenario: 兴全商业模式 — 市场极贵 OR 距新高 1% 暂停（pause-extreme，任一即触发）
- **GIVEN** 沪深300 PE 分位 = 92%（极贵）、距近1年新高 = 8%（不算高点附近）、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "pause-extreme"`、`hitRule.logic === "OR"`、`actualAmount` = 0、`triggerReason` 包含 "PE 分位 92.00% >= 90%"

#### Scenario: 兴全商业模式 — 距新高 1% 但 PE 中性 暂停（pause-extreme OR 单边）
- **GIVEN** 沪深300 PE 分位 = 65%（不算极贵）、距近1年新高 = 1.2%（基金极度过热）、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "pause-extreme"`、`actualAmount` = 0、`triggerReason` 包含 "距近1年新高 1.20% <= 2%"

#### Scenario: 兴全商业模式 — PE 偏贵 OR 近1年涨幅高 暂停（pause-overheat 任一）
- **GIVEN** 沪深300 PE 分位 = 82%（偏贵）、近1年涨幅 = 30%（不算极高）、距新高 = 5%、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "pause-overheat"`、`hitRule.logic === "OR"`、`actualAmount` = 0、`triggerReason` 包含 "PE 分位 82.00% >= 80%"

#### Scenario: 兴全商业模式 — PE 不算高但近1年涨幅 55% 暂停（pause-overheat OR 单边）
- **GIVEN** 沪深300 PE 分位 = 60%、近1年涨幅 = 55%、距新高 = 5%、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "pause-overheat"`、`actualAmount` = 0、`triggerReason` 包含 "近1年涨幅 55.00% > 50%"

#### Scenario: 兴全商业模式 — PE 60-80% 区间 OR 涨幅>40% 减半（half OR 任一）
- **GIVEN** 沪深300 PE 分位 = 70%（PE 命中下界）、近1年涨幅 = 25%（不过热）、距新高 = 5%、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "half"`、`hitRule.logic === "OR"`、`actualAmount` = 500、`triggerReason` 包含 "PE 分位 70.00% >= 60%"

#### Scenario: 兴全商业模式 — 涨幅>40% 但 PE 中性 减半（half OR 单边）
- **GIVEN** 沪深300 PE 分位 = 50%（中性）、近1年涨幅 = 45%、距新高 = 4%、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "half"`、`actualAmount` = 500、`triggerReason` 包含 "近1年涨幅 45.00% > 40%"

#### Scenario: 兴全商业模式 — PE 20-60% 回撤 ≥15% 加强定投（boost-mid，AND 双低）
- **GIVEN** 沪深300 PE 分位 = 35%、基金回撤 = 18%、近1年涨幅 = -10%、经理"乔迁"未变
- **WHEN** 用户调用推荐接口
- **THEN** 兴全商业模式 的 `hitRule.id === "boost-mid"`、`hitRule.color === "blue"`、`actualAmount` = 1500

#### Scenario: 命中即停（多档同时满足）
- **WHEN** 一只基金的状态同时满足"暂停"和"减半"档（理论上规则互斥，作为安全网）
- **THEN** 系统按 rules 数组顺序匹配，命中第一条即返回，剩余规则的 `ruleScans[i].hit = false` 且 summary 为"已被前置规则命中"

#### Scenario: 兜底规则触发
- **WHEN** 一只基金的状态不满足任何严苛档（pause/half/double/boost）
- **THEN** 系统返回 `hitRule.id = "normal"`，`actualAmount = monthlyAmount * 100 / 100`

#### Scenario: PE 数据获取失败时降级
- **WHEN** 蛋卷估值 API 失败且无任何缓存
- **THEN** 系统对所有策略返回 `stale: true`，`indicators.indexPePercentile = null`，跳过引用该字段的规则（视为不命中），并明确返回 `triggerReason` = "PE 数据不可用，建议手动判断"

#### Scenario: 基金净值数据获取失败时部分降级
- **WHEN** 某只基金的净值序列不可用，但 PE 数据正常
- **THEN** 系统对该基金返回 `stale: true`，缺失的衍生指标值为 `null`，引用 fundDrawdownAbs / fundGain3M / fundGain6M / fundGain1Y / fundDistanceToYearHighPct 的规则视为不命中

#### Scenario: 接口具备缓存
- **WHEN** 短时间内（交易时段 5 分钟内、休市 30 分钟内）多次调用推荐接口
- **THEN** 系统命中缓存层并直接返回相同结果，不重复请求底层数据源

### Requirement: 主动基金定投策略数据持久化
系统 SHALL 提供持久化的主动基金定投策略配置存储，独立于现有指数温度计定投策略，并在服务启动时智能升级 v1 默认策略到 v2 默认策略。

#### Scenario: 首次启动自动初始化两只默认基金的 v2 策略
- **WHEN** 服务首次启动且 `data/active-fund-strategy.json` 不存在
- **THEN** 系统自动创建文件并写入兴全商业模式（163415，乔迁规则 v2）和大成睿享A（008269，徐彦规则 v2）的预设策略配置；v2 默认配置包含 `boost` 档与对 `fundGain1Y` / `fundDistanceToYearHighPct` 的引用

#### Scenario: 配置文件存在且 rules 仍是 v1 默认快照时升级
- **GIVEN** `data/active-fund-strategy.json` 已存在，163415 / 008269 的 rules 数组结构与 v1 默认完全一致（按规则 id 排序后 JSON 序列化签名匹配）
- **WHEN** 服务启动时执行 `ensureDefaultActiveFundStrategies()`
- **THEN** 系统**仅替换** 163415 / 008269 的 `rules` 字段为 v2 默认值并刷新 `updatedAt`，**保留** `fundCode / fundName / managerName / benchmarkIndex / monthlyAmount / drawdownBaseline` 等其他字段不变

#### Scenario: 配置文件存在但 rules 已被管理员自定义时不升级
- **GIVEN** `data/active-fund-strategy.json` 中 163415 或 008269 的 rules 数组与 v1 默认签名不匹配（管理员已修改）
- **WHEN** 服务启动
- **THEN** 系统跳过该条记录的规则覆盖，保留管理员的所有修改

#### Scenario: 配置文件存在时按现有内容加载（其他基金）
- **WHEN** `data/active-fund-strategy.json` 含 163415/008269 之外的其他基金策略
- **THEN** 系统读取并保留这些自定义策略，不做任何覆盖

### Requirement: 投资策略 Tab 展示主动基金定投卡片
系统 SHALL 在「投资策略」Tab 中新增独立的「主动基金定投策略」section，与现有「温度计定投策略」并列。

#### Scenario: section 顶部显示市场基准状态
- **WHEN** 用户进入「投资策略」Tab 且推荐接口返回成功
- **THEN** section 顶部显示当前沪深300 PE 与 PE 分位（数据日期），让用户在看具体基金前先理解整体市场状态

#### Scenario: 每只基金一张卡片
- **WHEN** 当前共有 N 只主动基金策略
- **THEN** 系统渲染 N 张策略卡片，每张包含：基金名 + 经理 + 档位徽章 + 本月实际金额 + 触发依据 + "规则一览"折叠区

#### Scenario: 档位徽章颜色与档位一致
- **WHEN** 卡片渲染时，命中规则的 `color` 字段为 `red`/`green`/`yellow`/`purple`/`blue`
- **THEN** 徽章背景色对应使用 `--dca-low`（红）/`--dca-mid-low`（绿）/`--dca-mid-high`（黄）/`--dca-high`（紫）/`--dca-boost`（蓝）CSS 变量

#### Scenario: 经理变更警示横条
- **WHEN** 推荐接口返回某基金 `managerChanged === true`
- **THEN** 卡片顶部显示醒目红色警示横条，文案包含 "⚠ 基金经理已由 {managerName} 变更为 {currentManager}，建议重新评估"

#### Scenario: 规则一览展示扫描结果
- **WHEN** 用户点击"规则一览"折叠区域
- **THEN** 系统展示该基金所有规则（按存储顺序），每条标注「⚠ 当前」或「未触发」徽章 + summary 文本；当 `managerChanged === true` 时整个 ruleScans 显示灰色"已被经理变更短路"

#### Scenario: stale 数据带视觉警告
- **WHEN** 推荐接口返回某基金 `stale: true`
- **THEN** 卡片顶部显示灰色"⚠ 数据陈旧"标签，并展示数据时间，但仍渲染最近一次成功结果

#### Scenario: 配置为空时引导添加
- **WHEN** 当前主动基金策略列表为空
- **THEN** section 显示空态："暂无主动基金定投策略" + 管理员可见的"＋ 添加主动基金策略"按钮

### Requirement: 管理员可视化配置主动基金策略
系统 SHALL 为管理员提供主动基金策略的可视化创建/编辑表单，使用预设模板降低配置复杂度，并支持 v2 引擎的所有新档位与新字段。

#### Scenario: 普通用户看不到管理按钮
- **WHEN** 已登录但角色为 `user` 的用户查看「主动基金定投策略」section
- **THEN** 不显示"＋ 添加策略"、"编辑"、"删除"按钮

#### Scenario: 档位下拉支持 boost
- **WHEN** 管理员在编辑表单的"档位类型"下拉中选择
- **THEN** 选项包含：暂停定投(pause) / 减半定投(half) / 正常定投(normal) / 加强定投(boost) / 加倍定投(double)；选中 boost 时 multiplier 默认填 150、color 默认 blue

#### Scenario: 字段下拉支持 fundGain1Y 与 fundDistanceToYearHighPct
- **WHEN** 管理员在编辑表单的"判据字段"下拉中选择
- **THEN** 选项包含全部白名单字段，并以中文标签呈现：PE 分位 / PB 分位 / 基金回撤 / 近3月涨幅 / 近6月涨幅 / 近1年涨幅 / 距近1年新高 / 近5年价格分位 / 近1年回撤

#### Scenario: 编辑现有策略
- **WHEN** 管理员点击某基金卡片上的"编辑"
- **THEN** 系统弹出已填充当前策略字段的表单，allowing 修改后保存；现有 boost 档与新字段正确预填

#### Scenario: 删除二次确认
- **WHEN** 管理员点击"删除"
- **THEN** 系统弹出确认对话框 "确定删除该主动基金定投策略？"，确认后才调用删除接口
