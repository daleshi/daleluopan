## Context

排查后确认的两条根因链：

**估值缺失**：`/api/indices/quotes` → `fetchIndexQuotesForWatchlist`（services/dataFetcher.js:2768）中 PE/PB/百分位/roe/dividend/evaType 只有一个赋值点（2841 行 `if (poolCfg && poolCfg.djCode && djEvaMap[poolCfg.djCode])`）。搜索接口 `searchIndex`（2528）返回的条目只有 `code / name / market / secid / icon / category`，没有 `djCode`；`/api/indices/add`（server.js:1085）写 watchlist 时也不保存 `djCode`。于是 `POOL_MAP[code.market]` 查不到 → 估值全 `null`。前端 `buildIndexQuoteCard`（public/index.html:6654）对空值采取"整行不渲染"（6732-6765 的 PE 行、PB 行、百分位进度条都在有值时才输出），所以视觉上表现为卡片少了好几块。

雪上加霜的是 market 误判：`searchIndex` 2556-2576 把 `MktNum=2/128` 一律映射为 `market='HI'`、`secid='100.xxx'`，而候选池里中证系指数是 `market='CSI'`、`secid='2.xxx'`（如 H30269，dataFetcher.js:86-91）。添加后 watchlist 里 market 变成 `HI`，`POOL_MAP['H30269.HI']` 命中失败 → 连行情都取不到（现有缓存文件 `data/cache/index-quotes.json` 里 H30269 的 `price: null` 是佐证）。

**排序不保存**：`initCardDnD`（index.html:8481）的 index 分支在 8553 行 `indexQuotesData.map(i => i.code)` 拿到的是**带后缀**的 code（`000300.SH`，由 dataFetcher.js:2956-2960 拼装），而 watchlist 里存的是裸 code。后端 `/api/indices/reorder`（server.js:1149）用裸 code 建 Map（1156），`map.get('000300.SH')` 全为 undefined → `filter(Boolean)` 后为空 → 1159-1160 的兜底把原数组按原顺序全部写回。加上 reorder 完全没有缓存失效（对比 add/remove 的 1103、1135 行），即使写对了，刷新时 `smartCacheGet` 仍会返回旧顺序（休市 TTL 30 分钟）。

约束：保持现有缓存架构与数据源开关机制；天天基金估值函数 `fetchTiantianValuationMap`（dataFetcher.js:659）已存在且带 5 分钟缓存，`fetchComparisonSources` 里已有 `[cfg.code, cfg.csCode, cfg.djCode]` 的匹配模式可复用。

## Goals / Non-Goals

**Goals:**
- 搜索添加指数后，行情接口能返回与同类指数一致的估值字段；市场/代码归属判断正确，行情不再取不到
- 拖拽排序持久化到 watchlist，刷新页面后保持新顺序
- 蛋卷未覆盖时的二级数据源可开关、可降级，不给接口增加失败点

**Non-Goals:**
- 不计算池外指数的历史百分位（需要 10 年 PE 序列，天天基金只给当前百分位，能拿到就用，拿不到留空）
- 不改动 ETF / 股票 / 基金的拖拽逻辑（它们的分支本来就是剥离后缀的）
- 不为池外指数接入中证官网估值（现有 `fetchCSIndexValuation` 是无调用点的死代码，本次不动）
- 不改前端卡片布局，只让字段在有值时按现有样式渲染

## Decisions

### D1：估值兜底用天天基金，且只在蛋卷未命中时调用

**选择**：在 `fetchIndexQuotesForWatchlist` 中，蛋卷未命中时调用 `fetchTiantianValuationMap()`，按 `[idx.code, idx.csCode, watchlist.djCode]`（大写）依次匹配，取到就填 PE / PB / pePercentile / pbPercentile；`evaType` 在 pePercentile 可用时按现有阈值（<30 low、<70 mid、否则 high）推导，否则为 null。

**理由**：`fetchTiantianValuationMap` 已实现、带 5 分钟缓存、且已在 `/api/indices` 的多源对比里使用过（`fetchComparisonSources` 759-770），接入风险低。只在蛋卷未命中时调用，对现有指数零额外请求。
**备选方案**：接中证官网 `fetchCSIndexValuation`。放弃原因：它是死代码、未经线上验证、且只按 csCode 匹配，覆盖面和稳定性都不如已在使用的数据源。
**兜底顺序**：蛋卷（djCode）→ 天天基金（code/csCode/djCode）→ 全 null。数据源开关里 `tiantian` 关闭时跳过兜底，退化为原行为。

### D2：djCode 持久化到 watchlist，并让 quotes 优先读取

**选择**：`/api/indices/add` 命中候选池时写入 `djCode` / `csCode`；`fetchIndexQuotesForWatchlist` 中 `poolCfg?.djCode ?? idx.djCode` 作为蛋卷匹配键。

**理由**：一旦 watchlist 自带 djCode，即使某天候选池里该指数的配置调整，已添加的指数也能继续拿到估值；同时为"人工给池外指数补映射"留出位置（后续可手动补，不必改代码）。
**风险**：旧 watchlist 项没有 djCode 字段 → 回退到候选池，行为与现在一致，向后兼容。

### D3：market 推断按代码特征区分 CSI / HI，并按 code 跨市场查候选池

**选择**：`MktNum=2/128` 时，若代码匹配港股特征（`/^(HSI|HSTE|HSCE|HSSC|HK)/i`）→ `HI` + `100.xxx`，否则 → `CSI` + `2.xxx`；另外在生成结果前先按 code 在 `FULL_INDEX_POOL` 里查一次（不限制 market），命中就用池里的 `market` / `secid` / `icon` / `category`。

**理由**：跨市场查池能一次性解决所有"池内指数被判成别的市场"的情况，不只是 CSI/HI 这一种；MktNum 修正覆盖池外指数。
**备选方案**：只改 MktNum 映射。放弃原因：无法覆盖池内指数被判错市场的其他情形（如 secid 前缀差异）。

### D4：reorder 双端归一化 + 缓存失效

**选择**：前端 8553 行改为剥离 `/\.[A-Z]{2,5}$/`；后端在匹配前对入参 codes 做同样归一化，并对 watchlist 项同时建"裸码 → 项"的索引；成功后 `delete _smartCache['index-quotes']` 并异步 `getCachedIndexQuotes(true)`。

**理由**：双端归一化保证任何一端改动都不会再次静默失效；缓存失效与 add / remove 保持同一种写法，刷新后立即看到新顺序。
**备选方案**：只改后端。放弃原因：前端发的仍是错误格式，语义上不对，且规格里明确要求裸码。

### D5：不改 hashCodes 的顺序敏感性

`getCachedData` 的 `hashCodes`（server.js:399-401）用 `sort()` 只比集合。纯顺序变化不会触发 `/api/indices` 重算，但卡片顺序由 quotes 决定（quotes 顺序 = watchlist 顺序），所以不影响本问题。保持现状，避免引入不必要的全量重算。

## Risks / Trade-offs

- [天天基金接口波动] → 已有 5 分钟失败冷却与降级逻辑；取不到时字段为 null，前端按现有逻辑不渲染该行，不报错
- [池外指数百分位仍可能为空] → 天天基金不覆盖时百分位为 null，`evaType` 也为 null，卡片该区域不渲染（与当前行为一致，不会显示错误数值）
- [watchlist 新增 djCode 字段] → 旧数据无此字段时回退候选池，无迁移成本；`writeIndexWatchlist` 全量覆盖写入，格式变化向后兼容
- [reorder 缓存失效增加一次行情刷新] → 仅在管理员拖拽后触发一次，与 add / remove 同量级
- [修改 market 推断可能影响已添加的池外指数] → 已存在的 watchlist 项不会被回溯改写，只有新添加的受影响；如个别指数推断仍不准，可手动补 `djCode`

## Migration Plan

1. 改后端：`searchIndex` 映射 + 跨市场查池、`/api/indices/add` 持久化、`fetchIndexQuotesForWatchlist` 兜底、`/api/indices/reorder` 归一化 + 缓存失效
2. 改前端：拖拽保存剥离后缀
3. 本地验证：添加一个池外 A 股指数与中证系指数，确认估值和行情都返回；拖拽后刷新确认顺序保持
4. 上线：`npm run pm2:restart`（纯代码变更，无需数据迁移）
5. 回滚：git revert 后重启；watchlist 多出的 `djCode` 字段无副作用，无需清理

## Open Questions

- 无
