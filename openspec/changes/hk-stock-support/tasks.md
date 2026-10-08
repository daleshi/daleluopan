## 1. 搜索支持港股

- [ ] 1.1 `services/stockFetcher.js` `searchStock`：过滤放宽为 5 位或 6 位，按 `MktNum` 映射市场（`0`→SZ、`1`→SH、`116`→HK），港股 secid 为 `116.<5位>`
- [ ] 1.2 排除港股非正股：名称含「购 / 沽 / 牛 / 熊 / -R」的窝轮与人民币柜台；沿用 ETF / LOF / 基金过滤
- [ ] 1.3 搜索结果增加 `marketLabel`（A 股 / 港股）
- [ ] 1.4 兜底分支：5 位数字输入识别为港股（`market=HK`、`secid=116.<5位>`）
- [ ] 1.5 实测：搜索「腾讯」「00700」「阿里」均能返回港股正股

## 2. 添加与移除

- [ ] 2.1 `server.js` `/api/stocks/add`：market 白名单 `SH / SZ / HK`
- [ ] 2.2 按市场校验代码与 secid（SH/SZ 6 位 `^[01].` ；HK 5 位 `^116.`），非法返回 400 并说明
- [ ] 2.3 判重改为「code + market」
- [ ] 2.4 `/api/stocks/remove` 支持传 market（兼容只传 code）；`/api/stocks/watchlist` 批量接口同步白名单与格式校验
- [ ] 2.5 拖拽排序接口支持带市场后缀的 code（前端传 `fullCode`）

## 3. 行情与交易时段

- [ ] 3.1 `services/stockFetcher.js` 腾讯备用行情源增加 `hk` 前缀
- [ ] 3.2 新增 `_detectStockWatchlistMarkets()`（读股票 watchlist，`HK`/`HI` → `HK`）
- [ ] 3.3 `/api/stocks` 的 `trading` 与 `getCacheTTL('stocks')` 按识别出的市场判断
- [ ] 3.4 实测：港股时段内股票页按交易时段 TTL 刷新，A 股收盘后港股仍刷新

## 4. 采集进程与历史库

- [ ] 4.1 `services/db/repo.js`：股票 `guessValuationSource` 对 HK 返回 `quote_snapshot`
- [ ] 4.2 `services/collector/sources.js` `fetchTencentKlines` 增加 `hk` 前缀（不复权，与 `stockFetcher` 口径一致）
- [ ] 4.3 `services/collector/jobs.js`：日 K 兜底把 `market === 'HK'` 纳入腾讯可覆盖范围
- [ ] 4.4 收盘任务：把 `quote_snapshot` 源的股票（港股）PE / PB 按当日写入 `valuation_daily`
- [ ] 4.5 实测：港股个股出现在库中镜像（market=HK、secid=116.00700），日 K 与 PE / PB 记录正常

## 5. 页面

- [ ] 5.1 搜索结果显示市场标签（港股）
- [ ] 5.2 股票卡片代码显示完整代码（如 `00700.HK`）
- [ ] 5.3 港股金额、市值标注港元
- [ ] 5.4 「PE / PB 历史走势」对无历史估值数据源的市场给出明确提示（自 X 起积累）

## 6. 测试与上线

- [ ] 6.1 更新 `tests/stocks.test.js`：原「代码非6位时返回错误」改为按市场校验（5 位 + `SH` 应失败；5 位 + `HK` + `116.` 应成功）
- [ ] 6.2 新增港股 fixture（`00700 / HK / 116.00700`）
- [ ] 6.3 跑 `npm test` 与 ESLint
- [ ] 6.4 本地 db 模式端到端：搜索 → 添加 → 行情与 52 周 → 走势图 → 删除
- [ ] 6.5 发布到生产，添加腾讯控股（00700），港股时段观察刷新与收盘日 K
