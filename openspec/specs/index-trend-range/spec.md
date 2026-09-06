# index-trend-range Specification

## Purpose
TBD - created by archiving change fix-trend-range-and-thermometer. Update Purpose after archive.
## Requirements
### Requirement: 指数趋势历史序列覆盖 10 年

系统 SHALL 在生成指数数据（`fetchAllIndexData`）时以 10 年（约 2520 个交易日）为目标获取 K 线历史序列，使 `historySeries` 在数据源充足时达到 2520 条。

#### Scenario: 数据源充足时 historySeries 覆盖 10 年

- **GIVEN** 某指数的 K 线数据源可返回 2000 条以上日 K（如腾讯 2000 条或 Yahoo 2514 条）
- **WHEN** `fetchAllIndexData` 生成该指数数据
- **THEN** 该指数的 `historySeries` 条数不小于 2000

#### Scenario: 趋势图 3y/5y/10y 按钮可用

- **GIVEN** 某指数的 `historySeries` 条数 ≥ 2000
- **WHEN** 前端渲染该指数趋势图的时间范围切换按钮
- **THEN** "近3年"、"近5年"、"近10年"按钮均不为 `disabled`，点击后趋势图按对应范围重绘

#### Scenario: 近10年高低采用 10 年口径

- **GIVEN** 某指数的 K 线历史序列覆盖约 10 年
- **WHEN** 系统计算该指数的 10 年最高价与最低价
- **THEN** `high10y` / `low10y` 基于完整历史序列计算，其结果不等于 52 周高低（`high52w` / `low52w`）

#### Scenario: 精简模式仍不含 historySeries

- **WHEN** 请求 `/api/indices`（不带 `detail=1`）
- **THEN** 响应中不含 `historySeries`，响应体保持精简

### Requirement: 前端主动懒加载历史序列并同步按钮状态

前端系统 SHALL 在指数卡片首次渲染时主动触发完整指数数据（含 `historySeries`）的懒加载（不依赖详情展开状态），且加载成功后 SHALL 重绘指数卡片与指数行情网格，使时间范围按钮的可用状态与最新数据一致。懒加载请求在整个页面会话中 SHALL 只发起一次。

#### Scenario: 默认详情收起时按钮依然可用

- **GIVEN** 页面初次加载，上证指数详情处于收起状态（`featuredDetailOpen = false`）
- **WHEN** 指数卡片完成首次渲染且懒加载成功
- **THEN** 时间范围按钮依据最新 `historySeries` 计算可用性，数据充足时不再为 `disabled`

#### Scenario: 懒加载完成后按钮状态同步

- **GIVEN** 懒加载完成前按钮因 `historySeries` 缺失而被禁用
- **WHEN** `/api/indices?detail=1` 加载成功
- **THEN** 系统重绘上证指数卡片与指数行情网格，数据充足的时间范围按钮解除禁用

#### Scenario: 懒加载不会重复发起

- **GIVEN** 页面处于交易时段轮询中，`renderAll` 被反复调用
- **WHEN** 懒加载已完成或已发起
- **THEN** 不会再次请求 `/api/indices?detail=1`（会话内仅一次）

### Requirement: 懒加载回填指数行情数据池

系统 SHALL 在懒加载完整指数数据后，将 `historySeries` 同时回填到 `indexData`、`dashboardData` 与 `indexQuotesData` 三个数据池。

#### Scenario: 指数实时行情面板按钮可用

- **GIVEN** 指数实时行情面板由 `indexQuotesData` 渲染，而 `/api/indices/quotes` 响应不含 `historySeries`
- **WHEN** 懒加载 `/api/indices?detail=1` 成功
- **THEN** `indexQuotesData` 中对应指数的 `historySeries` 被填充，该面板内趋势图的 1y/3y/5y 按钮在数据充足时可点击

#### Scenario: 数据不足时按阈值禁用

- **GIVEN** 某指数的 `historySeries` 为 1620 条（如科创50）
- **WHEN** 渲染其趋势图时间范围按钮
- **THEN** 1y / 3y / 5y 可点击，10y 因不足 2000 条被禁用并提示"数据不足"

#### Scenario: 数据为空时全部禁用

- **GIVEN** 某指数因上游数据源失败导致 `historySeries` 为空（如纳斯达克100 遇 Yahoo 限流）
- **WHEN** 渲染其趋势图时间范围按钮
- **THEN** 全部按钮禁用，title 显示"数据不足，当前仅覆盖约0年"，且后端日志有对应告警

