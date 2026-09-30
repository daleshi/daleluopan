## ADDED Requirements

### Requirement: 搜索添加的指数获得估值数据

`/api/indices/quotes` SHALL 为通过搜索添加的指数返回估值字段：蛋卷（按 `djCode`）未命中时，MUST 使用天天基金估值映射按 `code` / `csCode` 匹配作为二级来源补充 `pe` / `pb` / `pePercentile` / `pbPercentile`。二级数据源在配置中被关闭时 MUST 跳过并退化为不补充。

#### Scenario: 池外 A 股指数拿到 PE / PB

- **GIVEN** 管理员搜索并添加了一个不在候选池内的 A 股指数，且天天基金覆盖该指数代码
- **WHEN** 前端请求 `/api/indices/quotes`
- **THEN** 该指数返回 `pe` / `pb` 为有效数值，前端卡片渲染出 PE / PB 行

#### Scenario: 蛋卷优先于兜底源

- **GIVEN** 某指数的 `djCode` 在蛋卷估值映射中存在
- **WHEN** 组装该指数的行情数据
- **THEN** 估值字段取自蛋卷，不调用兜底源

#### Scenario: 兜底源也缺失时优雅降级

- **GIVEN** 蛋卷与天天基金均未覆盖该指数
- **WHEN** 前端请求 `/api/indices/quotes`
- **THEN** 估值字段为 `null`，接口不报错，卡片对应区域按现有逻辑不渲染

#### Scenario: 百分位可用时推导估值档位

- **GIVEN** 兜底源返回 `pePercentile = 25`
- **WHEN** 组装行情数据
- **THEN** `evaType` 为 `low`；百分位不可用时 `evaType` 为 `null`

### Requirement: 添加指数时持久化估值映射并校正市场

`POST /api/indices/add` SHALL 在命中候选池时使用池内的 `market` / `secid` 校正入参，并把 `djCode` / `csCode` 写入 watchlist。搜索接口 SHALL 正确区分中证（CSI）与港股（HI）市场，并优先按代码在候选池中查找（不限市场）以确定 `market` / `secid` / `icon` / `category`。

#### Scenario: 添加池内指数带上 djCode

- **WHEN** 管理员添加创业板指（399006，候选池内 djCode 为 `SZ399006`）
- **THEN** watchlist 中该条目包含 `djCode: 'SZ399006'`，且行情接口返回其 PE / PB / 百分位

#### Scenario: 中证系指数不被判成港股

- **GIVEN** 东方财富搜索接口对中证红利低波（H30269）返回 `MktNum=2`
- **WHEN** 搜索结果生成
- **THEN** `market` 为 `CSI`、`secid` 为 `2.H30269`，添加后行情与估值均可正常获取

#### Scenario: 港股指数仍判为港股

- **GIVEN** 搜索返回恒生科技（HSTECH，`MktNum=2` 或 `100`）
- **WHEN** 搜索结果生成
- **THEN** `market` 为 `HI`、`secid` 为 `100.HSTECH`

#### Scenario: 旧数据兼容

- **GIVEN** watchlist 中存在不含 `djCode` 的历史条目
- **WHEN** 行情接口组装该指数
- **THEN** 回退使用候选池的 `djCode`，行为与变更前一致

### Requirement: 行情接口读取 watchlist 自带的 djCode

`fetchIndexQuotesForWatchlist` SHALL 优先使用 watchlist 项自带的 `djCode`，其次使用候选池配置的 `djCode`。

#### Scenario: 使用 watchlist 自带映射

- **GIVEN** watchlist 项含 `djCode: 'SZ399006'`，而候选池中该指数配置缺失
- **WHEN** 组装行情数据
- **THEN** 仍按 `SZ399006` 匹配蛋卷估值
