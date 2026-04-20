## 1. 新增 DataRefreshScheduler 调度器

- [x] 1.1 在 `public/index.html` 中，`createTradingRefresher` 函数定义之后，新增 `DataRefreshScheduler` 工厂函数（闭包），实现 `setActiveTab(tabName)`、`start()`、`stop()` 方法，内含单条 setTimeout 链和 1-3 秒随机间隔逻辑
- [x] 1.2 在 `DataRefreshScheduler` 内部，根据 `currentTab` 分支执行对应刷新逻辑：`dashboard` 串行调用 `loadData(true)` + `loadIndexQuotes(true)`；`etf` 调用 `loadETFData(true)`；`stocks` 调用 `loadStockData(true)`；其他 Tab 跳过刷新
- [x] 1.3 在全局初始化处（页面加载完成时）创建调度器实例，调用 `scheduler.setActiveTab('dashboard')` 和 `scheduler.start()`

## 2. 移除旧轮询器定义

- [x] 2.1 删除 `indexRefresher` 常量定义（约行 4401-4407）
- [x] 2.2 删除 `indexQuotesRefresher` 常量定义（约行 6504-6510）
- [x] 2.3 删除 `etfRefresher` 常量定义（约行 7443-7449）
- [x] 2.4 删除 `stockRefresher` 常量定义（约行 8243-8249）

## 3. 清理各 load* 函数内的自动刷新调用

- [x] 3.1 在 `loadData()` 函数内，移除调用 `handleIndexAutoRefresh()` 或 `indexRefresher.start()/stop()` 的逻辑
- [x] 3.2 在 `loadIndexQuotes()` 函数内，移除调用 `startIndexQuotesAutoRefresh()` / `stopIndexQuotesAutoRefresh()` 的逻辑
- [x] 3.3 在 `loadETFData()` 函数内，移除 `etfRefresher.start()/stop()` 调用
- [x] 3.4 在 `loadStockData()` 函数内，移除 `stockRefresher.start()/stop()` 调用

## 4. 统一 Tab 切换事件中的刷新控制

- [x] 4.1 找到主 Tab 切换事件监听器（约行 6394-6443），移除所有 `start*/stop*AutoRefresh()` 和 `*Refresher.start()/stop()` 调用
- [x] 4.2 在每个 Tab 点击分支结束处统一插入 `scheduler.setActiveTab(tab.dataset.tab)` 调用（或在切换逻辑最后统一调用一次）
- [x] 4.3 确认 `handleIndexAutoRefresh()` 等辅助函数不再被调用后，删除其定义（如存在）

## 5. 验证与回归测试

- [ ] 5.1 启动本地开发服务（`npm start`），在交易时段或模拟交易时段验证 `dashboard` Tab 下指数 PE/PB 与实时价格同步更新，无数据快照不一致现象
- [ ] 5.2 在浏览器开发者工具 Network 面板，确认 1-3 秒内有稳定的 API 请求（`/api/indices`、`/api/indices/quotes` 串行出现）
- [ ] 5.3 切换至 `etf` Tab，确认 `/api/etfs` 每 1-3 秒有请求；切换至 `stocks` Tab，确认 `/api/stocks` 每 1-3 秒有请求
- [ ] 5.4 切换至非实时 Tab（如 `daily-eval`、`strategy`），确认无多余 API 请求发出
- [ ] 5.5 在非交易时段（收盘后），确认所有实时轮询请求停止
- [ ] 5.6 验证列表刷新时无整块闪烁，仅数值平滑更新（smooth-refresh 回归）
