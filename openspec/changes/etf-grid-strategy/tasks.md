## 1. 后端 — 数据持久化与初始化

- [x] 1.1 在 `server.js` 内新增 `readEtfGridStrategies()` / `writeEtfGridStrategies()` / `readEtfGridHoldings()` / `writeEtfGridHoldings()` 辅助函数
- [x] 1.2 新增 `ensureEtfGridDataFiles()` 首次启动创建空文件 `{"strategies":[]}` / `{"records":[]}`，模块加载时自动调用
- [x] 1.3 数据文件路径：`data/etf-grid-strategy.json`、`data/etf-grid-holdings.json`

## 2. 后端 — 网格计算引擎

- [x] 2.1 新增 `services/etfGridEngine.js`，导出：
  - `buildGridTable({ basePrice, gridStep, gridLevels })` → 完整网格价位表
  - `expectedNetPct(gridStep, feeRate)` → 单轮预期净利率
  - `computeNearestGrid(currentPrice, gridTable, filledLevels)` → 最近未触发网线
  - `computeDistanceToBasePct(currentPrice, basePrice)` → 距中线百分比
- [x] 2.2 `computeHoldingsAndPnl(strategy, allRecords, currentPrice)`：FIFO 配对，返回底仓/网格已实现/网格浮动/总收益率
- [x] 2.3 `computeProtection(strategy, allRecords, marketTemperature)`：温度暂停 + 连续买入冷却判定
- [x] 2.4 `buildRecommendation(strategy, records, currentPrice, marketTemperature, meta)` 统一组装单个策略的推荐视图

## 3. 后端 — API 路由

- [x] 3.1 `GET /api/strategy/etf-grid-plans`（公开）
- [x] 3.2 `POST /api/strategy/etf-grid-plans`（requireAdmin，upsert，含完整字段校验与软警告）
- [x] 3.3 `POST /api/strategy/etf-grid-plans/delete`（requireAdmin）
- [x] 3.4 `POST /api/strategy/etf-grid-plans/reset-base-price`（requireAdmin，未指定 newBasePrice 时读实时价）
- [x] 3.5 `GET /api/strategy/etf-grid-holdings`（公开，按日期降序）
- [x] 3.6 `POST /api/strategy/etf-grid-holdings`（requireAdmin，含 type/gridLevel 一致性校验）
- [x] 3.7 `POST /api/strategy/etf-grid-holdings/delete`（requireAdmin）
- [x] 3.8 `GET /api/strategy/etf-grid-recommendations`（公开，`smartCacheGet` 交易 30s / 休市 30min）
- [x] 3.9 `getCacheTTL('etf-grid-recommendations')` TTL 配置
- [x] 3.10 `clearEtfGridRecommendationCache()` 写操作后立即失效

## 4. 前端 — SubTab 与卡片结构

- [x] 4.1 在 `#strategySubtabs` 添加 `<button data-substrat="etf-grid">🕸️ ETF 网格</button>`
- [x] 4.2 在 `STRATEGY_SUBTAB_MAP` 中新增 `'ETF 网格策略': 'etf-grid'`
- [x] 4.3 在 `#tab-strategy` 内新增 section (标题 "ETF 网格策略" / badge "ETF Grid")
- [x] 4.4 section 含说明文案 + 策略配置表单容器 + 卡片列表容器
- [x] 4.5 卡片模板 `buildEtfGridCardHtml(rec, isAdmin)`：头部/摘要行/配置块/运行状态块/网格价位表/成交记录

## 5. 前端 — CSS 样式

- [x] 5.1 `.grid-card / .grid-card-header / .grid-card-icon / .grid-card-title` 卡片基础样式
- [x] 5.2 `.grid-status-badge` (running/paused/archived)
- [x] 5.3 `.grid-protection-banner` 保护机制警戒横条
- [x] 5.4 `.grid-summary-row` 三栏摘要（当前价/距中线/下一步）
- [x] 5.5 `.grid-config-block / .grid-status-block / .grid-kv-grid` 配置与运行状态
- [x] 5.6 `.grid-price-table / .grid-price-row-base / .grid-price-row-current-price` 网格价位表 + 当前价横线穿插
- [x] 5.7 `.grid-cell-status-*` (waiting/filled-buy/filled-sell/paused/base)
- [x] 5.8 `.grid-fill-btn` 补录按钮 + `.grid-holdings-table` 成交记录
- [x] 5.9 移动端 ≤480px 断点：单列摘要 + 2 列 KV + 紧凑价位表

## 6. 前端 — 策略配置表单

- [x] 6.1 表单容器 `#etfGridFormWrap`（默认隐藏，点[+ 添加]或[编辑]展开）
- [x] 6.2 字段：ETF 下拉（从 etfData 派生）+ 步长% + 单侧网数 + 中线（含[使用当前价]按钮）+ 总预算 + 底仓 + 每格 + 手续费% + 温度阈值 + 冷却 N/M
- [x] 6.3 实时预览 `#etfGridFormPreview`：任一字段变更时刷新，显示完整价位表 + 满仓资金占用 + 单轮预期净利
- [x] 6.4 软警告：满仓资金超预算时预览区红字提示（服务端也返回 warnings）
- [x] 6.5 编辑模式：fundCode 下拉锁定；保存前 `confirm()` 提示"开启新一轮"
- [x] 6.6 保存后关闭表单 + 调 `loadEtfGridAll()` 刷新

## 7. 前端 — 成交补录表单

- [x] 7.1 点击网格价位表某档 [补录] → 复合 prompt() 收集 价格/金额/份数
- [x] 7.2 type 自动确定：gridLevel < 0 → buy、= 0 → base、> 0 → sell
- [x] 7.3 |amount - price × shares| / (price × shares) > 1% 时 `confirm()` 软警告
- [x] 7.4 保存后调 `loadEtfGridAll()` 刷新
- [x] 7.5 成交记录列表提供 [✕] 删除按钮，`confirm()` 二次确认

## 8. 前端 — 交互细节

- [x] 8.1 卡片顶部管理按钮：[编辑]/[重置中线]/[删除策略]（仅管理员）
- [x] 8.2 [重置中线] 通过 prompt() 收集 newBasePrice（可空 = 使用当前价）
- [x] 8.3 [删除策略] `confirm()` 二次确认
- [x] 8.4 protection.paused 时卡片顶部显示 `.grid-protection-banner` 横条
- [x] 8.5 stale=true 时显示"⚠ 行情数据陈旧"标签
- [x] 8.6 非管理员完全不显示 [＋ 添加]、[编辑]、[删除]、[重置]、[补录]、[✕]

## 9. 联调与回归

- [x] 9.1 本地启动 PORT=3216，`GET /api/strategy/etf-grid-plans` 返回空数组
- [x] 9.2 未登录 POST → 401 `请先登录`
- [x] 9.3 admin 登录后添加科创50 策略（gridStep=5%, gridLevels=5, basePrice=1.0, totalBudget=100000, baseAmount=40000, amountPerGrid=5000, pauseWhenTempAbove=70）→ 成功
- [x] 9.4 补录底仓 40000 元 + -1 网买入 5000 元 → 两条记录成功入库
- [x] 9.5 推荐视图返回：当前价 2.037（腾讯真值）/ 距中线 +103.7% / 下一步 sell L5 @1.2763 / 底仓 40000 已建 / -1 已触发 / 浮动盈亏 5698.42
- [x] 9.6 网格价位表数学正确：0 → 1.0000 / +1 → 1.0500 / +5 → 1.2763 / -1 → 0.9524 / -5 → 0.7835
- [x] 9.7 单轮净利公式：δ=5% + fee=0.15% → 9.95%（`(1.05)² - 1 - 0.003`）
- [x] 9.8 FIFO 盈亏验证：模拟 -1 买 → +1 卖 → realized = (5526-5000) - 0.0015×(5000+5526) ≈ 510.51 ✓
- [x] 9.9 保护机制：策略配置 pauseWhenTempAbove=70，当前温度 52° → protection.paused=false（正常）
- [x] 9.10 清理测试数据（删除策略 + 2 条成交记录）→ 空数组
- [x] 9.11 回归验证 `/api/strategy/etf-plans` 仍返回 4 只 ETF 定投策略（既有数据未受影响）
- [x] 9.12 lint 检查：`server.js` 0 error；`public/index.html` 仅预存 1 个无关 warning（第 152 行 `background-clip`）
- [x] 9.13 数据文件初始化日志：`[ETF网格] 首次启动，已创建空策略配置文件` + `已创建空持仓记录文件`

## 10. 部署与文档

- [ ] 10.1 `npm run package:deploy` 生成发布包（用户在确认后自行触发）
- [ ] 10.2 上传服务器并 PM2 重启，观察日志无异常（用户部署后验证）
- [ ] 10.3 线上抽样 `curl /api/strategy/etf-grid-plans` 返回 `{ strategies: [] }`（用户部署后验证）
- [x] 10.4 在 `CODEBUDDY.md` "API 路由结构 → 投资策略" 表新增 6 行（`etf-grid-plans` × 3、`etf-grid-holdings` × 2、`etf-grid-recommendations` × 1）
- [x] 10.5 数据文件说明在 CODEBUDDY.md 顶部 data 目录已含（无需额外补充）
