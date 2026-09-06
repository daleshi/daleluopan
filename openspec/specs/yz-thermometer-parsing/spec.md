# yz-thermometer-parsing Specification

## Purpose
TBD - created by archiving change fix-trend-range-and-thermometer. Update Purpose after archive.
## Requirements
### Requirement: 有知有行指数行按详情链接解析

系统 SHALL 基于指数详情页链接（`/data/indices/{code}`）解析有知有行温度计页面的指数列表，不再依赖已移除的 `data-event-params="idx_code:..."` 属性。

#### Scenario: 当前页面结构可解析出指数列表

- **GIVEN** 有知有行 `/data` 页面返回包含 `/data/indices/{code}` 链接的 HTML
- **WHEN** 系统调用 `fetchYZYXThermometer()`
- **THEN** 返回的 `result.indices` 非空，且每项包含 `name`、`code`、`shortCode`、`temperature`、`detailPath`

#### Scenario: 温度详情接口可返回数据

- **GIVEN** 温度计已成功解析出指数列表
- **WHEN** 请求 `GET /api/thermometer/detail?code=000300.SH`
- **THEN** 系统返回 200 且 `success: true`，`data` 含该指数的温度详情

#### Scenario: 非指数行不被误匹配

- **GIVEN** 页面中存在不含 `/data/indices/` 链接的表格行
- **WHEN** 系统解析指数行
- **THEN** 该行被忽略，不进入 `result.indices`

### Requirement: 温度计解析失败可观测

系统 SHALL 在有知有行页面解析结果为空时输出明确告警日志，不得静默返回 null。

#### Scenario: indices 为空时输出告警

- **GIVEN** 有知有行页面抓取成功（HTTP 200）但解析出的 `indices` 为空
- **WHEN** `tryFetch` 判定解析失败
- **THEN** 系统输出告警日志，包含页面 HTML 长度及关键特征命中情况（是否含 `/data/indices/`、是否含温度数值）

#### Scenario: 两次尝试均失败时不静默

- **GIVEN** `/data` 与 `/thermometer` 两个路径均解析为空
- **WHEN** 调用 `fetchYZYXThermometer()`
- **THEN** 系统输出告警后返回 null 或 stale 缓存，日志中可检索到"知有行"相关告警记录

