## Why

本机点击验证时发现两个用户可见的功能失效：

1. **基金总览的趋势图无法切换时间范围**：点击"近3年 / 近5年 / 近10年"无任何反应。根因是 `sliceByRange` 在 range 缺省时按 `sizeMap['1y']` 取 **252 条**，而 `fetchAllIndexData` 调用 `fetchIndexHistory(cfg)` 时未传 range，导致 `historySeries = klines.slice(-2520)` 实际只有 252 条。前端 `getTrendDataCoverage` 据此判定 3y（≥500）/ 5y（≥1000）/ 10y（≥2000）均不可用，按钮被渲染为 `disabled`，点击自然无响应。
   附带影响：`high10y` / `low10y` 同样是用这 252 条（约 1 年）数据计算的，"近10年"高低实际只有 1 年口径。

2. **温度计 Tab 无数据**：`GET /api/thermometer/detail?code=...` 对任意指数均返回 `未找到该指数的温度详情`。根因是有知有行页面改版，指数行不再携带 `data-event-params="idx_code:..."` 属性（当前页面该属性出现 **0 次**，改为 `tw-cursor-pointer` 类名 + `/data/indices/{code}` 详情链接），`parseYZYXPage` 的行正则匹配 0 行 → `result.indices` 恒为空 → `tryFetch` 判定失败并**静默返回 null**（既不打印成功日志也不打印失败告警），问题长期不可见。

## What Changes

- 指数历史序列改为取完整 10 年数据：`fetchAllIndexData` 调用 `fetchIndexHistory` 时显式传入 `range: '10y'`，使 `historySeries` 在源数据充足时达到 2520 条，从而让 3y/5y/10y 按钮恢复可用，并让 `high10y` / `low10y` 回归真实 10 年口径。
- 修复前端懒加载死锁（实现期发现）：`renderIndexCards` 在首次渲染时主动触发 `ensureFullIndexData()`（不依赖详情展开），加载完成后重绘上证指数卡片与指数行情网格，使 range 按钮的可用状态与最新数据同步。
- 重写有知有行指数行解析：基于 `/data/indices/{code}` 详情链接 + 行内温度数值提取指数列表，不再依赖已移除的 `data-event-params` 属性。
- 补上有知有行解析失败的可观测性：`indices` 解析为空时输出明确告警日志（含页面长度、关键特征命中情况），避免再次出现"静默失效"。

## Capabilities

### New Capabilities

- `index-trend-range`: 指数趋势图的历史序列数据完整性与时间范围（1y/3y/5y/10y）切换可用性。
- `yz-thermometer-parsing`: 有知有行温度计页面的指数行解析与解析失败告警。

### Modified Capabilities

（无）

## Impact

- **代码**：`services/dataFetcher.js`（`fetchAllIndexData` 的 K 线 range 入参；`parseYZYXPage` 指数行解析与告警）。
- **接口**：`/api/indices?detail=1` 的 `historySeries` 条数由 252 增至最多 2520，响应体相应增大（该接口已有"精简模式剔除 historySeries"的设计，`?detail=1` 本就是按需取全量的路径）。
- **依赖**：无新增外部依赖。
- **风险**：`historySeries` 变大会增加 `?detail=1` 响应体与前端内存占用；需确认前端趋势图渲染在 2520 条规模下的性能。
