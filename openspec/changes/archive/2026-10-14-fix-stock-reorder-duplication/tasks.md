## 1. 修复重排接口

- [x] 1.1 `server.js` `/api/stocks/reorder`：兜底追加判断改为 `codesSet.has(s.code) || codesSet.has(stockKey(s))`，同时认裸 code 与 fullCode
- [x] 1.2 构建 `reordered` 时用 `seen`（key = `code.market`）去重，抵御 `codes` 本身含重复项
- [x] 1.3 本地复现验证：5 条列表用 fullCode reorder 后仍为 5 条，顺序与提交一致；再 reorder 一次仍为 5 条

## 2. 读取侧自愈

- [x] 2.1 `services/stockFetcher.js` `readWatchlist()` 按「代码 + 市场」去重，发现重复时打印 `[股票] 关注列表存在重复项，已自动去重: N → M`
- [x] 2.2 去重结果为空时回退返回原始列表，避免清空
- [x] 2.3 确认该去重只在读取生效，落盘仍由既有写操作触发

## 3. 回归测试

- [x] 3.1 `tests/stocks.test.js` 新增 `POST /api/stocks/reorder` 用例组：未登录 401、非数组 400
- [x] 3.2 新增「用 fullCode 重排不翻倍」：断言条数不变、顺序等于提交、无重复
- [x] 3.3 新增「用裸 code 重排不翻倍」
- [x] 3.4 `npx jest tests/stocks.test.js` → 23/23 通过

## 4. 数据清洗与部署

- [x] 4.1 生产备份 `data/stock-watchlist.json` 为 `data/stock-watchlist.json.bak.<时间戳>`
- [x] 4.2 生产清洗 96 → 10（取前半段去重以保留最后一次拖拽顺序），确认 ETF 6/6 与指数 14/14 未受影响
- [x] 4.3 本地 `data/stock-watchlist.json` 同样去重（测试期间曾膨胀到 10 条），并补回测试删除的长江电力 600900
- [x] 4.4 `npm run package:deploy` → 部署 → `pm2 restart dale-compass`
- [x] 4.5 线上抽样：`/api/stocks/watchlist` 返回 10 条，`error.log` 无异常，进程 online

## 5. 浏览器验证删除

- [x] 5.1 管理员点击长江电力 600900 的删除按钮，确认只发一次 `POST /api/stocks/remove`（`{"code":"600900","market":"SH"}`）且只移除这一只
