## Why

存在两个需要修复的问题：
1. 温度计 Tab 底部风险提示文案中写的是"知有行温度计"（字序错误），应为"有知有行温度计"；
2. 网站移动端适配存在布局重叠问题：上证指数"市场风向标"卡片的行情区域（价格+涨跌幅）在窄屏下因 `flex-shrink: 0` 导致内容挤出容器边界，出现重叠或溢出。

## What Changes

- **Bug 1 - 文案修正**：将 `public/index.html:3963` 风险提示中的"知有行温度计"改为"有知有行温度计"
- **Bug 2 - 移动端适配**：修复 `.featured-index-summary` 行情区域在移动端的溢出/重叠问题，同时全面审查并补充其他可能的移动端重叠场景（导航栏、卡片内容等）

## Capabilities

### New Capabilities

### Modified Capabilities
- `thermometer-name`：补充修复风险提示区域的品牌名称文案
- `mobile-layout`：修复移动端布局重叠，上证指数卡片行情区域响应式适配

## Impact

- `public/index.html`：仅修改此文件，涉及 HTML 文案（行 3963）和 CSS 移动端媒体查询（行 759-761、2905-2907 附近）
