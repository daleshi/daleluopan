## ADDED Requirements

### Requirement: 市场推断逻辑增强

系统 SHALL 在前端 `_inferMarket(d)` 函数中实现多字段联合推断，确保所有指数（特别是美股指数）都能正确识别市场，从而拼接出正确的完整代码（code + market）。

#### Scenario: 通过 d.market 字段精确推断

- **GIVEN** `d.market` 存在且为合法值（`SH` / `SZ` / `HK` / `US` / `HI` / `CSI`）
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 直接返回 `d.market` 的值

#### Scenario: 通过 d.secid 字段推断

- **GIVEN** `d.market` 不存在，但 `d.secid` 存在（如 `'100.SPX'`）
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 根据 `secid` 前缀判断：`100.` → `US`，`1.` → `SH`，`0.` → `SZ`，`2.` → `CSI`，否则 → `US`

#### Scenario: 通过 d.code 正则匹配推断

- **GIVEN** `d.market` 和 `d.secid` 都不存在
- **WHEN** 调用 `_inferMarket(d)` 且 `d.code` 匹配已知美股指数正则（`/^(SPX|NDX|DJI|VIX)$/i`）
- **THEN** 返回 `US`

#### Scenario: 通过数据池查找推断

- **GIVEN** 以上方法都无法推断
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 在 `indexQuotesData`、`dashboardData`、`indexData` 三个数据池中查找 `i.code === d.code` 且 `i.market` 存在的项，如果找到则返回该 `i.market`

#### Scenario: 兜底返回 SH

- **GIVEN** 所有推断方法都失败
- **WHEN** 调用 `_inferMarket(d)`
- **THEN** 返回 `'SH'`（向后兼容）

---

### Requirement: K 线 API 市场后缀模糊匹配

系统 SHALL 在后端 `/api/indices/:code/klines` 接口中，当精确匹配（`POOL_MAP[fullCode]` 和 watchlist 查找都失败）时，自动尝试常见市场后缀（`.US` / `.SH` / `.SZ` / `.HI`），选择第一个能返回有效 K 线数据的市场。

#### Scenario: 精确匹配成功

- **GIVEN** `fullCode = 'SPX.US'`
- **WHEN** 调用 `/api/indices/SPX.US/klines`
- **THEN** 系统从 `POOL_MAP['SPX.US']` 获取配置，正常返回 K 线数据

#### Scenario: 精确匹配失败，模糊匹配成功

- **GIVEN** `fullCode = 'SPX'`（缺少市场后缀）
- **WHEN** 调用 `/api/indices/SPX/klines`
- **THEN** 系统尝试 `SPX.US`（因为 `SPX` 匹配美股指数正则），成功获取 K 线数据并返回

#### Scenario: 所有模糊匹配都失败

- **GIVEN** `fullCode = 'UNKNOWN'`（未知指数）
- **WHEN** 调用 `/api/indices/UNKNOWN/klines`
- **THEN** 系统尝试所有市场后缀（`.US` / `.SH` / `.SZ` / `.HI`）都失败，返回 404 + `{ success: false, error: '指数不存在或不在关注列表' }`

#### Scenario: 模糊匹配使用并行超时

- **GIVEN** 需要模糊匹配
- **WHEN** 系统尝试多个市场后缀
- **THEN** 并行发起所有尝试，每个尝试设置 3 秒超时，取第一个成功的结果；如果全部失败，返回 404

---

### Requirement: 美股指数数据准确性保障

系统 SHALL 确保美股指数（SPX、NDX 等）的 PE、价格、股息率等关键指标来自最新、最可靠的数据源，并在数据可能不准确时明确标注。

#### Scenario: PE 数据来自 Yahoo Finance 最新值

- **GIVEN** watchlist 包含 SPX.US
- **WHEN** 调用 `/api/indices/quotes` 或打开 SPX 详情模态框
- **THEN** `d.pe` 字段来自 Yahoo Finance 最新数据（或 Shiller PE 中位数，如果 Yahoo PE 不可靠）

#### Scenario: 价格数据来自 Yahoo Finance 实时行情

- **GIVEN** watchlist 包含 SPX.US
- **WHEN** 调用 `/api/indices/quotes`
- **THEN** `d.price` 字段来自 Yahoo Finance 或腾讯行情（备用）的最新值，且 `d.updateTime` 标注数据获取时间

#### Scenario: 数据过时标注

- **GIVEN** 美股指数的数据源返回的数据已超过 15 分钟（非交易时段除外）
- **WHEN** 渲染指数详情模态框
- **THEN** 在关键指标区域显示黄色警告标识，提示"数据可能延迟"

---

### Requirement: K 线加载错误反馈增强

系统 SHALL 在 K 线数据加载失败时，提供明确的错误原因说明和重试引导，而不是泛化的"暂时无法获取"。

#### Scenario: 404 错误明确提示

- **GIVEN** 用户点击某不在 `POOL_MAP` 和 watchlist 中的指数
- **WHEN** 模态框尝试加载 K 线数据
- **THEN** 显示"指数不存在或不在关注列表，请先添加该指数到关注列表"

#### Scenario: 数据源全部失败提示具体原因

- **GIVEN** 东方财富、腾讯、Yahoo Finance 三个数据源都失败
- **WHEN** 模态框尝试加载 K 线数据
- **THEN** 显示"所有数据源暂时无法访问（东方财富: socket hang up; 腾讯: timeout; Yahoo: invalid symbol），请稍后重试"

#### Scenario: 重试按钮清除错误状态

- **GIVEN** 当前显示 K 线加载错误
- **WHEN** 用户点击"重试"按钮
- **THEN** 错误提示消失，显示 loading 骨架屏，并重新发起 K 线数据请求

---

### Requirement: 数据时效性透明化

系统 SHALL 在指数详情模态框中显示关键数据的更新时间戳，让用户了解数据时效性。

#### Scenario: 显示 K 线数据获取时间

- **GIVEN** K 线数据加载成功
- **WHEN** 渲染"区间走势分析"区域
- **THEN** 在数据源行显示"K线N条 · 主源直连 · 更新于 HH:MM:SS"（或"已回退缓存 · 更新于 YYYY-MM-DD HH:MM"）

#### Scenario: 显示指数行情更新时间

- **GIVEN** 指数详情模态框打开
- **WHEN** 渲染行情区域（价格、涨跌幅）
- **THEN** 在价格旁边显示"更新于 HH:MM"（来自 `d.updateTime` 或 `/api/indices/quotes` 的响应时间）

---

## MODIFIED Requirements

（无修改现有 Requirement，仅新增 above）

## REMOVED Requirements

（无移除）

## RENAMED Requirements

（无重命名）
