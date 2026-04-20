## Why

当前前端数据刷新逻辑分散在 `index.html` 各个模块中，每个 Tab（指数、ETF、股票）各自独立管理定时器，且同一 Tab 内存在多个互不同步的轮询器（如 `indexRefresher` 和 `indexQuotesRefresher` 分别以随机间隔刷新不同数据，导致 PE/PB 与价格可能来自不同时刻的快照）。此外，轮询器的启动/停止逻辑与 Tab 切换、交易状态判断耦合在多处，维护困难，新增 Tab 时容易遗漏刷新控制。

## What Changes

- **新增**统一的 `DataRefreshScheduler` 调度器，作为全局唯一的轮询入口，负责按 1-3 秒随机间隔统一触发所有激活数据的刷新
- **移除**现有的分散式轮询器：`indexRefresher`、`indexQuotesRefresher`、`etfRefresher`、`stockRefresher` 各自独立的 setTimeout 链
- **统一**交易时段判断：调度器内部集中调用 `isMarketOpen()`，各模块不再重复判断
- **统一**Tab 可见性守卫：调度器根据当前激活 Tab 决定刷新哪些数据，Tab 切换时只需通知调度器，不再在切换处散布启动/停止逻辑
- **保持**现有的平滑刷新（无闪烁）渲染逻辑（`smooth-refresh` spec 要求）不变，只是触发来源统一

## Capabilities

### New Capabilities

- `unified-data-refresh-scheduler`: 统一数据刷新调度器——单一轮询入口，管理所有实时数据（指数、行情、ETF、股票）的刷新节奏与 Tab 可见性守卫

### Modified Capabilities

- `smooth-refresh`: 刷新触发来源从多个独立定时器变为统一调度器触发，渲染行为要求不变

## Impact

- **修改文件**：`public/index.html`（~9509 行）
  - 移除 `indexRefresher`、`indexQuotesRefresher`、`etfRefresher`、`stockRefresher` 独立定时器定义（约 30 行）
  - 移除 Tab 切换事件监听器中分散的 `start/stop` 调用（约 20 行）
  - 新增 `DataRefreshScheduler` 类/闭包（约 60 行）
  - 修改各 `load*Data()` 函数，移除其内部的自动刷新启动逻辑
- **无后端变更**：全部为前端改造，API 接口不变
- **无新依赖**：纯原生 JS 实现
