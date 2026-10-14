## Context

`public/index.html` 的看板卡片拖拽排序由两个函数实现，均使用事件委托绑定到网格容器：

- `initCardDnD(grid, type)`（约 9422 行）：`type` ∈ `etf` / `stock` / `index`，按 `codeAttrMap` 拼选择器 `[data-${codeAttr}]`
- `initFundDnD(grid)`（约 9527 行）：严选基金专用，选择器硬编码 `[data-fund-code]`

四个网格容器的初始化路径各不相同：

| 网格 | 初始化方式 | 首次渲染前是否有占位子元素 |
|---|---|---|
| `#etfGrid` | `renderETFs` 的 `if (grid.children.length === 0)` 分支 | ✅ HTML 里写死 `loading-wrap` |
| `#stockGrid` | `renderStocks` 的同上分支 | ✅ HTML 里写死 `loading-wrap` |
| `#activeFundGrid` | `renderActiveFunds` 的同上分支 | ✅ `loadActiveFundData` 先写 `loadingHtml` |
| `#indexSummaryGrid` | `setupIndexDnDOnce()`（带 `_indexDnDInitialized` 去重，无条件调用） | ✅ `loadIndexQuotes` 先写占位 |

实测（Playwright，管理员态，`body.role-admin` 已确认）：

```
#etfGrid        dragover.defaultPrevented = false   ← 监听器未绑定
#stockGrid      dragover.defaultPrevented = false   ← 监听器未绑定
#activeFundGrid dragover.defaultPrevented = false   ← 监听器未绑定
#indexSummaryGrid dragover.defaultPrevented = true  ← 正常
```

手动调用 `initCardDnD(g,'etf')` 后再派发 `dragstart`，事件 `defaultPrevented === true` 且 `isDraggingCard` 未被置为 `true` —— 说明监听器内的守卫 `if (!card || !authUser || authUser.role !== 'admin')` 命中，且 `authUser.role === 'admin'`，故只能是 `card === null`，即 `closest()` 没匹配上。

## Goals / Non-Goals

**Goals:**
- 管理员能在严选ETF / 严选股票 / 严选基金三个看板拖拽调整卡片顺序，并持久化
- 修复事件委托选择器（kebab-case 属性名）
- 修复初始化时机（不再依赖 `children.length === 0` 这一永不成立的条件）
- 保持指数看板拖拽正常，不回退
- 非管理员 / 未登录态仍不能拖拽（守卫保留）

**Non-Goals:**
- 不改动任何后端 `/api/*/reorder` 接口
- 不新增拖拽动画、跨网格拖拽、移动端长按拖拽手势
- 不改动卡片的 HTML 属性命名（`data-etf-code` 等被广泛使用，改属性名影响面更大）
- 不调整 `isDraggingCard` 跳过重建的机制

## Decisions

### 决策 1：`codeAttr` 拆成 `attrMap` + `keyMap`

```js
const attrMap = {            // 用于 querySelector / closest（HTML 属性名，kebab-case）
    etf:   'data-etf-code',
    stock: 'data-stock-code',
    index: 'data-code',
};
const keyMap = {             // 用于 dataset 读取（camelCase）
    etf:   'etfCode',
    stock: 'stockCode',
    index: 'code',
};
```

- **理由**：`closest()` 需要 HTML 属性名（`data-etf-code`），`dataset` 需要 camelCase 键（`etfCode`），两者语义不同，之前共用一个变量是缺陷源头。拆开后各自自解释，不会再被误用。
- **否决方案**：把卡片属性改成 `data-etfCode` 让两边一致 —— HTML 自定义属性惯例是 kebab-case，且 `data-etf-code` 已在多处（移除卡片、diff 渲染、网格策略）被引用，改名影响面远大于拆分两个常量。

### 决策 2：初始化改为幂等 + 渲染后无条件调用

```js
function initCardDnD(grid, type) {
    if (!grid) return;
    if (grid.dataset.dndBound === type) return;   // 幂等：同一网格只绑定一次
    grid.dataset.dndBound = type;
    ...
}
```

调用点从 `if (grid.children.length === 0) { ...; initCardDnD(grid, type); }` 内部移出，改为在渲染函数的三个分支（首次全量 / 拖拽中跳过 / 增量 diff）**之后**统一调用。

- **理由**：`children.length === 0` 是一个脆弱的"首次渲染"信号，被 loading 占位元素破坏后完全没有兜底。用显式的幂等标记既不依赖 DOM 状态，也保证无论走哪个分支、无论网格当前有什么子节点，监听器都会被绑定一次。
- **否决方案 A**：渲染前先 `grid.innerHTML = ''` 清空占位 —— 会让 `children.length === 0` 成立，但仍是隐式契约，且清空会造成一次额外的 DOM 抖动。
- **否决方案 B**：改用 `document` 级事件委托 —— 需处理多个网格的归属判断，改动面更大。
- `initFundDnD` 同样加 `grid.dataset.dndBound = 'fund'` 标记。

### 决策 3：`dataset.dndBound` 作为标记而非模块级 WeakSet

- **理由**：标记随 DOM 元素走，网格容器若将来被整体替换会自动重新绑定，不会出现"元素换了但 WeakSet 里还有旧引用导致漏绑"的隐患；读取成本可忽略。
- 网格容器本身不会被 diff 渲染替换（只替换卡片），因此标记稳定。

### 决策 4：保留 `authUser.role === 'admin'` 守卫，不改权限模型

- **理由**：这是唯一阻止非管理员拖拽的逻辑（`.pro-drag-handle` 的 CSS `display` 只是视觉隐藏）。修复只针对"管理员也拖不动"，权限语义不变。
- 仍需在验证中覆盖游客态：拖拽手柄不可见 + 手动派发 `dragstart` 应被 `preventDefault`。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **幂等标记与 diff 渲染冲突**：`grid.dataset.dndBound` 写入 DOM 属性，若 diff 逻辑重建网格容器会丢标记 | 三处渲染都只替换卡片（`.etf-card` 等），网格容器 `innerHTML` 仅在首次全量分支赋值一次；丢标记也只是重新绑定一次监听器，无副作用 |
| **重复绑定导致一次拖拽触发两次 reorder 请求** | `dndBound` 标记确保同一容器只绑一次；同时在验证中监听网络，确认一次拖拽只发一个 POST |
| **修复后 `codes` 取值与后端不匹配** | ETF 传裸 code（`159915`），股票传 `fullCode`（`600519.SH` / `00700.HK`）；`/api/stocks/reorder` 已同时按 `code` 与 `code.market` 建索引，上一变更已验证 |
| **指数看板回归** | `setupIndexDnDOnce()` 不动，但纳入验证清单（拖拽前后 `index-watchlist.json` 顺序变化） |
| **拖拽期间轮询刷新打断操作** | 已有 `isDraggingCard` 跳过重建机制，保持不变 |

## Migration Plan

1. 改 `initCardDnD`（拆 map + 幂等标记）与 `initFundDnD`（幂等标记）
2. 三处调用点移到渲染分支之外
3. 本地验证：管理员在 ETF / 股票 / 基金 / 指数四个看板拖拽，确认顺序持久化且刷新后保持；游客态确认拖不动
4. `npx jest tests/stocks.test.js tests/etfs.test.js` 确认排序接口回归
5. `npm run package:deploy` → 部署 → `pm2 restart` → 线上抽样

**回滚**：`git revert` 本次改动 + `pm2 restart`；拖拽失败不会损坏关注列表数据（未发起 reorder 请求时 watchlist 不变）。

## Open Questions

1. 是否需要给游客一个"登录后可排序"的提示？—— 现状 `.pro-admin-hint` 仅管理员可见，游客看不到任何提示，本次**不做**改动。
2. 移动端触摸拖拽？—— HTML5 DnD 在触摸端本就不工作，本次**不做**，维持现状（移动端按列表顺序展示）。
