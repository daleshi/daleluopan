# thermometer-name

## Requirements

### Requirement: 温度计数据源名称显示正确
温度计相关所有位置（包括风险提示）中数据源名称 SHALL 显示为"有知有行温度计"，不得显示任何错误字序变体（如"知有行温度计"）。

#### Scenario: 温度计 Tab 页面标题
- **WHEN** 用户切换到温度计 Tab
- **THEN** 页面中数据源名称显示为"有知有行温度计"

#### Scenario: 温度计卡片描述文案
- **WHEN** 用户查看温度计 Tab 中的说明卡片
- **THEN** 描述文字中品牌名称显示为"有知有行温度计"

#### Scenario: 风险提示中的品牌名称
- **WHEN** 用户查看温度计 Tab 底部的风险提示区域
- **THEN** 数据来源说明中品牌名称显示为"有知有行温度计"，不显示"知有行温度计"

---

### Requirement: 温度计数据 TTL 交易时段感知

后端 `fetchYZYXThermometer()` 与 `fetchYZYXIndexDetail()` 函数 SHALL 使用交易时段感知的内存 TTL，确保用户在交易时段能看到接近实时的温度数据，避免长时间复用过期快照。

#### Scenario: A 股开盘时段使用短 TTL

- **GIVEN** 当前为工作日北京时间 10:30（A 股开盘）
- **WHEN** 同一 Node 进程内连续两次调用 `fetchYZYXThermometer()`，间隔 90 秒
- **THEN** 第二次必须触发实际 HTTP 拉取（TTL = 60 秒），不复用第一次的内存缓存

#### Scenario: A 股休市但港美股开盘使用中 TTL

- **GIVEN** 当前为工作日北京时间 22:30（仅美股开盘）
- **WHEN** 调用 `fetchYZYXThermometer()` 后 6 分钟再次调用
- **THEN** 第二次触发实际 HTTP 拉取（TTL = 5 分钟）

#### Scenario: 全市场休市使用长 TTL

- **GIVEN** 当前为周日 14:00（全市场休市）
- **WHEN** 同一进程内调用 `fetchYZYXThermometer()`
- **THEN** TTL = 30 分钟

#### Scenario: 缓存最长不超过 4 小时

- **GIVEN** Node 进程已运行超过 4 小时且全程未触达 HTTP
- **WHEN** 任意调用 `fetchYZYXThermometer()`
- **THEN** 系统强制忽略内存缓存并重新发起 HTTP 抓取，避免长时间快照固化

#### Scenario: 详情接口同步使用相同 TTL 策略

- **GIVEN** `fetchYZYXIndexDetail('000300.SH')` 已被调用
- **WHEN** 在 A 股开盘时段 90 秒后再次调用同一 code
- **THEN** `_yzyxDetailCacheTime[code]` 比较使用与 `fetchYZYXThermometer()` 相同的 TTL 策略，触发重新抓取

---

### Requirement: 温度计强制刷新通道

系统 SHALL 提供绕过缓存的强制刷新通道，便于用户在发现数据滞后时获取最新温度，并供管理员排障使用。

#### Scenario: indices 接口支持 refresh 参数

- **GIVEN** 内存温度缓存仍在 TTL 内
- **WHEN** 调用 `GET /api/indices?refresh=1`
- **THEN** 系统跳过 `_yzyxCache`，重新拉取 youzhiyouxing.cn 并返回最新温度数据（透传 `forceRefreshThermometer: true` 至 `fetchYZYXThermometer({ force: true })`）

#### Scenario: 管理员可直接刷新温度计

- **GIVEN** 已登录管理员
- **WHEN** 调用 `POST /api/thermometer/refresh`
- **THEN** 系统返回 200 + `{ success: true, fetchedAt: ISOString, source, stale, marketTemperature: number, indexCount: number }`，并清空 `_yzyxCache` / `_yzyxDetailCache`

#### Scenario: 未登录或非管理员无法触发强制刷新端点

- **GIVEN** 未登录用户
- **WHEN** 调用 `POST /api/thermometer/refresh`
- **THEN** 系统返回 401 + `{ success: false, error: '请先登录' }`；登录但非 admin 则返回 403 + `{ success: false, error: '需要管理员权限' }`（与既有 `requireAdmin` 中间件一致）

#### Scenario: refresh 请求失败时回退原有缓存

- **GIVEN** 强制刷新但 youzhiyouxing.cn 当前不可达
- **WHEN** 调用 `GET /api/indices?refresh=1`
- **THEN** 系统返回上次成功的温度数据并在响应中标记 `thermometer.stale = true`，HTTP 状态保持 200

---

### Requirement: 温度计数据时效性透出

`/api/indices` 响应 SHALL 在 `thermometer` 对象中透出数据时效性元字段，供前端渲染"更新于"与 stale 提示。

#### Scenario: 响应包含 fetchedAt 字段

- **GIVEN** youzhiyouxing.cn 抓取成功
- **WHEN** 调用 `GET /api/indices`
- **THEN** 响应中存在 `thermometer.fetchedAt`（ISO 8601 字符串），值为本次实际拉取的 UTC 时间

#### Scenario: 响应包含 source 与 stale 标识

- **WHEN** 调用 `GET /api/indices`
- **THEN** 响应中存在 `thermometer.source ∈ {'youzhiyouxing-data', 'youzhiyouxing-thermometer', 'stale-cache'}` 与 `thermometer.stale ∈ {true, false}`

#### Scenario: 抓取失败回退缓存时正确标记

- **GIVEN** youzhiyouxing.cn 两条 URL 均失败但内存有上次成功的缓存
- **WHEN** 调用 `GET /api/indices`
- **THEN** 响应 `thermometer.stale = true`，`fetchedAt` 为原始缓存的时间戳

#### Scenario: 前端温度计 Tab 显示更新时间

- **GIVEN** 用户切换到温度计 Tab
- **WHEN** 渲染全市场温度卡片
- **THEN** 更新时间行追加「本站抓取 HH:MM:SS」，若 `stale = true` 则同时显示黄色「⚠️ 数据可能滞后」徽章

---

### Requirement: 其它估值数据源时效性透出

`dataFetcher.js` 中其它通过 HTTP 抓取的估值/温度数据源（如蛋卷 Wind、亿牛网、ETF.run、天天基金、中证指数）SHALL 透出与温度计一致的 `fetchedAt` / `stale` 字段，便于前端识别滞后。

#### Scenario: comparisonSources 数组包含 fetchedAt

- **WHEN** 调用 `GET /api/indices`
- **THEN** 响应中 `data.meta.comparisonSources` 数组的每一项含 `fetchedAt`（ISO 8601）与 `stale`（boolean）字段

#### Scenario: 长期失败的数据源标记 stale

- **GIVEN** 某估值数据源本次抓取 successCount = 0
- **WHEN** 调用 `GET /api/indices`
- **THEN** 该 comparisonSource 项 `stale = true`、`fetchedAt = null`

#### Scenario: 前端数据源说明区展示时间戳

- **GIVEN** 用户查看指数卡片底部"实时可用来源对比"
- **WHEN** 数据源行渲染
- **THEN** 每个数据源名称后追加「HH:MM」，stale 项加 `.ds-stale` 灰色样式
