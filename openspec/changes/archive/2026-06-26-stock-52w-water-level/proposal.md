## Why

用户反馈"股票总览"卡片缺少 52 周高/低与价格水位信息——仅展示当前价、涨跌幅、走势 sparkline，难以快速判断个股当前价位在过去一年区间中的位置（是逼近高点还是跌到低位）。

排查后端 `services/stockFetcher.js` 发现两个相关问题：

1. **字段名误导**：`fetchAllStockData()` 已透出 `high52w` / `low52w` 字段，但其计算输入的 K 线只取 **60 个交易日**（`fetchResilientStockKlinesDetailed(stock, 60)`），实际是"近 60 日高/低"而非真正的"52 周（约 252 个交易日）"——前端任何依赖此字段做 52w 展示都将得到误导性数据。
2. **缺少水位字段**：当前响应没有 `pricePosition52w`（当前价在 52 周区间所处百分位）字段，前端无法直接渲染"水位条"。

前端股票卡片渲染（`buildStockCardHtml`）也没有展示 52w 信息的 UI，需要新增"52 周区间条"组件，参考既有的 ETF 详情模态框水位条（`.etf-detail-52w-*`）与美股指数卡片 `buildRangeBar()` 的视觉风格。

## What Changes

- **后端 K 线扩展**：
  - 将 `services/stockFetcher.js` 中股票日线 K 线获取条数从 60 扩展到 252（约 52 周交易日），保证 `high52w` / `low52w` 名实相符。
  - 评估对外部数据源（东方财富 push2his / 腾讯）请求成本：原 60 → 252 仅是单次请求体积变大约 4 倍，请求次数不变；接口本身已支持（`fetchTencentStockKlines` 内部已默认 limit=60，需确认能取到更多）。
  - 保留 sparkData 在前端展示用的"近 30 日"切片，避免迷你走势图视觉变化（仅服务端切片：`sparkData = klines.slice(-30).map(k => k.close)`）。
- **新增水位字段**：
  - 响应中新增 `pricePosition52w`（number，0–100，保留 1 位小数；当前价在 52 周区间的百分位 = `(price - low52w) / (high52w - low52w) * 100`，价格突破上界时取 100，跌破下界时取 0）。
  - 数据缺失时（K 线不足 / 价格为空）返回 `null`。
- **前端股票卡片增加 52w 区间条**：
  - 在 `buildStockCardHtml()` 中，于 sparkline 与价格信息之间新增「52 周水位条」一行：左侧标注 `low52w`，右侧标注 `high52w`，中间渐变进度条 + 圆形游标定位当前价；下方显示「当前位 X.X%」徽章（红涨绿跌不适用，配色用 accent-blue）。
  - 移动端（≤480px）保持单行，字体压缩到 10px。
  - 数据缺失时整行隐藏（不渲染占位横线，避免空间浪费）。
- **不引入用户可见的 K 线性能感知变化**：响应体积少量增加（每股票约 +200 行 K 线 ≈ +30KB JSON），但前端只读 4 个字段（high52w / low52w / pricePosition52w / sparkData），实际感知开销可忽略。

## Capabilities

### New Capabilities

- `stock-overview`: 个人股票总览面板的实时行情卡片视觉与字段约束（含 52 周区间条与价格水位）。

### Modified Capabilities

无（与现有 capability 不耦合，独立新建）。

## Impact

- **后端**: `services/stockFetcher.js`（K 线 limit 60→252，新增 `pricePosition52w` 计算与字段透出）
- **前端**: `public/index.html` 的 `buildStockCardHtml()` 与 CSS（新增 `.stock-52w-*` 样式）
- **API 兼容性**: 仅扩展字段（`high52w` / `low52w` 字段名不变但语义从"60 日"变为"252 日"，行为更准确；新增 `pricePosition52w`）；不删除/重命名既有字段
- **缓存**: `_stockKlineCache` 自动按 `cacheKey` 复用并不区分 limit，但缓存内容结构不变；首次请求会重新拉 252 条 K 线
- **测试 / 部署**: 无 lint / 单元测试框架变更；PM2 重启即生效
- **数据源依赖**: 东方财富 push2his K 线接口（已支持 lmt=2520 上限）；腾讯 K 线 fallback（默认 limit=60，需在调用处改为 252）
