# 技术设计：精简标签页结构并重构整站排版

## Context

- 前端为 `public/index.html` 单文件 SPA（约 14,800 行：CSS ~1-4590、HTML ~4593-5860、JS ~5860-14800），零构建依赖。
- 当前顶部导航 10 个 tab；"每日估值"（`/api/daily-eval`，蛋卷源）与"温度计"（`/api/indices` 的 thermometer 字段 + `/api/thermometer/detail`，有知有行源）数据源独立但主体同为指数；"PE 分析"无独立 API，纯展示 `indexData`；"投资策略"含 7 个子 tab，对应 server.js 中 `/api/strategy/*` 与 `/api/position/*` 约 8 组路由。
- 后端为 `server.js`（Express 单体），数据持久化为 `data/` 下 JSON 文件。
- 约束：保持零构建、CommonJS、CSS 变量主题体系、PBKDF2 认证与交易时段感知刷新逻辑不变。

## Goals / Non-Goals

**Goals:**

1. 顶层导航收敛为 5 个业务 tab + 权限可见的管理入口（数据源管理、用户管理）。
2. 删除 PE 分析（纯前端）与投资策略（前端 + 后端路由）功能。
3. 合并"每日估值"与"温度计"为统一的"估值温度"页。
4. 重构整站排版：统一页面骨架、卡片层次、弹窗与搜索交互，桌面与移动端导航一致且单处维护。

**Non-Goals:**

- 不删除 `data/` 下任何历史 JSON 数据文件（策略数据留作备份）。
- 不改动 `services/` 数据采集层与缓存层。
- 不引入前端框架、构建工具或拆分 index.html 为多文件。
- 不改动认证系统、数据源管理、用户管理功能。

## Decisions

### D1: 合并页信息架构 — 前端按 code join，不新增聚合 API

新页 `data-tab="valuation"`（"估值温度"）以指数关注列表为主体，前端将 `/api/daily-eval`（蛋卷估值）与 `/api/indices` 响应中的 `thermometer` 字段按指数 code join，每指数一卡：左侧估值指标（PE/百分位/股息率），右侧温度计温度与档位色阶，行内展开调用 `/api/thermometer/detail` 查看温度详情。

- **理由**：两数据源 TTL 与缓存节奏不同（行情感知），分开拉取可保留各自缓存；后端聚合会扩大改动面且引入缓存合并复杂度。
- **备选（拒绝）**：后端新增 `/api/valuation-combined` 聚合接口 — 需处理两源 TTL 差异与 failover 组合，收益低。

### D2: PE 分析删除策略 — 纯前端清理

删除 `#tab-analysis` HTML、`renderAnalysisCards` / `renderValueMeters` / `renderPercentileBars` 函数及 `renderAll()` 与 tab 切换处的调用点。`/api/indices` 保留（基金总览依赖）。

### D3: 投资策略删除策略 — 前后端全删，温度计 API 保留

- 前端：删除 `#tab-strategy` HTML、7 个子模块 JS（~7992-10875、14047-14270）及策略专属 CSS 段（如 position records 残留样式）。
- 后端：删除 `/api/strategy/dca-plans`、`active-fund-plans`、`gold`、`etf`、`etf-grid`、`sp500`、`/api/position/*` 全部路由。`/api/position/records` 为已无前端调用的死代码，一并删除。
- **保留** `/api/thermometer/detail` 与 `/api/thermometer/refresh`（合并页依赖）；`data/` 下策略 JSON 不删。

### D4: 导航结构 — 收敛后清单 + 单一 tab 注册表

顶层导航目标：`基金总览 / ETF 总览 / 股票总览 / 估值温度 / 公众号`，管理入口（⚙ 数据源管理、👤 用户管理）靠右且按权限显示。移动端底部导航 4 个主 tab（基金/ETF/股票/估值温度）+ "更多"（公众号、管理类）。前端建立单一 tab 注册表常量（label、icon、data-tab、权限），顶部 nav 与移动端菜单均由它渲染，消除双份维护。

### D5: 排版重构策略 — 保留主题变量体系，统一骨架与组件规范

不整体重写 CSS，而是：

1. **统一页面骨架**：每个 tab 页采用 `page-header`（标题 + 副标题 + 操作按钮区）+ 卡片网格内容区结构，明确"导航 → 页头 → 内容 → 弹窗"四层视觉层级。
2. **统一组件规范**：弹窗（指数详情、基金详情、ETF 详情、登录）与搜索框（指数/基金/ETF/股票四套）收敛为统一 CSS 类与 DOM 模式，去除复制粘贴式样式漂移。
3. **层次优化**：统一卡片圆角/阴影/间距刻度（基于 `:root` 现有变量扩展 spacing/层级 token），导航视觉减重（去多余描边、当前 tab 高亮更明确）。
4. 深浅双主题在改动后逐一检查，`data-theme` 机制不变。

### D6: 实施顺序 — 删除 → 合并 → 重排

三个阶段相互独立可验证：先删 PE 分析与投资策略（含后端路由），再合并估值温度页，最后整体排版重构。每阶段完成后手工验证页面可加载、tab 切换正常。

## Risks / Trade-offs

- [巨型单文件删除易误伤共享函数] → 删除前逐函数搜索引用计数；分模块小步修改；依赖浏览器控制台无报错验证。
- [两数据源指数覆盖不一致，join 后出现空字段] → 以关注列表为主键，缺失方显示"—"占位且不报错；合并页 spec 中明确容错要求。
- [排版重构回归范围大] → 保留 CSS 变量体系与模块分区注释，按"骨架 → 组件 → 细节"顺序渐进；每步在深浅两主题下检查。
- [移动端"更多"面板与顶部 nav 不同步] → D4 的单一 tab 注册表从结构上消除。
- [删除策略 API 后前端残留 fetch 调用导致 404 报错] → 全文搜索 `/api/strategy`、`/api/position` 确认清零。

## Migration Plan

- 无数据库，部署即生效；回滚 = 还原 git 上一版本（数据文件未动，回滚无数据损失）。
- 部署前备份 `data/` 目录（既有运维惯例）。

## Open Questions

- 合并页命名："估值温度"（默认采用）vs "温度计"。采用"估值温度"以体现两数据源合并。
