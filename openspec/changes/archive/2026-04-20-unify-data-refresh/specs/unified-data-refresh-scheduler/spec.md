## ADDED Requirements

### Requirement: 统一数据刷新调度器
系统 SHALL 提供唯一的 `DataRefreshScheduler` 调度器实例，替代原有的 `indexRefresher`、`indexQuotesRefresher`、`etfRefresher`、`stockRefresher` 四个独立轮询器，作为全局唯一的数据刷新入口。

#### Scenario: 交易时段内统一轮询
- **WHEN** 市场处于交易时段（`isMarketOpen()` 返回 `true`）且调度器已启动
- **THEN** 调度器 SHALL 每隔 1-3 秒随机间隔触发一次刷新，刷新当前激活 Tab 对应的数据

#### Scenario: 非交易时段停止轮询
- **WHEN** `isMarketOpen()` 返回 `false`（收盘、休市日）
- **THEN** 调度器 SHALL 停止 setTimeout 链，不发出任何数据请求，直至下次 `start()` 被调用

#### Scenario: dashboard Tab 的双源串行刷新
- **WHEN** 当前激活 Tab 为 `dashboard` 且调度器触发刷新
- **THEN** 调度器 SHALL 先 `await loadData(true)` 再 `await loadIndexQuotes(true)`，两次调用串行执行，不并发

#### Scenario: ETF/股票 Tab 的单源刷新
- **WHEN** 当前激活 Tab 为 `etf` 或 `stocks` 且调度器触发刷新
- **THEN** 调度器 SHALL 分别调用 `loadETFData(true)` 或 `loadStockData(true)`

### Requirement: Tab 切换通知调度器
系统 SHALL 在 Tab 切换时通过调用 `scheduler.setActiveTab(tabName)` 统一通知调度器，不再在切换事件处散布 `start()/stop()` 调用。

#### Scenario: 切换到实时数据 Tab
- **WHEN** 用户点击 `dashboard`、`etf` 或 `stocks` Tab
- **THEN** 系统 SHALL 调用 `scheduler.setActiveTab(tabName)`，调度器 SHALL 更新内部 `currentTab` 并在下一个周期刷新新 Tab 的数据

#### Scenario: 切换到非实时数据 Tab
- **WHEN** 用户点击 `daily-eval`、`thermometer`、`strategy`、`config` 等 Tab
- **THEN** 系统 SHALL 调用 `scheduler.setActiveTab(tabName)`，调度器 SHALL 在下一个周期跳过刷新（无实时数据需求的 Tab 不触发请求）

### Requirement: 调度器全局唯一实例
系统 SHALL 确保 `DataRefreshScheduler` 在页面生命周期内只存在一个实例，初始化时立即启动。

#### Scenario: 页面初始化
- **WHEN** 页面加载完成（`DOMContentLoaded` 或等效入口）
- **THEN** 系统 SHALL 创建唯一调度器实例，调用 `scheduler.setActiveTab('dashboard')` 并 `scheduler.start()`

## MODIFIED Requirements

### Requirement: 列表刷新时不产生视觉闪烁
指数行情、股票、ETF、基金四个列表在自动轮询刷新时，页面 SHALL 不出现整块闪烁，用户只能观察到数值的平滑更新。刷新触发来源由原多个独立定时器变更为统一调度器，渲染行为要求不变。

#### Scenario: 交易时段自动刷新
- **WHEN** 统一调度器触发数据刷新，列表容器已有子元素
- **THEN** 容器中已存在的卡片 DOM 节点不被销毁重建，只有变化的数值文本发生更新

#### Scenario: 首次加载
- **WHEN** 列表容器为空（首次加载或空列表情况）
- **THEN** 正常走全量渲染，显示 loading 状态或直接填充内容
