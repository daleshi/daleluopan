## Requirements

### Requirement: 指数行情面板按市场分类切换

系统 SHALL 在「基金总览」页面的指数实时行情区域提供「全部 / A股 / 港股 / 美股」四个 Tab 按钮，点击后仅显示对应市场的指数卡片。

#### Scenario: 默认加载全部

- **GIVEN** 用户进入基金总览页
- **WHEN** 页面首次渲染
- **THEN** 「全部」Tab 高亮，所有指数卡片可见

#### Scenario: 切换至 A 股 Tab

- **GIVEN** watchlist 包含沪深 300（SH）、中证 500（SH）、恒生指数（HK）、标普 500（US）
- **WHEN** 用户点击「🇨🇳 A股」Tab
- **THEN** 仅显示沪深 300、中证 500 卡片，恒生与标普不可见

#### Scenario: 切换 Tab 后 URL 不刷

- **WHEN** 用户点击任意市场 Tab
- **THEN** 页面不重新加载，仅 `display` 属性变化

#### Scenario: 市场归类规则

- **GIVEN** 指数 code 后缀为 `.SH`、`.SZ`、`.BJ` → 归入 A 股
- **GIVEN** 指数 code 后缀为 `.HK` → 归入港股
- **GIVEN** 指数 code 后缀为 `.US` → 归入美股
- **GIVEN** 无后缀或未知后缀 → 归入 A 股（兜底）

---

### Requirement: 各 Tab 实时显示关注计数

系统 SHALL 在每个 Tab 右侧实时显示该分类下的指数数量（格式：`全部 (N)`），并在增删指数后自动更新。

#### Scenario: 初始计数正确

- **GIVEN** watchlist 共 10 个指数（A股 6、港股 2、美股 2）
- **THEN** Tab 显示：`全部 (10)` / `🇨🇳 A股 (6)` / `🇭🇰 港股 (2)` / `🇺🇸 美股 (2)`

#### Scenario: 删除指数后计数更新

- **WHEN** 管理员删除 1 个 A 股指数
- **THEN** `全部` 和 `🇨🇳 A股` 计数同步 -1，其余 Tab 不变

---

### Requirement: 空分类显示引导文案

系统 SHALL 当用户切换到无任何指数的市场 Tab 时，显示友好引导文案（而非空白）。

#### Scenario: 港股 Tab 为空

- **GIVEN** watchlist 中无港股指数
- **WHEN** 用户点击「🇭🇰 港股」Tab
- **THEN** 显示：「暂无关注的港股指数，点击 + 添加」

---

### Requirement: 切换 Tab 不破坏轮询增量更新

系统 SHALL 在用户切换市场 Tab 时，后台轮询（`refreshInterval`）继续正常运行，且回到「全部」Tab 时卡片增量更新逻辑不受影响。

#### Scenario: 轮询在后台持续

- **GIVEN** 用户停留在「🇺🇸 美股」Tab
- **WHEN** 每 30 秒轮询触发
- **THEN** 所有指数数据（含 A 股/港股）仍被获取并更新内存，`lastUpdateTime` 正确刷新

#### Scenario: 切回全部 Tab 卡片顺序不变

- **GIVEN** 用户拖拽调整过指数顺序
- **WHEN** 切换到港股 Tab 再切回全部
- **THEN** 卡片顺序与拖拽后一致，未重置

---

### Requirement: 市场归类前端规则

前端 SHALL 根据指数 `market` 字段（或 code 后缀）判断所属市场，规则与后端 `dataFetcher.js` 的 `POOL_MAP` 保持一致。

#### Scenario: 根据 market 字段归类

- **GIVEN** 指数对象含 `market: 'HK'`
- **THEN** 该指数在「🇭🇰 港股」Tab 下可见

#### Scenario: 根据 code 后缀兜底归类

- **GIVEN** 指数对象无 `market` 字段，但 `code: '000300.SH'`
- **THEN** 根据 `.SH` 后缀归入 A 股

---

### Requirement: 不影响市场风向标与搜索框

修改 SHALL NOT 影响页面其他元素：市场风向标（`#marketAngleBadge`）、搜索框（`#indexSearchInput`）、添加指数按钮。

#### Scenario: 风向标在所有 Tab 下均显示

- **WHEN** 用户切换 Tab
- **THEN** `#marketAngleBadge` 内容不变（仍显示「偏向 🇨🇳 A股」等）

#### Scenario: 搜索框在所有 Tab 下均可使用

- **WHEN** 用户在任意 Tab 下输入搜索词
- **THEN** 搜索下拉正常弹出，点击结果调用 `addIndex(code)`

---

### Requirement: 视觉与交互一致性

新增的 Tab 按钮 SHALL 复用现有 `.featured-card-tab` 样式（或等效果），保持与「投资策略」页 Tab 一致的视觉风格。

#### Scenario: Tab 选中态高亮

- **WHEN** 用户点击「🇺🇸 美股」Tab
- **THEN** 该 Tab 背景变为 accent 色，字体加粗，与现有 tab 选中态一致

#### Scenario: Tab 切换过渡平滑

- **WHEN** 点击 Tab
- **THEN** 卡片区域淡入淡出（opacity 0→1，200ms），无生硬闪烁

---

### Requirement: 美股指数卡片字段后端透出

后端 SHALL 在 `/api/indices/quotes` 和 `/api/indices` 的响应中，为美股指数（market=`US`）额外透出以下字段，供前端渲染使用：

| 字段 | 类型 | 说明 |
|---|---|---|
| `high52w` | number | 52 周最高价 |
| `low52w` | number | 52 周最低价 |
| `momentum1m` | number | 近 1 月涨幅 % |
| `momentum3m` | number | 近 3 月涨幅 % |
| `sparkData` | number[] | 近 30 日收盘价序列（用于 mini 走势图） |

#### Scenario: 标准响应包含新字段

- **GIVEN** watchlist 中含 SPX.US
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** SPX 对象含 `high52w`、`low52w`、`momentum1m`、`momentum3m`、`sparkData` 字段

#### Scenario: A 股指数不含美股专属字段

- **WHEN** 响应中含沪深 300（.SH）
- **THEN** 该对象不含 `high52w` / `low52w` / `momentum1m` 等字段（保持向后兼容）

---

### Requirement: 美股指数卡片 52 周区间条

前端 SHALL 在美股指数卡片上渲染「52 周区间水位条」：一个横向进度条，表示当前价在 52 周最低价与最高价之间的位置。

#### Scenario: 水位条位置正确

- **GIVEN** SPX 当前价 5500，52w 最低 4000、最高 6000
- **WHEN** 渲染卡片
- **THEN** 水位条填充比例为 `(5500-4000)/(6000-4000) = 75%`，左侧标注 `4000`，右侧标注 `6000`

#### Scenario: 价格突破 52w 最高/最低时取边界

- **GIVEN** 当前价 > high52w（盘中创新高）
- **WHEN** 渲染
- **THEN** 水位条 100% 填充，数字仍为历史 high52w/low52w

---

### Requirement: 美股指数卡片 3 列动量徽章

前端 SHALL 在美股指数卡片上以 3 列徽章形式展示动量：

| 列 | 内容 |
|---|---|
| 近 1 月 | `momentum1m`（红涨绿跌） |
| 近 3 月 | `momentum3m` |
| 今年以来 | `ytdChange`（如可计算） |

#### Scenario: 动量徽章颜色正确

- **GIVEN** `momentum1m = 5.2%`
- **WHEN** 渲染
- **THEN** 显示「近1月 +5.20%」，文字颜色为红色（上涨）

#### Scenario: 数据为 null 时显示 --

- **GIVEN** `momentum3m` 为 null（历史数据不足）
- **WHEN** 渲染
- **THEN** 显示「近3月 --」

---

### Requirement: 美股指数卡片 30 天 Sparkline

前端 SHALL 在美股指数卡片的某固定区域（如卡片底部或价格旁）渲染一个 30 天迷你走势图（Sparkline），使用 `sparkData` 数组。

#### Scenario: Sparkline 渲染成功

- **GIVEN** `sparkData.length >= 2`
- **WHEN** 渲染卡片
- **THEN** 显示一个宽度 ~100px、高度 ~30px 的 SVG 折线图，折线颜色根据首尾涨跌决定（红/绿）

#### Scenario: sparkData 不足时隐藏

- **GIVEN** `sparkData.length < 2`
- **WHEN** 渲染
- **THEN** Sparkline 区域不显示或显示「--」

---

### Requirement: A 股 / 港股卡片视觉零变更

修改 SHALL NOT 改变 A 股和港股指数卡片的现有布局、字段和样式。美股专属元素（52w 条、动量徽章、Sparkline）仅在 `market === 'US'` 时渲染。

#### Scenario: A 股卡片无 52w 条

- **WHEN** 渲染沪深 300 卡片
- **THEN** HTML 中不含 `.idx-card-52w-bar` 元素

#### Scenario: 港股卡片无动量徽章

- **WHEN** 渲染恒生科技卡片
- **THEN** 不含 `.idx-card-momentum` 区块

---

### Requirement: 移动端响应式

新增的 52w 条、动量徽章、Sparkline 在移动端（≤480px）自动调整为纵向堆叠或省略，保持卡片宽度不溢出。

#### Scenario: 480px 下动量徽章纵向排列

- **WHEN** 屏幕宽度 480px
- **THEN** 3 列动量徽章变为单列，高度自适应

---

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

---

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

---

### Requirement: 指数卡片管理员拖拽排序

系统 SHALL 允许管理员通过拖拽指数卡片调整顺序，并将顺序持久化到 watchlist。

#### Scenario: 管理员可见拖拽手柄

- **GIVEN** 已登录管理员
- **WHEN** 渲染指数卡片
- **THEN** 每张卡片左上角显示 `⠿` 拖拽手柄（CSS 类 `.idx-drag-handle`），鼠标悬停时变明亮

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

---

### Requirement: 按指数 code 单独查询 K 线接口

系统 SHALL 提供 `GET /api/indices/:code/klines` 公开 API，按完整 code（含市场后缀，如 `SPX.US`）返回单个指数的历史 K 线，复用现有 failover 链。

#### Scenario: 标准请求成功

- **GIVEN** watchlist 含 SPX.US 指数
- **WHEN** 调用 `GET /api/indices/SPX.US/klines`
- **THEN** 系统返回 200 + `{ success: true, data: { code: 'SPX.US', historySeries: [...], source: 'eastmoney'|'tencent'|'yahoo'|'stale-cache', sourceLabel: '主源直连'|'备用源生效中'|..., stale: false|true, fetchedAt: ISOString } }`
- **AND** historySeries 数组每项含 `{ date, open, close, high, low, ... }` 字段

#### Scenario: 候选池外指数动态查找

- **GIVEN** 用户搜索添加了某不在 DEFAULT_SELECTED_CODES 候选池但已在 watchlist 的指数
- **WHEN** 调用对应 code 的 klines 接口
- **THEN** 系统从 `readIndexWatchlist()` 动态构造 cfg，调用 `fetchIndexHistory(cfg)` 返回 K 线

#### Scenario: 未知 code 返回 404

- **WHEN** 调用 `GET /api/indices/UNKNOWN.XX/klines`
- **AND** 该 code 既不在候选池也不在 watchlist
- **THEN** 系统返回 404 + `{ success: false, error: '指数不存在或不在关注列表' }`

#### Scenario: 数据源全部失败返回错误但 HTTP 200

- **GIVEN** 东方财富 / 腾讯 / Yahoo 三方均超时或失败
- **WHEN** 调用接口
- **THEN** 系统返回 HTTP 200 + `{ success: false, error: 'K线数据暂时无法获取，请稍后重试', data: { code, source: 'none' } }`
- **AND** 前端可通过 success=false 分支显示 error UI

#### Scenario: 缓存命中快速返回

- **GIVEN** 同一 code 30 秒内被请求过
- **WHEN** 再次调用
- **THEN** 系统从 `_klineCache` 内存缓存返回，响应时间 < 50ms

#### Scenario: stale 缓存兜底

- **GIVEN** 主源失败但 stale 缓存内有同 code 的旧数据
- **WHEN** 调用接口
- **THEN** 系统返回 `{ success: true, data: { ..., source: 'stale-cache', stale: true } }`，前端正常渲染图并在数据源行标注"已回退缓存"

---

### Requirement: 模态框打开时按需异步加载 K 线

系统 SHALL 在用户点击指数卡片打开详情模态框时，**立即**显示已有元信息（价格、PE、52周高低、估值徽章），**独立异步**拉取 K 线数据并填充「区间走势分析」区。

#### Scenario: 首次打开有 K 线缓存

- **GIVEN** 用户首次点击沪深 300 卡片
- **WHEN** 模态框打开
- **THEN** Header / 行情 / 关键指标 / PE 百分位条立即可见
- **AND** 趋势区显示骨架屏 + 「📈 正在加载历史趋势数据…」
- **AND** 异步 fetch 完成后趋势区平滑替换为 SVG 折线图

#### Scenario: 用户点击未在 dashboard 候选池的指数

- **GIVEN** 用户搜索添加了某非主流指数到 watchlist
- **WHEN** 点击该指数的实时行情卡片
- **THEN** 模态框正常打开（不再 silently return），从 `indexQuotesData` 兜底构造元信息
- **AND** 异步触发 `GET /api/indices/:code/klines` 拉趋势

#### Scenario: 模态框关闭后 K 线缓存保留

- **GIVEN** 用户成功打开并查看了 NDX 模态框
- **WHEN** 关闭后再次打开 NDX 模态框
- **THEN** historySeries 已写回内存数据池（indexQuotesData / dashboardData），趋势图**立即可见**无 loading 闪烁

---

### Requirement: 区间走势三态可见反馈（loading / success / error）

系统 SHALL 在「区间走势分析」区根据数据状态显示明确反馈：loading（骨架屏 + 文案）、success（SVG 折线 + 范围按钮）、error（提示 + 重试按钮）。

#### Scenario: loading 态视觉

- **GIVEN** 模态框打开但 K 线尚未拉到
- **WHEN** 渲染趋势区
- **THEN** 区域显示一个高度等于趋势图（220px）的骨架屏（含 `@keyframes shimmer` 扫光动画）
- **AND** 文案为 「📈 正在加载历史趋势数据…」

#### Scenario: success 态正常渲染

- **WHEN** historySeries.length >= 2
- **THEN** 区域渲染 SVG 折线图 + 时间轴 + 范围按钮（1y/3y/5y/10y，按 coverage 启用/禁用）
- **AND** 数据源行显示 K 线 source 标签（如"主源直连 · 2520 条"）

#### Scenario: error 态显示重试按钮

- **GIVEN** `/api/indices/:code/klines` 返回 success=false 或网络异常
- **WHEN** 渲染趋势区
- **THEN** 区域显示 「⚠️ 历史趋势数据暂时无法获取」+ 「🔄 重试」按钮
- **AND** 点击重试按钮后回到 loading 态，重新触发拉取

#### Scenario: 重试成功后切回 success

- **GIVEN** 当前 error 态显示「重试」按钮
- **WHEN** 用户点击重试且后端这次返回 success=true（如服务端缓存恢复 / 网络恢复）
- **THEN** 趋势区切换为 SVG 折线图

#### Scenario: 切换范围按钮不重复请求

- **GIVEN** historySeries 已加载（含完整 10 年数据）
- **WHEN** 用户在 1y/3y/5y/10y 之间切换
- **THEN** 系统**不**发起新的 K 线请求，仅本地 slice 渲染

---

### Requirement: 并发请求去重

系统 SHALL 在前端用 `Map<code, Promise>` 防止同一 code 的并发 K 线请求重复触发。

#### Scenario: 快速切换 / 重试时去重

- **GIVEN** 用户快速连续点击「重试」按钮 5 次
- **WHEN** 上一次请求尚在 inflight
- **THEN** 系统**仅触发 1 次** fetch，后续 4 次复用同一 Promise

#### Scenario: 用户切换到其他指数时不影响当前请求

- **WHEN** 用户在 SPX 加载中切换到 NDX
- **THEN** SPX 的请求继续进行（用于回写缓存），NDX 单独发起新请求

---

### Requirement: K 线响应回写多数据池

系统 SHALL 在 K 线请求成功后将 historySeries 回写到 `indexQuotesData / dashboardData / indexData` 三个前端数据池（如对应 code 存在），保证下次打开同一指数模态框时直接命中。

#### Scenario: 回写 indexQuotesData

- **GIVEN** 用户在指数实时行情面板点击 HSCEI 模态框
- **WHEN** K 线拉取成功
- **THEN** `indexQuotesData.find(i => i.code === 'HSCEI').historySeries` 被设为响应中的 historySeries

#### Scenario: 回写 dashboardData（如 code 在候选池）

- **GIVEN** HSCEI 在 dashboard 候选池
- **WHEN** K 线拉取成功
- **THEN** `dashboardData.find(...).historySeries` 也同步更新

#### Scenario: code 不在某数据池时跳过

- **GIVEN** 某 code 不在 dashboardData 中
- **WHEN** 回写
- **THEN** 跳过该池，不抛错

---

### Requirement: 数据源透明度提示

系统 SHALL 在模态框「数据源」行显示 K 线实际来源（eastmoney / tencent / yahoo / stale-cache）。

#### Scenario: 显示主源直连

- **WHEN** K 线来自东方财富主源
- **THEN** 数据源行包含 "K线N条 · 主源直连"

#### Scenario: 显示备用源

- **WHEN** K 线来自腾讯备用源（东方财富冷却中或失败）
- **THEN** 数据源行包含 "K线N条 · 备用源生效中"

#### Scenario: 显示 stale 标识

- **WHEN** K 线来自 stale-cache
- **THEN** 数据源行包含 "K线N条 · 已回退缓存（数据可能滞后）"

---

### Requirement: 市场推断逻辑增强

系统 SHALL 在前端 `_inferMarket(d)` 函数中实现多字段联合推断，确保所有指数（特别是美股指数）都能正确识别市场，从而拼接出正确的完整代码（code + market）。

#### Scenario: 通过 d.market 字段精确推断

- **GIVEN** `d.market` 存在且为合法值（`SH` / `SZ` / `HK` / `US` / `HI` / `CSI`）
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 直接返回 `d.market` 的值

#### Scenario: 通过 d.secid 字段推断

- **GIVEN** `d.market` 不存在，但 `d.secid` 存在（如 `'100.SPX'`）
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 根据 `secid` 前缀判断：`100.` → `US`，`1.` → `SH`，`0.` → `SZ`，`2.` → `CSI`，否则 → `US`

#### Scenario: 通过 d.code 正则匹配推断

- **GIVEN** `d.market` 和 `d.secid` 都不存在
- **WHEN** 调用 `_inferMarket(d)` 且 `d.code` 匹配已知美股指数正则（`/^(SPX|NDX|DJI|VIX)$/i`）
- **THEN** 返回 `US`

#### Scenario: 通过数据池查找推断

- **GIVEN** 以上方法都无法推断
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 在 `indexQuotesData`、`dashboardData`、`indexData` 三个数据池中查找 `i.code === d.code` 且 `i.market` 存在的项，如果找到则返回该 `i.market`

#### Scenario: 兜底返回 SH

- **GIVEN** 所有推断方法都失败
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 返回 `'SH'`（向后兼容）

---

### Requirement: K 线 API 市场后缀模糊匹配

系统 SHALL 在后端 `/api/indices/:code/klines` 接口中，当精确匹配（`POOL_MAP[fullCode]` 和 watchlist 查找都失败）时，自动尝试常见市场后缀（`.US` / `.SH` / `.SZ` / `.HI`），选择第一个能返回有效 K 线数据的市场。

#### Scenario: 精确匹配成功

- **GIVEN** `fullCode = 'SPX.US'`
- **WHEN** 调用 `/api/indices/SPX.US/klines`
- **THEN** 系统从 `POOL_MAP['SPX.US']` 获取配置，正常返回 K 线数据

#### Scenario: 精确匹配失败，模糊匹配成功

- **GIVEN** `fullCode = 'SPX'`（缺少市场后缀）
- **WHEN** 调用 `/api/indices/SPX/klines`
- **THEN** 系统尝试 `SPX.US`（因为 `SPX` 匹配美股指数正则），成功获取 K 线数据并返回

#### Scenario: 所有模糊匹配都失败

- **GIVEN** `fullCode = 'UNKNOWN'`（未知指数）
- **WHEN** 调用 `/api/indices/UNKNOWN/klines`
- **THEN** 系统尝试所有市场后缀（`.US` / `.SH` / `.SZ` / `.HI`）都失败，返回 404 + `{ success: false, error: '指数不存在或不在关注列表' }`

#### Scenario: 模糊匹配使用并行超时

- **GIVEN** 需要模糊匹配
- **WHEN** 系统尝试多个市场后缀
- **THEN** 并行发起所有尝试，每个尝试设置 3 秒超时，取第一个成功的结果；如果全部失败，返回 404

---

### Requirement: 美股指数数据准确性保障

系统 SHALL 确保美股指数（SPX、NDX 等）的 PE、价格、股息率等关键指标来自最新、最可靠的数据源，并在数据可能不准确时明确标注。

#### Scenario: PE 数据来自 Yahoo Finance 最新值

- **GIVEN** watchlist 包含 SPX.US
- **WHEN** 调用 `/api/indices/quotes` 或打开 SPX 详情模态框
- **THEN** `d.pe` 字段来自 Yahoo Finance 最新数据（或 Shiller PE 中位数，如果 Yahoo PE 不可靠）

#### Scenario: 价格数据来自 Yahoo Finance 实时行情

- **GIVEN** watchlist 包含 SPX.US
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** `d.price` 字段来自 Yahoo Finance 或腾讯行情（备用）的最新值，且 `d.updateTime` 标注数据获取时间

#### Scenario: 数据过时标注

- **GIVEN** 美股指数的数据源返回的数据已超过 15 分钟（非交易时段除外）
- **WHEN** 渲染指数详情模态框
- **THEN** 在关键指标区域显示黄色警告标识，提示"数据可能延迟"

---

### Requirement: K 线加载错误反馈增强

系统 SHALL 在 K 线数据加载失败时，提供明确的错误原因说明和重试引导，而不是泛化的"暂时无法获取"。

#### Scenario: 404 错误明确提示

- **GIVEN** 用户点击某不在 `POOL_MAP` 和 watchlist 中的指数
- **WHEN** 模态框尝试加载 K 线数据
- **THEN** 显示"指数不存在或不在关注列表，请先添加该指数到关注列表"

#### Scenario: 数据源全部失败提示具体原因

- **GIVEN** 东方财富、腾讯、Yahoo Finance 三个数据源都失败
- **WHEN** 模态框尝试加载 K 线数据
- **THEN** 显示"所有数据源暂时无法访问（东方财富: socket hang up; 腾讯: timeout; Yahoo: invalid symbol），请稍后重试"

#### Scenario: 重试按钮清除错误状态

- **GIVEN** 当前显示 K 线加载错误
- **WHEN** 用户点击"重试"按钮
- **THEN** 错误提示消失，显示 loading 骨架屏，并重新发起 K 线数据请求

---

### Requirement: 数据时效性透明化

系统 SHALL 在指数详情模态框中显示关键数据的更新时间戳，让用户了解数据时效性。

#### Scenario: 显示 K 线数据获取时间

- **GIVEN** K 线数据加载成功
- **WHEN** 渲染"区间走势分析"区域
- **THEN** 在数据源行显示"K线N条 · 主源直连 · 更新于 HH:MM:SS"（或"已回退缓存 · 更新于 YYYY-MM-DD HH:MM"）

#### Scenario: 显示指数行情更新时间

- **GIVEN** 指数详情模态框打开
- **WHEN** 渲染行情区域（价格、涨跌幅）
- **THEN** 在价格旁边显示"更新于 HH:MM"（来自 `d.updateTime` 或 `/api/indices/quotes` 的响应时间）

---

### Requirement: 全市场指数多周期动量字段后端透出

后端 SHALL 在 `/api/indices/quotes` 与 `/api/indices` 的响应中，为**全部市场**（A 股 / 港股 / 美股）的每个指数对象统一透出多周期涨跌幅字段，基于现有 `historySeries` 在后端计算（避免前端重复计算）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `momentum1m` | number\|null | 近 1 月（约 21 个交易日）涨跌幅 %（保留两位小数） |
| `momentum3m` | number\|null | 近 3 月（约 63 个交易日）涨跌幅 % |
| `momentum6m` | number\|null | 近 6 月（约 126 个交易日）涨跌幅 % |
| `momentum1y` | number\|null | 近 1 年（约 252 个交易日）涨跌幅 % |

#### Scenario: A 股指数响应包含全部 4 个动量字段

- **GIVEN** watchlist 含沪深 300（`000300.SH`）且 historySeries 长度 ≥ 252
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 沪深 300 对象同时包含 `momentum1m` / `momentum3m` / `momentum6m` / `momentum1y` 四个字段，类型为 number 或 null

#### Scenario: 港股指数响应包含全部 4 个动量字段

- **GIVEN** watchlist 含恒生科技（`HSTECH.HK`）
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 恒生科技对象包含 `momentum1m` / `momentum3m` / `momentum6m` / `momentum1y` 四个字段

#### Scenario: 历史数据不足时对应字段为 null

- **GIVEN** 某指数 historySeries 长度 = 30（不足 3 月）
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 该对象 `momentum1m` 为有效数字，`momentum3m` / `momentum6m` / `momentum1y` 均为 `null`

#### Scenario: 字段数值与口径一致

- **GIVEN** 沪深 300 当前价 = 4000，21 个交易日前收盘 = 3800
- **WHEN** 后端计算 `momentum1m`
- **THEN** 字段值 = `((4000 - 3800) / 3800 * 100).toFixed(2)` = `5.26`

#### Scenario: 美股指数兼容现有口径

- **GIVEN** watchlist 含 SPX.US
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 美股指数对象仍保留原有 `momentum1m` / `momentum3m` / `ytdChange` 字段，新增的 `momentum6m` / `momentum1y` 采用与其它市场相同的口径（基于交易日数）

---

### Requirement: 指数卡片多周期动量徽章

前端 SHALL 在**每张**指数卡片（不论市场）渲染一行"多周期动量"，以 4 列徽章形式展示近 1 月 / 3 月 / 6 月 / 1 年涨跌幅。

#### Scenario: A 股卡片显示 4 列动量徽章

- **GIVEN** `/api/indices/quotes` 返回沪深 300 `momentum1m=2.50`、`momentum3m=-1.20`、`momentum6m=8.30`、`momentum1y=15.50`
- **WHEN** 渲染指数卡片
- **THEN** 卡片显示 `1月 +2.50%`、`3月 -1.20%`、`6月 +8.30%`、`1年 +15.50%` 四列徽章

#### Scenario: 港股卡片显示 4 列动量徽章

- **GIVEN** 恒生科技返回 `momentum1m=3.10`、`momentum3m=null`、`momentum6m=null`、`momentum1y=null`
- **WHEN** 渲染卡片
- **THEN** 显示 `1月 +3.10%`、`3月 --`、`6月 --`、`1年 --`

#### Scenario: 红涨绿跌配色一致

- **GIVEN** `momentum1m > 0`
- **WHEN** 渲染徽章
- **THEN** 数字文字颜色使用 CSS 变量 `--color-rise`（红）；`< 0` 使用 `--color-fall`（绿）；`= 0` 使用次级文本色

#### Scenario: null 值显示横线

- **GIVEN** 任一周期值为 `null`
- **WHEN** 渲染该列
- **THEN** 显示 `--`，颜色使用次级文本色（不进入红/绿配色）

#### Scenario: 移动端纵向自适应

- **GIVEN** 屏幕宽度 ≤ 480px
- **WHEN** 渲染指数卡片
- **THEN** 4 列动量徽章自适应为 2×2 网格，不溢出卡片宽度

---

### Requirement: 多周期动量与现有美股展示元素并存

新增的"多周期动量徽章"行 SHALL 不替换或破坏现有美股卡片上的 52 周区间条、Sparkline 与原有 3 列动量徽章；A 股 / 港股卡片仍不显示美股专属元素。

#### Scenario: 美股卡片同时显示新旧元素

- **GIVEN** SPX.US 卡片
- **WHEN** 渲染
- **THEN** 同时包含：52 周区间水位条、原 3 列动量徽章（近1月 / 近3月 / 今年以来）、30 天 Sparkline、**以及**新增的 4 列多周期动量行

#### Scenario: A 股卡片仅显示新增多周期动量

- **GIVEN** 沪深 300 卡片
- **WHEN** 渲染
- **THEN** 包含基础信息 + 新增 4 列多周期动量行，**不**包含 52 周区间条 / Sparkline / 原 3 列美股动量徽章

---

### Requirement: 美股指数 secid 正确性

后端 `POOL_MAP` 中美股指数（market='US'）的 `secid` SHALL 指向数据源（东方财富 push2）真正对应的指数代码，确保返回值与指数中文名一致，禁止出现"NDX 实际返回纳斯达克综合指数"这类语义错位。

#### Scenario: NDX.US 返回纳斯达克 100 真值

- **GIVEN** `POOL_MAP['NDX.US'].secid = '100.NDX100'`
- **WHEN** 后端调用东方财富 `push2/api/qt/stock/get?secid=<NDX.US.secid>`
- **THEN** 响应 `data.f58 === '纳斯达克100'`，且 `data.f43 / 100` 等于腾讯 `qt.gtimg.cn/q=us.NDX` 返回的最新价（误差 ≤ 0.5%）

#### Scenario: SPX.US 返回标普 500 真值

- **GIVEN** `POOL_MAP['SPX.US'].secid = '100.SPX'`
- **WHEN** 后端调用东方财富批量行情接口
- **THEN** 响应中 `f12='SPX'` 且 `f14='标普500'`

#### Scenario: secid 变更不破坏 K 线获取

- **GIVEN** `POOL_MAP['NDX.US']` 的 `secid` 改为新值，`altSecids` 留有旧值作为兜底
- **WHEN** 后端调用 `fetchIndexHistory(NDX_cfg)`
- **THEN** 主源使用新 secid 拉取真正的纳斯达克 100 历史 K 线，若主源失败再依次尝试 `altSecids` 与腾讯/Yahoo 备用源

#### Scenario: 腾讯 K 线代码同样需要校验

- **GIVEN** 腾讯 K 线接口对 `us.NDX`（带点）已被错误绑定到德尼克斯投资 (DX.N)
- **WHEN** 配置 `POOL_MAP['NDX.US'].txKlineCode`
- **THEN** 该字段使用 `'usNDX'`（不带点）以拉取真正的纳斯达克 100 K 线

---

### Requirement: 美股指数行情走腾讯优先通道

`fetchRealtimeQuotes()` SHALL 在收到 `cfg.market === 'US'` 的指数请求时，优先调用 `fetchRealtimeQuotesTencent()`（基于 `qt.gtimg.cn` GBK 接口），失败时再降级到东方财富与新浪。A 股、港股仍沿用现有"东财主源 → 腾讯补漏 → 新浪兜底"的路径，零变更。

#### Scenario: 美股优先腾讯

- **GIVEN** watchlist 含 SPX.US 与 NDX.US
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`
- **THEN** 系统先以美股 configs 调用 `fetchRealtimeQuotesTencent()`，得到全部美股报价后再用东方财富批量接口处理剩余 A 股 / 港股 configs

#### Scenario: 腾讯失败时美股回退东财

- **GIVEN** `qt.gtimg.cn` 当前不可达
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`，allConfigs 包含 SPX.US
- **THEN** 美股段降级到东方财富批量接口拉取（用修正后的 secid），再失败则到新浪

#### Scenario: A 股链路完全不变

- **GIVEN** allConfigs 仅含 A 股指数
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`
- **THEN** 路径与改造前一致：东财主源 → 腾讯补漏 → 新浪兜底，不引入额外腾讯调用

---

### Requirement: 美股指数响应数据准确性自检

`fetchRealtimeQuotesEastmoney()` SHALL 在解析响应时校验返回的 `f12`（code）与 `f14`（中文名）是否与请求 cfg 一致；不一致时 SHALL 记录 WARNING 日志、丢弃该条数据并对该 cfg 标记 `quoteSource = 'eastmoney-mismatch'`，避免错位数据进入下游缓存。

#### Scenario: 名称匹配则正常入库

- **GIVEN** 请求 cfg.code='SPX'，cfg.name='标普500'
- **WHEN** 东财响应 `f12='SPX'`、`f14='标普500'`
- **THEN** 行情数据正常写入 `quotes['SPX']`

#### Scenario: 名称不匹配则丢弃并告警

- **GIVEN** 请求 cfg.code='NDX'，cfg.name='纳斯达克100'
- **WHEN** 东财响应 `f12='NDX'`、`f14='纳斯达克'`（不含"100"）
- **THEN** 系统输出 `console.warn('[美股映射] NDX 期望"纳斯达克100"但收到"纳斯达克"，secid 可能漂移')`，且不写入该 cfg 的报价

#### Scenario: 错位数据不污染历史 K 线缓存

- **GIVEN** 上次 `indices.json` 里 NDX 的 historySeries.tail.close 与当前真值偏差超过 5%
- **WHEN** 服务首次启动加载 `indices.json`
- **THEN** 系统检测到偏差并对 NDX 强制触发一次 `fetchIndexHistory()` 刷新（不阻塞当前请求），下次缓存即为正确值

---

### Requirement: 美股指数响应携带 quoteSource 与 quoteFetchedAt

`/api/indices` 与 `/api/indices/quotes` 响应 SHALL 在每个美股指数对象上输出 `quoteSource`（实际生效的报价源）与 `quoteFetchedAt`（ISO 8601 拉取时间），与温度计 `fetchedAt`/`source` 字段保持一致风格，便于前端展示数据来源与时效。

#### Scenario: 腾讯成功时

- **GIVEN** 美股报价从腾讯成功获取
- **WHEN** 客户端调用 `/api/indices/quotes`
- **THEN** SPX.US 与 NDX.US 对象均含 `quoteSource: 'tencent'`、`quoteFetchedAt: <ISO>`

#### Scenario: 东财兜底时

- **GIVEN** 腾讯不可达，东财成功
- **WHEN** 调用接口
- **THEN** 美股对象 `quoteSource: 'eastmoney'`

#### Scenario: 错位告警透出到前端

- **GIVEN** 东财数据被名称校验判定为 mismatch
- **WHEN** 调用接口
- **THEN** 美股对象 `quoteSource: 'eastmoney-mismatch'`，并附 `staleNote: '数据源映射可能漂移：期望"<expected>"，东财返回"<actual>"'`

#### Scenario: A 股 / 港股不输出该字段

- **WHEN** 客户端调用 `/api/indices/quotes` 看到沪深 300、恒生科技等条目
- **THEN** 这些对象**不**含 `quoteSource` / `quoteFetchedAt` / `staleNote` 字段（避免字段噪声、保持向后兼容）

---

### Requirement: 历史 K 线末尾对齐当日实时价

`fetchIndexQuotesForWatchlist()` 在合并美股 enriched.historySeries 时，SHALL 将"昨日及更早的 historySeries.tail"对齐到本次实时价：若实时价 `q.price > 0` 且与 historySeries 末尾收盘价偏差大于 0.1%，则在 sparkData 末尾追加实时价（已实现），同时**多周期动量**计算优先使用实时价为 last（已实现），不阻塞历史趋势图渲染。

#### Scenario: 实时价新于 historySeries 末尾

- **GIVEN** historySeries.tail.date='2026-06-11'，close=25809.66；实时价 q.price=29446.18
- **WHEN** 计算 `momentum1m`
- **THEN** 使用 last=29446.18（实时价）与 21 个交易日前收盘做差，避免 momentum 长期挂在错位历史上

#### Scenario: 实时价缺失时回退 historySeries 末尾

- **GIVEN** 腾讯与东财同时失败，q.price = null
- **WHEN** 计算 momentum
- **THEN** 使用 historySeries.tail.close 作为 last，保持向后兼容
