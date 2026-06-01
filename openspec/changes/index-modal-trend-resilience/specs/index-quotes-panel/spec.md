## ADDED Requirements

### Requirement: 按指数 code 单独查询 K 线接口

系统 SHALL 提供 `GET /api/indices/:code/klines` 公开 API，按完整 code（含市场后缀，如 `SPX.US`）返回单个指数的历史 K 线，复用现有 failover 链。

#### Scenario: 标准请求成功

- **GIVEN** watchlist 含 SPX.US 指数
- **WHEN** 调用 `GET /api/indices/SPX.US/klines`
- **THEN** 系统返回 200 + `{ success: true, data: { code: 'SPX.US', historySeries: [...], source: 'eastmoney'|'tencent'|'yahoo'|'stale-cache', sourceLabel: '主源直连'|'备用源生效中'|..., stale: false|true, fetchedAt: ISOString } }`
- **AND** historySeries 数组每项含 `{ date, open, close, high, low, ... }` 字段

#### Scenario: 候选池外指数动态查找

- **GIVEN** 用户搜索添加了某不在 DEFAULT_SELECTED_CODES 候选池但已在 watchlist 的指数
- **WHEN** 调用对应 code 的 klines 接口
- **THEN** 系统从 `readIndexWatchlist()` 动态构造 cfg，调用 `fetchIndexHistory(cfg)` 返回 K 线

#### Scenario: 未知 code 返回 404

- **WHEN** 调用 `GET /api/indices/UNKNOWN.XX/klines`
- **AND** 该 code 既不在候选池也不在 watchlist
- **THEN** 系统返回 404 + `{ success: false, error: '指数不存在或不在关注列表' }`

#### Scenario: 数据源全部失败返回错误但 HTTP 200

- **GIVEN** 东方财富 / 腾讯 / Yahoo 三方均超时或失败
- **WHEN** 调用接口
- **THEN** 系统返回 HTTP 200 + `{ success: false, error: 'K线数据暂时无法获取，请稍后重试', data: { code, source: 'none' } }`
- **AND** 前端可通过 success=false 分支显示 error UI

#### Scenario: 缓存命中快速返回

- **GIVEN** 同一 code 30 秒内被请求过
- **WHEN** 再次调用
- **THEN** 系统从 `_klineCache` 内存缓存返回，响应时间 < 50ms

#### Scenario: stale 缓存兜底

- **GIVEN** 主源失败但 stale 缓存内有同 code 的旧数据
- **WHEN** 调用接口
- **THEN** 系统返回 `{ success: true, data: { ..., source: 'stale-cache', stale: true } }`，前端正常渲染图并在数据源行标注"已回退缓存"

### Requirement: 模态框打开时按需异步加载 K 线

系统 SHALL 在用户点击指数卡片打开详情模态框时，**立即**显示已有元信息（价格、PE、52周高低、估值徽章），**独立异步**拉取 K 线数据并填充「区间走势分析」区。

#### Scenario: 首次打开有 K 线缓存

- **GIVEN** 用户首次点击沪深 300 卡片
- **WHEN** 模态框打开
- **THEN** Header / 行情 / 关键指标 / PE 百分位条立即可见
- **AND** 趋势区显示骨架屏 + 「📈 正在加载历史趋势数据…」
- **AND** 异步 fetch 完成后趋势区平滑替换为 SVG 折线图

#### Scenario: 用户点击未在 dashboard 候选池的指数

- **GIVEN** 用户搜索添加了某非主流指数到 watchlist
- **WHEN** 点击该指数的实时行情卡片
- **THEN** 模态框正常打开（不再 silently return），从 `indexQuotesData` 兜底构造元信息
- **AND** 异步触发 `GET /api/indices/:code/klines` 拉趋势

#### Scenario: 模态框关闭后 K 线缓存保留

- **GIVEN** 用户成功打开并查看了 NDX 模态框
- **WHEN** 关闭后再次打开 NDX 模态框
- **THEN** historySeries 已写回内存数据池（indexQuotesData / dashboardData），趋势图**立即可见**无 loading 闪烁

### Requirement: 区间走势三态可见反馈（loading / success / error）

系统 SHALL 在「区间走势分析」区根据数据状态显示明确反馈：loading（骨架屏 + 文案）、success（SVG 折线 + 范围按钮）、error（提示 + 重试按钮）。

#### Scenario: loading 态视觉

- **GIVEN** 模态框打开但 K 线尚未拉到
- **WHEN** 渲染趋势区
- **THEN** 区域显示一个高度等于趋势图（220px）的骨架屏（含 `@keyframes shimmer` 扫光动画）
- **AND** 文案为 「📈 正在加载历史趋势数据…」

#### Scenario: success 态正常渲染

- **WHEN** historySeries.length >= 2
- **THEN** 区域渲染 SVG 折线图 + 时间轴 + 范围按钮（1y/3y/5y/10y，按 coverage 启用/禁用）
- **AND** 数据源行显示 K 线 source 标签（如"主源直连 · 2520 条"）

#### Scenario: error 态显示重试按钮

- **GIVEN** `/api/indices/:code/klines` 返回 success=false 或网络异常
- **WHEN** 渲染趋势区
- **THEN** 区域显示 「⚠️ 历史趋势数据暂时无法获取」+ 「🔄 重试」按钮
- **AND** 点击重试按钮后回到 loading 态，重新触发拉取

#### Scenario: 重试成功后切回 success

- **GIVEN** 当前 error 态显示「重试」按钮
- **WHEN** 用户点击重试且后端这次返回 success=true（如服务端缓存恢复 / 网络恢复）
- **THEN** 趋势区切换为 SVG 折线图

#### Scenario: 切换范围按钮不重复请求

- **GIVEN** historySeries 已加载（含完整 10 年数据）
- **WHEN** 用户在 1y/3y/5y/10y 之间切换
- **THEN** 系统**不**发起新的 K 线请求，仅本地 slice 渲染

### Requirement: 并发请求去重

系统 SHALL 在前端用 `Map<code, Promise>` 防止同一 code 的并发 K 线请求重复触发。

#### Scenario: 快速切换 / 重试时去重

- **GIVEN** 用户快速连续点击「重试」按钮 5 次
- **WHEN** 上一次请求尚在 inflight
- **THEN** 系统**仅触发 1 次** fetch，后续 4 次复用同一 Promise

#### Scenario: 用户切换到其他指数时不影响当前请求

- **WHEN** 用户在 SPX 加载中切换到 NDX
- **THEN** SPX 的请求继续进行（用于回写缓存），NDX 单独发起新请求

### Requirement: K 线响应回写多数据池

系统 SHALL 在 K 线请求成功后将 historySeries 回写到 `indexQuotesData / dashboardData / indexData` 三个前端数据池（如对应 code 存在），保证下次打开同一指数模态框时直接命中。

#### Scenario: 回写 indexQuotesData

- **GIVEN** 用户在指数实时行情面板点击 HSTECH 模态框
- **WHEN** K 线拉取成功
- **THEN** `indexQuotesData.find(i => i.code === 'HSTECH').historySeries` 被设为响应中的 historySeries

#### Scenario: 回写 dashboardData（如 code 在候选池）

- **GIVEN** HSTECH 在 dashboard 候选池
- **WHEN** K 线拉取成功
- **THEN** `dashboardData.find(...).historySeries` 也同步更新

#### Scenario: code 不在某数据池时跳过

- **GIVEN** 某 code 不在 dashboardData 中
- **WHEN** 回写
- **THEN** 跳过该池，不抛错

### Requirement: 数据源透明度提示

系统 SHALL 在模态框「数据源」行显示 K 线实际来源（eastmoney / tencent / yahoo / stale-cache）。

#### Scenario: 显示主源直连

- **WHEN** K 线来自东方财富主源
- **THEN** 数据源行包含 "K线N条 · 主源直连"

#### Scenario: 显示备用源

- **WHEN** K 线来自腾讯备用源（东方财富冷却中或失败）
- **THEN** 数据源行包含 "K线N条 · 备用源生效中"

#### Scenario: 显示 stale 标识

- **WHEN** K 线来自 stale-cache
- **THEN** 数据源行包含 "K线N条 · 已回退缓存（数据可能滞后）"
