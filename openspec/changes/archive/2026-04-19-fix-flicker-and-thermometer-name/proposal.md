## Why

存在两个影响用户体验的 bug：
1. 前端交易时段自动轮询时，所有列表（指数行情、股票、ETF、基金）使用 `innerHTML` 整体替换容器内容，导致每次刷新页面整块闪烁，用户体验差。
2. 温度计 Tab 中数据源名称显示为"知行温度计"，实际品牌名称为"有知有行温度计"，全项目存在 2 处错误文案。

## What Changes

- **Bug 1 - 无感刷新**：修改指数行情、股票、ETF、基金四个模块的渲染函数，从整体 `innerHTML` 替换改为逐项 diff 更新（仅更新数值变化的 DOM 节点），消除视觉闪烁
- **Bug 2 - 文案修正**：将 `public/index.html` 中出现的 2 处"知行温度计"全部改为"有知有行温度计"

## Capabilities

### New Capabilities

### Modified Capabilities
- `smooth-refresh`: 渲染函数从整体 innerHTML 替换改为细粒度 DOM diff 更新
- `thermometer-name`: 将"知行温度计"文案统一修正为"有知有行温度计"

## Impact

- `public/index.html`：修改四个渲染函数（renderIndexQuotesGrid、renderStocks、renderETFs、renderActiveFunds）+ 2 处文案
- 不涉及后端或其他文件
