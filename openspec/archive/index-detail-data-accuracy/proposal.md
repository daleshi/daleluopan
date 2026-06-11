## Why

指数详情模态框存在两个关键问题影响用户体验：
1. **区间走势分析加载失败**：点击指数卡片后，"区间走势分析"区域经常提示"指数不存在或无法获取"，导致用户无法查看历史趋势图
2. **美股指数数据不准确**：美股指数（如标普500、纳斯达克100）的PE、价格等关键指标显示的值不是最新数据，影响投资决策

## What Changes

- **修复 K 线数据加载失败问题**：
  - 增强 `_inferMarket(d)` 函数的市场推断逻辑，确保为所有指数正确识别市场（特别是美股指数）
  - 优化 `ensureModalTrendData(d)` 函数，当 K 线 API 返回 404 时，尝试使用备选 market 后缀重新请求
  - 在 `openIdxDetailModal(code)` 中，确保传入的 code 能正确转换为完整代码（code + market）

- **修复美股指数数据准确性问题**：
  - 检查并修复美股指数的数据源链路，确保使用最新的实时数据
  - 优化缓存策略，确保美股指数在交易时段能及时更新
  - 增强 `fetchIndexHistory(cfg)` 函数，为美股指数选择最可靠的数据源

- **增强错误处理和用户反馈**：
  - 当 K 线数据加载失败时，提供更明确的错误信息和重试机制
  - 在模态框中显示数据更新时间戳，让用户了解数据时效性

## Capabilities

### New Capabilities

_（无新增能力）_

### Modified Capabilities

- `index-quotes-panel`: 修复指数详情模态框的 K 线数据加载逻辑，确保对所有指数（特别是美股指数）都能正确获取历史走势数据；修复美股指数的数据准确性问题，确保 PE、价格等指标为最新值

## Impact

- **后端**：`server.js` 中的 K 线 API 端点 `/api/indices/:code/klines` 逻辑；`services/dataFetcher.js` 中的 `fetchIndexHistory()` 函数和市场推断逻辑
- **前端**：`public/index.html` 中的 `openIdxDetailModal()`、`ensureModalTrendData()`、`_inferMarket()` 函数
- **数据源**：美股指数的 K 线数据源（东方财富、腾讯、Yahoo Finance）的 failover 链
- **缓存**：美股指数的缓存 TTL 和 stale 缓存处理逻辑
