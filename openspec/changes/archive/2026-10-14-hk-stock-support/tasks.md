## 1. 搜索支持港股

- [x] 1.1 `services/stockFetcher.js` `searchStock`：过滤放宽为 5 位或 6 位，按 `MktNum` 映射市场（`0`→SZ、`1`→SH、`116`→HK），港股 secid 为 `116.<5位>`
- [x] 1.2 排除港股非正股：名称含「购 / 沽 / 牛 / 熊」的窝轮，名称匹配 `/-W?R\b/` 的人民币柜台（`-R` / `-WR`）；沿用 ETF / LOF / 基金过滤
- [x] 1.3 搜索结果增加 `marketLabel`（A 股 / 港股）
- [x] 1.4 兜底分支：5 位数字输入识别为港股（`market=HK`、`secid=116.<5位>`）
- [x] 1.5 实测：搜索「腾讯」「00700」「阿里」「小米」均返回港股正股，`81810 小米集团-WR` 已被剔除

## 2. 添加与移除

- [x] 2.1 `server.js` `/api/stocks/add`：market 白名单 `SH / SZ / HK`（新增 `validateStockRef()` 统一校验）
- [x] 2.2 按市场校验代码与 secid（SH/SZ 6 位 `^[01].` ；HK 5 位 `^116.`，不足 5 位补前导零），非法返回 400 并说明
- [x] 2.3 判重改为「code + market」（`stockKey()`）
- [x] 2.4 `/api/stocks/remove` 支持传 market（兼容只传 code）；`/api/stocks/watchlist` 批量接口同步白名单与格式校验
- [x] 2.5 拖拽排序接口支持带市场后缀的 code（前端传 `fullCode`，后端同时按 code 与 code.market 建索引）

## 3. 行情与交易时段

- [x] 3.1 `services/stockFetcher.js` 腾讯备用行情源增加 `hk` 前缀
- [x] 3.2 新增 `_detectStockWatchlistMarkets()`（读股票 watchlist，`HK`/`HI` → `HK`，其余 → `CN`）
- [x] 3.3 `/api/stocks` 的 `trading` 与 `getCacheTTL('stocks')` 按识别出的市场判断
- [x] 3.4 实测：关注列表含港股时 `_detectStockWatchlistMarkets()` 返回 `['CN','HK']`，`trading` 随之判定

## 4. 采集进程与历史库

- [x] 4.1 `services/db/repo.js`：股票 `guessValuationSource` 对 HK 返回 `quote_snapshot`
- [x] 4.2 `services/collector/sources.js` `fetchTencentKlines` 增加 `hk` 前缀（不复权，与 `stockFetcher` 口径一致）
- [x] 4.3 `services/collector/jobs.js`：日 K 兜底把 `market === 'HK'` 纳入腾讯可覆盖范围
- [x] 4.4 收盘任务：把 `quote_snapshot` 源的股票（港股）PE / PB 按当日写入 `valuation_daily`（写入时 source 取 `inst.valuation_source`）
- [x] 4.5 实测：库中镜像 `stock:00700.HK`（secid=116.00700、valuation_source=quote_snapshot）✅；`fetchTencentKlines('00700','HK')` 返回 246 条日 K ✅

## 5. 页面

- [x] 5.1 搜索结果显示市场标签（港股）
- [x] 5.2 股票卡片代码显示完整代码（如 `00700.HK`），标题带「港股」标签
- [x] 5.3 港股金额、市值标注港元
- [x] 5.4 「PE / PB 历史走势」对无历史估值数据源的市场给出明确提示（自接入之日起逐日积累，历史不回补）

## 6. 测试与上线

- [x] 6.1 更新 `tests/stocks.test.js`：原「代码非6位时返回错误」改为按市场校验（5 位 + `SH` 应失败；5 位 + `HK` + `116.` 应成功），并补不支持市场 / 港股判重 / A股港股共存 / 带 market 删除用例（19/19 通过）
- [x] 6.2 新增港股 fixture `testHkStock`（用不可能真实存在的 `99999`，避免与真实关注冲突）
- [x] 6.3 跑 `npx jest`：`tests/stocks.test.js` 19/19 通过。⚠️ 全量 6 个套件（`activeFundStrategy` / `etfStrategy` / `goldStrategy` / `position` / `sp500Strategy` / `strategy`）失败，均为 `05dce25` 删除策略路由导致的既有失败，与本次变更无关；项目无 ESLint 配置
- [x] 6.4 端到端：搜索 → 添加 → 行情与 52 周（浏览器实测 + curl 实测）；生产库 `stock:00700.HK` 镜像正确，`kline_daily` 2654 条 / 最后日期 2026-10-13
- [x] 6.5 发布到生产（打包 + 部署 + PM2 重启两个进程），已添加腾讯控股（00700.HK），生产 `/api/stocks` 返回其行情（price 417 / -1.93%）；港股当日 PE / PB 待收盘任务写入
