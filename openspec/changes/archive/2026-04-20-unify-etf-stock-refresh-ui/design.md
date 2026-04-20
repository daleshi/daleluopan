## Context

当前 `public/index.html` 中：

- **ETF Tab**（行 3391-3397）：`etf-toolbar-right` 容器内有 `etf-status` div（状态点 + 状态文字）和 `#etfUpdateTime` span
- **股票 Tab**（行 3420-3426）：类似的状态区块包含 `stock-status` div 和 `#stockUpdateTime` span
- `renderETFs()` / `renderStocks()` 函数已通过 `setTopUpdateTime()` 更新顶部时间，但 `statusDot` 同步只在 `handleIndexAutoRefresh()`（dashboard 专用）中处理，ETF/股票更新时不更新顶部状态点
- 顶部 `#statusDot` 有三种样式：`meta-dot`（普通）、`meta-dot live`（交易中）、`meta-dot warn/error`（异常）

**约束**：纯原生 JS 单文件，不引入新依赖。

## Goals / Non-Goals

**Goals:**
- 删除 ETF/股票 Tab 内的状态点、状态文字、更新时间 UI 元素
- 在 `renderETFs()` / `renderStocks()` 中补充更新顶部 `#statusDot` 的逻辑，确保切换 Tab 后顶部状态反映正确的交易状态

**Non-Goals:**
- 不改变搜索框、数据卡片等其他 UI
- 不修改后端 API
- 不改变自动刷新调度逻辑

## Decisions

### 决策 1：顶部 statusDot 如何在多 Tab 间共享

**选择**：在 `renderETFs()` 和 `renderStocks()` 中直接按 `isTrading` 更新 `#statusDot`，与 `applyIndexRefreshMeta()` 保持相同的更新模式。

**理由**：现有 `applyIndexRefreshMeta()` 已有完整的 statusDot 更新逻辑（warn/live/normal 三态），ETF/股票只需复用相同模式，无需引入新的抽象。

### 决策 2：etfUpdateTime / stockUpdateTime 元素是否保留

**选择**：直接删除 HTML 元素，同时清理 `renderETFs()` / `renderStocks()` 中对这两个 ID 的 `getElementById` 引用。

**理由**：这两个元素已无用途（`setTopUpdateTime()` 已统一顶部时间），保留会产生死代码。

## Risks / Trade-offs

| 风险 | 缓解措施 |
|---|---|
| 切换到 ETF Tab 时，顶部 statusDot 可能短暂显示 dashboard 的状态 | Tab 切换时立即调用 `loadETFData()`，渲染完成后立即更新 statusDot，用户感知 < 100ms |
| 删除 `etfRefreshBtn` / `stockRefreshBtn` 的 spinning 已在上次改造中完成，本次只需清理剩余 DOM 引用 | 上次已将 refreshBtn 改为顶部全局，无风险 |

## Migration Plan

1. 删除 ETF Tab HTML 中的 `etf-toolbar-right` div（含状态点、状态文字、更新时间）
2. 删除股票 Tab HTML 中对应的状态+时间 div
3. 在 `renderETFs()` 中：移除 `etfStatusDot`/`etfStatusText`/`etfUpdateTime` 的 DOM 引用，补充 `#statusDot` 更新逻辑
4. 在 `renderStocks()` 中：移除 `stockStatusDot`/`stockStatusText`/`stockUpdateTime` 的 DOM 引用，补充 `#statusDot` 更新逻辑

**回滚**：git revert 单文件即可。
