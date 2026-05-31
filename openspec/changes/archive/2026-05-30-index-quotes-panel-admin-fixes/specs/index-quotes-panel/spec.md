## ADDED Requirements

### Requirement: 删除指数后立即从 UI 移除

系统 SHALL 在管理员通过卡片右上角 × 按钮删除指数后，立即从前端 UI 移除该卡片，无需等待后续轮询或缓存过期。

#### Scenario: 删除后 UI 立即更新

- **GIVEN** 管理员看到 8 张指数卡片，含沪深 300
- **WHEN** 管理员点击沪深 300 卡片的 × 按钮并确认
- **THEN** 在 100ms 内，沪深 300 卡片从 `#indexSummaryGrid` 中消失，剩余 7 张卡片自然重排
- **AND** 各市场分类 Tab 计数同步更新（"全部" 8→7、"A股"对应数字 -1）

#### Scenario: 后端缓存同步失效

- **GIVEN** 后端 `_smartCache['index-quotes']` 含已被删除的指数记录
- **WHEN** 管理员调用 `/api/indices/remove`
- **THEN** 后端在写入 watchlist 后立即 `delete _smartCache['index-quotes']`，下次任何 `/api/indices/quotes` 请求触发新鲜计算

#### Scenario: forceRefresh 参数正确透传

- **WHEN** 前端调用 `loadIndexQuotes(true)`
- **THEN** 实际 fetch URL 为 `/api/indices/quotes?refresh=1`，后端绕过缓存返回最新数据

#### Scenario: API 失败时 UI 自动恢复

- **GIVEN** 网络异常导致 `/api/indices/remove` 返回 500
- **WHEN** 管理员尝试删除
- **THEN** 系统弹 `alert('移除失败: ...')` 并重新调用 `loadIndexQuotes(true)`，UI 恢复到删除前状态（卡片回归）

### Requirement: 全市场交易时段感知缓存

系统 SHALL 根据 watchlist 实际包含的市场（A 股 / 港股 / 美股）动态判定 `index-quotes` 缓存 TTL，使任一关注市场处于开盘时段时使用 30 秒短 TTL。

#### Scenario: 美股开盘时段使用短 TTL

- **GIVEN** 当前北京时间为 22:30（美股夏令时开盘约 21:30）
- **GIVEN** watchlist 包含 SPX.US 与 NDX.US
- **WHEN** 调用 `/api/indices/quotes` 后 31 秒再次调用
- **THEN** 第 2 次请求触发新鲜计算（缓存 TTL = 30 秒已过期）

#### Scenario: 仅 A 股 watchlist 在美股开盘时段使用长 TTL

- **GIVEN** 当前北京时间为 22:30（美股开盘）
- **GIVEN** watchlist 仅含沪深 300 / 中证 500 等 A 股
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** TTL 使用休市态 30 分钟（A 股已收盘，无需高频刷新）

#### Scenario: 港股盘中精准判定

- **GIVEN** 当前为周二上午 10:00（港股开盘）
- **GIVEN** watchlist 含 HSTECH（恒生科技）
- **WHEN** 系统判定 TTL
- **THEN** TTL = 30 秒

#### Scenario: 全部休市

- **GIVEN** 当前为周日 14:00
- **WHEN** 系统判定 TTL
- **THEN** TTL = 30 分钟（A 股 / 港股 / 美股 周末全部休市）

#### Scenario: 向后兼容 isTradingHours 旧调用

- **WHEN** 现有代码（如股票/ETF 模块）以无参形式调用 `isTradingHours()`
- **THEN** 系统仅检查 A 股，行为与改造前完全一致，不破坏现有缓存逻辑

#### Scenario: isTradingHours 接受市场数组

- **WHEN** 调用 `isTradingHours(['CN', 'HK', 'US'])`
- **THEN** 任一市场处于开盘时段返回 true，全部休市返回 false

### Requirement: 指数卡片管理员拖拽排序

系统 SHALL 允许管理员通过拖拽指数卡片调整顺序，并将顺序持久化到 watchlist。

#### Scenario: 管理员可见拖拽手柄

- **GIVEN** 已登录管理员
- **WHEN** 渲染指数卡片
- **THEN** 每张卡片左上角显示 `⠿` 拖拽手柄（CSS 类 `.drag-handle`），鼠标悬停时变明亮

#### Scenario: 普通用户无拖拽能力

- **GIVEN** 未登录或角色为 user
- **WHEN** 查看指数面板
- **THEN** 卡片不显示拖拽手柄，`draggable` 属性不存在，拖拽事件被 `preventDefault` 拦截

#### Scenario: 拖拽落位

- **GIVEN** 当前顺序为 [沪深300, 中证500, 中证红利]
- **WHEN** 管理员将"中证红利"卡片拖到"沪深300"之前
- **THEN** DOM 立即更新为 [中证红利, 沪深300, 中证500]
- **AND** 系统调用 `POST /api/indices/reorder` body=`{codes:['000922','000300','000905']}`
- **AND** 后端写入 watchlist 文件并返回 200

#### Scenario: 顺序持久化

- **GIVEN** 管理员已拖拽完成
- **WHEN** 刷新页面
- **THEN** 指数卡片按拖拽后的新顺序渲染（从 watchlist 读取）

#### Scenario: 拖拽与 Tab 分类协同

- **GIVEN** 管理员当前在「🇺🇸 美股」Tab，可见 SPX 和 NDX
- **WHEN** 将 NDX 拖到 SPX 之前
- **THEN** 全局 watchlist 中美股指数的相对顺序变为 [NDX, SPX]，但其他市场（A 股/港股）的相对位置不变
- **AND** 切回「📊 全部」Tab 时，看到的整体顺序合理（其他市场指数位置不变，美股内部已重排）

#### Scenario: 拖拽与轮询并存不抖动

- **GIVEN** 管理员正在拖拽卡片
- **WHEN** 后台轮询返回新数据
- **THEN** 现有 `isDraggingCard` 标志生效，渲染逻辑跳过位置重排，拖拽体验不受干扰

#### Scenario: 拖拽 API 失败的兼容

- **GIVEN** 拖拽完成调用 `/api/indices/reorder` 失败
- **WHEN** 网络异常
- **THEN** 控制台 `console.error('[拖拽排序] 保存失败:', err)`，UI 暂时保持新顺序但不刷新页面（与现有 ETF/股票拖拽行为一致）

#### Scenario: 事件委托避免重复绑定

- **GIVEN** `renderIndexQuotesGrid` 被轮询多次调用
- **WHEN** 系统初始化拖拽
- **THEN** 通过 `_indexDnDInitialized` 模块状态标志位，`initCardDnD` 仅在首次渲染时绑定一次，事件委托随 children 增删自然生效
