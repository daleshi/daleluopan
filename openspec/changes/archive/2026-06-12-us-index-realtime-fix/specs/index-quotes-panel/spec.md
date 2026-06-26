## ADDED Requirements

### Requirement: 美股指数 secid 正确性

后端 `POOL_MAP` 中美股指数（market='US'）的 `secid` SHALL 指向数据源（东方财富 push2）真正对应的指数代码，确保返回值与指数中文名一致，禁止出现"NDX 实际返回纳斯达克综合指数"这类语义错位。

#### Scenario: NDX.US 返回纳斯达克 100 真值

- **GIVEN** `POOL_MAP['NDX.US'].secid` 已修正
- **WHEN** 后端调用东方财富 `push2/api/qt/stock/get?secid=<NDX.US.secid>`
- **THEN** 响应 `data.f58 === '纳斯达克100'`，且 `data.f43 / 100` 等于腾讯 `qt.gtimg.cn/q=us.NDX` 返回的最新价（误差 ≤ 0.5%）

#### Scenario: SPX.US 返回标普 500 真值

- **GIVEN** `POOL_MAP['SPX.US'].secid = '100.SPX'`
- **WHEN** 后端调用东方财富批量行情接口
- **THEN** 响应中 `f12='SPX'` 且 `f14='标普500'`

#### Scenario: secid 变更不破坏 K 线获取

- **GIVEN** `POOL_MAP['NDX.US']` 的 `secid` 改为新值，`altSecids` 留有旧值作为兜底
- **WHEN** 后端调用 `fetchIndexHistory(NDX_cfg)`
- **THEN** 主源使用新 secid 拉取真正的纳斯达克 100 历史 K 线，若主源失败再依次尝试 `altSecids` 与腾讯/Yahoo 备用源

---

### Requirement: 美股指数行情走腾讯优先通道

`fetchRealtimeQuotes()` SHALL 在收到 `cfg.market === 'US'` 的指数请求时，优先调用 `fetchRealtimeQuotesTencent()`（基于 `qt.gtimg.cn` GBK 接口），失败时再降级到东方财富与新浪。A 股、港股仍沿用现有"东财主源 → 腾讯补漏 → 新浪兜底"的路径，零变更。

#### Scenario: 美股优先腾讯

- **GIVEN** watchlist 含 SPX.US 与 NDX.US
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`
- **THEN** 系统先以美股 configs 调用 `fetchRealtimeQuotesTencent()`，得到全部美股报价后再用东方财富批量接口处理剩余 A 股 / 港股 configs

#### Scenario: 腾讯失败时美股回退东财

- **GIVEN** `qt.gtimg.cn` 当前不可达
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`，allConfigs 包含 SPX.US
- **THEN** 美股段降级到东方财富批量接口拉取（用修正后的 secid），再失败则到新浪

#### Scenario: A 股链路完全不变

- **GIVEN** allConfigs 仅含 A 股指数
- **WHEN** 调用 `fetchRealtimeQuotes(allConfigs)`
- **THEN** 路径与改造前一致：东财主源 → 腾讯补漏 → 新浪兜底，不引入额外腾讯调用

---

### Requirement: 美股指数响应数据准确性自检

`fetchRealtimeQuotesEastmoney()` SHALL 在解析响应时校验返回的 `f12`（code）与 `f14`（中文名）是否与请求 cfg 一致；不一致时 SHALL 记录 WARNING 日志、丢弃该条数据并对该 cfg 标记 `quoteSource = 'eastmoney-mismatch'`，避免错位数据进入下游缓存。

#### Scenario: 名称匹配则正常入库

- **GIVEN** 请求 cfg.code='SPX'，cfg.name='标普500'
- **WHEN** 东财响应 `f12='SPX'`、`f14='标普500'`
- **THEN** 行情数据正常写入 `quotes['SPX']`

#### Scenario: 名称不匹配则丢弃并告警

- **GIVEN** 请求 cfg.code='NDX'，cfg.name='纳斯达克100'
- **WHEN** 东财响应 `f12='NDX'`、`f14='纳斯达克'`（不含"100"）
- **THEN** 系统输出 `console.warn('[美股映射] NDX 期望"纳斯达克100"但收到"纳斯达克"，secid 可能漂移')`，且不写入该 cfg 的报价

#### Scenario: 错位数据不污染历史 K 线缓存

- **GIVEN** 上次 `indices.json` 里 NDX 的 historySeries.tail.close 与当前真值偏差超过 5%
- **WHEN** 服务首次启动加载 `indices.json`
- **THEN** 系统检测到偏差并对 NDX 强制触发一次 `fetchIndexHistory()` 刷新（不阻塞当前请求），下次缓存即为正确值

---

### Requirement: 美股指数响应携带 quoteSource 与 quoteFetchedAt

`/api/indices` 与 `/api/indices/quotes` 响应 SHALL 在每个美股指数对象上输出 `quoteSource`（实际生效的报价源）与 `quoteFetchedAt`（ISO 8601 拉取时间），与温度计 `fetchedAt`/`source` 字段保持一致风格，便于前端展示数据来源与时效。

#### Scenario: 腾讯成功时

- **GIVEN** 美股报价从腾讯成功获取
- **WHEN** 客户端调用 `/api/indices/quotes`
- **THEN** SPX.US 与 NDX.US 对象均含 `quoteSource: 'tencent'`、`quoteFetchedAt: <ISO>`

#### Scenario: 东财兜底时

- **GIVEN** 腾讯不可达，东财成功
- **WHEN** 调用接口
- **THEN** 美股对象 `quoteSource: 'eastmoney'`

#### Scenario: 错位告警透出到前端

- **GIVEN** 东财数据被名称校验判定为 mismatch
- **WHEN** 调用接口
- **THEN** 美股对象 `quoteSource: 'eastmoney-mismatch'`，并附 `staleNote: '数据源映射可能漂移'`

---

### Requirement: 历史 K 线末尾对齐当日实时价

`fetchIndexQuotesForWatchlist()` 在合并美股 enriched.historySeries 时，SHALL 将"昨日及更早的 historySeries.tail"对齐到本次实时价：若实时价 `q.price > 0` 且与 historySeries 末尾收盘价偏差大于 0.1%，则在 sparkData 末尾追加实时价（已实现），同时**多周期动量**计算优先使用实时价为 last（已实现），不阻塞历史趋势图渲染。

#### Scenario: 实时价新于 historySeries 末尾

- **GIVEN** historySeries.tail.date='2026-06-11'，close=25809.66；实时价 q.price=29446.18
- **WHEN** 计算 `momentum1m`
- **THEN** 使用 last=29446.18（实时价）与 21 个交易日前收盘做差，避免 momentum 长期挂在错位历史上

#### Scenario: 实时价缺失时回退 historySeries 末尾

- **GIVEN** 腾讯与东财同时失败，q.price = null
- **WHEN** 计算 momentum
- **THEN** 使用 historySeries.tail.close 作为 last，保持向后兼容
