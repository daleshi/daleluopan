## 1. 每日估值页面优化

- [x] 1.1 在每日估值 Tab HTML 中，筛选器上方新增 `#dailyEvalSummary` 汇总卡片区（含低估/适中/高估数量、总指数数、平均 PE 百分位）
- [x] 1.2 添加 `#dailyEvalSummary` CSS 样式（横向卡片布局，与主题系统一致）
- [x] 1.3 在 `renderDailyEval()` 中同步更新 `#dailyEvalSummary` 的数字（基于全量 `dailyEvalData`）
- [x] 1.4 优化筛选器区域视觉层级（分类 Tab 和估值筛选按钮加分隔或分组样式）

## 2. PE 分析移除无百分位数据的指数

- [x] 2.1 在 `renderPercentileBars()` 中过滤掉 `d.pePercentile == null` 的指数
- [x] 2.2 在 `renderAnalysisCards()` 中同步过滤掉 `d.pePercentile == null` 的指数

## 3. 修复区间趋势图按钮 disabled 状态不更新的 bug

- [x] 3.1 提取 rangeButtons 生成逻辑为独立函数 `buildRangeButtons(d, activeRange)`，复用 `buildIndexCardHTML` 和 `renderCoreTrendView` 中的按钮生成
- [x] 3.2 在 `renderCoreTrendView()` 执行时，同步重建当前卡片的 `.featured-trend-ranges` 容器内容（调用 `buildRangeButtons`）
- [x] 3.3 验证：首次加载 historySeries 较短时按钮正确 disabled，刷新数据后按钮变为可用

## 4. 后端新增 watchlist reorder 端点

- [x] 4.1 在 `server.js` 中新增 `POST /api/indices/reorder`（requireAdmin），接收 `{ codes }` 数组，按顺序重排 index-watchlist.json
- [x] 4.2 新增 `POST /api/active-funds/reorder`（requireAdmin），重排 fund-watchlist.json
- [x] 4.3 新增 `POST /api/etfs/reorder`（requireAdmin），重排 etf-watchlist.json
- [x] 4.4 新增 `POST /api/stocks/reorder`（requireAdmin），重排 stock-watchlist.json

## 5. 前端拖拽排序 UI（基金总览）

- [x] 5.1 添加拖拽把手 CSS（`.drag-handle`，仅 `body.role-admin` 下可见）
- [x] 5.2 在 `buildFundSummaryCard()` 中为卡片添加 `draggable="true"` 属性和拖拽把手元素
- [x] 5.3 实现基金卡片的 `dragstart/dragover/drop` 事件处理，drop 后更新 DOM 顺序并调用 `/api/active-funds/reorder`
- [x] 5.4 拖拽进行中设置 `isDraggingCard = true` flag，在 `renderActiveFunds()` 增量更新时检查此 flag，拖拽中跳过 DOM 重建

## 6. 前端拖拽排序 UI（ETF 总览）

- [x] 6.1 在 `buildEtfCardHtml()` 中为卡片添加 `draggable="true"` 属性和拖拽把手元素
- [x] 6.2 实现 ETF 卡片的 `dragstart/dragover/drop` 事件处理，drop 后调用 `/api/etfs/reorder`
- [x] 6.3 拖拽中在 `renderETFs()` 增量更新时跳过 DOM 重建

## 7. 前端拖拽排序 UI（股票总览）

- [x] 7.1 在 `buildStockCardHtml()` 中为卡片添加 `draggable="true"` 属性和拖拽把手元素
- [x] 7.2 实现股票卡片的 `dragstart/dragover/drop` 事件处理，drop 后调用 `/api/stocks/reorder`
- [x] 7.3 拖拽中在 `renderStocks()` 增量更新时跳过 DOM 重建

## 8. 验证

- [x] 8.1 每日估值页：确认汇总卡片显示正确的低估/适中/高估数量
- [x] 8.2 PE 分析：确认标普500、纳斯达克100 不再出现在百分位柱条和分析卡片中
- [x] 8.3 区间趋势图：刷新数据后，原先 disabled 的近3年/近5年按钮变为可点击
- [x] 8.4 拖拽排序：管理员登录后可拖拽，刷新页面顺序保持；非管理员看不到拖拽把手
