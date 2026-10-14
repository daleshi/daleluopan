## Why

管理员在严选ETF 与严选股票页无法拖拽调整卡片顺序（页面还有「💡 管理员提示：拖动卡片左上角的 ⠿ 即可调整顺序」的引导文案，与现状矛盾）。经浏览器实测确认，拖拽事件监听器**从未绑定到网格上**，拖拽完全不生效。

实测证据（Playwright，管理员身份 `role-admin` 已确认）：

| 网格 | `dragover` 事件被 `preventDefault`（= 监听器已绑定） |
|---|---|
| `#etfGrid`（严选ETF） | ❌ false |
| `#stockGrid`（严选股票） | ❌ false |
| `#activeFundGrid`（严选基金） | ❌ false |
| `#indexSummaryGrid`（指数行情） | ✅ true（唯一正常的） |

根因有**两个叠加缺陷**，都在 `public/index.html` 的拖拽排序模块（`initCardDnD` / `initFundDnD`）：

1. **初始化时机失效**：`initCardDnD(grid, ...)` 与 `initFundDnD(grid)` 只在 `grid.children.length === 0` 分支里调用。但三个网格在首次渲染前都已被写入 loading 占位子元素（`#etfGrid` / `#stockGrid` 在 HTML 里写死，`#activeFundGrid` / `#indexFundGrid` 由 `loadActiveFundData` 写入），因此该分支**永不成立**，监听器从未绑定。指数看板幸免是因为它走的是 `setupIndexDnDOnce()` 无条件绑定。
2. **事件委托选择器与 HTML 属性名不匹配**：`initCardDnD` 用 `'[data-' + codeAttr + ']'` 拼选择器，而 `codeAttr` 用的是 camelCase 的 `dataset` 键（`etfCode` / `stockCode`），拼出 `[data-etfCode]` / `[data-stockCode]`；实际 HTML 属性是带连字符的 `data-etf-code` / `data-stock-code`。`closest()` 永远返回 `null` → 直接 `preventDefault()` 取消拖拽。指数用 `data-code`（无连字符）所以不受影响。实测手动调用 `initCardDnD` 后 `dragstart` 的 `defaultPrevented` 为 `true`，即监听器存在但仍被守卫拦下，确认此缺陷。

也就是说：**即使只修好初始化时机，ETF 与股票的拖拽仍会因选择器错误而失效**，两个缺陷必须一起修。

## What Changes

- **修复选择器**：`codeAttrMap` 拆成两份——`attrMap`（HTML 选择器，kebab-case：`data-etf-code` / `data-stock-code` / `data-code`）与 `keyMap`（`dataset` 读取键，camelCase：`etfCode` / `stockCode` / `code`），四个 `closest()` 调用改用 `attrMap`
- **初始化改为幂等且每次渲染都调用**：`initCardDnD` / `initFundDnD` 内部以 `grid.dataset.dndBound` 标记去重，调用点从 `if (grid.children.length === 0)` 分支内移出，改到渲染函数末尾无条件调用（三个分支之后统一调用）
- **同步修正严选基金**：`initFundDnD` 的选择器 `[data-fund-code]` 本身正确，但同样受缺陷 1 影响一并修复
- **保留指数看板现有实现**：`setupIndexDnDOnce()` 已正确，仅纳入回归验证范围
- 不改动任何后端 `/api/*/reorder` 接口（实测接口本身可用）

## Capabilities

### New Capabilities

- `card-drag-reorder`: 看板卡片（严选ETF / 严选股票 / 严选基金 / 指数行情）的拖拽排序能力：管理员可拖拽调整顺序、顺序持久化到关注列表、非管理员与非登录态不触发拖拽

### Modified Capabilities

（无 — 现有 specs 未描述拖拽排序行为，本变更以新增能力方式补齐其需求与场景）

## Impact

**代码**
- `public/index.html`：仅改 `initCardDnD`（约 9420-9524 行）与 `initFundDnD`（约 9526-9585 行）两个函数，以及 3 处调用点（`renderETFs` ~8045、`renderStocks` ~9364、`renderActiveFunds` ~7470）

**后端**
- 不改动。`/api/etfs/reorder`、`/api/stocks/reorder`、`/api/active-funds/reorder`、`/api/indices/reorder` 均已存在且校验正常；`/api/stocks/reorder` 在上一个变更中已支持带市场后缀的 `fullCode`

**数据**
- 无迁移。顺序仍存于 `data/etf-watchlist.json`、`data/stock-watchlist.json`、`data/active-fund-watchlist.json`、`data/index-watchlist.json`

**风险**
- 幂等标记 `grid.dataset.dndBound` 会写入 DOM 属性，对 diff 渲染无影响（diff 按 `data-*-code` 匹配卡片，网格容器本身不被替换）
- 拖拽期间 `isDraggingCard` 会跳过 DOM 重建，该机制保持不变
