# index-quote-enrichment Specification

## Purpose
指数行情增强数据（52w 高低、动量、估值）的全市场覆盖与池外指数兜底回填，确保 `/api/indices/quotes` 对所有市场指数返回完整的可推导指标，并对数据源未覆盖的场景优雅降级。

## Requirements

### Requirement: 全市场指数 52 周高低点回填

`/api/indices/quotes` 接口 SHALL 为所有市场（A 股、港股、美股）的指数返回 `high52w`/`low52w` 字段。当行情数据源未原生提供 52 周数据时，系统 MUST 从该指数的 K 线统计（indices.json 缓存）回填；仅当 K 线数据也不存在时字段才为 `null`。回填逻辑 MUST NOT 按市场（如仅限美股）做限制。

#### Scenario: A 股指数返回 52 周高低点

- **WHEN** 前端请求 `/api/indices/quotes` 且某 A 股指数（如沪深 300）已有 K 线统计缓存
- **THEN** 该指数返回对象中 `high52w` 与 `low52w` 为基于近约 250 个交易日 K 线计算的有效数值

#### Scenario: 行情源原生字段优先

- **WHEN** 腾讯行情备用源返回了 52 周高低字段（字段 48/49）
- **THEN** 系统优先使用该原生值，K 线回填仅在其缺失时兜底

#### Scenario: K 线数据缺失时优雅降级

- **WHEN** 某指数既无行情源 52w 字段也无 K 线统计
- **THEN** `high52w`/`low52w` 为 `null`，接口不报错，前端展示降级文案

### Requirement: 池外指数行情的 K 线统计兜底

对于 watchlist 中不在内置候选池（FULL_INDEX_POOL）内的指数，`fetchIndexQuotesForWatchlist` SHALL 使用 K 线统计兜底可由历史数据推导的指标（52w 高低、动量），估值类字段（PE/PB/百分位，依赖蛋卷 djCode 映射）允许为 `null`。

#### Scenario: 池外指数返回可推导指标

- **WHEN** watchlist 包含池外指数且其历史 K 线已成功采集
- **THEN** quotes 接口返回该指数的 `high52w`/`low52w` 与动量字段为有效值，`pe`/`pb` 为 `null`

#### Scenario: 池外指数前端降级展示

- **WHEN** 前端渲染池外指数的详情弹窗
- **THEN** 无数据字段展示"暂无数据"类降级文案，不出现整片空白或脚本错误

### Requirement: 温度计详情未覆盖指数友好降级

`/api/thermometer/detail` 对知有行未覆盖的指数 SHALL 返回 HTTP 200 及 `{ supported: false, message }` 降级响应体，而非 404；前端 MUST 识别该响应并展示"该指数暂无温度数据"提示。

#### Scenario: 未覆盖指数返回降级响应

- **WHEN** 请求 `/api/thermometer/detail?code=<知有行未覆盖的指数代码>`
- **THEN** 接口返回 HTTP 200，响应体含 `supported: false` 与中文提示文案

#### Scenario: 已覆盖指数行为不变

- **WHEN** 请求知有行已覆盖指数的温度详情
- **THEN** 接口返回完整温度详情数据，字段与现有行为一致
