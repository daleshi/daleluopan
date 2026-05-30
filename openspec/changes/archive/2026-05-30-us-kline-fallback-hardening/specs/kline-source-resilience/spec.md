## ADDED Requirements

### Requirement: 启动期 K 线优先刷新

系统 SHALL 在服务启动 Phase 2 阶段优先刷新 `indices.json`（K 线衍生数据），确保后续依赖 K 线的数据加工逻辑（如 `fetchIndexQuotesForWatchlist`）读到的是当日最新快照。

#### Scenario: 启动顺序符合"K 线优先"

- **WHEN** 服务启动进入 Phase 2
- **THEN** 系统先 await `getCachedData(true)` 完成（成功或失败），再以 `Promise.allSettled` 并发刷新 `index-quotes`、`active-funds`、`stocks`、`etfs`、`daily-eval`

#### Scenario: K 线刷新失败不阻塞后续刷新

- **GIVEN** Phase 2a 的 K 线刷新抛错或超时
- **WHEN** 启动流程到达 Phase 2b
- **THEN** 系统记录警告并继续并发刷新其他 5 类数据，不因 K 线失败导致 quote / 基金 / 股票数据全部不更新

#### Scenario: 启动总耗时无显著增加

- **WHEN** 服务在网络正常条件下启动
- **THEN** Phase 2 总耗时与改造前相差不超过 1 秒（K 线本身是关键路径，串行 ≈ 并发耗时）

#### Scenario: 启动日志显示阶段化标识

- **WHEN** 服务启动完成
- **THEN** 控制台日志包含明确的两阶段标识，如 `[启动] Phase 2a: K 线优先刷新完成` 与 `[启动] Phase 2b: 其他数据并发刷新完成`

### Requirement: 运行时 indices.json 陈旧主动刷新

系统 SHALL 在 `fetchIndexQuotesForWatchlist` 调用时检测 `indices.json` 缓存的时间戳，若距今超过 30 分钟且 watchlist 包含美股指数，主动触发该指数的 K 线刷新（异步、限量、不阻塞主流程）。

#### Scenario: 检测到陈旧时触发异步刷新

- **GIVEN** watchlist 含 SPX/NDX，indices.json 的 cache.time 距今 60 分钟
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** 系统通过 `setImmediate` 异步触发 SPX/NDX 的 `fetchIndexHistory`，但本次响应**不等待**该刷新完成

#### Scenario: 不影响响应时间

- **WHEN** 即使触发了异步刷新
- **THEN** 本次 `/api/indices/quotes` 响应时间增加不超过 50ms

#### Scenario: 限量保护

- **GIVEN** watchlist 含 5 个美股指数
- **WHEN** 触发主动刷新
- **THEN** 系统**最多刷新 2 个**美股指数（按 watchlist 顺序），避免对外部源压力突增

#### Scenario: 并发触发去重

- **GIVEN** 同一时刻有 5 个并发 `/api/indices/quotes` 请求
- **WHEN** 全部检测到陈旧
- **THEN** 系统通过 `_indicesRefreshInProgress` 闭锁，仅触发一次主动刷新，其余跳过

#### Scenario: indices.json 不存在时不报错

- **GIVEN** 服务首次启动 indices.json 尚未生成
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** 系统不触发主动刷新（cache.time 不存在视为不陈旧），不抛错；美股增强字段返回 null

#### Scenario: 阈值不可配置但显式

- **WHEN** 阅读源代码
- **THEN** 阈值常量 `INDICES_CACHE_STALE_THRESHOLD_MS = 30 * 60 * 1000` 显式存在并有注释说明语义

### Requirement: K 线源健康度监控

系统 SHALL 维护一个内存中的 K 线源健康度状态，记录每个源（eastmoney / tencent / yahoo）的成功次数、失败次数、最后成功/失败时间、最近 50 条失败记录。

#### Scenario: 成功埋点

- **WHEN** `fetchHistoryKlinesDetailed` / `fetchTencentKlines` / `fetchYahooKlines` 任一成功返回非空 K 线
- **THEN** 系统调用 `recordKlineSourceSuccess(source, code)` 增加 success 计数 + 更新 lastSuccessAt

#### Scenario: 失败埋点

- **WHEN** 任一 fetcher 抛错或返回空结果
- **THEN** 系统调用 `recordKlineSourceFailure(source, code, errMsg)` 增加 failure 计数 + 更新 lastFailureAt + push 到 recentFailures

#### Scenario: recentFailures 内存边界

- **GIVEN** 某源已记录 50 条失败
- **WHEN** 第 51 条失败发生
- **THEN** 系统 shift 移除最早一条，保持数组长度 ≤ 50

#### Scenario: 重启清零

- **WHEN** 服务重启
- **THEN** 健康状态归零（所有计数器为 0），不依赖任何持久化文件

#### Scenario: 公开导出快照函数

- **WHEN** server.js 通过 `getKlineSourceHealthSnapshot()` 获取数据
- **THEN** 返回的对象是 plain JSON，可安全 `JSON.stringify`，不含 Map/Set/Date 实例

### Requirement: K 线源健康 API

系统 SHALL 提供 `GET /api/health/kline-sources` 公开 API，返回 K 线源健康度快照。

#### Scenario: 公开访问返回 200

- **WHEN** 未登录用户访问 `GET /api/health/kline-sources`
- **THEN** 系统返回 200 + `{ success: true, snapshot: { eastmoney: {...}, tencent: {...}, yahoo: {...} }, timestamp: "..." }`

#### Scenario: 字段结构清晰

- **WHEN** 解析响应
- **THEN** 每个源的对象包含：`success`(数字)、`failure`(数字)、`successRate`(0-1 浮点)、`lastSuccessAt`(ISO 字符串或 null)、`lastFailureAt`(ISO 字符串或 null)、`recentFailures`(数组，每条含 `code/time/err`)

#### Scenario: 服务刚启动时返回零值

- **GIVEN** 服务刚启动，尚未有任何 K 线请求
- **WHEN** 访问健康 API
- **THEN** 各源 success/failure 均为 0，`successRate` 为 null（避免 0/0）

### Requirement: 30 分钟聚合告警

系统 SHALL 在服务启动时注册 `setInterval(checkKlineSourceHealth, 30 * 60 * 1000)`，定期检查最近 1 小时内每个源的失败率，若某源失败次数 ≥ 3 个不同指数则在控制台输出聚合告警。

#### Scenario: 失败少于阈值不告警

- **GIVEN** 过去 1 小时仅有 SPX 在东财失败 5 次
- **WHEN** 30 分钟检查触发
- **THEN** 不输出任何告警（影响指数数 = 1 < 3）

#### Scenario: 多指数失败触发告警

- **GIVEN** 过去 1 小时 SPX/NDX/HSTECH 都在东财失败
- **WHEN** 检查触发
- **THEN** 控制台输出 `[K线健康] eastmoney 最近 1 小时失败 N 次，影响 3 个指数: SPX,NDX,HSTECH`

#### Scenario: 告警频率不超过每 30 分钟一次

- **GIVEN** 持续故障状态
- **WHEN** 多次检查触发
- **THEN** 每 30 分钟最多输出一行告警，不刷屏
