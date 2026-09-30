## 1. 搜索接口：市场推断与候选池匹配

- [x] 1.1 `services/dataFetcher.js` `searchIndex`（~2556-2590）：`MktNum=2/128` 时按代码特征区分 CSI（`secid` 前缀 `2.`）与 HI（`secid` 前缀 `100.`）
- [x] 1.2 生成结果前先按 code 在 `FULL_INDEX_POOL` 中跨市场查找，命中则用池内的 `market` / `secid` / `icon` / `category`
- [x] 1.3 验证：搜索「中证红利低波」返回 `market=CSI`、`secid=2.H30269`；搜索「恒生科技」仍返回 `market=HI`、`secid=100.HSTECH`

## 2. 添加接口：持久化估值映射

- [x] 2.1 `server.js` `/api/indices/add`（~1085-1107）：命中 `POOL_MAP` 时用池内 `market` / `secid` 校正入参
- [x] 2.2 把候选池的 `djCode` / `csCode` 一并写入 watchlist 条目
- [x] 2.3 `services/dataFetcher.js` `fetchIndexQuotesForWatchlist`（~2838）：蛋卷匹配键改为 `idx.djCode ?? poolCfg?.djCode`
- [x] 2.4 验证：添加创业板指后 watchlist 含 `djCode: 'SZ399006'`，`/api/indices/quotes` 返回其 PE / PB

## 3. 行情接口：估值二级数据源兜底

- [x] 3.1 `fetchIndexQuotesForWatchlist` 中蛋卷未命中时调用 `fetchTiantianValuationMap()`，按 `[code, csCode, djCode]`（大写）匹配
- [x] 3.2 命中后填充 `pe` / `pb` / `pePercentile` / `pbPercentile`；`pePercentile` 可用时按现有阈值推导 `evaType`（<30 low / <70 mid / 否则 high）
- [x] 3.3 受数据源开关 `tiantian` 控制：关闭时跳过兜底，退化为原行为
- [x] 3.4 验证：添加一个池外 A 股指数，确认返回 PE / PB；关闭天天基金数据源后该字段回到 null 且不报错

## 4. 拖拽排序持久化

- [x] 4.1 `public/index.html` `initCardDnD` index 分支（~8553）：发送前剥离 code 的市场后缀（`/\.[A-Z]{2,5}$/`）
- [x] 4.2 `server.js` `/api/indices/reorder`（~1149）：入参 codes 做同样归一化后再匹配，兼容裸码与带后缀两种写法
- [x] 4.3 reorder 成功后删除 `index-quotes` 内存缓存并异步 `getCachedIndexQuotes(true)`，与 add / remove 保持一致
- [x] 4.4 验证：管理员拖拽后刷新页面顺序保持；非管理员仍不可拖拽

## 5. 端到端回归

- [x] 5.1 管理员登录：添加池内指数、中证系指数、池外指数各一个，确认三者行情正常，估值字段按能力取到（至少 PE / PB）
- [x] 5.2 拖拽排序 → 刷新 → 顺序保持；再切到其他 Tab 返回仍保持
- [x] 5.3 确认已有指数（含美股、港股）的估值与行情字段无回归
- [x] 5.4 控制台无报错，`/api/indices/quotes` 响应时间无明显变长
