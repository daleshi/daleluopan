## 1. HTML 结构（public/index.html）

- [x] 1.1 在 `#indexSummaryGrid` 上方插入 `.idx-cat-tabs` 容器（位置：第 4124~4125 行之间，af-toolbar 与 indexSummaryGrid 之间）
- [x] 1.2 容器内含 4 个 button：`📊 全部 / 🇨🇳 A股 / 🇭🇰 港股 / 🇺🇸 美股`，每个 button 含 `.idx-cat-icon` + label + `.idx-cat-count` 三段
- [x] 1.3 各 button 设置 `data-market="all|cn|hk|us"`、`onclick="switchIndexMarketTab('<group>')"`，第一个 button 默认 `class="idx-cat-tab active"`
- [x] 1.4 计数徽章 id 命名：`indexCatCountAll` / `indexCatCountCn` / `indexCatCountHk` / `indexCatCountUs`

## 2. CSS 样式（public/index.html `<style>` 区域）

- [x] 2.1 新增 `.idx-cat-tabs` 容器：flex 布局、gap 8px、margin-bottom 12px、flex-wrap: wrap（兼容窄屏）
- [x] 2.2 新增 `.idx-cat-tab` 按钮：圆角胶囊、padding、字号、border、cursor、transition；与 `.af-cat-tab` 视觉参数对齐
- [x] 2.3 新增 `.idx-cat-tab.active` 激活态：高亮背景 + 主题强调色
- [x] 2.4 新增 `.idx-cat-icon` / `.idx-cat-count` 子元素样式（emoji 与计数徽章）
- [x] 2.5 移动端响应式（< 480px）：紧凑 padding，确保 4 Tab 一行不溢出（必要时 flex-wrap）
- [x] 2.6 验证亮色与暗色主题下 Tab 样式均可见（检查 CSS 变量引用）

## 3. JS 模块状态与常量（public/index.html `<script>` 区域，紧邻 `indexQuotesData` 声明处）

- [x] 3.1 声明模块常量 `MARKET_GROUPS = { all: null, cn: ['SH','SZ','CSI'], hk: ['HI'], us: ['US'] }`
- [x] 3.2 声明模块状态变量 `let currentMarketFilter = 'all'`
- [x] 3.3 声明工具函数 `filterIndicesByMarket(indices, group)`：按 MARKET_GROUPS 过滤，未识别 market 控制台 console.warn 一次（用 Set 去重避免重复打印）

## 4. 切换函数（public/index.html `<script>` 区域）

- [x] 4.1 新增全局函数 `window.switchIndexMarketTab(group)`：更新 `currentMarketFilter`、切换 `.idx-cat-tab.active` 类、清空 `#indexSummaryGrid`、调用 `renderIndexQuotesGrid({ indices: indexQuotesData, updateTime: lastUpdateTime })`
- [x] 4.2 维护一个 `let _lastIndexUpdateTime = null` 模块变量供切换时复用（避免切 Tab 后顶部时间被清空）
- [x] 4.3 在 `loadIndexQuotes` 成功路径中赋值 `_lastIndexUpdateTime = json.data.updateTime`

## 5. 改造 renderIndexQuotesGrid（public/index.html 第 9764 行起）

- [x] 5.1 在第 9772 行 filter 后增加 filter：`const visible = filterIndicesByMarket(filtered, currentMarketFilter)`
- [x] 5.2 计数更新：基于 `filtered`（不含上证）按 4 个分类计算计数，写入 `indexCatCountAll/Cn/Hk/Us` 元素 textContent
- [x] 5.3 渲染分支改为基于 `visible`（不是原 `filtered`）
- [x] 5.4 空网格分支判断改为 `visible.length === 0`：若 `currentMarketFilter !== 'all'` 显示"📊 该市场暂无关注指数，使用上方搜索框添加关注"；若 `currentMarketFilter === 'all'` 保留原文案
- [x] 5.5 增量 diff 路径中所有 `newCodes`、`filtered.forEach` 等引用改为 `visible`
- [x] 5.6 `countLabel` 文案保持显示总关注数 `关注 N 个指数`（基于 `filtered.length`，不受 Tab 切换影响）

## 6. 集成验证（人工浏览器验证，无前端测试框架）

- [ ] 6.1 `npm start` 启动后访问 `http://localhost:3200`，进入「基金总览」Tab
- [ ] 6.2 默认显示「📊 全部」Tab 激活，卡片网格内容与改造前一致
- [ ] 6.3 4 个 Tab 计数与各市场卡片实际数量逐一吻合（默认 watchlist：A股 6 / 港股 1 / 美股 2）
- [ ] 6.4 点击「🇨🇳 A股」：仅显示 SH/SZ/CSI 指数卡片
- [ ] 6.5 点击「🇭🇰 港股」：仅显示恒生科技
- [ ] 6.6 点击「🇺🇸 美股」：仅显示标普 500、纳斯达克 100
- [ ] 6.7 切回「📊 全部」：恢复原状
- [ ] 6.8 在 A 股 Tab 下等待 5~10 秒，观察沪深 300 等卡片价格区域增量更新（无闪烁、无重建）
- [ ] 6.9 在港股 Tab 下用搜索框搜"标普"添加成功，确认「🇺🇸 美股」与「📊 全部」计数 +1，但当前不跳转 Tab
- [ ] 6.10 移除一个港股关注指数，确认「🇭🇰 港股」计数 -1，「📊 全部」计数 -1
- [ ] 6.11 切到一个空 Tab（如先移除美股全部指数后切到「美股」），看到引导文案
- [ ] 6.12 暗色主题与亮色主题下 Tab 视觉均无异常
- [ ] 6.13 移动端 Chrome DevTools 模拟 iPhone SE（375px）+ Galaxy（360px）下 Tab 不溢出

## 7. 校验与归档准备

- [x] 7.1 `openspec validate index-quotes-market-tabs --strict` 通过
- [x] 7.2 提交前自查：`git diff public/index.html` 仅在三块区域有改动（HTML / CSS / JS），无其他文件改动
- [ ] 7.3 PM2 reload 或 `npm run pm2:restart` 后回归全功能（指数行情、严选基金、温度计、投资策略均正常）
- [ ] 7.4 待用户确认是否需要部署到生产服务器（**待人工**）
