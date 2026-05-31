## 1. 修复 loadIndexQuotes forceRefresh 参数透传（public/index.html）

- [x] 1.1 定位 `loadIndexQuotes(forceRefresh = false)`（约 9906 行）
- [x] 1.2 修改 fetch URL：`fetch('/api/indices/quotes' + (forceRefresh ? '?refresh=1' : ''))`

## 2. 删除指数 — 乐观更新（public/index.html）

- [x] 2.1 改造 `removeIndexFromPanel`（约 10253 行）：API 成功后立即 `indexQuotesData = indexQuotesData.filter(i => i.code !== code)` + `renderIndexQuotesGrid(...)` 重渲染
- [x] 2.2 在乐观更新之后追加 `loadIndexQuotes(true)`（不 await，后台兜底刷新）
- [x] 2.3 失败兜底：catch 块中 `alert + loadIndexQuotes(true)` 恢复正确状态
- [x] 2.4 `_lastIndexUpdateTime` 在乐观更新时保持不变，避免顶部时间被清空

## 3. 删除指数 — 后端缓存失效（server.js）

- [x] 3.1 定位 `POST /api/indices/remove`（约 974 行）
- [x] 3.2 在 `writeIndexWatchlist(reordered)` 之后追加 `delete _smartCache['index-quotes']`
- [x] 3.3 同步在 `POST /api/indices/add` 路由也加 `delete _smartCache['index-quotes']`（添加后立即可见新指数）

## 4. 全市场交易时段感知（services/stockFetcher.js）

- [x] 4.1 提取私有函数 `_isCNTrading()`：周一~周五 09:15-15:05（沿用现有逻辑）
- [x] 4.2 新增私有函数 `_isHKTrading()`：周一~周五 09:30-12:00 + 13:00-16:10（北京时间，与港股相同时区）
- [x] 4.3 新增私有函数 `_isUSTrading()`：北京时间周一~周六 21:30-次日 05:00（涵盖夏令时 + 冬令时 + 缓冲；周六对应纽约周五交易日）
- [x] 4.4 改造 `isTradingHours(markets)` 主函数：无参兼容旧调用（仅 CN）；接受字符串/数组；任一开盘 → true
- [x] 4.5 module.exports 保持 `isTradingHours` 导出（签名向后兼容）

## 5. getCacheTTL 动态市场判定（server.js）

- [x] 5.1 在 `getCacheTTL` 函数前定义 `_detectIndexWatchlistMarkets()` 工具：读 `readIndexWatchlist`，按 `idx.market` 字段映射到 `'CN' | 'HK' | 'US'` 集合，异常时兜底返回 `['CN']`
- [x] 5.2 改造 `getCacheTTL('index-quotes')` 分支：`const trading = isTradingHours(_detectIndexWatchlistMarkets()); return trading ? CACHE_TTL_INDEX_QUOTES_TRADING : CACHE_TTL_INDEX_QUOTES_CLOSED`
- [x] 5.3 验证其他 cache key（stocks/etfs/active-funds/daily-eval）继续走原 `isTradingHours()` 无参调用，行为不变

## 6. 拖拽排序 — 复用 initCardDnD（public/index.html）

- [x] 6.1 定位 `initCardDnD(grid, type)`（约 11887 行）
- [x] 6.2 在 `endpointMap` 添加 `index: '/api/indices/reorder'`
- [x] 6.3 在 `codeAttrMap` 添加 `index: 'code'`（buildIndexQuoteCard 使用 `data-code` 属性）
- [x] 6.4 在 drop 事件回调中：当 `type === 'index'` 时，**只重排当前可见集合**，并按设计文档"决策 6"算法回写完整 `indexQuotesData`，保持其他市场相对位置不变
- [x] 6.5 拖拽完成后调用 reorder API 时，body codes 来自完整 `indexQuotesData`，而非当前可见 grid（避免 watchlist 丢失隐藏市场）

## 7. 卡片注入拖拽属性（public/index.html）

- [x] 7.1 定位 `buildIndexQuoteCard(idx)`（约 9972 行）
- [x] 7.2 计算 `isAdmin = !!(authUser && authUser.role === 'admin')`
- [x] 7.3 卡片根 div 增加 `${isAdmin ? 'draggable="true"' : ''}` 属性
- [x] 7.4 在卡片内部基础信息块**之前**注入 `${isAdmin ? '<div class="drag-handle" title="拖拽排序">⠿</div>' : ''}`
- [x] 7.5 验证现有 × 删除按钮位置（top:6px right:6px）与拖拽手柄（top:8px left:8px）无视觉冲突

## 8. 拖拽初始化绑定（public/index.html）

- [x] 8.1 在 INDEX QUOTES 模块声明区（约 9861 行附近）增加 `let _indexDnDInitialized = false`
- [x] 8.2 新增 `setupIndexDnDOnce()` 函数：检查标志位 + 取 `#indexSummaryGrid` + 调 `initCardDnD(grid, 'index')` + 置位
- [x] 8.3 在 `renderIndexQuotesGrid` 末尾（首次 innerHTML 全量渲染分支后）调用 `setupIndexDnDOnce()`
- [x] 8.4 验证 Tab 切换时（已实现 `grid.innerHTML = ''` 清空）事件委托宿主未被销毁，绑定保持有效

## 9. 集成验证（人工浏览器验证）

- [ ] 9.1 重启服务后，管理员登录访问基金总览
- [ ] 9.2 删除测试：点击某指数 × 按钮 → 立即消失（< 100ms 感知），各 Tab 计数同步 -1
- [ ] 9.3 美股 TTL 测试（北京时间夜间 22:00 后）：访问 `/api/health` 看 `cache.index-quotes.ttl` 显示约 30s
- [ ] 9.4 美股 TTL 测试（白天）：访问 `/api/health` 看 `cache.index-quotes.ttl` 显示约 30min（A 股已休市，watchlist 含美股但非夜间）
- [ ] 9.5 拖拽测试：管理员看到 ⠿ 手柄，拖动一个 A 股卡片到另一位置 → DOM 重排 → 后端 API 200 → 刷新页面顺序保留
- [ ] 9.6 拖拽 + Tab 协同：在「美股」Tab 下拖拽 SPX/NDX 互换 → 切到「全部」Tab → A 股顺序未变，美股内部已对调
- [ ] 9.7 普通用户测试：以非管理员登录或未登录访问 → 无 ⠿ 手柄 + 拖拽尝试无效
- [ ] 9.8 网络失败回滚：DevTools 设 Network → Offline，点击删除 → alert 弹出 → 卡片自动恢复

## 10. 校验与归档准备

- [x] 10.1 `openspec validate index-quotes-panel-admin-fixes --strict` 通过
- [x] 10.2 `git diff --stat` 仅 `public/index.html` + `server.js` + `services/stockFetcher.js` 三个文件改动
- [x] 10.3 PM2 reload / `npm run pm2:restart` 后回归全功能（指数行情/严选基金/温度计/投资策略均正常）
- [x] 10.4 待用户确认是否部署到生产服务器（**待人工**）
