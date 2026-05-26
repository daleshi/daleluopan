## 1. 后端：规则引擎扩展与数据持久化

- [x] 1.1 在 `services/activeFundStrategyEngine.js` 的 `ALLOWED_FIELDS` 中追加 `fundPricePercentile5Y` 和 `fundDrawdown1Y` 两个枚举值
- [x] 1.2 在 `FIELD_LABELS` / `FIELD_UNITS` 中追加对应的中文显示文案
- [x] 1.3 新建 `data/gold-strategy.json` 的默认数据（华安黄金联接A 000216 + 4 档买入规则 + 3 档止盈）
- [x] 1.4 在 `server.js` 中新增 `GOLD_STRATEGY_FILE` / `GOLD_HOLDINGS_FILE` 常量与 read/write 函数
- [x] 1.5 实现首次启动自检：`ensureDefaultGoldStrategies()`（注入默认配置）+ `ensureGoldHoldingsFile()`（创建空记录）

## 2. 后端：黄金策略引擎模块

- [x] 2.1 新建 `services/goldStrategyEngine.js`
- [x] 2.2 实现 `computeGoldIndicators(navTrend, priceWindow, drawdownWindow)`
- [x] 2.3 实现 `summarizeHoldings(records, fundCode, latestNav)`
- [x] 2.4 实现 `evaluateTakeProfitTiers(tiers, totalReturnPct, totalShares, latestNav)`
- [x] 2.5 实现 `computeGoldRecommendations(strategies, allHoldings)` 主入口

## 3. 后端：API 路由

- [x] 3.1 `GET /api/strategy/gold-plans`（公开）
- [x] 3.2 `POST /api/strategy/gold-plans`（requireAdmin）+ 完整字段校验
- [x] 3.3 `POST /api/strategy/gold-plans/delete`（requireAdmin）
- [x] 3.4 `GET /api/strategy/gold-recommendations`（公开）+ smartCacheGet 接入
- [x] 3.5 在 `getCacheTTL()` 中追加 `'gold-recommendations'` 的 TTL 配置
- [x] 3.6 `GET /api/strategy/gold-holdings`（公开）
- [x] 3.7 `POST /api/strategy/gold-holdings`（requireAdmin）+ 校验 + sell 类型联动设置 tier triggeredAt
- [x] 3.8 `POST /api/strategy/gold-holdings/delete`（requireAdmin）+ sell 记录删除联动重置 tier triggeredAt
- [x] 3.9 写入接口完成后清空 recommendations 缓存

## 4. 前端：数据加载与状态管理

- [x] 4.1 在 `public/index.html` 顶层 JS 区新增模块变量：`goldStrategies = []`、`goldRecommendations = null`、`goldHoldings = []`、`goldLoading = false`
- [x] 4.2 实现 `loadGoldData(forceRefresh)`：并行 fetch recommendations / plans / holdings，更新状态并触发渲染
- [x] 4.3 在 `switchTab('strategy')` 钩子中追加 `loadGoldData()` 调用（与现有的 loadActiveFundRecommendations、loadDcaPlans 并列）

## 5. 前端：HTML 与 CSS

- [x] 5.1 在 `tab-strategy` section 内、主动基金定投策略之上，插入「黄金定投策略」容器：
      ```html
      <div class="section">
        <div class="section-header">
          <div class="section-title">黄金定投策略</div>
          <div class="section-badge">Gold DCA</div>
          <button class="dca-add-btn" onclick="openGoldForm()">＋ 添加策略</button>
        </div>
        <div id="goldCards" class="gold-cards"></div>
        <div id="goldFormWrap" class="pos-form-wrap" style="display:none">...</div>
        <div id="goldHoldingFormWrap" class="pos-form-wrap" style="display:none">...</div>
      </div>
      ```
- [x] 5.2 新增 CSS：`.gold-card`（卡片样式）/ `.gold-badge-gold`（金色徽章用于止盈）/ `.gold-tp-row`（止盈档行）/ `.gold-tp-actionable`（金色高亮）/ `.gold-holdings-table`（持仓表）
- [x] 5.3 移动端适配（@media max-width: 768px），止盈进度条单列堆叠

## 6. 前端：渲染逻辑

- [x] 6.1 实现 `renderGoldCards(recommendations, holdings)` — 遍历每只基金渲染卡片
- [x] 6.2 实现 `renderGoldCard(rec)` — 单卡片，包含买入端徽章、持仓汇总、止盈进度、持仓记录折叠区
- [x] 6.3 实现 `renderGoldTakeProfitTiers(takeProfitStatus)` — 3 档止盈进度条
- [x] 6.4 实现 `renderGoldHoldingsTable(records, fundCode)` — 持仓记录表（按日期降序，buy/sell 颜色区分）
- [x] 6.5 stale 状态显示灰色"⚠ 数据陈旧"
- [x] 6.6 空态显示："暂无黄金定投策略" + 管理员添加按钮
- [x] 6.7 持仓为空时显示提示"暂无持仓记录，请录入定投买入"

## 7. 前端：管理员配置表单

- [x] 7.1 实现 `openGoldForm(fundCode?)` — 策略表单（创建/编辑）
- [x] 7.2 表单字段：基金选择器（搜索）、月定投金额、4 档规则阈值、3 档止盈阈值与卖出比例
- [x] 7.3 实现 `goldFormToRules(formValues)` — 转通用 rules 结构（含 normal 兜底）
- [x] 7.4 实现 `goldFormToTakeProfitTiers(formValues)` — 转 tiers 数组
- [x] 7.5 实现 `saveGoldStrategy()` — 提交 POST，成功后 closeGoldForm + loadGoldData(true)
- [x] 7.6 实现 `deleteGoldStrategy(fundCode)` — confirm 二次确认 → POST 删除接口

## 8. 前端：持仓记录管理

- [x] 8.1 实现 `openGoldHoldingForm(fundCode, prefilled?)` — 持仓记录表单
- [x] 8.2 表单字段：基金（lock）、类型 buy/sell、日期、金额、份额、净值、备注
- [x] 8.3 实现 `saveGoldHolding()` — 提交 POST，成功后 closeGoldHoldingForm + loadGoldData(true)
- [x] 8.4 实现 `deleteGoldHolding(id)` — confirm 二次确认 → POST 删除接口
- [x] 8.5 实现 `openTakeProfitConfirm(fundCode, tierId, suggestion)` — 止盈确认弹窗：
        - 预填 type=sell、date=今天、shares=suggestion.shares、amount=suggestion.amountApprox、tierId
        - 用户可调整金额/份额
        - 提交时调用 `saveGoldHolding()`（带 tierId）

## 9. 验证

- [x] 9.1 本地启动后 `data/gold-strategy.json` 与 `data/gold-holdings.json` 自动生成，前者含 000216 默认配置
- [x] 9.2 调用 `GET /api/strategy/gold-recommendations`，校验 000216 当前应为 pause 档，actualAmount=0，triggerReason 含 "≥ 90%"
- [ ] 9.3 通过 UI 录入若干 buy 记录后，持仓汇总（totalCost/Shares/marketValue/returnPct）正确
- [ ] 9.4 当 totalReturnPct ≥ 30% 时 tp30 显示为 actionable + 显示建议份额；点击「已止盈」 → 弹表单 → 提交 → tier 状态变 triggered + sell 记录入表（**待人工验证**）
- [ ] 9.5 删除该 sell 记录 → tp30 状态自动回退到 actionable / pending（**待人工验证**）
- [ ] 9.6 普通用户看不到任何添加/编辑/删除按钮（**待人工验证**）
- [ ] 9.7 蛋卷/东方财富断网时，stale 标记正确显示（**待人工验证**）

## 10. 测试

- [x] 10.1 新增 `tests/goldEngine.test.js`：覆盖 `computeGoldIndicators`（含 NAV 不足 60 天降级）/ `summarizeHoldings`（buy-sell 净计算）/ `evaluateTakeProfitTiers`（3 种 state）
- [x] 10.2 新增 `tests/goldStrategy.test.js`：覆盖 GET / POST / DELETE / Recommendations / Holdings 的认证、校验、Upsert、联动等核心场景
