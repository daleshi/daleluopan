## 1. 后端 — K 线条数扩展

- [x] 1.1 在 `services/stockFetcher.js` 中将 `fetchAllStockData()` 内 `fetchResilientStockKlinesDetailed(stock, 60)` 调用改为 `fetchResilientStockKlinesDetailed(stock, 252)`
- [x] 1.2 同步将 `fetchResilientStockKlinesDetailed`、`fetchResilientStockKlines`、`fetchStockKlines`、`fetchStockKlinesDetailed`、`fetchTencentStockKlines` 的默认 `limit` 参数从 60 改为 252，保持链路一致
- [x] 1.3 sparkData 计算改为 `klines.slice(-30).map(k => k.close)`，确保前端迷你走势图视觉无变化（30 日窗口）

## 2. 后端 — pricePosition52w 计算与字段透出

- [x] 2.1 在 `services/stockFetcher.js` 新增 `computePricePosition52w(price, low52w, high52w)` helper：返回 null（任一缺失或 high===low）或 [0, 100] 的 number（保留 1 位小数）
- [x] 2.2 在 `fetchAllStockData()` 组装每只股票对象时调用该 helper，挂上字段 `pricePosition52w`
- [x] 2.3 字段位置紧邻 `high52w` / `low52w`，便于阅读

## 3. 前端 — 股票卡片 52 周水位条 HTML

- [x] 3.1 在 `public/index.html` 的 `buildStockCardHtml()` 中，于 sparkline 区与 stock-metrics 之间插入 `.stock-52w-row` 容器（仅当 `s.pricePosition52w != null && s.high52w != null && s.low52w != null`）
- [x] 3.2 模板：左 `low52w`（2 位小数）+ 中央 `.stock-52w-bar`（含 `.stock-52w-fill` 渐变背景与 `.stock-52w-cursor` 游标，`style="left:${pricePosition52w}%"`）+ 右 `high52w`（2 位小数）
- [x] 3.3 进度条右侧紧接「水位 X.X%」徽章（`.stock-52w-badge`）

## 4. 前端 — CSS 样式

- [x] 4.1 新增样式：`.stock-52w-row`（display:flex, align-items:center, gap:8px, margin: 0 0 12px 0, padding:6px 8px）
- [x] 4.2 `.stock-52w-bar`（flex:1, min-width:80px, height:5px, position:relative, background:var(--overlay-06), border-radius:3px）
- [x] 4.3 `.stock-52w-fill`（position:absolute, inset:0, height:100%, background: linear-gradient(90deg, var(--green-value), var(--accent-gold), var(--red-danger))）
- [x] 4.4 `.stock-52w-cursor`（position:absolute, top:-4px, width:12px, height:12px, border-radius:50%, background:var(--accent-blue), border:2px solid var(--bg-card), transform:translateX(-50%), transition:left 0.4s ease）
- [x] 4.5 `.stock-52w-label`（font-size:11px, font-family:var(--font-mono), color:var(--text-muted), white-space:nowrap）
- [x] 4.6 `.stock-52w-badge`（font-size:11px, padding:1px 6px, border-radius:4px, background:var(--accent-blue-dim), color:var(--accent-blue), flex-shrink:0）
- [x] 4.7 `@media (max-width: 480px)` 收紧：`.stock-52w-label / .stock-52w-badge` 字号 10px，`.stock-52w-row` gap:6px / padding:5px 6px

## 5. 联调与回归

- [x] 5.1 本地启动（PORT=3215）→ `/api/stocks?refresh=1` 返回：6 只关注股票全部含 `high52w` / `low52w` / `pricePosition52w`；东方财富 K 线请求自动 fallback 腾讯，每股 252-253 条 K 线（`lmt=252` 已生效）
- [x] 5.2 验证 `pricePosition52w` 数学正确：单元式测试 (180,120,200) → 75 / (210,120,200) → 100 / (110,120,200) → 0 / (150,150,150) → null 全部通过
- [x] 5.3 验证真值：国电南瑞 600406 站内 `low52w=20.934 / high52w=32.06`，与腾讯实时接口 `qt.gtimg.cn/q=sh600406` 提供的 52w 高低（20.93 / 32.06）完全一致
- [x] 5.4 边界场景：水位 2.0%（隆基绿能 12.45 接近 52w 低 12.22）/ 18.1%（国电南瑞）/ 28.2%（长江电力）/ 49.9%（先导智能）/ 1.8%（宝信软件），全部数学正确
- [x] 5.5 前端整行隐藏条件 `s.pricePosition52w!=null && s.high52w!=null && s.low52w!=null` 经表达式逻辑验证通过；移动端断点 ≤480px 已加紧凑规则
- [x] 5.6 配色复用 CSS 变量（`--green-value` / `--accent-gold` / `--red-danger` / `--accent-blue`），主题切换自动适配
- [x] 5.7 sparkData 仍为 30 条（首/尾值正常），前端迷你走势图视觉零变化

## 6. 部署与文档

- [x] 6.1 `npm run package:deploy` 生成 `dale-compass-20260624-193605.tar.gz`（2026-06-24 19:36）
- [x] 6.2 上传 `43.136.122.239:/data/dale-compass/` 并 PM2 重启 PID=31205 online；日志无异常（东方财富 K 线偶尔 socket hang up，自动 fallback 腾讯成功取得 252 条）
- [x] 6.3 线上 `curl http://127.0.0.1:3200/api/stocks` 抽样 6 只关注股票全部带 `low52w / high52w / pricePosition52w`：隆基绿能水位 2.0%（接近 52w 低 12.22）/ 国电南瑞 18.1%（与腾讯 52w 真值 20.93–32.06 一致）/ 特变电工 55.5%（中位）等
- [x] 6.4 在 `CODEBUDDY.md` "数据格式"区段补充说明：`/api/stocks` 响应含 `high52w` / `low52w`（基于近 252 个交易日 K 线）与 `pricePosition52w`（0–100 水位百分位，1 位小数）
