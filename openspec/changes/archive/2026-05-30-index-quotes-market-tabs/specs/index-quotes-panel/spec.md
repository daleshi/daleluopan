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
