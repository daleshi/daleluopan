## ADDED Requirements

### Requirement: 标普 500 策略数据持久化
系统 SHALL 提供持久化的标普 500 投资策略配置存储，独立于现有 active-fund / gold / etf 三类策略文件。

#### Scenario: 首次启动自动初始化默认策略
- **WHEN** 服务首次启动且 `data/sp500-strategy.json` 不存在
- **THEN** 系统自动创建文件并写入默认策略对象，包含：
  - `indexCode = "SPX"`、`indexSecid = "100.SPX"`
  - `offsite.fundCode = "017641"`、`offsite.monthlyAmount = 1000`、`offsite.tiers` 4 档（pause/half/normal/double，回撤边界 3/10/20）
  - `onsite.etfCode = "513500"`、`onsite.etfSecid = "1.513500"`、`onsite.signals` 4 信号（idle/watch/buy/strong，金额 0/5000/10000/15000，回撤边界同 offsite）
  - `onsite.premiumGate = { fullPassMaxPct: 0.5, halfPassMaxPct: 1.5 }`

#### Scenario: 已存在配置不被覆盖
- **WHEN** `data/sp500-strategy.json` 已包含合法 JSON
- **THEN** 系统加载现有数据，不修改任何用户已配置内容

#### Scenario: 不影响其他策略文件
- **WHEN** 系统读写本配置文件
- **THEN** 仅读写 `data/sp500-strategy.json`，不读写 `active-fund-strategy.json` / `gold-strategy.json` / `etf-strategy.json`

### Requirement: 读取标普 500 策略配置（公开）
系统 SHALL 提供 `GET /api/strategy/sp500-plans` 接口，未登录用户也可读取当前策略配置。

#### Scenario: 未登录读取策略
- **WHEN** 未登录用户调用 `GET /api/strategy/sp500-plans`
- **THEN** 系统返回 200 + `{ success: true, data: { strategy: <对象> } }`

#### Scenario: 配置文件不存在时返回默认结构
- **WHEN** 配置文件因故缺失
- **THEN** 系统返回 200 + `{ success: true, data: { strategy: null } }`，不抛错

### Requirement: 更新标普 500 策略配置（管理员）
系统 SHALL 提供 `POST /api/strategy/sp500-plans` 接口，仅管理员可调用，整体替换当前策略对象。

#### Scenario: 未登录返回 401
- **WHEN** 未登录用户 POST 策略对象
- **THEN** 系统返回 401

#### Scenario: 普通用户返回 403
- **WHEN** 已登录但角色为 user 的用户 POST 策略对象
- **THEN** 系统返回 403

#### Scenario: 管理员成功更新
- **WHEN** 管理员 POST 一个合法策略对象
- **THEN** 系统替换 `data/sp500-strategy.json` 内容并返回 200 + 更新后的策略

#### Scenario: 缺少必填字段时拒绝
- **WHEN** POST body 缺少 `offsite.fundCode` 或 `onsite.etfCode` 或 `onsite.etfSecid`
- **THEN** 系统返回 400 + 错误说明

#### Scenario: offsite.tiers 不含 normal 兜底档时拒绝
- **WHEN** POST body 的 `offsite.tiers` 中没有任何 `id` 包含 "double" 或 "normal" 的兜底档（即所有档都有 drawdownLt 上界）
- **THEN** 系统返回 400 + 错误说明

#### Scenario: 溢价闸门阈值不合法时拒绝
- **WHEN** `onsite.premiumGate.fullPassMaxPct >= halfPassMaxPct` 或两值非数字
- **THEN** 系统返回 400 + "fullPassMaxPct 必须 < halfPassMaxPct 且均为非负数字"

### Requirement: 标普 500 共享指标 — 距 5Y 高点回撤
系统 SHALL 在策略推荐计算中产出 `drawdownFromPeak5Y` 共享衍生指标（标普 500 指数距近 5 年最高收盘价的回撤绝对值，% 正数；为 0 表示当前即为近 5 年新高）。

#### Scenario: 数据齐全时正确计算
- **GIVEN** 标普 500 指数近 5 年最高收盘价 = 5500，最新收盘价 = 4900
- **WHEN** 引擎计算共享指标
- **THEN** `drawdownFromPeak5Y ≈ 10.91`、`peakClose5Y = 5500`、`peakDate5Y` 为 ISO 日期字符串

#### Scenario: 当前为 5Y 新高
- **GIVEN** 最新价 = 5Y 最高
- **WHEN** 引擎计算共享指标
- **THEN** `drawdownFromPeak5Y === 0`

#### Scenario: K 线数据不足 60 个交易日降级
- **GIVEN** 标普 500 指数 K 线获取失败或数据点 < 60
- **WHEN** 引擎计算共享指标
- **THEN** `drawdownFromPeak5Y === null`、推荐响应顶层 `stale: true`、offsite 命中兜底 `normal` 档、onsite 命中 `idle` 信号

#### Scenario: 响应同时返回 peakClose5Y / peakDate5Y / latestClose
- **WHEN** 推荐接口对一个数据齐全的标普 500 返回结果
- **THEN** 响应顶层包含 `drawdownFromPeak5Y` / `peakClose5Y`（4 位小数）/ `peakDate5Y`（YYYY-MM-DD）/ `latestClose`（4 位小数）

### Requirement: 场外定投 4 档矩阵
系统 SHALL 根据共享指标 `drawdownFromPeak5Y` 匹配场外子配置的 `offsite.tiers`，按"命中即停"输出场外推荐档位与月定投金额。

#### Scenario: 默认配置 — 暂停档
- **GIVEN** drawdownFromPeak5Y = 1.5
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.hitTier.id === "pause"`、`offsite.actualAmount === 0`、`triggerReason` 包含 "回撤 1.50% < 3%"

#### Scenario: 默认配置 — 减半档
- **GIVEN** drawdownFromPeak5Y = 6.0
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.hitTier.id === "half"`、`offsite.actualAmount === 500`（基准 1000 × 50%）

#### Scenario: 默认配置 — 正常档
- **GIVEN** drawdownFromPeak5Y = 14.0
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.hitTier.id === "normal"`、`offsite.actualAmount === 1000`

#### Scenario: 默认配置 — 加倍档（兜底无上界）
- **GIVEN** drawdownFromPeak5Y = 32.0
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.hitTier.id === "double"`、`offsite.actualAmount === 2000`

#### Scenario: 边界 — 右开区间
- **GIVEN** drawdownFromPeak5Y = 10.0（恰好等于 normal 档下界）
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.hitTier.id === "normal"`（上一档 half 的 drawdownLt = 10 是右开，10 落入 normal）

#### Scenario: tierScans 全量返回
- **WHEN** 引擎匹配场外档位
- **THEN** `offsite.tierScans` 数组返回所有 4 档，命中档 `hit: true`，其余 `hit: false`、`summary: "已被前置规则命中" 或 "未触发"`

### Requirement: 场内 4 信号灯 + 阶梯溢价闸门
系统 SHALL 根据共享指标 `drawdownFromPeak5Y` 匹配场内子配置的 `onsite.signals`，并通过 `onsite.premiumGate` 阶梯闸门对建议金额做二次调整。

#### Scenario: 默认配置 — 未到时机
- **GIVEN** drawdownFromPeak5Y = 1.5
- **WHEN** 引擎匹配场内信号
- **THEN** `onsite.hitSignal.id === "idle"`、`onsite.baseAmount === 0`、`onsite.suggestedAmount === 0`

#### Scenario: 默认配置 — 可关注（基础金额 5000）
- **GIVEN** drawdownFromPeak5Y = 6.0、ETF 当前溢价 = 0.3%
- **WHEN** 引擎匹配场内信号 + 闸门
- **THEN** `onsite.hitSignal.id === "watch"`、`onsite.baseAmount === 5000`、`onsite.premium.status === "fullPass"`、`onsite.suggestedAmount === 5000`

#### Scenario: 默认配置 — 可加仓 + 半额放行
- **GIVEN** drawdownFromPeak5Y = 14.0、ETF 当前溢价 = 0.8%
- **WHEN** 引擎匹配场内信号 + 闸门
- **THEN** `onsite.hitSignal.id === "buy"`、`onsite.baseAmount === 10000`、`onsite.premium.status === "halfPass"`、`onsite.suggestedAmount === 5000`（10000 × 0.5）

#### Scenario: 默认配置 — 强烈加仓 + 拦截
- **GIVEN** drawdownFromPeak5Y = 32.0、ETF 当前溢价 = 2.5%
- **WHEN** 引擎匹配场内信号 + 闸门
- **THEN** `onsite.hitSignal.id === "strong"`、`onsite.baseAmount === 15000`、`onsite.premium.status === "blocked"`、`onsite.suggestedAmount === 0`、`onsite.premium.message` 包含 "溢价过高，建议改买场外"

#### Scenario: IOPV 不可用降级 — 全额放行 + stale
- **GIVEN** drawdownFromPeak5Y = 14.0、ETF 实时行情可用但 IOPV / 折溢价率字段缺失
- **WHEN** 引擎匹配场内信号 + 闸门
- **THEN** `onsite.premium.value === null`、`onsite.premium.status === "iopvUnavailable"`、`onsite.suggestedAmount === 10000`（按全额放行，避免误拦截）、`onsite.stale === true`

#### Scenario: ETF 行情完全失败 — 信号正常 + 闸门 stale
- **GIVEN** drawdownFromPeak5Y = 14.0、ETF 实时行情接口完全失败
- **WHEN** 引擎计算
- **THEN** `onsite.hitSignal.id === "buy"`（按指数回撤命中）、`onsite.premium.value === null`、`onsite.premium.status === "iopvUnavailable"`、`onsite.suggestedAmount === 10000`、`onsite.stale === true`

#### Scenario: 信号档与定投档共享回撤边界
- **WHEN** 引擎匹配同一回撤值
- **THEN** `offsite.hitTier.id` 与 `onsite.hitSignal.id` 必然落在对应档位（pause↔idle / half↔watch / normal↔buy / double↔strong）

### Requirement: ETF IOPV 抓取扩展
系统 SHALL 在东方财富 push2 行情接口请求中扩展抓取 `f184`（IOPV）+ `f185`（折溢价率，%），并提供按 secid 查询单只 ETF IOPV 的辅助方法。

#### Scenario: 批量行情接口扩展字段
- **WHEN** `services/etfFetcher.js` 的 `fetchETFQuotesEastmoney(etfs)` 被调用
- **THEN** 请求 URL 的 `fields=` 参数末尾包含 `f184,f185`，返回的 quotes 对象每条记录包含 `iopv: number|null`、`premiumPct: number|null`

#### Scenario: 服务端折溢价率优先
- **GIVEN** 接口返回 `f185 = 0.78`、`f184 = 1.234`、`price = 1.244`
- **WHEN** 引擎读取溢价率
- **THEN** 优先使用 `f185 = 0.78` 作为 premium

#### Scenario: f185 不可用时自算
- **GIVEN** `f185` 缺失但 `f184 = 1.234`、`price = 1.244`
- **WHEN** 引擎读取溢价率
- **THEN** 自算 `premium = (1.244 - 1.234) / 1.234 × 100 ≈ 0.81`

#### Scenario: f184 也不可用时降级
- **GIVEN** `f184` 与 `f185` 均缺失
- **WHEN** 引擎读取溢价率
- **THEN** `premium = null`

#### Scenario: 提供 fetchETFIopvBySecid 公共导出
- **WHEN** 策略引擎需按 secid 拉取单只 ETF 的最新 IOPV
- **THEN** `services/etfFetcher.js` 暴露 `fetchETFIopvBySecid(secid)` 方法，返回 `{ price, iopv, premiumPct } | null`

### Requirement: 实时计算标普 500 推荐
系统 SHALL 提供 `GET /api/strategy/sp500-recommendations` 接口，公开读取，返回当前共享指标 + 场外档位 + 场内信号 + 溢价闸门状态。

#### Scenario: 数据齐全时返回完整推荐
- **WHEN** 标普 500 K 线 + 摩根 017641 净值（用于显示）+ 513500 ETF 行情 IOPV 均可用
- **THEN** 响应包含 `calculatedAt` / 顶层共享指标（drawdownFromPeak5Y / peakClose5Y / peakDate5Y / latestClose）/ `offsite.{ hitTier, monthlyAmount, actualAmount, triggerReason, tierScans, stale: false }` / `onsite.{ hitSignal, premium, baseAmount, suggestedAmount, triggerReason, signalScans, stale: false }` / 顶层 `stale: false`

#### Scenario: 指数 K 线失败时整体降级
- **WHEN** 标普 500 K 线全部源失败
- **THEN** 顶层 `stale: true`、`drawdownFromPeak5Y: null`、`offsite.hitTier.id === "normal"`（兜底）、`onsite.hitSignal.id === "idle"`（数据缺失视为不命中加仓）、`triggerReason` 包含 "指数 K 线不可用，建议手动判断"

#### Scenario: 仅 ETF 行情失败 — 场外正常 / 场内单独 stale
- **WHEN** 指数 K 线 OK，017641 净值 OK，513500 ETF 行情失败
- **THEN** `offsite.stale === false`（正常）、`onsite.stale === true`、`onsite.premium.status === "iopvUnavailable"`、顶层 `stale === false`

#### Scenario: 仅场外基金净值失败 — 场内正常 / 场外单独 stale
- **WHEN** 指数 K 线 OK，017641 净值失败，513500 ETF 行情 + IOPV OK
- **THEN** `offsite.stale === true`（净值数据不可用，但档位仍按指数回撤计算）、`onsite.stale === false`、顶层 `stale === false`

#### Scenario: 接口具备缓存
- **WHEN** 短时间内多次调用推荐接口（交易时段 5 分钟内 / 休市 30 分钟内）
- **THEN** 系统命中 smartCacheGet 缓存，返回相同结果

### Requirement: 投资策略 Tab 新增标普 500 子 tab
系统 SHALL 在「投资策略」Tab 的子 tab 列表中新增"📈 标普500"，渲染场外定投卡片 + 场内加仓卡片两张。

#### Scenario: 子 tab 注册
- **WHEN** 用户进入「投资策略」Tab
- **THEN** 子 tab 列表包含"📈 标普500"，位置在"💼 主动基金"和"🌡️ 温度计"之间

#### Scenario: 默认渲染两张卡片
- **WHEN** 用户切换到"📈 标普500"子 tab
- **THEN** 系统渲染两张卡片：
  - 顶部"场外定投 · 摩根标普500 (017641)"卡片，含档位徽章 + 月定投金额 + 触发依据 + 档位扫描折叠区
  - 底部"场内加仓 · 博时标普500 ETF (513500)"卡片，含信号灯徽章 + 溢价状态条 + 建议金额 + 触发依据 + 信号扫描折叠区

#### Scenario: 场内卡片溢价状态条
- **WHEN** 推荐响应 `onsite.premium.value` 非 null
- **THEN** 卡片顶部显示溢价状态条："💱 溢价 X.XX% · {放行|半额放行|拦截}"，颜色按 status 映射（fullPass=绿 / halfPass=橙 / blocked=红）

#### Scenario: 场内卡片 IOPV 不可用警告
- **WHEN** `onsite.premium.value === null`
- **THEN** 状态条显示 "⚠ IOPV 数据不可用，闸门暂停工作"，灰色背景

#### Scenario: 共享指标顶部展示
- **WHEN** 用户切换到子 tab
- **THEN** 在两张卡片之上显示一个"市场状态"小条：标普 500 当前 X.XX、5Y 高点 X.XX (YYYY-MM-DD)、距高点回撤 X.XX%

#### Scenario: stale 数据视觉警告
- **WHEN** 推荐响应任一层级 `stale === true`
- **THEN** 对应卡片顶部显示灰色"⚠ 数据陈旧"标签

#### Scenario: 非管理员看不到管理按钮
- **WHEN** 用户未登录或角色为 user
- **THEN** 不显示"编辑策略"按钮，但完整展示推荐内容

### Requirement: 管理员可视化配置标普 500 策略
系统 SHALL 为管理员提供标普 500 策略的可视化创建/编辑表单。

#### Scenario: 编辑表单
- **WHEN** 管理员点击"编辑策略"
- **THEN** 弹出表单包含：
  - 场外子表单：基金代码（锁定 017641 默认）、基金名、月定投基准金额
  - 场外档位编辑：4 个 drawdownLt 阈值（pause / half / normal / double 的回撤上界，double 的上界为 null）+ 4 个 multiplier
  - 场内子表单：ETF 代码、ETF secid
  - 场内信号编辑：4 个 drawdownLt + 4 个 amount
  - 溢价闸门：fullPassMaxPct + halfPassMaxPct 两阈值

#### Scenario: 提交后整体替换
- **WHEN** 管理员填完表单提交
- **THEN** 前端 POST 完整策略对象给后端，存储至 `data/sp500-strategy.json`，响应清空推荐缓存

#### Scenario: 表单校验失败
- **WHEN** 表单值不合法（如 fullPassMaxPct >= halfPassMaxPct，或档位边界非递增）
- **THEN** 前端阻止提交并提示错误，不发起 API 调用
