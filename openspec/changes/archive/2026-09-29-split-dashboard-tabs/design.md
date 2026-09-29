## Context

`public/index.html` 中的 `#tab-dashboard`（基金总览）目前由三块组成：

1. `#featuredIndexRow`：上证指数"市场风向标"大卡片（`renderIndexCards` 渲染，数据来自 `loadData` → `/api/indices`）
2. 指数实时行情 section：搜索框 `#indexSearchInput`、市场分类 `#indexCatTabs`、网格 `#indexSummaryGrid`（数据来自 `loadIndexQuotes` → `/api/indices/quotes`）
3. 严选基金 section：搜索框 `#fundSearchInput`、分类 `#fundCatTabs`、`#indexFundGrid` / `#activeFundGrid`（数据来自 `loadActiveFundData` → `/api/active-funds`，内部有 `activeFundLoaded` 加载标记）

好几处逻辑写死了 `'dashboard'` 标识：
- 调度器 `createDataRefreshScheduler`（`currentTab === 'dashboard'` 时轮询 `loadData` + `loadIndexQuotes`）
- `refreshCurrentTab`
- 登出 / 权限失效时回跳 `.nav-tab[data-tab="dashboard"]`（约 9497、9631 行）
- 启动时 `scheduler.setActiveTab('dashboard')`
- `renderNavFromRegistry` 默认给 `dashboard` 加 active

导航已经收敛成 `NAV_TABS` 单一注册表（进行中的 `redesign-tabs-and-layout` 已完成这一步）。桌面顶部导航、移动端底部栏、"更多"面板都由它生成。

限制：单文件 SPA、零构建；不改后端；已有的 DOM id 要保留，这样搜索 / 添加 / 删除 / 详情弹窗等大量现有逻辑不用动。

## Goals / Non-Goals

**Goals:**
- 拆成"指数行情"和"严选基金"两个顶层标签页，各自内容独立、各自有 page-header
- 数据按页加载：严选基金只在首次进入时请求
- 刷新按钮、调度器、登出回跳、移动端导航在拆分后都能正确工作
- 改动尽量小：不改 DOM id，不改数据加载函数本身

**Non-Goals:**
- 不做整站视觉重构（由 `redesign-tabs-and-layout` 第 6 组负责）
- 不给严选基金增加交易时段轮询（基金净值是每天更新，没必要）
- 不引入 URL hash 路由或"记住上次停留的标签页"
- 不改后端 API

## Decisions

### D1：指数行情沿用 `dashboard` 标识，严选基金新增 `funds`

**选择**：`data-tab="dashboard"` 保留给"指数行情"（容器 `#tab-dashboard` 不改名），新增 `data-tab="funds"` 和 `#tab-funds`。

**理由**：调度器、登出回跳、启动流程、导航默认 active 等至少 6 处写死了 `dashboard`，而它们的语义本来就是"默认首页 = 指数行情"。沿用这个标识就不用改这些地方。
**备选方案**：把 `dashboard` 改名成 `indices`。放弃原因：改动面大、容易漏改，而且内部标识用户看不到，改名没有实际收益。

### D2：搬迁 DOM，不复制；保留所有 id

**选择**：把严选基金整个 section（含 `.af-toolbar`、`#fundCatTabs`、两个面板）原样挪进 `#tab-funds`，原位置删掉。基金详情弹窗 `#fundDetailModal` 本来就在 tab 容器外面，不用动。

**理由**：`loadActiveFundData` / `renderActiveFunds` / `switchFundCatTab` / 搜索添加删除这些逻辑都通过 id 或 class 找元素，id 不变，JS 就完全不用改。
**风险点**：`.guest-hint`、`.af-search-*` 这些 class 两个页面都在用，属于共享样式，搬走后不受影响。

### D3：严选基金懒加载，指数行情不再顺带加载基金

**选择**：
- 启动流程去掉 `loadActiveFundData()`（首页是指数行情）
- tab 切换：`dashboard` 分支只调 `loadIndexQuotes()`；新增 `funds` 分支调 `loadActiveFundData()`（`activeFundLoaded` 标记保证只请求一次）
- `refreshCurrentTab`：`dashboard` 分支去掉 `loadActiveFundData(true)`；新增 `funds` 分支调 `loadActiveFundData(true)`

**理由**：首屏少一个 `/api/active-funds` 请求（后端这个接口要拉多个基金数据源）。第一次切到严选基金时有短暂的 loading（现有 spinner），可以接受；后端有缓存，一般很快返回。
**备选方案**：启动时后台预加载基金数据。放弃原因：违背"按页加载"的目标，而且大多数访问只看指数。

### D4：导航顺序和移动端底部栏

**选择**：
- `NAV_TABS` 顺序：指数行情（📈，short "指数"）→ 严选基金（💰，short "基金"）→ ETF总览 → 股票总览 → 估值温度 → 公众号 / 管理
- `NAV_MOBILE_MAIN = ['dashboard', 'funds', 'etf', 'stocks', 'valuation']`，底部栏 5 个主入口 + "更多"

**理由**：两个页面都是高频入口，不应该藏进"更多"。6 个按钮在 360px 宽度下每个约 60px，还能放下"图标 + 2 字短标签"。实施时要在 360px 视口实测，如果挤了，就收紧 `.mobile-nav-item` 的 padding / 字号（只改 CSS）。
**备选方案**：把估值温度降到"更多"里。放弃原因：会改变 `redesign-tabs-and-layout` 刚确定的信息架构，应该交给那个变更决定。

### D5：调度器不改

调度器只在 `currentTab === 'dashboard'` 时轮询指数，拆分后正好就是"只在指数行情页轮询"。切到 `funds` 时调度器按现有逻辑空转，不发请求。符合 Non-Goals。

## Risks / Trade-offs

- [与 `redesign-tabs-and-layout` 的第 6/7 组任务冲突] → 本变更只改 `NAV_TABS` 数据和 tab 容器结构，不碰样式 token、弹窗统一、搜索框统一；如果那个变更之后重构导航，会自然带上 `funds` 条目。在两边的 tasks 里都注明依赖
- [移动端 6 个按钮拥挤] → 在 360px / 375px 视口实测，必要时只调 CSS
- [第一次进严选基金有 loading] → 使用现有 spinner；后端缓存命中时通常小于 300ms
- [外部或书签里依赖"基金总览"这个名字] → 纯 SPA、没有 URL 路由，不存在链接失效问题；只有文案变化

## Migration Plan

1. 修改 `public/index.html`（HTML 搬迁 + 注册表 + 切换 / 刷新 / 启动逻辑）
2. 本地验证后 `npm run pm2:restart`，前端静态资源即时生效
3. 回滚：git revert 单个提交即可，不涉及数据和后端

## Open Questions

- 无（移动端底部栏拥挤度在实施阶段实测决定是否调 CSS）
