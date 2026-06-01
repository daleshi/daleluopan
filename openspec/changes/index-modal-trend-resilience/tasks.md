## 1. 后端轻量 K 线接口（server.js）

- [x] 1.1 在 `/api/indices/quotes` 之后新增路由 `GET /api/indices/:code/klines`（公开，参数为完整 code 含市场后缀）
- [x] 1.2 路径参数解析：`req.params.code` → 形如 `'SPX.US'`；验证非空，不含特殊字符
- [x] 1.3 查找 cfg：先查 `POOL_MAP[fullCode]`，找不到则从 `readIndexWatchlist()` 动态构造（含 `{ name, code, market, secid }`）
- [x] 1.4 调用 `fetchIndexHistory(cfg)` 获取 `{ klines, status }`
- [x] 1.5 成功响应：`{ success: true, data: { code, historySeries: klines.map(k => ({date,open,close,high,low,...})), source: status.source, sourceLabel: status.label, stale: !!status.usedStaleCache, fetchedAt: ISOString } }`
- [x] 1.6 找不到 cfg 返回 404 + `{ success: false, error: '指数不存在或不在关注列表' }`
- [x] 1.7 fetchIndexHistory 返回空 klines 时返回 HTTP 200 + `{ success: false, error: 'K线数据暂时无法获取，请稍后重试', data: { code, source: 'none' } }`
- [x] 1.8 try/catch 整体保护，异常时返回 500

## 2. 前端骨架屏 + error 态 CSS（public/index.html）

- [x] 2.1 新增 `.featured-chart-loading` 容器样式：高度 220px，flex 居中，定位 relative
- [x] 2.2 新增 `.kline-skeleton-svg` 内容容器：宽度 100%，5 个 `.kline-skeleton-bar` 柱状元素
- [x] 2.3 `.kline-skeleton-bar` 配 `@keyframes shimmer` 扫光动画（linear-gradient + background-position 移动）
- [x] 2.4 `.kline-skeleton-label` 居中文本，颜色 `var(--text-muted)`，font-size: 12px
- [x] 2.5 新增 `.featured-chart-error` 容器样式：高度 220px，居中布局，含 icon + 文案 + 重试按钮
- [x] 2.6 新增 `.featured-chart-retry-btn`：圆角胶囊按钮，背景渐变蓝色，hover 加深，cursor pointer

## 3. 前端工具函数：去重 + 数据池回写 + K 线拉取（public/index.html）

- [x] 3.1 在 INDEX QUOTES 模块或公共工具区声明 `const _modalTrendInFlight = new Map();`
- [x] 3.2 新增 `_patchHistorySeries(pool, code, history)` 工具：在 pool 中找 code，存在则赋值
- [x] 3.3 新增 `_inferMarket(code)` 辅助：从已知数据池或 POOL_MAP 推断 market（兜底默认 'SH'）
- [x] 3.4 新增 `async ensureModalTrendData(d, forceRefresh = false)`：
  - 如果 d.historySeries.length >= 2 且非 forceRefresh → 直接返回 d
  - 计算 fullCode = `${d.code}.${d.market}`
  - 检查 inflight Map，复用进行中的 Promise
  - 否则 fetch `/api/indices/${encodeURIComponent(fullCode)}/klines`
  - 成功：回写 d.historySeries + d.dataSources.kline + 三个数据池 + delete inflight
  - 失败：throw 错误（让调用方处理 UI）+ delete inflight

## 4. 改造 openIdxDetailModal（public/index.html）

- [x] 4.1 定位 `openIdxDetailModal(code)`（约 6706 行）
- [x] 4.2 在 `getCurrentDashboardCards().find(...)` 找不到时增加 fallback：
  ```js
  if (!d) {
    const quote = indexQuotesData.find(i => i.code === code || `${i.code}.${i.market}` === code);
    if (quote) d = { ...quote, historySeries: [], dataSources: {} };
  }
  if (!d) return;
  ```
- [x] 4.3 模态框打开后**异步**调用 `ensureModalTrendData(d).catch(e => 渲染 error 态)`
- [x] 4.4 ensureModalTrendData 成功后调 `renderIdxModalTrend(d)` 替换骨架屏

## 5. 改造 renderIdxModalTrend 三态分支（public/index.html）

- [x] 5.1 定位 `renderIdxModalTrend(d)`（约 6877 行）
- [x] 5.2 增加 `d.__trendLoading` / `d.__trendError` 元字段判定（仅运行时状态，不污染数据）
- [x] 5.3 loading 分支：chartEl.innerHTML = loading 骨架屏 HTML
- [x] 5.4 error 分支：chartEl.innerHTML = error 提示 + `<button onclick="retryModalTrend('${d.code}')">🔄 重试</button>`
- [x] 5.5 原 `series.length < 2 && !d.__trendLoading && !d.__trendError` 分支：若 historySeries 仍为空且不在 loading/error → 显示 loading 并触发 ensureModalTrendData
- [x] 5.6 success 分支保留现有 SVG 渲染逻辑（不动）

## 6. 新增 window.retryModalTrend（public/index.html）

- [x] 6.1 全局函数 `window.retryModalTrend = function(code) { ... }`
- [x] 6.2 实现：找到 d → 设 `d.__trendLoading = true; d.__trendError = null; d.historySeries = []` → renderIdxModalTrend(d) → 触发 ensureModalTrendData(d, true)
- [x] 6.3 失败时设 `d.__trendError = err.message` 并 re-render
- [x] 6.4 重试也走 `_modalTrendInFlight` 去重

## 7. 数据源行显示 K 线 source（public/index.html）

- [x] 7.1 改造 buildIdxModalBody 底部"数据源"行（约 6869 行附近）：从 `d.dataSources.kline` 读取 sourceLabel
- [x] 7.2 stale 状态显示 "（数据可能滞后）" 后缀

## 8. 集成验证（人工）

- [ ] 8.1 重启服务（含本次后端 + 前端改动），管理员登录
- [ ] 8.2 点击沪深 300 卡片：模态框立即打开，趋势区显示骨架屏 → 折线图（< 3s）
- [ ] 8.3 点击 SPX：同样有 loading → success 流程，数据源显示"备用源"或"主源"
- [ ] 8.4 直接 fetch `/api/indices/SPX.US/klines`：返回 200 + historySeries 数组
- [ ] 8.5 fetch `/api/indices/UNKNOWN.XX/klines`：返回 404
- [ ] 8.6 关闭再打开同一指数：趋势图直接出现，无骨架屏闪烁
- [ ] 8.7 切换 range 按钮（1y→3y→5y→10y）：本地切片，无网络请求
- [ ] 8.8 DevTools 限速到 Slow 3G + 关闭后端 → 点击指数：模态框打开 + loading → 等待超时 → error UI + 重试按钮
- [ ] 8.9 点击重试按钮：回到 loading 态，再次失败显示 error
- [ ] 8.10 恢复网络后重试：成功显示折线图

## 9. 校验与归档准备

- [x] 9.1 `openspec validate index-modal-trend-resilience --strict` 通过
- [x] 9.2 `git diff --stat` 仅 `server.js` + `public/index.html` 两个文件改动
- [ ] 9.3 PM2 reload 后回归全功能
- [ ] 9.4 待用户确认是否部署到生产服务器（**待人工**）
