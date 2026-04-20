## Why

在上一次 `unify-data-refresh` 改造中，基金总览（dashboard）Tab 的分散刷新按钮和状态显示已统一到顶部 header；但 ETF 总览和股票总览 Tab 内仍残留独立的状态点（交易中/已收盘）、状态文字和更新时间元素，与基金总览的体验不一致。用户需要在 ETF/股票 Tab 也能通过顶部统一区域看到数据状态和更新时间，Tab 内部不再重复展示。

## What Changes

- **移除** ETF Tab 工具栏中的 `etf-status`（状态点 + 状态文字）和 `#etfUpdateTime` 区块
- **移除** 股票 Tab 工具栏中的 `stock-status`（状态点 + 状态文字）和 `#stockUpdateTime` 区块
- **统一** `renderETFs()` 和 `renderStocks()` 的交易状态反馈到顶部 `#statusDot` 和 `#updateTime`（已有 `setTopUpdateTime()` 入口，追加 `statusDot` 同步即可）
- **保持** 搜索框、无数据提示等非状态 UI 不变

## Capabilities

### New Capabilities

（无新能力）

### Modified Capabilities

- `unified-data-refresh-scheduler`: ETF/股票 Tab 的交易状态（statusDot 样式）和更新时间现在也通过顶部 header 统一展示，与 dashboard Tab 行为对齐

## Impact

- **修改文件**：`public/index.html`
  - HTML 层：删除 ETF Tab 内 `etf-toolbar-right` 区块（约 7 行），删除股票 Tab 内状态+时间区块（约 8 行）
  - JS 层：`renderETFs()` 和 `renderStocks()` 中补充对顶部 `statusDot` 的更新逻辑；移除对已删除 DOM 元素的引用
- **无后端变更**，无新依赖
