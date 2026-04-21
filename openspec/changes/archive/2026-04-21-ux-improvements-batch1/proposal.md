## Why

本批次包含 4 项独立优化：

1. **每日估值页面重构**：当前每日估值 Tab 信息密度高但层次扁平，纯表格展示缺乏视觉重点，用户难以快速获取关键信息。需重新组织信息层次，提升浏览效率。

2. **PE 分析移除美股指数**：标普500 和纳斯达克100 无 PE 百分位数据（蛋卷基金不覆盖美股），在 PE 分析 Tab 中显示意义不大，反而造成干扰。

3. **指数区间趋势图按钮 bug**：上证指数大卡片中，区间切换按钮（近1年/近3年/近5年）在数据刷新后仍保持首次渲染时的 disabled 状态，无法切换到更大时间跨度。

4. **拖拽排序**：基金总览、ETF 总览、股票总览中，管理员登录后支持拖拽调整卡片顺序，并持久化到 watchlist JSON。

## What Changes

- **每日估值 Tab**：在表格上方新增汇总统计卡片区（低估/适中/高估数量、平均 PE 百分位等），并优化筛选器的视觉层级
- **PE 分析**：`renderPercentileBars()` 和 `renderAnalysisCards()` 中过滤掉 `pePercentile` 为 null 的指数（即标普500、纳斯达克100）
- **区间趋势图 bug**：数据刷新后重新计算按钮的 disabled 状态，确保 historySeries 更新后按钮可用性同步刷新
- **拖拽排序**：引入 HTML5 Drag and Drop API，管理员登录后卡片显示拖拽把手，拖拽结束后调用 watchlist reorder API 持久化顺序；后端新增 `/api/*/reorder` 端点

## Capabilities

### New Capabilities

- `watchlist-drag-reorder`: 管理员可拖拽调整基金/ETF/股票卡片顺序，顺序持久化到服务端 watchlist

### Modified Capabilities

- `smooth-refresh`: 区间趋势图按钮在数据刷新后需同步更新可用性，属于平滑刷新能力的 bug 修复

## Impact

- `public/index.html`：每日估值 HTML/CSS/JS、PE 分析过滤逻辑、趋势图按钮刷新逻辑、拖拽 UI 和事件绑定
- `server.js`：新增 4 个 reorder 端点（index/fund/etf/stock watchlist 各一个）
- `data/*.json`：watchlist JSON 中卡片顺序即为 reorder 结果（已有结构，无需改格式）
