## MODIFIED Requirements

### Requirement: 列表刷新时不产生视觉闪烁
指数行情、股票、ETF、基金四个列表在自动轮询刷新时，页面 SHALL 不出现整块闪烁，用户只能观察到数值的平滑更新。刷新触发来源由统一调度器触发，渲染行为要求不变。

#### Scenario: 交易时段自动刷新
- **WHEN** 统一调度器触发数据刷新，列表容器已有子元素
- **THEN** 容器中已存在的卡片 DOM 节点不被销毁重建，只有变化的数值文本发生更新

#### Scenario: 首次加载
- **WHEN** 列表容器为空（首次加载或空列表情况）
- **THEN** 正常走全量渲染，显示 loading 状态或直接填充内容

### Requirement: 统一数据刷新调度器
系统 SHALL 提供唯一的 `DataRefreshScheduler` 调度器实例，替代原有的分散式轮询器，作为全局唯一的数据刷新入口。

#### Scenario: ETF Tab 交易状态反映到顶部
- **WHEN** 用户切换到 ETF Tab，`renderETFs()` 完成渲染
- **THEN** 顶部 `#statusDot` SHALL 更新为对应 `isTrading` 的样式（`meta-dot live` 或 `meta-dot`），顶部 `#updateTime` SHALL 显示最新数据更新时间

#### Scenario: 股票 Tab 交易状态反映到顶部
- **WHEN** 用户切换到股票 Tab，`renderStocks()` 完成渲染
- **THEN** 顶部 `#statusDot` SHALL 更新为对应状态样式（包含 `warn` 降级状态），顶部 `#updateTime` SHALL 显示最新数据更新时间

#### Scenario: ETF/股票 Tab 内无独立状态元素
- **WHEN** ETF 或股票 Tab 处于激活状态
- **THEN** Tab 内部 SHALL 不存在独立的交易状态点、状态文字、更新时间元素；所有状态信息 SHALL 仅在顶部 header 中显示
