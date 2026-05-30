## 1. 后端：动量计算辅助函数（services/dataFetcher.js）

- [x] 1.1 在 `fetchIndexQuotesForWatchlist` 函数之前定义 `computeUSMomentum(historySeries)` 私有函数：基于交易日近似（21/63/126/252）计算 `changeMonth / change3Month / change6Month / changeYear` + `drawdownFromHigh52w`
- [x] 1.2 边界保护：`historySeries == null || length === 0` 全返回 null；`pickAgo(days)` 在索引越界时返回 null；`high52w === 0` 时回撤返回 null
- [x] 1.3 数值精度：百分比字段保留 2 位小数（`parseFloat(x.toFixed(2))`）

## 2. 后端：合并 indices.json 到 watchlist 响应（services/dataFetcher.js）

- [x] 2.1 在 `fetchIndexQuotesForWatchlist` 内 `Promise.all` 之后、`results.map` 之前，新增 indices.json 加载逻辑：try/catch 调用 `readDiskCache('indices')`，构造 `Map<code, indexRecord>`
- [x] 2.2 在 `results.map` 内对 `idx.market === 'US'` 分支，从 `indicesByCode` 取增强记录：补齐 `result.high52w / result.low52w / result.sparkData` + 调用 `computeUSMomentum(enriched.historySeries)` 拓展动量字段
- [x] 2.3 重要：补齐操作放在 `usValuationInfo` 处理**之前**，确保第 2244 行的 `q.high52w / q.low52w` 在量化时已有值，触发 `pePercentile / evaType` 自动推导
- [x] 2.4 字段缺失或读 indices.json 失败时优雅降级，不阻塞 quotes 主流程
- [x] 2.5 在 `result` 返回对象中显式列出新增字段：`change6Month / changeYear / drawdownFromHigh52w / sparkData`

## 3. 前端：CSS 样式（public/index.html `<style>` 区域）

- [x] 3.1 新增 `.idx-range-bar-wrap` 容器：margin、padding、字号（参照 .idx-pct-bar-wrap 风格）
- [x] 3.2 新增 `.idx-range-bar`：高度 6px、border-radius 3px、灰色到中性的渐变背景
- [x] 3.3 新增 `.idx-range-bar-fill`：低 → 当前的填充层（颜色按水位偏低/偏高决定）
- [x] 3.4 新增 `.idx-range-bar-marker`：圆点 10px 直径，绝对定位 `transform: translateX(-50%)`，带卡片背景色边框（避免融入条形）
- [x] 3.5 新增 `.idx-range-bar-labels`：左/中/右三个 span（低值 / 当前距高 / 高值），flex 布局
- [x] 3.6 新增 `.idx-momentum-row`：display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 6px
- [x] 3.7 新增 `.idx-momentum-cell`：内部 label + value 双行紧凑布局，文本居中
- [x] 3.8 新增 `.idx-sparkline-wrap` + `.idx-sparkline`：宽度 100%、高度 28px、margin-top: 6px
- [x] 3.9 新增移动端 `@media (max-width: 480px)`：sparkline 高度 22px；动量字号缩减到 11px；区间条数字简化（必要时 CSS 控制小数位）

## 4. 前端：JS 工具函数（public/index.html `<script>` 区域）

- [x] 4.1 新增 `buildRangeBar(low, high, current, drawdownPct)` 工具函数：返回区间条 HTML 字符串；钳制 markerLeft 在 [0, 100]
- [x] 4.2 新增 `buildMomentumRow(changeMonth, change3Month, changeYear)` 工具函数：返回 3 列动量 HTML；缺失值显示 `--` 灰色
- [x] 4.3 新增 `buildSparkline(sparkData, momentumDir)` 工具函数：纯 SVG 折线；min/max 自适应；range 防除零；color 按方向

## 5. 前端：改造 buildIndexQuoteCard 美股分支（public/index.html）

- [x] 5.1 定位到第 10018 行 `if (isUS) {` 分支
- [x] 5.2 移除原"52周高 / 52周低"两个独立 detail-item（行 10029~10034）
- [x] 5.3 在"今开/昨收"之后插入 `buildRangeBar(idx.low52w, idx.high52w, idx.price, idx.drawdownFromHigh52w)`（仅当 high52w/low52w 都非 null）
- [x] 5.4 保留现有 52w 价格水位条（pePercentile）
- [x] 5.5 替换原 `idx.changeMonth != null || idx.change3Month != null` 分支为 `buildMomentumRow(idx.changeMonth, idx.change3Month, idx.changeYear)`（任一非 null 即渲染）
- [x] 5.6 在卡片末尾追加 `buildSparkline(idx.sparkData, idx.changeMonth >= 0 ? 'up' : 'down')`（sparkData.length >= 2 才渲染）
- [x] 5.7 验证 A 股 / 港股分支（`else` 块）完全不受影响

## 6. 集成验证（人工浏览器验证）

- [ ] 6.1 `npm start` 启动服务，确保 `data/cache/indices.json` 已生成（首次启动如未生成需等 fetchAllIndexData 完成）
- [ ] 6.2 浏览器访问 `http://localhost:3200`，进入「基金总览」Tab
- [ ] 6.3 切换到 `/opsx:apply` 已实施的「🇺🇸 美股」子 Tab（如其归档了的话）；否则在「全部」Tab 找到 SPX/NDX 卡片
- [ ] 6.4 SPX 卡片显示：今开/昨收 + 52w 区间条 + 52w 价格水位条 + 动量 3 列 + Sparkline
- [ ] 6.5 区间条圆点位置正确：近 5Y 高位时圆点应贴近右侧
- [ ] 6.6 距高回撤数字与"52w 价格水位"逻辑一致（高位 = 距高回撤近 0%）
- [ ] 6.7 动量 3 列：正负数着色正确，对齐排版
- [ ] 6.8 Sparkline：30 天走势可见，主色按近1月涨跌正确
- [ ] 6.9 NDX 卡片同样验证
- [ ] 6.10 沪深300、恒生科技等 A 股 / 港股卡片视觉**完全不变**
- [ ] 6.11 暗色 / 亮色主题切换，新元素均有正确配色
- [ ] 6.12 Chrome DevTools 模拟 iPhone SE（375px）/ Galaxy（360px），布局不破版
- [ ] 6.13 调用 `/api/indices/quotes` 直接看 SPX 记录的字段：`high52w / low52w / changeMonth / change3Month / change6Month / changeYear / drawdownFromHigh52w / sparkData` 全部有值
- [ ] 6.14 临时移走 `data/cache/indices.json`（mv 备份），调 API 验证降级：基础字段正常，新字段全 null，控制台 console.warn 出现一次
- [ ] 6.15 恢复 indices.json，重新验证一切正常

## 7. 校验与归档准备

- [x] 7.1 `openspec validate us-index-card-enrichment --strict` 通过
- [x] 7.2 `git diff --stat` 仅 `services/dataFetcher.js` + `public/index.html` 两个文件改动
- [ ] 7.3 PM2 reload / `npm run pm2:restart` 后回归全功能（指数行情、严选基金、温度计、投资策略均正常）
- [ ] 7.4 待用户确认是否需要部署到生产服务器（**待人工**）
