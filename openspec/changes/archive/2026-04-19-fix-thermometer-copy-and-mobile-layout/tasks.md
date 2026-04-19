## 1. 文案修正

- [x] 1.1 将 `public/index.html:3963` 风险提示中的 `知有行温度计` 改为 `有知有行温度计`（同步修正了 4158、8637 两处 JS 中的用户可见文案）

## 2. 移动端布局：上证指数风向标行情区域

- [x] 2.1 在 `@media (max-width: 768px)` 块（行 2906 附近）中，修改 `.featured-index-quote` 的移动端样式：补充 `flex-shrink: 1; min-width: 0; flex-direction: column; align-items: flex-end; gap: 4px;`，并将 `.featured-index-price` 字号改为 `20px`
- [x] 2.2 在 `@media (max-width: 480px)` 块中将 `.featured-index-price` 改为 `17px`，并补充 `.featured-index-change { font-size: 11px; padding: 2px 6px; }`

## 3. 验证

- [x] 3.1 确认风险提示文案显示"有知有行温度计"，无"知有行温度计"（用户可见位置全部修正）
- [x] 3.2 CSS 验证：移动端媒体查询中 featured-index-quote 已正确覆盖，桌面端不受影响
