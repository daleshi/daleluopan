## Context

单文件 SPA，前端纯原生 JS，后端 Express + JSON 文件持久化。每日估值数据来自 `/api/daily-eval`，指数数据来自 `/api/indices`（含 `historySeries` 字段）。watchlist 持久化在 `data/*.json`，当前结构为 `{ stocks: [...] }` / `{ etfs: [...] }` 等数组，顺序即展示顺序。

## Goals / Non-Goals

**Goals:**
- 每日估值页汇总区提供快速概览，减少用户扫描表格的认知负担
- PE 分析仅展示有有效百分位数据的指数
- 区间趋势图按钮在数据刷新后正确反映可用性
- 管理员拖拽排序后持久化，刷新页面保持顺序

**Non-Goals:**
- 不改变每日估值的数据来源和计算逻辑
- 不为美股指数补充 PE 数据
- 拖拽不支持跨 Tab（指数卡不能拖到 ETF）
- 不引入第三方拖拽库

## Decisions

**决策 1：每日估值汇总卡用静态 HTML 容器 + JS 填充**
在表格上方插入 `#dailyEvalSummary` 容器，`renderDailyEval()` 执行时同步更新汇总数字。无需新增 API。

**决策 2：PE 分析过滤条件**
过滤掉 `d.pePercentile == null` 的条目（标普500/纳斯达克100 没有百分位数据），不硬编码指数代码，以保持数据驱动。

**决策 3：区间按钮 bug 修复——数据更新后重建按钮**
`renderCoreTrendView()` 在渲染图表时，同步重建 `.featured-trend-ranges` 内的按钮 HTML（复用 `buildIndexCardHTML` 中的 rangeButtons 生成逻辑），确保每次数据刷新后按钮 disabled 状态与当前 `historySeries` 长度一致。

**决策 4：拖拽使用 HTML5 原生 DnD API**
给卡片添加 `draggable="true"`，监听 `dragstart/dragover/drop` 事件，drop 时提取新顺序并 POST 到后端。管理员身份判断复用全局 `authUser.role === 'admin'`。后端 reorder 端点接收 `{ codes: [...] }` 数组，按顺序重写 watchlist JSON。

**决策 5：拖拽把手仅管理员可见**
复用已有的 `body.role-admin` CSS 类控制拖拽把手（`::before` 或独立 DOM）的显示/隐藏，无需额外鉴权 API。

## Risks / Trade-offs

- [风险] 拖拽与增量刷新并发：拖拽进行中若数据刷新重建 DOM，会中断拖拽 → 缓解：拖拽进行中（`isDragging` flag）时跳过增量 DOM 更新
- [风险] 区间按钮重建会丢失用户当前选中状态 → 缓解：重建时从 `coreTrendState[code].range` 读取当前选中范围，正确设置 `active` 类
- [Trade-off] 每日估值汇总区是全量数据统计还是当前筛选结果统计 → 选择**全量数据统计**，让用户知道总体分布，筛选结果数量已在现有 UI 中展示
