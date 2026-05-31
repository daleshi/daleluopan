## ADDED Requirements

### Requirement: 指数行情面板按市场分类切换

系统 SHALL 在「基金总览」Tab 下的「指数实时行情」面板中提供市场分类 Tab 切换能力，允许用户在 `📊 全部 / 🇨🇳 A股 / 🇭🇰 港股 / 🇺🇸 美股` 四个分类间切换显示范围。

#### Scenario: 默认渲染显示全部分类

- **WHEN** 用户首次进入「基金总览」Tab 并加载指数行情
- **THEN** 系统在搜索栏与卡片网格之间渲染 4 个 Tab 按钮，第一个「📊 全部」处于激活态，卡片网格展示用户关注的所有指数（不区分市场，但仍排除上证指数 000001）

#### Scenario: 切换到 A 股分类

- **GIVEN** 用户的指数 watchlist 包含 SH/SZ/CSI/HI/US 各类指数
- **WHEN** 用户点击「🇨🇳 A股」Tab
- **THEN** 卡片网格仅展示 `market` 字段为 `SH`、`SZ` 或 `CSI` 的指数，其他市场指数不渲染

#### Scenario: 切换到港股分类

- **WHEN** 用户点击「🇭🇰 港股」Tab
- **THEN** 卡片网格仅展示 `market === 'HI'` 的指数

#### Scenario: 切换到美股分类

- **WHEN** 用户点击「🇺🇸 美股」Tab
- **THEN** 卡片网格仅展示 `market === 'US'` 的指数

#### Scenario: 切回全部分类

- **GIVEN** 用户当前激活的 Tab 为「🇭🇰 港股」
- **WHEN** 用户点击「📊 全部」Tab
- **THEN** 卡片网格恢复展示所有市场的指数

### Requirement: 各 Tab 实时显示关注计数

系统 SHALL 在每个市场分类 Tab 上同时显示该市场下用户已关注的指数数量。

#### Scenario: 全部 Tab 计数等于已关注总数

- **GIVEN** 用户 watchlist 关注了 9 个指数（含上证指数 000001）
- **WHEN** 系统渲染 Tab 计数
- **THEN** 「📊 全部」计数显示为 8（排除上证指数 000001，与卡片网格实际可见数一致）

#### Scenario: 单分类计数与渲染卡片数严格一致

- **GIVEN** 用户 watchlist 包含 6 个 A 股指数（SH/SZ/CSI 任意混合）、1 个港股、2 个美股
- **WHEN** 系统渲染 Tab
- **THEN** 计数为「全部 9 / A股 6 / 港股 1 / 美股 2」，且切换到对应 Tab 后实际渲染的卡片数与计数完全一致

#### Scenario: watchlist 变更后计数实时更新

- **WHEN** 用户通过搜索框添加一个新港股指数
- **THEN** 在下一次 `renderIndexQuotesGrid` 调用时，「🇭🇰 港股」Tab 计数加 1，「📊 全部」Tab 计数加 1

### Requirement: 空分类显示引导文案

系统 SHALL 在用户切换到关注数为 0 的分类 Tab 时显示引导文案，而不是空白网格。

#### Scenario: 切到无关注指数的分类

- **GIVEN** 用户 watchlist 中没有美股指数
- **WHEN** 用户点击「🇺🇸 美股」Tab
- **THEN** 卡片网格区域显示居中文案 "📊 该市场暂无关注指数，使用上方搜索框添加关注"

#### Scenario: 引导文案不阻挡 Tab 切换

- **GIVEN** 用户当前看到「该市场暂无关注指数」引导文案
- **WHEN** 用户点击其他有数据的 Tab
- **THEN** 引导文案被替换为对应市场的指数卡片，不需刷新页面

### Requirement: 切换 Tab 不破坏轮询增量更新

系统 SHALL 在用户切换 Tab 之后，继续支持交易时段内的指数行情轮询增量更新（保持丝滑无闪烁）。

#### Scenario: 切换 Tab 后下一次轮询正常更新价格

- **GIVEN** 用户当前在「🇨🇳 A股」Tab，沪深 300 卡片显示 3850.12
- **WHEN** 后台轮询返回新价格 3855.30
- **THEN** 沪深 300 卡片的价格区域增量更新为 3855.30，不重建整张卡片，无闪烁

#### Scenario: 切换 Tab 时强制清空网格

- **GIVEN** 用户当前在「📊 全部」Tab 且已渲染 8 张卡片
- **WHEN** 用户切换到「🇭🇰 港股」Tab
- **THEN** 系统先清空 `#indexSummaryGrid` DOM，然后按新 filter 走"首次渲染"分支（全量 innerHTML），避免增量 diff 路径在大批量移除时误判

### Requirement: 市场归类前端规则

系统 SHALL 使用一份前端常量 `MARKET_GROUPS` 将后端返回的 `market` 字段归类到 4 个 UI 分类。

#### Scenario: 标准市场代码映射

- **WHEN** 系统对一条 `market === 'SH'` / `'SZ'` / `'CSI'` 的指数进行分类
- **THEN** 该指数归入「🇨🇳 A股」分类

#### Scenario: 港股市场代码映射

- **WHEN** 系统对一条 `market === 'HI'` 的指数进行分类
- **THEN** 该指数归入「🇭🇰 港股」分类

#### Scenario: 美股市场代码映射

- **WHEN** 系统对一条 `market === 'US'` 的指数进行分类
- **THEN** 该指数归入「🇺🇸 美股」分类

#### Scenario: 未知 market 值兜底

- **GIVEN** 后端某天返回了一条 `market === 'LSE'` 的指数（当前未支持的市场代码）
- **WHEN** 系统应用分类
- **THEN** 该指数仅在「📊 全部」Tab 可见，不出现在 cn/hk/us 任何 Tab；同时控制台输出 `console.warn` 标识未识别市场

### Requirement: 不影响市场风向标与搜索框

系统 SHALL 仅作用于「指数实时行情」面板（`#indexSummaryGrid`），不修改「市场风向标」（上证指数大卡片）的渲染逻辑，不限制搜索框的搜索范围。

#### Scenario: 市场风向标始终独立展示

- **WHEN** 用户在任意分类 Tab 之间切换
- **THEN** 顶部 `#featuredIndexRow` 中的上证指数大卡片始终展示，不参与任何分类过滤

#### Scenario: 搜索框始终全市场搜索

- **GIVEN** 用户当前激活的 Tab 为「🇨🇳 A股」
- **WHEN** 用户在搜索框输入"标普"
- **THEN** 搜索结果包含标普 500（美股），用户可点击添加；添加成功后该指数自动出现在「🇺🇸 美股」与「📊 全部」Tab，但当前 Tab（A 股）不会立即跳转

### Requirement: 视觉与交互一致性

系统 SHALL 复用同页面「严选基金」的 `.af-cat-tabs` 视觉语言（圆角胶囊 Tab、激活态高亮、计数徽章），通过独立类名 `.idx-cat-tabs` 实现样式隔离。

#### Scenario: 视觉风格与严选基金 Tab 对齐

- **WHEN** 用户对比同页面的「📈 指数基金 / 🎯 主动基金」Tab 与新增的市场分类 Tab
- **THEN** 两套 Tab 在圆角、内边距、激活色、字号、计数徽章样式上保持一致

#### Scenario: 移动端响应式

- **WHEN** 视口宽度 < 480px
- **THEN** 4 个 Tab 仍可完整显示在一行内（必要时使用 `flex-wrap` 或紧凑 padding），不出现横向滚动条


### Requirement: 美股指数卡片字段后端透出

系统 SHALL 在 `/api/indices/quotes` 响应中为美股（`market === 'US'`）指数记录额外透出 K 线衍生统计字段，复用已存在的 `data/cache/indices.json` 数据，不发起新外部请求。

#### Scenario: 美股记录字段齐全

- **GIVEN** `data/cache/indices.json` 中 SPX.US 含 `high52w / low52w / sparkData / historySeries`
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** 响应中 SPX 记录包含：
  - `high52w` / `low52w`（来自 indices.json 原值）
  - `changeMonth` / `change3Month` / `change6Month` / `changeYear`（基于 historySeries 末尾相对位置计算，单位 %，保留 2 位小数）
  - `drawdownFromHigh52w`（距 52 周收盘高点回撤，正数 %，保留 2 位小数）
  - `sparkData`（最近 30 个交易日 close 数组，直接复用）

#### Scenario: A 股 / 港股不受影响

- **GIVEN** A 股或港股指数 watchlist
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** 这些非美股记录的 `change6Month / changeYear / drawdownFromHigh52w / sparkData` 字段保持为 `null`（向后兼容，不增加 payload）

#### Scenario: indices.json 不可读时优雅降级

- **GIVEN** `data/cache/indices.json` 不存在或解析失败
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** 系统输出 `console.warn` 提示，美股记录的 `high52w / low52w / change6Month / changeYear / drawdownFromHigh52w / sparkData` 全部为 null；其他基础字段（price / changePercent / open / prevClose）正常返回

#### Scenario: historySeries 长度不足

- **GIVEN** indices.json 中某美股记录 `historySeries.length < 252`（数据不足 1 年）
- **WHEN** 计算动量字段
- **THEN** `changeYear` 返回 null，但 `changeMonth / change3Month / change6Month` 在数据足够时仍正常返回

#### Scenario: 触发 evaType 自动推导

- **GIVEN** 美股记录补齐 `high52w / low52w / price` 后
- **WHEN** 进入 `usValuationInfo` 处理分支
- **THEN** 系统自动计算 `pePercentile`（即 52 周价格水位），并按区间映射 `evaType`（< 30 → low、30~70 → mid、≥ 70 → high）

### Requirement: 美股指数卡片 52 周区间条

系统 SHALL 在美股指数卡片中以单行视觉化方式展示 52 周价格区间，含低点、高点、当前价位置标记、距高回撤百分比。

#### Scenario: 区间条基础渲染

- **GIVEN** 美股记录含 `high52w = 7599.38, low52w = 5861.43, price = 7580.06`
- **WHEN** 渲染卡片
- **THEN** 卡片中包含一个 `.idx-range-bar` 元素：
  - 左侧文字 `低 5861.43`，右侧文字 `高 7599.38`
  - 横向背景条 + 圆点标记，圆点 left 位置 = `(price - low52w) / (high52w - low52w) * 100%`
  - 副标签 `距高 -0.25%`（即 `drawdownFromHigh52w` 的负数表达，方便阅读）

#### Scenario: 当前价超出 52 周区间（极端场景）

- **WHEN** 因 quote 与 indices.json 时间差导致 `price > high52w`
- **THEN** 圆点位置被钳制在 0~100%（超出时 = 100%），不破坏布局

#### Scenario: 字段缺失降级

- **WHEN** 美股记录的 `high52w` 或 `low52w` 为 null
- **THEN** 整个区间条不渲染（不显示占位符）

### Requirement: 美股指数卡片 3 列动量徽章

系统 SHALL 在美股指数卡片中以等宽 3 列布局展示`近 1 月 / 近 3 月 / 近 1 年`涨跌幅。

#### Scenario: 三列动量正常渲染

- **GIVEN** 美股记录含 `changeMonth = 2.1, change3Month = 6.4, changeYear = 21.3`
- **WHEN** 渲染卡片
- **THEN** 卡片中包含一个 `.idx-momentum-row` 元素，3 列均分宽度：
  - 第 1 列：`近1月 +2.10%`，正数应用 `up` 类（绿色）
  - 第 2 列：`近3月 +6.40%`
  - 第 3 列：`近1年 +21.30%`
  - 涨跌符号正确：负数显示 `-` 不显示 `+`，应用 `down` 类（红色）

#### Scenario: 部分字段缺失

- **GIVEN** `changeYear = null`（数据不足 1 年）
- **WHEN** 渲染
- **THEN** 第 3 列显示 `近1年 --`，灰色样式，不破坏 3 列布局

#### Scenario: 整行降级

- **WHEN** 三个动量字段全为 null
- **THEN** `.idx-momentum-row` 整行不渲染

### Requirement: 美股指数卡片 30 天 Sparkline

系统 SHALL 在美股指数卡片底部展示 30 天收盘价微缩走势图（Sparkline），无外部库依赖。

#### Scenario: Sparkline 正常渲染

- **GIVEN** 美股记录含 `sparkData` 数组，长度 ≥ 2
- **WHEN** 渲染卡片
- **THEN** 卡片底部包含一个 `<svg class="idx-sparkline" viewBox="0 0 100 28">` 元素：
  - 含一个 `<polyline>` 折线，points 等距按 sparkData 自适应缩放（min/max 自动）
  - 主色按 `changeMonth >= 0` 决定：涨用 `var(--accent-green)`、跌用 `var(--accent-red)`
  - `stroke-width = 1.5`，无填充
  - SVG 高度 28px（移动端 < 480px 时 22px）

#### Scenario: 数据点过少时不渲染

- **GIVEN** `sparkData.length < 2` 或 `sparkData == null`
- **WHEN** 渲染
- **THEN** Sparkline 元素整体不渲染

#### Scenario: 数据全部相同（极端值）

- **GIVEN** `sparkData = [100, 100, 100, ...]`（30 天无波动）
- **WHEN** 渲染
- **THEN** 折线水平居中显示，不抛出除零错误（min/max 相等时手动设 range = 1）

### Requirement: A 股 / 港股卡片视觉零变更

系统 MUST 保持 A 股 / 港股 / 主动基金 / ETF / 各类策略卡片**完全不受本次改动影响**，仅作用于 `idx.market === 'US'` 分支。

#### Scenario: A 股卡片不变

- **WHEN** 渲染沪深 300 卡片
- **THEN** 卡片视觉、布局、字段与本 change 实施前完全一致（PE / PB / 百分位 / ROE / 股息 / 温度 全保留）

#### Scenario: 港股卡片不变

- **WHEN** 渲染恒生科技卡片
- **THEN** 卡片视觉、布局、字段与本 change 实施前完全一致

#### Scenario: 严选基金 / ETF / 其他 Tab 不变

- **WHEN** 用户切换到「严选基金」「投资策略」等 Tab
- **THEN** 对应卡片视觉零变化

### Requirement: 移动端响应式

系统 SHALL 在视窗宽度 < 480px 时保证美股新增卡片元素布局不破版。

#### Scenario: Sparkline 移动端高度调整

- **WHEN** 视窗宽度 < 480px
- **THEN** `.idx-sparkline` 高度从 28px 缩减至 22px，宽度自适应卡片

#### Scenario: 3 列动量保持单行

- **WHEN** 视窗宽度 = 360px（极小屏）
- **THEN** `.idx-momentum-row` 三列仍单行展示，不换行（必要时缩减字号）

#### Scenario: 52 周区间条保持单行

- **WHEN** 视窗宽度 < 480px
- **THEN** 区间条左右文字与圆点保持同一行，必要时数字简化（如 `5861` 不 `5861.43`）


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
