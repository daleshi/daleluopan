## 1. K 线降级链数据完整性校验

- [x] 1.1 在 `services/dataFetcher.js` 的 K 线常量区（`KLINE_FAILURE_COOLDOWN` 附近）新增常量 `MIN_TENCENT_US_INDEX_KLINES = 200`，并附注释说明语义（52 周高低需约 252 条，200 用于识别明显残缺数据）
- [x] 1.2 修改 `fetchIndexHistory` 腾讯 fallback 分支：当 `cfg.yahooCode` 存在且 `tencentKlines.length < MIN_TENCENT_US_INDEX_KLINES` 时，判定数据无效，调用 `recordKlineSourceFailure('tencent', code, reason)` 记录埋点并输出告警日志，然后继续走 Yahoo 兜底分支，而非缓存并返回
- [x] 1.3 验证 NDX：强制刷新 `/api/indices?refresh=1`，确认日志出现"数据异常，判定无效"告警，且 NDX K 线最终来自 `yahoo` 源（`^NDX`）且条数充足，52 周高低 / 动量 / sparkline 字段恢复非空
- [x] 1.4 验证 SPX 与 A 股指数不受影响：SPX 腾讯 `us.INX` 返回 2000 条仍正常使用；沪深300 等无 `yahooCode` 指数沿用 `length > 0` 逻辑
- [x] 1.5 （实现期新增）Yahoo 兜底增加双域名退避重试：将 `fetchYahooKlines` 拆为外层重试 + 内层 `fetchYahooKlinesOnce`，依次尝试 `query1` / `query2`，失败退避 `YAHOO_RETRY_DELAY_MS = 1500ms` 后重试，失败埋点在所有尝试结束后统一记录一次（应对实测出现的间歇性 HTTP 429）

## 2. 清理垃圾基金数据

- [x] 2.1 从 `data/fund-watchlist.json` 删除 `code === '123456'` 的条目
- [x] 2.2 验证刷新 `/api/active-funds`，日志不再出现 `123456 所有数据源均失败`，基金列表正常

## 3. 收尾验证

- [x] 3.1 重启测试实例，确认 `/api/indices` 中 NDX K 线数据源为 yahoo 且条数充足
- [x] 3.2 运行 `read_lints` 确认 `services/dataFetcher.js` 无新增错误
