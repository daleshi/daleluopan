## Why

指数实时行情功能存在三个影响可用性的缺陷：A 股/港股指数的 52 周最高/最低点恒为 N/A（后端行情主源不返回 52w 字段，且 K 线回填逻辑被限制为仅美股）；详情弹窗的趋势走势图"最近3年/最近5年/最近10年"按钮永久禁用（前端首次只拉取 1 年数据，按钮可用性基于本地数据条数一次性定死，切换时不会重新拉取）；新添加的池外指数详情页大面积空白（PE/PB/动量/52w/温度等增强数据链路仅覆盖 22 个内置候选池指数）。这些问题使用户无法获得完整的指数估值与趋势信息。

## What Changes

- 修复 52 周高/低缺失：解除 `fetchIndexQuotesForWatchlist` 中"仅美股回填 52w 高低"的市场限制，所有市场指数统一从 K 线统计回填 `high52w`/`low52w`（含 `pricePosition52w`），东财数据缺失时亦可由腾讯备用源字段补充
- 修复趋势周期切换：`ensureModalTrendData` 首次直接请求 `range=10y` 全量 K 线（后端切片成本低且有缓存），前端本地按 range 切片渲染；同时在本地数据不足时 `setIdxModalTrendRange` 可按目标 range 重新请求后端，并在数据到达后重建按钮区
- 修复池外指数详情空白：`/api/indices` 的 `buildIndexConfig` 支持基于 watchlist 动态构造配置（而非仅查 POOL_MAP），使新增指数也能拉取历史 K 线、计算 52w 统计与动量；`fetchIndexQuotesForWatchlist` 对池外指数使用 K 线统计兜底；温度计详情对未覆盖指数返回友好降级提示而非 404
- 前端对"该指数暂无温度/估值数据"做优雅降级展示

## Capabilities

### New Capabilities
- `index-quote-enrichment`: 指数行情增强数据（52w 高低、动量、估值）的全市场覆盖与池外指数兜底回填
- `index-trend-range-switching`: 详情弹窗趋势图 1y/3y/5y/10y 周期切换的数据加载与按钮状态管理
- `dynamic-index-registration`: watchlist 新增指数（候选池外）自动纳入历史数据构建与详情数据链路

### Modified Capabilities
<!-- 无既有 specs 目录中的能力需要修改 -->

## Impact

- **后端**: `services/dataFetcher.js`（`fetchIndexQuotesForWatchlist` 52w 回填限制、`buildIndexConfig` 池外指数支持、温度计详情降级）、`server.js`（`/api/indices/add` 后可异步预热新指数历史数据）
- **前端**: `public/index.html`（`ensureModalTrendData` / `setIdxModalTrendRange` / `buildIdxModalBody` 趋势切换逻辑、详情弹窗缺失字段的降级展示）
- **API**: `/api/indices`、`/api/indices/quotes`、`/api/indices/:code/klines`、`/api/thermometer/detail` 响应行为变化（字段补全、错误响应优化），无破坏性变更
- **数据**: `data/cache/indices.json` 将包含 watchlist 中池外指数的历史数据条目
