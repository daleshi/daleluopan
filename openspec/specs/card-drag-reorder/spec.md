# card-drag-reorder Specification

## Purpose

让管理员能拖拽调整看板卡片顺序：严选ETF / 严选股票 / 严选基金 / 指数行情四个网格都能绑定 HTML5 拖拽监听（不依赖网格是否为空、不依赖是否首次渲染），事件委托用与卡片 HTML 属性一致的 kebab-case 选择器定位卡片，释放后把新顺序持久化到对应 reorder 接口；非管理员与未登录用户不能拖拽。

## Requirements

### Requirement: 卡片网格绑定拖拽排序监听

系统 SHALL 在严选ETF（`#etfGrid`）、严选股票（`#stockGrid`）、严选基金（`#activeFundGrid`）、指数行情（`#indexSummaryGrid`）四个卡片网格上绑定 HTML5 拖拽排序事件监听（事件委托到网格容器），且绑定**不依赖网格当前是否为空**、不依赖是否处于"首次渲染"分支。

#### Scenario: 网格存在 loading 占位子元素时仍完成绑定

- **WHEN** 网格在首次渲染前已包含 `loading-wrap` 占位子元素
- **THEN** 渲染完成后系统 SHALL 仍然完成拖拽监听绑定，派发 `dragover` 事件时 SHALL 被 `preventDefault`

#### Scenario: 增量 diff 渲染后监听仍然有效

- **WHEN** 网格已渲染过卡片，后续通过增量 diff 更新（非全量 `innerHTML` 重建）
- **THEN** 已绑定的拖拽监听 SHALL 保持有效，不需要重新渲染才生效

#### Scenario: 同一网格不重复绑定

- **WHEN** 渲染函数被多次调用（轮询刷新 3-5 秒一次）
- **THEN** 系统 SHALL 保证同一网格容器只绑定一次监听，一次拖拽只发起一个 reorder 请求

### Requirement: 事件委托选择器匹配卡片 HTML 属性

系统 SHALL 使用与卡片实际 HTML 属性名一致的 kebab-case 选择器（`[data-etf-code]` / `[data-stock-code]` / `[data-fund-code]` / `[data-code]`）在 `dragstart` / `dragover` / `dragleave` / `drop` 中定位卡片，`dataset` 读取时才使用 camelCase 键（`etfCode` / `stockCode` / `fundCode` / `code`）。

#### Scenario: 拖拽起点落在卡片上

- **WHEN** 管理员从某张 ETF 卡片（`data-etf-code="159915.SZ"`）发起 `dragstart`
- **THEN** 系统 SHALL 成功定位到该卡片，不调用 `preventDefault`，并标记卡片为拖拽中

#### Scenario: 拖拽起点落在卡片内部子元素上

- **WHEN** `dragstart` 的 `event.target` 是卡片内的子元素（如价格、迷你走势图）
- **THEN** 系统 SHALL 通过 `closest()` 向上找到所属卡片并正常开始拖拽

#### Scenario: 落点定位与插入位置

- **WHEN** 管理员把卡片拖到另一张卡片上并释放
- **THEN** 系统 SHALL 把源卡片插入到目标卡片之后（向下拖）或之前（向上拖），并高亮显示插入位置

### Requirement: 管理员完成拖拽并持久化顺序

系统 SHALL 允许管理员拖拽调整卡片顺序，并在释放后把新顺序 POST 到对应 reorder 接口持久化；拖拽期间 SHALL 跳过网格 DOM 重建以免打断操作。

#### Scenario: 拖拽 ETF 卡片并重排

- **WHEN** 管理员在严选ETF 页把第 1 张卡片拖到第 3 张位置
- **THEN** 系统 SHALL 立即调整 DOM 顺序，并向 `/api/etfs/reorder` 提交新顺序的裸 code 数组（如 `["159915","588000",...]`）

#### Scenario: 拖拽股票卡片并重排

- **WHEN** 管理员在严选股票页拖拽卡片
- **THEN** 系统 SHALL 向 `/api/stocks/reorder` 提交带市场后缀的 `fullCode`（如 `600519.SH` / `00700.HK`），以便区分 A 股与港股同码标的

#### Scenario: 拖拽基金卡片并重排

- **WHEN** 管理员在严选基金页拖拽卡片
- **THEN** 系统 SHALL 向 `/api/active-funds/reorder` 提交新顺序的 code 数组

#### Scenario: 顺序刷新后保持

- **WHEN** 拖拽完成后页面刷新或下一次轮询刷新
- **THEN** 卡片顺序 SHALL 与持久化后的关注列表顺序一致，不被还原

#### Scenario: 拖拽期间不被轮询重建打断

- **WHEN** 拖拽进行中恰好触发数据轮询刷新
- **THEN** 系统 SHALL 跳过网格 DOM 重建，正在拖拽的卡片不被替换

### Requirement: 非管理员不可拖拽

系统 SHALL 阻止未登录用户与非管理员用户发起卡片拖拽，`.pro-drag-handle` 拖拽手柄对非管理员不可见。

#### Scenario: 游客发起拖拽被取消

- **WHEN** 未登录用户在卡片上发起 `dragstart`
- **THEN** 系统 SHALL 调用 `preventDefault` 取消拖拽，卡片不进入拖拽态

#### Scenario: 登录非管理员发起拖拽被取消

- **WHEN** 已登录但 `role !== 'admin'` 的用户发起 `dragstart`
- **THEN** 系统 SHALL 取消拖拽，且不发起任何 reorder 请求

#### Scenario: 拖拽手柄仅管理员可见

- **WHEN** 页面以游客或非管理员身份渲染
- **THEN** 卡片上的 `.pro-drag-handle`（⠿）SHALL 不显示，管理员提示文案 SHALL 不显示

