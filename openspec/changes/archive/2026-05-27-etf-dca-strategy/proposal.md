## Why

「投资策略」Tab 当前覆盖了三类资产（指数温度计、主动基金、黄金），但**ETF 资产**尚未覆盖。
用户希望按 4ETF.md 提供的康波周期策略，对 4 只精选 ETF 进行动态定投：

- **科创50 (588080)** · 配置 35% · 半导体国产化
- **创业板50 (159949)** · 配置 25% · 新能源 + AI 算力
- **有色金属 (512400)** · 配置 20% · 资源周期
- **恒生科技 (513180)** · 配置 20% · 港股科技

这套策略与现有的指数温度计 / 主动基金 / 黄金策略**都不同**：
- 不用 PE 分位（部分 ETF 是周期股，PE 反向指示）
- 不用基金回撤（ETF 价格本身就是直接信号）
- 采用 **5 档价格区间** + **3 档止盈** + **3 级暴跌加仓** 的纪律化执行系统
- 每只 ETF 各自有完全不同的价格阈值（不像黄金那套通用规则模板）

按真实数据 dry-run（2026-05-26 收盘）：
- 科创50：1.913 → 🔴 暂停（>1.60）
- 创业板50：1.954 → 🔴 暂停（>1.90）
- 有色金属：2.095 → 🟡 观望（1.80-2.30）
- 恒生科技：0.630 → 🟢 加倍定投（<0.63）—— **当前唯一在投标的**

## What Changes

### 规则锁定（来自 4ETF.md，用户已确认全集实现）

**入场端（5 档仓位控制）**

每只 ETF 各自独立的价格区间（参考 4ETF.md 第 1.1-1.4 节）：

| ETF | 暂停 | 观望 | 定投 | 加倍 | 极限 |
|---|---|---|---|---|---|
| 科创50 (588080) | >1.60 = ¥0 | 1.22-1.60 = ¥700 | 0.92-1.22 = ¥2,100 | 0.72-0.92 = ¥4,200 | <0.72 = ¥12,600 |
| 创业板50 (159949) | >1.90 = ¥0 | 1.50-1.90 = ¥500 | 1.20-1.50 = ¥1,500 | 1.00-1.20 = ¥3,000 | <1.00 = ¥9,000 |
| 有色金属 (512400) | >2.30 = ¥0 | 1.80-2.30 = ¥500 | 1.40-1.80 = ¥1,200 | 1.10-1.40 = ¥2,400 | <1.10 = ¥7,200 |
| 恒生科技 (513180) | >0.80 = ¥0 | 0.63-0.80 = ¥1,200 | 0.50-0.63 = ¥2,400 | 0.40-0.50 = ¥3,600 | <0.40 = ¥14,400 |

**卖出端（3 档分批止盈）**

每只 ETF 各自独立的止盈条件（参考 4ETF.md 第 2.1-2.4 节），三档独立触发、用户确认型：

| 档位 | 操作 |
|---|---|
| 第一批止盈 | 减仓 1/3 |
| 第二批止盈 | 再减 1/3 |
| 清仓 | 卖出剩余 1/3 |

触发条件各 ETF 不同（PE 阈值 / 价格阈值 / PB 阈值），详见 design.md 数据结构。

**暴跌加仓（3 级，月度涨跌幅信号驱动）**

| 等级 | 触发条件 | 投入量 |
|---|---|---|
| 一级·加倍 | 单月跌超 12% | 3 倍月投 |
| 二级·极限 | 单月跌超 20% | 6 倍月投 |
| 三级·史诗 | 单月跌超 30% | 全部可用资金（信号性提示，不自动计算金额） |

### 功能新增

- **新增** 在「投资策略」Tab 增加第 4 个 section「ETF 投资策略」，与黄金/主动基金/温度计并列
- **新增** 4 只默认 ETF 的预设策略配置（首次启动自动注入）
- **新增** ETF 实时价格 → 5 档入场判定 → 推荐定投金额
- **新增** 3 档止盈状态评估（基于持仓累计收益率 / 自定义阈值字段）
- **新增** 月度涨跌幅监控 → 暴跌加仓信号
- **新增** ETF 持仓记录管理（买入 / 卖出 / 止盈卖出事件流）

### 数据存储（用户已确认 A 方案）

新建独立持仓表 `data/etf-holdings.json`，结构沿用 gold-holdings 的事件流模式（buy/sell 各一条），但与黄金完全隔离：
- 黄金继续用 `data/gold-holdings.json` + `/api/strategy/gold-holdings*` —— **不动**
- ETF 用 `data/etf-holdings.json` + `/api/strategy/etf-holdings*` —— 新增
- 两份表完全独立，避免迁移风险

### 新增 API

- `GET /api/strategy/etf-plans`（公开）
- `POST /api/strategy/etf-plans`（管理员）
- `POST /api/strategy/etf-plans/delete`（管理员）
- `GET /api/strategy/etf-recommendations`（公开 + smartCacheGet）
- `GET /api/strategy/etf-holdings`（公开）
- `POST /api/strategy/etf-holdings`（管理员）
- `POST /api/strategy/etf-holdings/delete`（管理员）

## Capabilities

### New Capabilities

- **`etf-dca-strategy`**：ETF 动态定投策略与持仓管理。
  - 入场端：5 档价格区间判定（暂停/观望/定投/加倍/极限）
  - 卖出端：3 档止盈状态评估（用户确认型）
  - 暴跌加仓：基于月度涨跌幅的 3 级警戒信号
  - 数据来源：复用 `services/etfFetcher.js` 实时行情 + K 线接口
  - 引擎复用 `activeFundStrategyEngine` 的规则匹配 + `goldStrategyEngine` 的持仓汇总/止盈评估

### Modified Capabilities

无（本变更是纯新增 capability，不修改现有 gold-dca-strategy 或其他 capability）。

## Impact

### 后端
- **新建** `services/etfStrategyEngine.js`（~280 行）：
  - `computeEtfIndicators(currentPrice, klineMonthly)` — 计算月涨跌幅、N 月最高价等
  - `matchEtfPriceTier(price, priceTiers)` — 5 档价格区间匹配
  - `evaluateCrashSignal(monthChangePct, crashTiers)` — 3 级暴跌信号评估
  - `computeEtfRecommendations(strategies, holdings, etfQuotes)` — 主入口
- **新增数据文件** `data/etf-strategy.json`（首次启动自动注入 4 只默认 ETF 配置）
- **新增数据文件** `data/etf-holdings.json`（首次启动自动创建为 `{ records: [] }`）
- **调整** `server.js`：
  - 新增 7 个 ETF API 路由（plans CRUD 3 个 + recommendations 1 个 + holdings CRUD 3 个，~400 行）
- **新增** 字段白名单（用于 ETF 卖出规则）：`fundReturnPct`（自基金视角的累计收益率，用于止盈触发）

### 前端 (`public/index.html`)
- 新增 HTML section：ETF 策略容器（~120 行）
- 新增 JS 模块（~500 行）：ETF 卡片渲染 + 5 档进度可视化 + 暴跌加仓状态 + 止盈进度
- 新增 CSS（~150 行）：5 档色阶（绿/蓝/橙/红/紫）、价格区间进度条、暴跌警戒徽章
- 接入 `switchTab('strategy')` 钩子（与黄金并列加载）

### 不影响
- 现有 ETF 总览 Tab（`/api/etfs`）完全不动
- 现有黄金策略**完全不动**（持仓存储独立、API 独立）
- 现有 active-fund / 温度计定投完全不动

### 验收 Dry-Run

按 4ETF.md 第四节的 2026-05-26 当前快照：

```
科创50    (588080) 1.913 → 🔴 暂停定投 ¥0     未投
创业板50  (159949) 1.954 → 🔴 暂停定投 ¥0     未投
有色金属  (512400) 2.095 → 🟡 观望      ¥500   小仓试探
恒生科技  (513180) 0.630 → 🟢 加倍定投 ¥2,400 当前唯一在投标的

合计本月投入：¥2,900（满额时 4 只合计 ¥5,800/月）
```
