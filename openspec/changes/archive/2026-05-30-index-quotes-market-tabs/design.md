## Context

「基金总览」Tab 下「指数实时行情」面板（`#indexSummaryGrid`）当前以**扁平网格**展示用户关注的所有指数（上证指数除外，单独占据顶部"市场风向标" `#featuredIndexRow`）。

**当前关键代码位置**：
- `public/index.html` 第 4108~4126 行：HTML 结构（section header / 搜索栏 / `#indexSummaryGrid`）
- `public/index.html` 第 9744~9762 行：`loadIndexQuotes()` 拉取 `/api/indices/quotes`
- `public/index.html` 第 9764~9830 行：`renderIndexQuotesGrid(data)` —— 渲染 + 增量 diff 防闪烁
- `public/index.html` 第 9772 行：`filter(idx => idx.code !== '000001')` 排除上证指数
- `services/dataFetcher.js` 候选池每条记录均带 `market` 字段（`SH/SZ/CSI/HI/US`）
- `data/index-watchlist.json`：每条 watchlist 项已包含 `market`
- `/api/indices/quotes` 响应 `data.indices[].market` 已存在 ✅

**约束**：
- 项目无前端构建工具（纯原生单文件 SPA），不能引入框架
- 项目无前端测试框架，依赖手工浏览器验证
- 现有交易时段轮询逻辑（3-5 秒随机间隔 + 增量 DOM diff）必须保持不闪烁
- 视觉语言需与同页面"严选基金" `.af-cat-tabs` 保持一致

## Goals / Non-Goals

**Goals:**
- 在「指数实时行情」加入市场分类 Tab（全部 / A股 / 港股 / 美股），降低跨市场扫视成本
- 各 Tab 显示实时计数
- 切换 Tab 不破坏轮询增量更新（仍保持丝滑无闪烁）
- 复用现有 `.af-cat-tabs` 视觉语言，保持页面一致性
- 零后端改动、零数据结构变更

**Non-Goals:**
- 不改造「股票总览」「ETF 总览」的市场分类（如有需要将作为独立 change）
- 不改造「市场风向标」上证指数大卡片
- 不限制搜索框范围（搜索保持全市场）
- 不实现 Tab 排序拖拽 / 自定义市场组
- 不引入持久化（用户切到哪个 Tab 不需要记忆，每次进入默认"全部"）

## Decisions

### 决策 1：分类粒度 — 4 个 Tab（合并 SH/SZ/CSI 到 A股）

**选择**：4 个 Tab：`📊 全部 / 🇨🇳 A股 / 🇭🇰 港股 / 🇺🇸 美股`

**映射规则**（前端常量 `MARKET_GROUPS`）：
```js
{
  all: null,              // 全部 → 不过滤
  cn:  ['SH','SZ','CSI'], // A股 → 上交所、深交所、中证
  hk:  ['HI'],            // 港股 → 恒生
  us:  ['US'],            // 美股 → 标普、纳指等
}
```

**为什么不用 5 个 Tab（拆分 SH/SZ）**：用户视角下"沪深"是同一资产类别，技术上的市场代码不应外溢到 UI；且中证（CSI）指数本质标的也是 A 股。

### 决策 2：切换 Tab 用"完全重渲染" vs "CSS hide"

**选择**：完全重渲染（`grid.innerHTML = ''` 后调用现有渲染路径）

**备选**：所有卡片始终在 DOM 里，用 `display:none` 切换 → 否决。

**理由**：
- 切 Tab 是低频用户操作，性能不敏感
- 卡片无 hover 维持的弹窗 / 富交互状态，重渲染零状态丢失
- 实现直观，调试简单
- **关键**：让 `renderIndexQuotesGrid` 在内部应用 filter，轮询的增量 diff 自然在 filter 后的子集上工作 —— 复用现有逻辑，无需大改

### 决策 3：空 Tab 处理 — 永远展示 + 引导文案

**选择**：4 个 Tab 永远可见 + 计数 0 也可点击 + 切到空 Tab 显示"该市场暂无关注指数，使用上方搜索框添加"

**否决**：自动隐藏空 Tab。理由：UI 抖动严重（用户加一个港股就突然冒出来一个 Tab），且失去引导价值。

### 决策 4：搜索框范围 — 保持全市场

**选择**：搜索框不受当前 Tab 限制；用户搜到的指数添加成功后 watchlist 增量刷新，自动出现在对应 Tab。

**否决**：根据当前 Tab 限制搜索范围。理由：后端 `/api/indices/search` 本就是全市场搜索，强行限制反而增加规则复杂度。

### 决策 5：渲染入口 —— 在 `renderIndexQuotesGrid` 内部 filter

**选择**：保留 `loadIndexQuotes` 与轮询触发器不变；将 filter 逻辑收口在 `renderIndexQuotesGrid` 内部，读取模块级 `currentMarketFilter` 状态。

```
轮询/手动触发
    ↓
loadIndexQuotes() ──fetch──▶ indexQuotesData = [...]
    ↓
renderIndexQuotesGrid(data)
    ├─ 读取 currentMarketFilter
    ├─ 应用 MARKET_GROUPS 过滤
    ├─ 更新 4 个 Tab 计数（基于全集计算）
    └─ 在过滤后的子集上跑现有增量 DOM diff
```

切 Tab 时：
```
用户点击 Tab → switchIndexMarketTab(group)
    ├─ currentMarketFilter = group
    ├─ 清空 #indexSummaryGrid（强制全量重渲染，避免 diff 误判）
    └─ 调用 renderIndexQuotesGrid({ indices: indexQuotesData, updateTime: ... })
```

### 决策 6：计数来源 —— 基于已加载的 `indexQuotesData`（不查 watchlist）

**选择**：计数 = 当前已加载行情数据中各市场指数数量（同时也等于 watchlist 中各市场数量，因为两者强一致）

**否决**：单独 fetch `/api/indices/watchlist` 拿计数。理由：与 quotes 数据不一致风险（如 quotes 失败但 watchlist 成功 → 计数与卡片对不上）。

### 决策 7：CSS 命名隔离

**选择**：新建 `.idx-cat-tabs` / `.idx-cat-tab` / `.idx-cat-icon` / `.idx-cat-count` 类名（与 `.af-cat-tabs` 隔离），样式参数复用同一套 CSS 变量

**否决**：直接复用 `.af-cat-tabs` 类。理由：未来若两块 Tab 视觉需要差异化（如指数 Tab 加上市场旗标 emoji 间距调整）时无需相互牵扯；命名也更语义化。

## Risks / Trade-offs

- **[Risk] 切 Tab 时增量 diff 误判**：现有 diff 逻辑通过 `data-code` 索引现有卡片，切 Tab 时若新过滤集合移除了大部分卡片再立即轮询，可能出现一次性大幅 DOM 变更
  → **Mitigation**：切 Tab 时显式 `grid.innerHTML = ''` 强制清空，下次渲染走"首次渲染"分支（全量 innerHTML），下下次轮询又回到增量 diff，无副作用

- **[Risk] 计数与卡片不同步**：filter 与计数在不同位置计算时可能跑偏
  → **Mitigation**：计数与渲染**用同一份 `indexQuotesData` 与同一套 `MARKET_GROUPS` 常量**，计数走全集（不应用当前 filter），渲染走 filter 后子集，两者解耦但同源

- **[Risk] 后端某天加新 market 值（如 `LSE` 伦敦交易所）**：MARKET_GROUPS 未覆盖时该指数会"消失"于 4 个 Tab
  → **Mitigation**：在 filter 函数中实现兜底：未知 market 默认归入"全部"，但不出现在 cn/hk/us 任何 Tab。同时在控制台输出 `console.warn`，便于发现

- **[Risk] 移动端 4 Tab 横向溢出**：小屏 320px 下 4 Tab + emoji + 计数可能换行
  → **Mitigation**：CSS 设 `flex-wrap:wrap` + 较紧凑的 padding，或在 `<480px` 隐藏 emoji 仅留文字

- **[Trade-off] 切 Tab 全量重渲染 vs 增量隐藏**：选择前者牺牲少许 50ms 级首次渲染时间，换来代码极简
  → 接受：用户切 Tab 是低频操作，体感无感知
