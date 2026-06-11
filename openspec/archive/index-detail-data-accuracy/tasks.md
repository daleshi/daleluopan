## 1. 增强前端 _inferMarket(d) 市场推断逻辑（public/index.html）

- [x] 1.1 在 `public/index.html` 中找到 `_inferMarket(d)` 函数（约 6856 行），增强推断逻辑
- [x] 1.2 优先级 1：若 `d.market` 存在且为合法值（SH/SZ/HI/US/CSI），直接返回 `d.market`
- [x] 1.3 优先级 2：若 `d.secid` 存在，根据 secid 前缀判断：`100.` → `US`，`1.` → `SH`，`0.` → `SZ`，`2.` → `CSI`，否则 → `US`
- [x] 1.4 优先级 3：若 `d.code` 匹配已知美股指数正则（`/^(SPX|NDX|DJI|VIX)$/i`），返回 `US`
- [x] 1.5 优先级 4：在 `indexQuotesData`、`dashboardData`、`indexData` 三个数据池中查找 `i.code === d.code` 且 `i.market` 存在的项，若找到则返回该 `i.market`
- [x] 1.6 兜底：返回 `'SH'`

## 2. 增强后端 K 线 API 市场后缀模糊匹配（server.js）

- [x] 2.1 在 `server.js` 中找到 `GET /api/indices/:code/klines` 路由（约 937 行）
- [x] 2.2 在精确匹配（`POOL_MAP[fullCode]`）和 watchlist 查找都失败后，增加模糊匹配逻辑
- [x] 2.3 模糊匹配：对常见市场后缀（`.US`、`.SH`、`.SZ`、`.HI`、`.CSI`）依次构造候选 `candidateFullCode`，使用 `POOL_MAP` 和 watchlist 查找
- [x] 2.4 若找到匹配项，使用该配置的 market 继续后续逻辑
- [x] 2.5 若所有模糊匹配都失败，返回 404（现有行为），但增加 `detail` 字段说明失败原因

## 3. 修复美股指数数据准确性（services/dataFetcher.js）

- [x] 3.1 检查 `fetchAllIndexData()` 函数（约 1498 行），确认美股指数（SPX、NDX）的 `pe`、`pb`、`dividend`、`roe` 字段处理
- [x] 3.2 若 Yahoo Finance 的 PE 数据不可靠，改为使用 `usValuation.peHistoricalMedian` 计算百分位，并在前端标注"估值参考历史中位数"
- [x] 3.3 检查 `fetchIndexQuotesForWatchlist()` 函数（约 2379 行），确认美股指数的 `price`、`change` 字段从腾讯行情正确获取
- [x] 3.4 `price` 数据已从腾讯行情正确获取（通过 `usSPX`、`usNDX` 代码），无需修改

## 4. 增强 K 线加载错误处理（public/index.html + server.js）

- [x] 4.1 修改后端 `/api/indices/:code/klines`，在返回 `success: false` 时，在响应体中增加 `detail` 字段，说明具体失败原因
- [x] 4.2 修改前端 `ensureModalTrendData(d)` 函数，在 catch 块中将 `err.message` 和 `json.detail`（若有）合并为用户友好的错误提示
- [x] 4.3 修改前端 `renderIdxModalTrend(d)` 的 error 分支，显示详细错误信息，并保留重试按钮

## 5. 增加数据时效性透明化（public/index.html）

- [x] 5.1 在指数详情模态框的"关键估值指标"区域，若 `d.updateTime` 存在，在数据源信息行显示更新时间戳
- [x] 5.2 在"区间走势分析"区域的数据源行，显示 K 线数据的获取时间戳（`json.data.fetchedAt`）
- [ ] 5.3 在行情区域的价格旁边，显示 `d.updateTime`（来自 `/api/indices/quotes` 的响应时间）- **待优化**

## 6. 验证与回归测试

- [ ] 6.1 本地启动服务（`npm start`），以管理员身份登录
- [ ] 6.2 点击 A 股指数（沪深 300），验证 K 线数据能正确加载，且 PE/价格数据准确
- [ ] 6.3 点击港股指数（恒生科技），验证 K 线数据能正确加载
- [ ] 6.4 点击美股指数（标普 500、纳斯达克 100），验证 K 线数据能正确加载，且 PE/价格数据准确（对比 Yahoo Finance 官网）
- [ ] 6.5 模拟网络故障（DevTools → Network → Offline），点击指数，验证 error UI 显示详细错误信息且重试按钮可用
- [ ] 6.6 部署到生产服务器，验证所有场景正常工作
