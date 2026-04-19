## Context

`public/index.html` 是零构建依赖的单文件 SPA，所有渲染逻辑用原生 JS 实现。当前四个列表模块（指数行情/股票/ETF/基金）在每次数据刷新时，都通过 `grid.innerHTML = items.map(...).join('')` 整体替换容器，触发浏览器完整重排重绘，导致视觉闪烁。

受影响函数及容器：
- `renderIndexQuotesGrid` → `#indexSummaryGrid`（行 6529）
- `renderStocks` → `#stockGrid`（行 8165）
- `renderETFs` → `#etfGrid`（行 7398）
- `renderActiveFunds` → `#indexFundGrid` + `#activeFundGrid`（行 6878/6888）

## Goals / Non-Goals

**Goals:**
- 刷新时只更新数值变化的文本节点，容器结构保持稳定，消除闪烁
- 修正"知行温度计"→"有知有行温度计"两处文案

**Non-Goals:**
- 引入虚拟 DOM 或第三方库
- 重构渲染架构
- 修改后端逻辑

## Decisions

**方案：key-based DOM reconciliation（基于数据 code 做 diff）**

每次渲染时：
1. 遍历新数据，以 `code`（或唯一标识）为 key
2. 若容器中已存在对应 key 的子元素（`data-code` 属性），则只更新其中变化的数值字段（价格、涨跌幅等文本节点）
3. 若不存在，则 `insertAdjacentHTML` 插入新卡片
4. 遍历结束后，移除容器中多余的旧子元素

**选择理由：**
- 零依赖，与现有原生 JS 风格一致
- 首次加载仍走 innerHTML 全量渲染（容器为空时直接 innerHTML，性能最优）
- 后续增量更新只触发目标节点的 repaint，不触发容器级 reflow

**文案修正：**
- 直接字符串替换，无架构影响

## Risks / Trade-offs

- [风险] 卡片 HTML 结构若变化（如新增字段），需同步更新 diff 逻辑 → 可接受，卡片结构稳定
- [风险] `data-code` 属性需添加到每个卡片的根元素上 → 改动集中，影响面小
