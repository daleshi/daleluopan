## Context

当前指数实时行情链路存在三处结构性缺陷（根因已排查确认）：

1. **52w 高低缺失**：`/api/indices/quotes` 的输出字段 `high52w`/`low52w`（`services/dataFetcher.js:2947-2948`）只有两个来源——腾讯备用源扩展字段（`dataFetcher.js:962-965`）和"仅美股"的 K 线回填（`dataFetcher.js:2853-2861` 被 `idx.market === 'US'` 限制）。A 股/港股走东财主源（`fetchRealtimeQuotesEastmoney`，`dataFetcher.js:844`），请求字段不含 52w 数据，腾讯源仅在补漏时触发，故非美股指数 52w 恒为 `null`。但 `fetchAllIndexData` 已为全市场从 K 线计算了 52w 统计并存入 `indices.json`（`dataFetcher.js:1806-1817`），数据其实存在。
2. **趋势周期不能切换**：后端 `/api/indices/:code/klines` 完整支持 1y/3y/5y/10y（`sliceByRange`，`dataFetcher.js:1389-1394`）。问题全在前端：弹窗打开时 `idxModalTrendState.range` 固定为 `'1y'`（`index.html:7296`），`ensureModalTrendData` 只拉 1 年约 252 条数据；按钮 disabled 由 `getTrendDataCoverage` 按本地数据条数一次性判定（3y≥500、5y≥1000、10y≥2000 条）；`setIdxModalTrendRange` 切换时只做本地切片，不重新请求，数据不足时按钮永远禁用。
3. **池外指数详情空白**：候选池 `FULL_INDEX_POOL` 仅 22 个（`dataFetcher.js:22-195`）。`buildIndexConfig`（`dataFetcher.js:223-228`）`filter(Boolean)` 直接丢弃池外 code → `/api/indices` 不含池外指数 → 无 10 年 K 线、无 52w 统计、无动量；quotes 组装中 PE/PB（需 `poolCfg.djCode`）、动量（依赖 indices.json）对池外指数全 null；`/api/thermometer/detail` 对知有行未覆盖的指数返回 404。仅 K 线接口（`server.js:952-963` 动态构造 cfg）正常。

约束：保持现有缓存架构（内存/磁盘/stale 三级 + 并发去重）与编码约定（CommonJS、`fetch{Source}{DataType}` 命名、中文日志前缀）；前端为单文件 SPA，无构建工具。

## Goals / Non-Goals

**Goals:**
- 所有市场（A 股/港股/美股）指数在 quotes 接口中均返回有效的 `high52w`/`low52w`/`pricePosition52w`（有 K 线数据时）
- 详情弹窗趋势图 1y/3y/5y/10y 按钮可正常切换，切换后正确渲染对应区间
- watchlist 中的池外指数被纳入 `/api/indices` 历史数据构建，详情弹窗中可展示 52w、动量等可由 K 线推导的指标
- 温度计详情对未覆盖指数返回友好降级信息；前端对缺失字段优雅展示（"暂无数据"），不再整片空白

**Non-Goals:**
- 不为池外指数接入蛋卷 PE/PB 估值（无 djCode 映射，需人工维护映射表，另开变更处理）
- 不改动数据源 failover 链路结构与缓存 TTL 策略
- 不重构单文件前端架构

## Decisions

### 决策 1：52w 回填——解除市场限制，统一走 K 线统计回填

将 `fetchIndexQuotesForWatchlist` 中 `if (idx.market === 'US')` 的回填逻辑扩展为全市场：当行情源未提供 `high52w`/`low52w` 时，从 `indicesByCode`（indices.json 的 K 线统计）回填。

- **选择理由**：`fetchAllIndexData` 已为池内全市场指数算好 52w 统计，成本为零、数据一致性最高；东财 push2 的 52w 字段（f174/f175 等）未经全面验证，追加字段风险更高。
- **备选方案**：在东财请求 fields 中追加 52 周字段。放弃原因：东财内部字段语义不透明（参考已有的美股 secid 错位陷阱），K 线回填更可控。
- **兜底顺序**：行情源原生字段（腾讯 48/49）→ K 线统计回填 → null。两者并存，谁有值用谁。

### 决策 2：趋势切换——首次拉取全量 10y，前端本地切片

`ensureModalTrendData` 首次请求改为 `range=10y`（后端 `sliceByRange` 切片成本极低，K 线接口有内存缓存）；拿到全量序列后，前端 `getTrendSeries` 按当前 range 本地切片渲染；`setIdxModalTrendRange` 仅更新 range 并重绘，按钮 disabled 判定基于全量数据条数。

- **选择理由**：一次请求解决所有周期，避免每次切换的网络往返与 loading 闪烁；10y 约 2520 条 K 线，gzip 后传输量可控（现网美股卡片已用同量级数据）。
- **备选方案 A**：切换时按需请求对应 range。放弃原因：切换体验差（每次 loading），且按钮可用性仍无法提前判定。
- **备选方案 B**：依赖 `ensureFullIndexData()` 回填解锁按钮。放弃原因：时序不可靠（回填完成前打开弹窗即失效），且只覆盖池内指数。
- 池外指数数据不足 10 年时（新指数上市时间短），按钮按实际数据条数判定 disabled 属正常行为，tooltip 提示"历史数据不足"。

### 决策 3：池外指数——`buildIndexConfig` 支持 watchlist 动态配置

`buildIndexConfig` 对 POOL_MAP 未命中的 code，从 watchlist 条目动态构造最小配置 `{ code, name, market, secid }`，纳入 `/api/indices` 的 `fetchAllIndexData` 流程（拉 K 线、算 52w/动量、写 indices.json）。`fetchIndexQuotesForWatchlist` 中 PE/PB 等需 djCode 的字段对池外指数保持 null，其余由 K 线统计兜底。

- **选择理由**：复用现有数据采集与缓存管线，改动面最小；添加接口 `/api/indices/add` 无需同步等待，由缓存失效后的下一次 `fetchAllIndexData` 自然覆盖（selectedCodes hash 变化已会强制重算，`server.js:414-416`）。
- **备选方案**：添加接口内同步拉取历史数据。放弃原因：阻塞添加响应，且与现有异步刷新架构不一致。
- 温度计详情：知有行未覆盖的指数返回 200 + `{ supported: false, message: '该指数暂无温度数据' }`（替代 404），前端据此展示降级提示。API 行为变化但非破坏性（原 404 无有效消费者依赖）。

## Risks / Trade-offs

- [indices.json 体积增大（池外指数纳入 10 年 K 线）] → 单指数 10y 约 2520 条，关注列表上限 20 项，增量可控；磁盘缓存已有同类数据量级
- [池外指数首次添加后短暂无历史数据（需等一次刷新周期）] → 添加接口触发异步预热（fire-and-forget 调用 K 线获取），前端详情弹窗对 loading/空态做提示
- [10y 全量首拉略慢于 1y] → 后端切片前走内存/磁盘缓存，重复打开弹窗命中缓存；首拉增加 loading 态
- [池外指数 secid 来自搜索接口，若错误会导致 K 线失败] → 沿用 K 线接口现有的多级降级与错误返回，详情弹窗展示"行情数据加载失败"
- [温度计响应从 404 改为 200 降级体] → 前端同步适配；语义更清晰，旧行为（404）无下游依赖

## Migration Plan

1. 修改 `services/dataFetcher.js`（52w 回填、`buildIndexConfig`、温度计详情降级）
2. 修改 `public/index.html`（趋势切换逻辑、缺失字段降级展示）
3. 本地验证三个问题的修复效果后，按现有流程 `npm run pm2:restart` 重启即可
4. 回滚：纯代码变更，git revert 后重启服务；indices.json 新增的池外条目无副作用，无需清理

## Open Questions

- 无
