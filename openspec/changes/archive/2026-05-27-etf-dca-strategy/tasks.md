## 1. 后端：ETF 持仓数据持久化（独立存储）

- [x] 1.1 在 `server.js` 中新增 `ETF_HOLDINGS_FILE = path.join(__dirname, 'data', 'etf-holdings.json')` 常量
- [x] 1.2 实现 `readEtfHoldings()` / `writeEtfHoldings()` 读写函数（参考 `readGoldHoldings` 模式）
- [x] 1.3 实现 `ensureEtfHoldingsFile()` 首次启动自检：文件不存在时创建空 `{ records: [] }`
- [x] 1.4 在启动序列中调用 `ensureEtfHoldingsFile()`（与 `ensureDefaultGoldStrategies()` 并列）

## 2. 后端：ETF 持仓 API（独立路径）

- [x] 2.1 `GET /api/strategy/etf-holdings`（公开，按日期降序）
- [x] 2.2 `POST /api/strategy/etf-holdings`（requireAdmin）+ 字段校验（fundCode/type/date/amount/shares/nav）+ sell 联动 tier triggeredAt
- [x] 2.3 `POST /api/strategy/etf-holdings/delete`（requireAdmin）+ sell 删除联动重置 tier triggeredAt
- [x] 2.4 写入接口完成后清空 etf-recommendations 缓存
- [x] 2.5 确认黄金 API `/api/strategy/gold-holdings*` 完全不动，正常工作

## 3. 后端：ETF 策略引擎模块

- [x] 3.1 新建 `services/etfStrategyEngine.js`
- [x] 3.2 实现 `matchEtfPriceTier(price, priceTiers)`：
        - 按 priceTiers 顺序遍历，找到第一个 `priceMin ≤ price < priceMax` 的档（priceMin 或 priceMax 为 null 表示无界）
        - 区间右开（price === priceMax 时不命中该档）
        - 返回命中的 tier + 所有档的扫描结果（hit/miss + 简短文案）
- [x] 3.3 实现 `computeEtfIndicators(currentPrice, dailyKline)`：
        - 计算 monthChangePct = (currentPrice − k线第 22 日前的收盘) / 22日前收盘 × 100
        - K 线点数 < 22 时返回 monthChangePct = null
- [x] 3.4 实现 `evaluateCrashSignal(monthChangePct, crashTiers)`：
        - 按 threshold 从严到松（绝对值大→小）匹配
        - 命中即返回该 tier + 友好文案，无命中返回 null
- [x] 3.5 实现 `evaluateGenericTakeProfitTiers(tiers, indicators, totalShares, latestPrice)`：
        - 通用化止盈评估，支持 condition 数组（v1 仅 fundReturnPct 字段）
        - state: triggered（triggeredAt 非空）/ actionable（所有 conditions 命中）/ pending
- [x] 3.6 实现 `computeEtfRecommendations(strategies, holdings, etfQuotes, etfKlines)` 主入口：
        - 并行从 etfQuotes 提取每只 ETF 当前价
        - 并行调用 `fetchETFKlinesForRange(secid, code, market, '1y')` 获取 K 线（或复用现有缓存）
        - 调用 matchEtfPriceTier / computeEtfIndicators / evaluateCrashSignal / summarizeHoldings（复用 gold 引擎）/ evaluateGenericTakeProfitTiers
        - 组装返回 recommendations 数组

## 4. 后端：ETF 数据持久化与默认配置

- [x] 4.1 在 `server.js` 中新增 `ETF_STRATEGY_FILE` 常量 + 默认 4 只 ETF 完整配置（priceTiers 5档 + takeProfitTiers 3档 + crashTiers 3级）
- [x] 4.2 实现 `readEtfStrategies()` / `writeEtfStrategies()`
- [x] 4.3 实现 `ensureDefaultEtfStrategies()` 首次启动自动注入 4 只 ETF（启动时调用）
- [x] 4.4 实现 `validateEtfStrategy(input)` 校验函数：
        - fundCode / fundName 必填
        - priceTiers 非空 且区间不交叉
        - takeProfitTiers 的 sellPct ∈ (0, 100]
        - crashTiers 的 threshold ≤ 0
        - upsert 时保留旧 triggeredAt

## 5. 后端：ETF API 路由

- [x] 5.1 `GET /api/strategy/etf-plans`（公开）
- [x] 5.2 `POST /api/strategy/etf-plans`（requireAdmin）+ 完整字段校验
- [x] 5.3 `POST /api/strategy/etf-plans/delete`（requireAdmin）
- [x] 5.4 `GET /api/strategy/etf-recommendations`（公开）+ smartCacheGet（key='etf-recommendations'，TTL 交易 30s / 休市 30min）
- [x] 5.5 在 `getCacheTTL()` 追加 `etf-recommendations` 配置
- [x] 5.6 写入接口完成后清空 etf-recommendations 缓存

## 6. 前端：数据加载与状态管理

- [x] 6.1 在 `public/index.html` 顶层 JS 区新增模块变量：`etfStrategies = []`、`etfRecommendations = null`、`etfHoldings = []`、`etfLoading = false`、`etfEditingCode = null`
- [x] 6.2 实现 `loadEtfData(forceRefresh)`：并行 fetch recommendations / plans / etf-holdings
- [x] 6.3 在 `switchTab('strategy')` 钩子中追加 `loadEtfData()` 调用（与 loadGoldData 并列）

## 7. 前端：HTML 与 CSS

- [x] 7.1 在 `tab-strategy` section 内、黄金 section 之后插入 ETF section：标题 "ETF 投资策略" + Gold DCA 风格 section-header + `<div id="etfCards" class="etf-cards"></div>` 容器 + 策略表单（隐藏）+ 持仓表单（隐藏）
- [x] 7.2 新增 CSS（~150 行）：
        - `.etf-card` 卡片
        - `.etf-tier-row.color-{red,yellow,green,orange,purple}` 5 档色阶（橙色为本次新增）
        - `.etf-crash-banner` / `.etf-crash-banner.lv1/lv2/lv3` 暴跌警戒横条
        - `.etf-tier-table` 5 档进度表
- [x] 7.3 移动端适配

## 8. 前端：渲染逻辑

- [x] 8.1 `renderEtfCards(recommendations, holdings)` — 遍历渲染所有 ETF 卡片
- [x] 8.2 `renderEtfCard(rec, isAdmin)` — 单卡片，含 7 个子区域：
        a. header（名称 + 代码 + 配置比例 + 数据陈旧标记）
        b. 当前档徽章 + 本月推荐金额 + 触发依据
        c. 5 档进度表（折叠）
        d. 持仓汇总
        e. 止盈进度（3 档，复用黄金渲染器）
        f. 暴跌信号横条（命中时高亮）
        g. 持仓记录折叠表（复用黄金渲染器，但 fundCode 过滤为当前 ETF）
- [x] 8.3 `renderEtfTierTable(tierScans, hitTierId)` — 5 档进度可视化
- [x] 8.4 `renderEtfCrashBanner(crashSignal, monthChangePct)` — 暴跌警戒横条
- [x] 8.5 stale 状态显示灰色 "⚠ 行情陈旧" 标签
- [x] 8.6 空配置态显示 "暂无 ETF 策略" + 管理员添加按钮

## 9. 前端：管理员配置表单

- [x] 9.1 实现 `openEtfForm(fundCode?)` — 策略表单（创建/编辑）
- [x] 9.2 表单字段：fundCode、fundName、shortName、secid、allocationPct、5 档 priceTiers 表格（label / priceMin / priceMax / monthlyAmount / color / note）、3 档 takeProfitTiers 表格（label / sellPct / triggerConditions / displayHint）、3 级 crashTiers 表格（label / threshold / multiplier / note）
- [x] 9.3 实现 `etfFormToStrategy()` 将表单转 POST body
- [x] 9.4 实现 `saveEtfStrategy()` — POST 成功后 closeEtfForm + loadEtfData(true)
- [x] 9.5 实现 `editEtfStrategy(fundCode)` 与 `deleteEtfStrategy(fundCode)`（confirm 二次确认）

## 10. 前端：持仓记录管理（与黄金共用入口）

- [x] 10.1 实现 `openEtfHoldingForm(fundCode, defaultType, prefilled?)` — 沿用黄金的 `openGoldHoldingForm` 模式但走 `/api/strategy/etf-holdings`
- [x] 10.2 实现 `openEtfTakeProfitConfirm(fundCode, tierId, suggestion)` — 止盈确认弹窗
- [x] 10.3 实现 ETF 持仓表的 saveEtfHolding / deleteEtfHolding（走 `/api/strategy/etf-holdings*`）
- [x] 10.4 持仓表渲染时直接读 `etfHoldings`，不与黄金混杂

## 11. 验证

- [x] 11.1 启动服务后：`data/etf-strategy.json` 自动生成含 4 只 ETF；`data/etf-holdings.json` 自动创建为空记录；`data/gold-*.json` 完全不动
- [x] 11.2 调用 `GET /api/strategy/etf-recommendations`，校验：
        - 科创50 → hitTier.id 取决于当前实时价（预期：pause）
        - 创业板50 → 同上
        - 有色金属 → 同上
        - 恒生科技 → 取决于当前实时价（预期：normal 或 double）
- [x] 11.3 校验 `GET /api/strategy/gold-holdings` 返回结果与本次变更前完全一致（黄金接口不动）
- [ ] 11.4 前端「投资策略」Tab 第 4 个 section 正确展示 4 只 ETF 卡片（**待人工验证**）
- [ ] 11.5 5 档进度表展开/折叠 + 暴跌信号横条显示正确（**待人工验证**）
- [ ] 11.6 管理员录入 ETF 持仓记录 → 持仓汇总正确 + 收益率正确（**待人工验证**）
- [ ] 11.7 触发某只 ETF 的止盈档 → 点击「已止盈」 → 提交 sell 记录 → tier 状态变 triggered（**待人工验证**）
- [ ] 11.8 普通用户与未登录用户看不到任何管理按钮（**待人工验证**）

## 12. 测试

- [x] 12.1 新增 `tests/etfEngine.test.js`：覆盖
        - `matchEtfPriceTier`（含区间右开、超出最高档/最低档、价格 null 降级）
        - `computeEtfIndicators`（K 线不足 22 日降级）
        - `evaluateCrashSignal`（3 级匹配优先级、未命中返回 null）
        - `evaluateGenericTakeProfitTiers`（含 fundReturnPct null 场景）
- [x] 12.2 新增 `tests/etfStrategy.test.js`：覆盖
        - GET/POST/DELETE etf-plans 认证 + 校验（fundCode/priceTiers交叉/sellPct越界/crashThreshold正数）
        - upsert 保留 triggeredAt
        - GET etf-recommendations 返回结构完整
- [x] 12.3 新增 `tests/etfHoldings.test.js`：覆盖
        - `/api/strategy/etf-holdings*` 的认证、校验、CRUD 完整流程
        - sell + tierId 联动正确设置 / 删除 sell 联动重置 tier
        - 黄金 `/api/strategy/gold-holdings` 不受影响（回归校验）
- [x] 12.4 跑全量回归测试，确保现有 199 项测试不破坏（active-fund 27 + gold 17 + 等等）
