## Why

用户反馈温度计 Tab 显示的「有知有行」温度数据与 youzhiyouxing.cn 官网实际温度对不上，存在明显滞后；排查发现 `fetchYZYXThermometer()` 与 `_yzyxDetailCache` 使用固定 10 分钟内存缓存，又叠加磁盘 `daily-eval.json` 与两阶段启动的 stale 缓存，最终用户在某些时段看到的是数小时甚至上一交易日的快照，且没有"强制刷新最新"路径。同类问题可能也存在于其他通过 HTML 抓取或长 TTL 缓存的估值/温度数据源中。

同时，当前指数实时行情面板仅为美股卡片展示了 `momentum1m`/`momentum3m`，A 股与港股缺少同维度的中长期涨跌幅信息，用户无法在卡片上快速判断指数的多周期表现，需要补齐近 1 月 / 3 月 / 6 月 / 1 年涨跌幅展示。

## What Changes

- **修复温度计数据滞后**：
  - 将 `fetchYZYXThermometer()` 与 `fetchYZYXIndexDetail()` 的内存 TTL 改为交易时段感知（A 股开盘 60 秒；A 股休市但港美股开盘 5 分钟；全部休市 30 分钟，封顶 4 小时强制刷新）。
  - 新增 `?refresh=1` 强制绕过缓存通道，并在 `/api/daily-eval` 与新增 `/api/thermometer/refresh` 端点（管理员限）中支持。
  - 在响应中透出 `thermometer.fetchedAt` / `stale` / `source` 字段，前端温度计 Tab 显示"更新于 HH:MM:SS"与 stale 警告徽章。
  - 当 youzhiyouxing.cn HTML 解析返回数据为空或与上次完全一致超过 4 小时时，记录告警并尝试备用路径 `/thermometer`。
- **同类问题体检与防御**：
  - 审计 `dataFetcher.js` 中其它 HTML 抓取/长 TTL 缓存（danjuan-eva、eniu、etfrun），统一改为交易时段感知 TTL 并透出 `fetchedAt`。
  - `/api/daily-eval` 响应顶层补充 `dataSources[].fetchedAt` / `stale` 字段，前端在数据源说明区显示更新时间。
- **指数卡片多周期动量**：
  - 后端在 `/api/indices/quotes` 与 `/api/indices` 响应中为**所有市场**（A 股 / 港股 / 美股）的指数对象统一透出 `momentum1m`、`momentum3m`、`momentum6m`、`momentum1y` 四个字段（基于现有 historySeries 计算，历史不足时返回 `null`）。
  - 前端在每张指数卡片上新增一行"多周期涨跌"展示：`1月` / `3月` / `6月` / `1年` 四列徽章，红涨绿跌，`null` 显示 `--`。
  - 兼容现有美股卡片：保留原有 `momentum1m` / `momentum3m` / `ytdChange` 字段，新增字段以同口径覆盖。

## Capabilities

### New Capabilities

无（本次新增需求归入既有 capability）。

### Modified Capabilities

- `thermometer-name`: 在现有"数据源命名正确"基础上，新增"温度计数据时效性"需求——TTL 交易时段感知、强制刷新通道、`fetchedAt` / `stale` 透出与前端提示。
- `index-quotes-panel`: 扩展"指数卡片字段后端透出"与"卡片渲染"相关需求，将多周期 momentum 从美股专属扩展为全市场，并新增 6 月 / 1 年两个周期；新增前端"多周期动量徽章"渲染需求。

## Impact

- **后端**：`services/dataFetcher.js`（`fetchYZYXThermometer`、`fetchYZYXIndexDetail`、`fetchAllIndexData`、`fetchIndexQuotes` 等），`server.js`（`/api/daily-eval` 缓存策略、新增 `/api/thermometer/refresh`）。
- **前端**：`public/index.html` 温度计 Tab 渲染段、指数卡片渲染函数 `renderIndexQuotesGrid` 及对应 CSS。
- **API 兼容性**：响应字段为新增字段，不删除/重命名既有字段，向后兼容。
- **数据源依赖**：仍依赖 youzhiyouxing.cn HTML 抓取（保留两条 URL 路径），需在解析失败时回退磁盘缓存并标记 `stale=true`。
- **缓存**：调整内存 TTL，不引入新的磁盘缓存文件；`data/cache/daily-eval.json` 字段扩展但格式向后兼容。
- **测试 / 部署**：无 lint / 单元测试框架变更；PM2 重启即可生效。
