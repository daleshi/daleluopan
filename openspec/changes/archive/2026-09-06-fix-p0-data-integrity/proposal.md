## Why

全站数据实时性体检（2026-09-06 周日）发现两个 P0 数据完整性问题：

1. **纳斯达克100（NDX）K 线只剩 1 条**。腾讯 K 线接口 `usNDX` 自 2026-09 起对历史日 K 仅返回最新 1 条（实测：请求 2000 条只得 1 条；对照组 `us.INX` 正常返回 2000 条）。由于 `fetchTencentKlines` 返回"非空但残缺"的数据（`length > 0` 即视为成功），K 线降级链在此处**中断**，已配置的 Yahoo `^NDX` 兜底（实测可用，返回 252 条）永远无法触发。后果：NDX 卡片的 52 周高低、多周期动量徽章、sparkline 全部失效或失真。

2. **主动基金 watchlist 混入无效测试代码 `123456`**。`data/fund-watchlist.json` 中有一条 `code/name/shortName` 均为 `123456` 的垃圾数据，每次刷新该基金所有数据源均超时失败，拖慢整体刷新并污染日志。

## What Changes

- 在 K 线降级链中增加**数据完整性校验**：对配置了 Yahoo 兜底的指数（美股 SPX/NDX），当腾讯 fallback 返回的 K 线条数低于阈值时，判定为无效数据并继续降级到 Yahoo，而不是中断降级链。
- 清理主动基金 watchlist 中的垃圾代码 `123456`（删除该条数据）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `kline-source-resilience`: 新增"K 线数据完整性校验"需求——腾讯 fallback 返回非空但明显残缺的数据时，系统 SHALL 判定其无效并继续降级至下一级数据源，确保 Yahoo 兜底在美股指数场景下可被正确触发。

## Impact

- **代码**：`services/dataFetcher.js`（`fetchIndexHistory` 降级链主流程 + 新增完整性校验常量/逻辑）。
- **数据**：`data/fund-watchlist.json`（删除 `123456` 条目）。
- **依赖**：无新增外部依赖；复用已存在的 Yahoo Finance K 线兜底能力（`fetchYahooKlines`）。
- **风险**：完整性校验仅作用于配置了 `yahooCode` 的指数（当前仅 SPX、NDX 两个美股指数），不影响 A 股/港股指数的现有降级行为。
