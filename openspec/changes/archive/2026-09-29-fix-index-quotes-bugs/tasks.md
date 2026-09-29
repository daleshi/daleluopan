## 1. 后端：52 周高低点全市场回填（Bug 1）

- [x] 1.1 修改 `services/dataFetcher.js` 中 `fetchIndexQuotesForWatchlist`（~2853 行）：解除 `idx.market === 'US'` 限制，所有市场指数在行情源未提供 `high52w`/`low52w` 时统一从 `indicesByCode` K 线统计回填
- [x] 1.2 确认回填兜底顺序：行情源原生字段（腾讯 48/49）→ K 线统计回填 → `null`，并同步校验 `pricePosition52w` 计算逻辑对回填值生效
- [x] 1.3 重启服务验证：请求 `/api/indices/quotes`，确认沪深 300 等 A 股指数返回有效 `high52w`/`low52w`，前端基金总览指数卡片与详情弹窗 52 周高/低显示数值

## 2. 后端：池外指数纳入数据构建（Bug 3 后端部分）

- [x] 2.1 修改 `services/dataFetcher.js` 中 `buildIndexConfig`（~223 行）：POOL_MAP 未命中的 watchlist code 使用 watchlist 条目 `{code, name, market, secid}` 动态构造配置，纳入 `fetchAllIndexData`
- [x] 2.2 修改 `fetchIndexQuotesForWatchlist`：池外指数的动量/52w 字段由 K 线统计兜底，PE/PB/百分位保持 `null`（无 djCode 映射）
- [x] 2.3 修改 `server.js` 中 `/api/indices/add`（~1069 行）：写入 watchlist 后 fire-and-forget 触发新指数历史数据异步预热，不阻塞响应
- [x] 2.4 修改 `/api/thermometer/detail`（`server.js` ~1309 行 + `dataFetcher.js` ~2387 行）：知有行未覆盖指数返回 HTTP 200 + `{ supported: false, message: '该指数暂无温度数据' }` 替代 404
- [x] 2.5 验证：添加一个池外指数（secid 有效），等待/触发刷新后确认 `/api/indices` 包含该指数且 indices.json 写入其条目；无效 secid 场景不影响其他指数

## 3. 前端：趋势周期切换修复（Bug 2）

- [x] 3.1 修改 `public/index.html` 中 `ensureModalTrendData`（~7226 行）：首次请求改为 `range=10y` 全量加载
- [x] 3.2 修改 `setIdxModalTrendRange`（~7570 行）：仅更新 range 并本地切片重绘，不重复请求；确保重绘后按钮激活态正确
- [x] 3.3 确认 `buildIdxModalBody`（~7355 行）按钮 disabled 判定基于全量数据条数（3y≥500/5y≥1000/10y≥2000），数据不足按钮附"历史数据不足"提示
- [x] 3.4 K 线加载失败时趋势区展示"行情数据加载失败"，不阻塞弹窗其余内容

## 4. 前端：缺失数据优雅降级

- [x] 4.1 详情弹窗对 `null` 的 PE/PB/温度/52w 字段统一展示"暂无数据"降级文案
- [x] 4.2 适配温度计详情新降级响应（`supported: false`），展示"该指数暂无温度数据"

## 5. 端到端验证

- [x] 5.1 启动本地服务，验证 Bug 1：基金总览/指数实时行情各指数 52 周最高/最低均显示数值
- [x] 5.2 验证 Bug 2：详情弹窗趋势图 1y/3y/5y/10y 可正常切换，切换即时无 loading
- [x] 5.3 验证 Bug 3：新添加指数（池内如创业板指 399006 + 池外如中证红利）详情弹窗信息完整（池外指数估值类字段为降级文案）
- [x] 5.4 检查日志无新增报错，缓存读写正常
