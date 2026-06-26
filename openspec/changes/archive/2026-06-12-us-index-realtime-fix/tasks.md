## 1. 后端 — POOL_MAP 与 secid 修复

- [x] 1.1 在 `services/dataFetcher.js` 的 `POOL_MAP` / `FULL_INDEX_POOL` 中将 `NDX.US` 的 `secid` 由 `'100.NDX'` 改为 `'100.NDX100'`，并新增 `altSecids: ['100.NDX']` 字段保留旧值
- [x] 1.2 检查 `buildIndexKlineProfile()` 是否正确读取 `cfg.altSecids` 用于 K 线兜底链（已支持，确认无需改动）
- [x] 1.3 同步把 `data/index-watchlist.json` 中 `NDX` 的 `secid` 从 `100.NDX` 改为 `100.NDX100`（虽 POOL_MAP 优先级更高，仍统一）
- [x] 1.4 [意外发现 + 修复] 腾讯 K 线接口 `us.NDX`（带点）2026-06 起被错误绑定到德尼克斯投资 (DX.N)，必须改为 `usNDX`（不带点）才能拿到真正的纳斯达克 100 K 线 → 修改 `POOL_MAP['NDX.US'].txKlineCode: 'us.NDX' → 'usNDX'`

## 2. 后端 — fetchRealtimeQuotes 按 market 分流

- [x] 2.1 改造 `fetchRealtimeQuotes(allConfigs)`：在最前置增加美股优先腾讯通道，将 `usConfigs` 从 `allConfigs` 中剥离后单独走 `fetchRealtimeQuotesTencent → fetchRealtimeQuotesEastmoney → fetchSingleQuoteSina` 三级链
- [x] 2.2 A 股 / 港股 / CSI configs 走原有"东财主源 → 腾讯补漏 → 新浪兜底"链路（保留全部既有行为，仅把 `allConfigs.filter` 替换为 `otherConfigs`）
- [x] 2.3 在每条美股 quote 上挂 `_quoteSource`（`'tencent'` / `'eastmoney'` / `'eastmoney-mismatch'` / `'sina'`）与 `_quoteFetchedAt`（ISO）

## 3. 后端 — 东财响应 secid/name 自检

- [x] 3.1 新增 `checkUsQuoteNameMatch(cfg, actualName)` helper：要求 `cfg.name` 是 `actualName` 的子串或相等（如"纳斯达克100" ⊄ "纳斯达克" 拒绝）
- [x] 3.2 在 `fetchRealtimeQuotesEastmoney()` 解析每条 `data.diff[i]` 时调用 helper，不一致时输出 `console.warn('[美股映射] <code> 期望"<expectedName>"但东财返回"<actualName>"...')`，跳过该条（不写入 `quotes`）
- [x] 3.3 自检逻辑只对美股（`cfg.market === 'US'`）启用，避免误伤 A 股/港股的别名差异
- [x] 3.4 当美股因自检被丢弃且没有腾讯/新浪兜底时，外层路由通过模块级 `_eastmoneyMismatchNotes` sideband 构造占位 quote，标记 `_quoteSource = 'eastmoney-mismatch'` + `_staleNote`

## 4. 后端 — indices.json 启动体检

- [x] 4.1 在 `loadIndicesCacheMap()` 末尾增加美股一致性检测：对每个美股指数，比较 `historySeries.tail.close` 与 `cachedPrice`，偏差 > 5% 则标记 `_needsForceRefresh = true` 并 `console.warn('[美股映射]')`
- [x] 4.2 在 `fetchIndexQuotesForWatchlist()` 加载缓存后，过滤出 `_needsForceRefresh` 的美股触发 `triggerLazyUSKlineRefresh()`（不阻塞当前响应）
- [x] 4.3 在美股 enriched 使用环节增加保护：被标记的条目不参与 `high52w/low52w/sparkData/momentum` 计算，避免错位数据泄漏到当次响应

## 5. 后端 — 响应字段透出

- [x] 5.1 `fetchAllIndexData()` 在美股 result 上挂 `quoteSource`、`quoteFetchedAt`、`staleNote`（仅美股市场）
- [x] 5.2 `fetchIndexQuotesForWatchlist()` 同步挂这三个字段，A 股/港股不输出（保持向后兼容）
- [x] 5.3 module.exports 无需新增（字段在响应中自动透出）

## 6. 前端 — 美股卡片可选展示数据源

- [x] 6.1 在 `public/index.html` 的 `buildIndexQuoteCard()` 中，仅当 `idx.market === 'US'` 且 `idx.quoteSource` 存在时，在卡片底部追加「来源 <中文名> · HH:MM」小行
- [x] 6.2 当 `idx.quoteSource === 'eastmoney-mismatch'` 或 `idx.staleNote` 存在时，复用 `.thermo-stale-badge` 样式渲染「⚠️ 数据可能不准」徽章
- [x] 6.3 复用既有 `.yzyx-fetched-at` / `.thermo-stale-badge` CSS（无需新增样式）

## 7. 联调与回归

- [x] 7.1 本地启动（PORT=3214）→ `/api/indices/quotes?refresh=1` 返回：SPX.US **price=7394.30**、NDX.US **price=29446.18**（与腾讯 `qt.gtimg.cn/q=us.SPX,us.NDX` 完全一致）
- [x] 7.2 美股响应字段含 `quoteSource: 'tencent'`、`quoteFetchedAt: <ISO>`
- [x] 7.3 启动日志可见 `[美股映射] NDX.US 缓存自检：historySeries.tail=12.9 与 price=29446.18 偏差 100.0% > 5%，将异步刷新 K 线`，体检逻辑正常工作
- [x] 7.4 触发 lazy refresh 后 `data/cache/indices.json` 中 NDX historySeries.tail=2026-06-11 close=29446.18，本次完整刷新成功
- [x] 7.5 A 股/港股回归：沪深 300/中证 500/中证红利数据正常，且响应中**未出现** `quoteSource` 字段（符合 design D5）
- [x] 7.6 NDX 的 52w 区间 `[21532.32, 30762.20]` 已是真正的纳斯达克 100 范围（与腾讯一致），不再是综合指数的 `[19334, 27190]`
- [x] 7.7 NDX K 线 historySeries.len=252 条，最新点 close=29446.18 与实时价完全一致；4 周期动量全部填上（m1m=+0.27% / m3m=+20.78% / m6m=+14.24% / m1y=+34.70%）

## 8. 部署与文档

- [x] 8.1 `npm run package:deploy` 生成 `dale-compass-20260612-110455.tar.gz`（2026-06-12 11:04）
- [x] 8.2 上传 `43.136.122.239:/data/dale-compass/`、PM2 重启 PID=4725 online；启动日志无 `[美股映射]` 告警（启动时 fetchAllIndexData 用新 POOL_MAP 直接拉取真值，未触发体检）
- [x] 8.3 线上 `curl http://127.0.0.1:3200/api/indices/quotes` 验证：SPX.US=7394.30、**NDX.US=29446.18**、52w[21532.32, 30762.20]、m1y=+34.70%、quoteSource=tencent
- [x] 8.4 在 `CODEBUDDY.md` 的"数据源概览"补充：腾讯行情作为美股指数主源，含 52w/动量/换手字段
- [x] 8.5 在 `CODEBUDDY.md` "注意事项"区段新增第 7 条：美股指数 secid 陷阱（东财 `100.NDX` ≠ 纳指 100；腾讯 K 线 `us.NDX` 也错位需用 `usNDX`），并指出后端已加 name 自检
