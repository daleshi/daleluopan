# 提案：精简标签页结构并重构整站排版

## Why

当前站点顶部导航多达 10 个标签页，其中"每日估值 / 温度计 / PE 分析"三个估值类页面内容高度同质（PE 分析无独立数据源，纯粹重复展示 `indexData`），"投资策略"内嵌 7 个子 tab 形成双层导航，层级过深。信息架构冗余导致用户浏览路径长、认知负担重，亟需一次"减法 + 重排"来让核心能力（估值判断 + 资产总览）更突出。

## What Changes

### 功能删除（**BREAKING**）

- **删除"PE 分析"标签页**：移除 HTML 区块（`#tab-analysis`）、`renderAnalysisCards` / `renderValueMeters` / `renderPercentileBars` 及其调用点。该页无独立后端 API（复用 `/api/indices`），后端无需改动。
- **删除"投资策略"标签页**：移除 HTML 区块（`#tab-strategy`）及 7 个子模块（ETF投资 / ETF网格 / 黄金 / 主动基金 / 标普500 / 温度计定投 / 投资基准）的全部前端 JS。
- **删除后端策略 API**：移除 server.js 中 `/api/strategy/*` 与 `/api/position/*` 全部路由（dca-plans、active-fund-plans、gold、etf、etf-grid、sp500、position benchmarks/records/index-pool）。
  - **保留** `/api/thermometer/*`（温度计页面依赖）与 `/api/indices`（总览页面依赖）。
  - `data/` 下的策略 JSON 数据文件（dca-plan.json 等）**不主动删除**，留作历史数据备份，仅代码不再读写。
  - `/api/position/records` 前端本已无调用（死代码），一并清理。

### 功能合并

- **"每日估值" + "温度计"合并为一个标签页**：新页面（建议名"估值温度"）以指数为统一主体，整合蛋卷每日估值数据与有知有行温度计数据，消除两个页面间重复的指数列表展示。

### 排版重构

- **整站排版重新设计**：基于精简后的标签页结构，重排 header / 导航 / 内容区层次，统一弹窗与搜索交互样式，优化移动端底部导航与"更多"面板的双份 tab 维护问题，实现层次清晰、简洁大方的视觉结构。

## Capabilities

### New Capabilities

- `valuation-thermometer`: 合并后的统一估值页 — 以指数为实体，聚合展示每日估值（蛋卷源）与温度计（有知有行源）数据，支持温度详情查看。
- `app-layout`: 整站信息架构与排版规范 — 精简后的顶层导航（基金总览 / ETF / 股票 / 估值温度 / 公众号 / 管理）、统一的页面骨架、弹窗与搜索交互模式、响应式布局。

### Modified Capabilities

- `mobile-layout`: 顶部导航与移动端底部导航/"更多"面板需按精简后的 tab 清单同步收敛，去掉双份维护。

### Removed Capabilities（随本次变更废弃）

- `etf-dca-strategy`、`etf-grid-strategy`、`gold-dca-strategy`、`sp500-dca-strategy`、`active-fund-dca-strategy`、`dca-thermometer-recommendation`、`strategy-tab-auth-guard`

## Impact

- **前端**：`public/index.html`（约 14,800 行单文件 SPA）
  - 删除：`#tab-analysis`（~4952-4978）、`#tab-strategy`（~4981-5526）及对应 CSS/JS（策略 JS 约 7992-10875、14047-14270；PE 分析 JS 7944-7990 及 renderAll 调用点 6263-6269）。
  - 合并：`#tab-daily-eval`（~4805-4866）与 `#tab-thermometer`（~4868-4950）。
  - 重构：导航栏、页面骨架、CSS 变量与模块分区、移动端导航。
- **后端**：`server.js` 删除约 1891-1967、2419-3950、4228-4267、4335-4495 行的路由组（策略/加仓相关），其余模块无引用，可安全移除。
- **数据**：`data/` 下策略 JSON 文件保留不删；`data/cache/daily-eval.json`、指数缓存继续使用。
- **无影响**：认证系统、数据源管理、用户管理、基金/ETF/股票总览、`/api/thermometer/*`、`/api/indices`、`/api/daily-eval`。
