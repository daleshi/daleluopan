## Why

「基金总览」Tab 下的「指数实时行情」面板当前以**扁平网格**展示用户关注的全部指数（上证除外），混合了 A 股、港股、美股等不同市场的卡片。当用户关注的指数较多（默认 8 张，最多 20 张）时，跨市场扫视成本高，难以快速定位"我想看的某市场行情"。

参考同页面「严选基金」已有的「📈 指数基金 / 🎯 主动基金」分类 Tab 模式，对指数行情面板做同构改造，可以在**零后端改动 / 零数据结构变更**的前提下显著提升信息扫读效率。

## What Changes

- 在「指数实时行情」搜索栏与卡片网格之间，新增一行**市场分类 Tab**：`📊 全部 / 🇨🇳 A股 / 🇭🇰 港股 / 🇺🇸 美股`
- 每个 Tab 显示该市场下用户已关注的指数数量（计数实时同步 watchlist）
- Tab 切换时：仅渲染所选市场的指数卡片；当前实现的轮询增量更新逻辑在过滤后的子集上继续生效
- 默认激活 Tab 为「全部」，与现状心智一致
- 空 Tab 显示引导文案"该市场暂无关注指数"
- **市场归类规则（前端常量）**：`SH/SZ/CSI → A股`、`HI → 港股`、`US → 美股`
- 「市场风向标」（上证指数大卡片）保持不变，不参与分类

## Capabilities

### New Capabilities

- `index-quotes-panel`: 「基金总览」下「指数实时行情」面板的展示与分类切换能力（含分类 Tab、计数、过滤渲染、轮询兼容）

### Modified Capabilities

（无 — 本次为新建独立能力，不修改现有 spec）

## Impact

- **前端** (`public/index.html`)：
  - HTML：`#indexSummaryGrid` 上方新增 `.idx-cat-tabs` Tab 条
  - CSS：复用 `.af-cat-tabs` 视觉语言，新增约 30 行样式（命名隔离避免污染严选基金）
  - JS：新增 `currentMarketFilter` 模块变量、`MARKET_GROUPS` 常量、`switchIndexMarketTab(group)` 切换函数；改造 `renderIndexQuotesGrid` 增加 filter 与计数更新；约 40 行
- **后端**：无改动（`/api/indices/quotes` 已返回 `market` 字段）
- **数据结构**：无改动
- **依赖**：无新增
- **测试**：项目无前端测试框架，依赖人工浏览器验证（切换 Tab、计数正确、轮询不打断、空 Tab 引导文案）
