## MODIFIED Requirements

### Requirement: 列表刷新时不产生视觉闪烁
指数行情、股票、ETF、基金四个列表在自动轮询刷新时，页面 SHALL 不出现整块闪烁，用户只能观察到数值的平滑更新。刷新触发来源由统一调度器触发，渲染行为要求不变。

#### Scenario: 交易时段自动刷新
- **WHEN** 自动轮询触发数据刷新，列表容器已有子元素
- **THEN** 容器中已存在的卡片 DOM 节点不被销毁重建，只有变化的数值文本发生更新

#### Scenario: 首次加载
- **WHEN** 列表容器为空（首次加载或空列表情况）
- **THEN** 正常走全量渲染，显示 loading 状态或直接填充内容

## ADDED Requirements

### Requirement: 区间趋势图按钮可用性与数据同步
指数卡片中的区间切换按钮（近1年/近3年/近5年/近10年）的 disabled 状态 SHALL 在每次数据刷新后与当前 `historySeries` 长度保持一致，不得停留在首次渲染时的状态。

#### Scenario: 数据刷新后按钮可用性更新
- **WHEN** 指数数据刷新完成，`historySeries` 长度增加（如从缓存的短数组变为完整数组）
- **THEN** 区间切换按钮 SHALL 重新计算 `rangeAvailability`，原本 disabled 的按钮 SHALL 变为可点击

#### Scenario: 用户已选中范围不被重置
- **WHEN** 数据刷新触发按钮重建
- **THEN** 当前选中的时间范围（active 按钮）SHALL 保持不变，不跳回默认值
