## ADDED Requirements

### Requirement: K 线降级链数据完整性校验

系统 SHALL 在指数 K 线降级链中，对配置了 Yahoo 兜底（`cfg.yahooCode` 存在）的指数，校验腾讯 fallback 返回的 K 线条数；当条数低于最小阈值（`MIN_TENCENT_US_INDEX_KLINES`，默认 200）时，系统 SHALL 判定该批数据无效并继续降级至下一级数据源（Yahoo），而非将其视为成功结果并缓存。

#### Scenario: 腾讯返回残缺数据时降级到 Yahoo

- **GIVEN** 关注列表包含纳斯达克100（NDX），其 `yahooCode = '^NDX'`
- **AND** 腾讯 `usNDX` 仅返回 1 条日 K（少于 200 条阈值）
- **WHEN** 系统在 `fetchIndexHistory` 中获取到腾讯 fallback 结果
- **THEN** 系统判定该批数据无效，调用 `recordKlineSourceFailure('tencent', code, reason)` 记录失败埋点，并继续调用 `fetchYahooKlines(cfg)` 获取 Yahoo 兜底数据

#### Scenario: 腾讯返回完整数据时正常使用

- **GIVEN** 标普500（SPX）的腾讯 `us.INX` 返回 2000 条日 K（不少于阈值）
- **WHEN** 系统获取到腾讯 fallback 结果
- **THEN** 系统正常使用该批数据，以 `tencent` 为源写入 K 线缓存，不降级至 Yahoo

#### Scenario: 无 Yahoo 兜底的指数不受校验影响

- **GIVEN** 沪深300 未配置 `yahooCode`
- **WHEN** 系统获取其腾讯 fallback 结果且条数大于 0
- **THEN** 系统沿用既有 `length > 0` 判断逻辑，不施加最小条数校验

### Requirement: Yahoo 兜底限流重试

Yahoo 免费接口存在间歇性限流，系统 SHALL 在 Yahoo K 线兜底请求失败时依次尝试 `query1` / `query2` 两个域名，每次失败后退避 `YAHOO_RETRY_DELAY_MS`（默认 1500ms）再重试，且失败埋点在所有尝试结束后统一记录一次。

#### Scenario: 首次请求被限流后换域名重试成功

- **GIVEN** NDX 需要 Yahoo 兜底，`yahooCode = '^NDX'`
- **AND** `query1.finance.yahoo.com` 返回 HTTP 429
- **WHEN** 系统调用 `fetchYahooKlines(cfg)`
- **THEN** 系统退避 1500ms 后改用 `query2.finance.yahoo.com` 重试，并在成功时返回完整 K 线（约 2500 条 10 年日 K）

#### Scenario: 两次尝试均失败时统一记录一次埋点

- **GIVEN** `query1` 与 `query2` 均返回 HTTP 429
- **WHEN** 系统调用 `fetchYahooKlines(cfg)`
- **THEN** 系统记录**一次** `recordKlineSourceFailure('yahoo', yahooCode, ...)`，不因重试而重复计数

#### Scenario: 首次请求即成功时不触发重试

- **GIVEN** `query1.finance.yahoo.com` 正常返回 K 线
- **WHEN** 系统调用 `fetchYahooKlines(cfg)`
- **THEN** 系统直接返回该批数据，不再请求 `query2`，且无退避等待
