> 依赖：基于 `redesign-tabs-and-layout` 已完成的 `NAV_TABS` 单一注册表。本变更不碰该变更第 6/7 组的视觉与样式重构任务。

## 1. HTML 结构拆分

- [x] 1.1 在 `#tab-dashboard` 之后新增 `<div class="tab-content" id="tab-funds">` 容器，加上独立 page-header（标题「严选基金」，副标题描述指数基金 / 主动基金跟踪）
- [x] 1.2 把严选基金 section（说明文字、`.af-toolbar` 搜索、`#fundCatTabs`、`#indexFundPanel` / `#activeFundPanel`）原样搬进 `#tab-funds`，所有 id 和 class 不变，原位置删除
- [x] 1.3 把 `#tab-dashboard` 的 page-header 改成标题「指数行情」、副标题「市场风向标 · 指数实时行情 · 估值水位」
- [x] 1.4 确认 `#fundDetailModal` 等弹窗仍在 tab 容器外，不受搬迁影响

## 2. 导航注册表

- [x] 2.1 `NAV_TABS`：`dashboard` 条目改成 `label: '指数行情', short: '指数', icon: '📈'`；在它后面新增 `{ tab: 'funds', label: '严选基金', short: '基金', icon: '💰' }`
- [x] 2.2 `NAV_MOBILE_MAIN` 改成 `['dashboard', 'funds', 'etf', 'stocks', 'valuation']`
- [x] 2.3 全文搜索「基金总览」文案，更新剩余的提示和注释（例如 `loadActiveFundData` 附近注释、tab 切换注释）

## 3. 数据加载与刷新归属

- [x] 3.1 tab 切换处理：`dashboard` 分支去掉 `loadActiveFundData()`，只保留 `loadIndexQuotes()`；新增 `funds` 分支调 `loadActiveFundData()`
- [x] 3.2 `refreshCurrentTab`：`dashboard` 分支去掉 `loadActiveFundData(true)`；新增 `funds` 分支调 `loadActiveFundData(true)`
- [x] 3.3 启动流程（非 `/admin` 路径）去掉 `loadActiveFundData()`，首屏不请求基金数据
- [x] 3.4 确认调度器 `createDataRefreshScheduler` 不需要改：`funds` 页不轮询，`dashboard` 页轮询保持不变

## 4. 移动端适配

- [x] 4.1 在 360px 和 375px 视口检查底部导航 6 个按钮（指数 / 基金 / ETF / 股票 / 估值 / 更多）是否在一行内且不溢出
- [x] 4.2 如果拥挤，只调整 `.mobile-nav-item` 的 padding / 字号 / 图标尺寸（仅 CSS）

## 5. 验证

- [x] 5.1 首屏：默认显示指数行情，网络请求里没有 `/api/active-funds`，控制台无报错
- [x] 5.2 切到严选基金：首次出现 loading 后渲染卡片；切走再切回不重复请求
- [x] 5.3 刷新按钮：指数行情页只刷新指数；严选基金页请求 `/api/active-funds?refresh=1`
- [x] 5.4 回归严选基金交互：搜索添加（自动切到对应分类）、删除、分类切换、详情弹窗
- [x] 5.5 回归指数行情交互：市场分类 Tab、指数搜索添加、删除、拖拽排序、详情弹窗
- [x] 5.6 在管理类标签页登出后回到指数行情；深浅主题下两个页面显示正常
- [x] 5.7 移动端：底部导航点「基金」能切换并高亮，「更多」面板内容正确
