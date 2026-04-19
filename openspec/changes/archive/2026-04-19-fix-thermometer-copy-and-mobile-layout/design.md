## Context

**文案问题**：`public/index.html:3963` 风险提示中品牌名称错写为"知有行温度计"（"有"和"知"字序颠倒），需改为"有知有行温度计"。

**移动端重叠问题**：

当前 `.featured-index-summary`（上证指数风向标行）是一个 `flex` 容器，子元素从左到右依次为：图标 → 名称信息 → 行情（价格+涨跌幅）→ 展开按钮。

行情区域 `.featured-index-quote` 设置了 `flex-shrink: 0`，价格字号 26px，在窄屏（< 380px）下四个子元素的总宽度超出容器，导致内容挤压重叠。

移动端媒体查询（行 2905-2907）中对 `.featured-index-quote` 只改了 `align-items` 和 `text-align`，未处理 `flex-shrink`，也未给价格在更小屏幕下缩减字号。

## Goals / Non-Goals

**Goals:**
- 修正风险提示中品牌名称文案
- 修复 `.featured-index-summary` 在移动端（≤768px 及更小屏）行情区域溢出/重叠
- 对更小屏幕（≤480px）进一步缩减价格字号，防止截断

**Non-Goals:**
- 重构整体移动端布局
- 修改后端或其他文件

## Decisions

**文案**：直接字符串替换。

**移动端布局修复**：

1. 在 `@media (max-width: 768px)` 中补充：
   - `.featured-index-quote { flex-shrink: 1; min-width: 0; flex-direction: column; align-items: flex-end; gap: 4px; }` — 允许行情区收缩，价格和涨跌幅改为纵向排列（右对齐），避免水平方向溢出
   - `.featured-index-price { font-size: 22px; }` — 缩小价格字号

2. 在 `@media (max-width: 480px)` 中补充：
   - `.featured-index-price { font-size: 18px; }` — 超小屏进一步缩小

这样在移动端行情区变为右对齐的上下两行（价格在上、涨跌幅在下），与左侧名称信息互不重叠。

## Risks / Trade-offs

- [风险] 右对齐纵向排列改变了桌面端设计意图 → 已通过 @media 限制仅在移动端生效，桌面端不受影响
- [风险] 其他 featured-index 相关样式可能需联动调整 → 范围小，仅修改 quote 区域
