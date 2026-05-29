## Why

用户在投资组合中长期配置标普 500，目前用户已通过 watchlist 关注摩根标普500指数(QDII)A（场外，017641）和博时标普500 ETF（场内，513500）两只标的，但缺少一个**自动化的"是否值得定投/加仓"**判断工具。标普 500 与 A 股不同——没有可信的 PE 分位口径，故现有三套策略引擎（active-fund 用沪深 300 PE 分位、gold 用金价分位、etf 用 ETF 价格区间）的核心判据都不适用。

用户的实际操作策略是：**场外按月定投（受 QDII 限购影响小、跟踪误差大但单价稳）+ 场内择机下跌加仓（实时申赎不受限但有溢价风险）**。这种"场外定投+场内加仓"的双形态需要一个独立的策略卡片承载，并加入 QDII ETF 特有的**溢价闸门**——避免在场内溢价 >1.5% 时盲目追高。

## What Changes

- 新增 capability `sp500-dca-strategy`，独立于现有 `active-fund / gold / etf` 三套策略
- 新增数据持久化文件 `data/sp500-strategy.json`，承载场外基金（017641）+ 场内 ETF（513500）的双标的配置
- 新增 ETF 行情字段抓取：`services/etfFetcher.js` 的 `fetchETFQuotesEastmoney` 抓取字段集追加 `f184`（IOPV）+ `f185`（折溢价率），新增公共导出 `fetchETFIopvBySecid(secid)`，便于策略引擎按需获取单只 ETF 的 IOPV
- 新增策略引擎 `services/sp500StrategyEngine.js`：
  - 共享衍生指标 `priceDrawdown5Y`（标普 500 指数距近 5 年最高收盘价的回撤绝对值，% 正数）
  - 场外档位评估（4 档：暂停/减半/正常/加倍，对应回撤边界 3% / 10% / 20%）
  - 场内信号评估（4 信号：未到时机/可关注/可加仓/强烈加仓 + 阶梯溢价闸门 0.5% / 1.5%）
- 新增 API 端点：
  - `GET /api/strategy/sp500-plans`（公开读取配置）
  - `POST /api/strategy/sp500-plans`（管理员更新配置）
  - `GET /api/strategy/sp500-recommendations`（公开实时计算）
- 前端「投资策略」Tab 新增"📈 标普500"子 tab（与现有 ETF/黄金/主动基金/温度计/投资基准并列），渲染场外定投卡片 + 场内加仓卡片两张
- 单元测试：新增 `tests/sp500Engine.test.js`（衍生指标 + 档位匹配 + 溢价闸门 + 数据降级）+ `tests/sp500Strategy.test.js`（API 集成）

## Capabilities

### New Capabilities

- `sp500-dca-strategy`: 标普 500 指数的"场外定投 + 场内加仓"双形态投资策略，含距 5Y 高点回撤指标、4 档场外定投矩阵、4 信号场内加仓 + 阶梯溢价闸门、双标的独立降级。

### Modified Capabilities

（无 — 不改动 active-fund / gold / etf 任何 capability 的 spec 行为）

## Impact

- **代码**：
  - `services/sp500StrategyEngine.js`（新文件，~300 行）：核心引擎，含 `computePriceDrawdown5Y` / `matchOffsiteTier` / `matchOnsiteSignal` / `evaluatePremiumGate` / `computeRecommendations`
  - `services/etfFetcher.js`（小修改）：fields 字符串追加 `f184,f185`，导出 `fetchETFIopvBySecid` 函数
  - `services/dataFetcher.js`（小修改）：暴露标普 500 指数 K 线获取能力（若已有则不动）
  - `data/sp500-strategy.json`（新文件）：默认配置 — 单一策略对象（含 offsite + onsite 子配置）
  - `server.js`（中等修改）：3 个 API 路由 + `ensureDefaultSp500Strategy()` 初始化 + 推荐缓存 key
  - `public/index.html`（中等修改）：子 tab 注册（标普500）+ 双卡片 CSS（~80 行）+ 双卡片渲染函数（~250 行）+ 管理员可视化配置弹窗
  - `tests/sp500Engine.test.js` / `tests/sp500Strategy.test.js`（新文件，预计 30+ 用例）
- **API 兼容性**：100% additive，新增独立路径，不改既有 API
- **数据兼容性**：新增 `data/sp500-strategy.json` 文件；首次启动若不存在则用默认值初始化；已存在则保留不覆盖（与 gold/etf 策略一致）
- **前端兼容性**：新增子 tab，不影响其他 tab
- **运行依赖**：
  - 标普 500 指数 K 线（已有，dataFetcher 候选池含 SPX/100.SPX）
  - 摩根 017641 净值序列（已有，fundFetcher 可处理）
  - 513500 ETF 实时价 + IOPV（待扩展 f184/f185 字段抓取）
- **风险**：
  - **[Risk] 东财 f184/f185 字段对 QDII ETF 可能不稳定** → Mitigation: null 降级链 — 字段缺失时 premium=null，UI 显示"⚠ IOPV 数据不可用"，闸门视为"放行"（不误拦截），但卡片标 `stale: true`
  - **[Risk] 美股交易时段差异（北京时间 21:30-04:00 美股开盘）导致 IOPV 与现价失真** → Mitigation: 在 IOPV 字段同时记录 `iopvUpdatedAt`，前端显示数据时间，让用户自行判断；策略引擎不做时段过滤（保持简单）
  - **[Risk] QDII 限购** → Out of scope — 限购检测交给用户在场外申购时的实际反馈；策略只负责"该不该买"，不管"能不能买"
