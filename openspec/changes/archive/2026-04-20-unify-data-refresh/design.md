## Context

当前 `public/index.html`（~9509 行）前端代码中，数据刷新逻辑分散在四处：

- **指数数据**：`indexRefresher`（行 4401）调用 `loadData(true)`
- **指数行情**：`indexQuotesRefresher`（行 6504）调用 `loadIndexQuotes(true)`
- **ETF 数据**：`etfRefresher`（行 7443）调用 `loadETFData()`
- **股票数据**：`stockRefresher`（行 8243）调用 `loadStockData()`

四个轮询器各自独立地以 3-5 秒随机间隔运行 setTimeout 链，且 Tab 切换时分别在多处调用 `start()/stop()`。同一 `dashboard` Tab 内，`indexRefresher` 与 `indexQuotesRefresher` 并发运行、彼此不同步，导致 PE/PB 数值与实时价格可能来自不同时刻的数据快照，造成数据不一致。

**约束**：
- 项目无构建工具，纯原生 JS，必须在单文件 `public/index.html` 内实现
- 必须保持 `smooth-refresh` spec 的无闪烁渲染行为不变
- 不引入新的外部依赖

## Goals / Non-Goals

**Goals:**
- 用单一 `DataRefreshScheduler` 替代四个独立轮询器，统一刷新节奏和调度入口
- 每次调度周期内，按当前激活 Tab 决定刷新哪些数据，避免跨快照不一致
- Tab 切换只需通知调度器更新上下文，不再分散 start/stop 逻辑
- 刷新对用户完全透明（无 loading 动画、无页面抖动）

**Non-Goals:**
- 不改变后端 API 接口
- 不对基金（`loadActiveFundData`）、每日估值（`loadDailyEval`）等非实时数据加入轮询
- 不对站点统计的 30 秒轮询（`_statsRefreshTimer`）进行改造
- 不修改数据的渲染逻辑（增量 DOM 更新由 `smooth-refresh` spec 保障）

## Decisions

### 决策 1：单一调度器 vs. 多轮询器协调器

**选择**：单一 `DataRefreshScheduler` 闭包，内含一条 setTimeout 链

**理由**：
- 多轮询器协调器（Orchestrator）方案需要维护轮询器间的同步锁，复杂度高
- 单一 setTimeout 链天然串行，同一周期内的刷新请求不会并发竞争
- 项目为纯原生 JS 单文件，单闭包方案代码量更小，易于定位

**被否决的方案**：保留多轮询器但增加同步屏障——依然分散，只是加了锁，解决问题不彻底

---

### 决策 2：刷新间隔 1-3 秒 vs. 3-5 秒

**选择**：1-3 秒随机间隔（`Math.random() * 2000 + 1000`）

**理由**：
- 用户需求明确要求 1-3 秒
- 服务端有三层缓存（内存 L1 → 磁盘 L2 → stale 回退），交易时段 TTL 为 5 秒，1-3 秒请求均命中缓存，不增加上游数据源压力
- 相较原 3-5 秒体验更实时

**风险**：服务端内存缓存 5 秒 TTL，1-3 秒请求中约有一半返回缓存数据而非新数据——这符合预期，用户感知是"持续有数据"而非"每次都最新"

---

### 决策 3：Tab 上下文切换方式

**选择**：调度器暴露 `setActiveTab(tabName)` 方法，Tab 切换事件统一调用

**理由**：
- 调度器内部维护 `currentTab` 状态，每次触发前按 `currentTab` 决定刷新哪个 `load*` 函数
- Tab 切换处从"调用多个 start/stop"简化为"调用一次 setActiveTab"
- 清晰、单一职责

---

### 决策 4：dashboard Tab 的两个数据源（indices + quotes）如何统一

**选择**：在同一调度周期内，`dashboard` Tab 顺序调用 `loadData(true)` 后再调用 `loadIndexQuotes(true)`（串行，不并发）

**理由**：
- 两个接口的数据代表同一时刻的市场状态，串行调用确保 UI 更新在同一 Event Loop Tick 内完成
- 若并发调用，两个 `render*` 可能交错触发，仍有不一致风险

**被否决的方案**：后端提供合并接口——超出本次范围，且后端本已有缓存层

---

## Risks / Trade-offs

| 风险 | 缓解措施 |
|---|---|
| 串行刷新导致 `dashboard` 每次耗时翻倍（两次 fetch） | 两次均命中内存缓存（5s TTL），实测延迟 < 20ms，可接受 |
| 调度器 `stop()` 后页面卸载前还有一次挂起的 setTimeout | 单次 setTimeout 挂起最多 3 秒，无副作用，不处理 |
| `setActiveTab()` 调用遗漏（老代码未迁移） | 单次 code review 可覆盖，Tab 切换入口唯一（一个事件监听器） |

## Migration Plan

1. 在 `index.html` 中新增 `DataRefreshScheduler` 定义（紧接 `createTradingRefresher` 之后）
2. 删除旧的四个 `*Refresher` 常量定义
3. 删除各 `load*Data()` 函数内部的 `refresher.start()/stop()` 调用
4. 删除 Tab 切换监听器内所有 `start*/stop*` 调用，替换为 `scheduler.setActiveTab(tabName)`
5. 在页面初始化处调用 `scheduler.setActiveTab('dashboard')` 并 `scheduler.start()`

**回滚**：单文件改动，git revert 即可

## Open Questions

无——设计已足够明确，可直接实现。
