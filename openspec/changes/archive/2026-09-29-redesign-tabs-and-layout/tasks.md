# 任务清单：精简标签页结构并重构整站排版

> 依赖顺序：删除 → 合并 → 重排（design.md D6）。每个任务组完成后手工验证页面可加载、tab 切换正常。

## 1. 前置准备与代码定位

- [x] 1.1 备份 `data/` 目录（策略历史数据不删，仅备份以防万一）
- [x] 1.2 在 `public/index.html` 中精确定位并记录：PE 分析区块（`#tab-analysis` ~4952-4978）、投资策略区块（`#tab-strategy` ~4981-5526）、每日估值区块（`#tab-daily-eval` ~4805-4866）、温度计区块（`#tab-thermometer` ~4868-4950）及相关 JS/CSS 段行号
- [x] 1.3 搜索确认策略相关函数的引用计数，标记与保留模块（温度计、指数详情弹窗）共享的函数边界

## 2. 删除 PE 分析功能（前端）

- [x] 2.1 删除 `#tab-analysis` HTML 区块及导航中 `data-tab="analysis"` 按钮（含移动端"更多"面板入口）
- [x] 2.2 删除 `renderAnalysisCards` / `renderValueMeters` / `renderPercentileBars` 函数及 `renderAll()` 中的调用点（~6263-6269）
- [x] 2.3 删除 tab 切换逻辑中对 analysis 的处理（~11147-11152）及 PE 分析专属 CSS 段
- [x] 2.4 验证：基金总览页数据加载、`/api/indices` 渲染正常，控制台无报错

## 3. 删除投资策略功能（前端）

- [x] 3.1 删除 `#tab-strategy` HTML 区块（含 7 个子 tab）及导航按钮（桌面 + 移动端）
- [x] 3.2 删除策略 JS 模块：子 tab 导航（~7992）、ETF DCA（~8045）、ETF GRID（~8577）、GOLD（~9128）、ACTIVE FUND（~9622）、SP500（~10127）、DCA THERMOMETER（~10417）、投资基准（~14047-14270）
- [x] 3.3 删除登出时"离开 strategy tab"的跳转逻辑及 strategy 相关权限守卫 CSS/JS
- [x] 3.4 全文搜索 `/api/strategy` 与 `/api/position` 确认前端调用清零；搜索残留 CSS（如 position records ~3081、~243）并清理
- [x] 3.5 验证：所有保留 tab（基金/ETF/股票/每日估值/温度计/公众号/管理）功能正常，控制台无 404 报错

## 4. 删除投资策略 API（后端）

- [x] 4.1 删除 server.js 中 `/api/strategy/dca-plans` 路由组（~1891-1967）及相关文件读写辅助函数
- [x] 4.2 删除 active-fund-plans（~2419-2501）、gold（~2782-2956）、etf（~3345-3553）、etf-grid（~3764-3950）、sp500（~4228-4267）路由组
- [x] 4.3 删除 `/api/position/*` 路由组（~4335-4495，含已是死代码的 records 接口）
- [x] 4.4 清理仅被已删路由使用的常量、辅助函数与未使用变量；确认 `/api/thermometer/*`、`/api/indices`、`/api/daily-eval` 完整保留
- [x] 4.5 验证：`npm start` 启动无报错，`/api/health`、`/api/indices`、`/api/daily-eval`、`/api/thermometer/detail` 均正常返回

## 5. 合并每日估值与温度计为"估值温度"页

- [x] 5.1 创建新页 `data-tab="valuation"`（估值温度）：以指数关注列表为主体，前端按指数 code join `/api/daily-eval` 与 `/api/indices` 的 thermometer 字段
- [x] 5.2 实现指数卡片：左侧估值指标（PE/百分位/股息率）、右侧温度计温度与档位色阶；数据缺失时显示"—"占位且不阻塞渲染（spec: valuation-thermometer 缺失容错）
- [x] 5.3 迁移温度详情行内展开功能（调用 `/api/thermometer/detail`，原 ~7668 逻辑）
- [x] 5.4 删除原 `#tab-daily-eval` 与 `#tab-thermometer` 区块及其独立导航入口，合并相关 JS 到统一模块
- [x] 5.5 验证：两数据源指标均正确展示、行内展开正常、`/api/daily-eval` 失败时温度计部分仍渲染

## 6. 整站排版重构

- [x] 6.1 建立统一页面骨架：每个 tab 采用 page-header（标题 + 副标题 + 操作按钮区）+ 卡片化内容区结构
- [x] 6.2 扩展 `:root` 间距/层级 token（spacing、阴影、圆角刻度），统一卡片视觉规范
- [x] 6.3 统一弹窗样式：指数详情、基金详情、ETF 详情、登录弹层收敛为统一 CSS 类与 DOM 模式
- [x] 6.4 统一搜索框：指数/基金/ETF/股票四套搜索使用一致的样式与交互模式
- [x] 6.5 导航视觉优化：当前 tab 高亮更明确、去多余描边、管理入口靠右；深浅两主题下逐一检查
- [x] 6.6 验证：深浅主题下所有页面骨架、卡片、弹窗、搜索框显示正常，无不可读元素

## 7. 移动端导航同步

- [x] 7.1 建立单一 tab 注册表常量（label、icon、data-tab、权限），桌面 nav 与移动端菜单均由其渲染
- [x] 7.2 移动端底部导航调整为：基金总览 / ETF 总览 / 股票总览 / 估值温度 + "更多"（公众号、管理入口按权限）
- [x] 7.3 更新移动端"更多"面板，移除已删除功能入口；清理 `switchMobileTab` 等切换逻辑
- [x] 7.4 验证：≤768px 视口下底部导航与"更多"面板内容正确，桌面/移动功能集一致

## 8. 收尾与整体验证

- [x] 8.1 全文搜索确认无残留：`strategy`、`dca-plan`、`etf-grid`、`sp500`、`position`（前端 fetch 与后端路由）
- [x] 8.2 更新 `README.md` 与 `CODEBUDDY.md` 中的页面模块清单、API 路由表、数据文件说明（标注策略文件已闲置保留）
- [x] 8.3 端到端手工验证：登录/登出、主题切换、全部 tab 切换、搜索、弹窗、移动端视口
- [x] 8.4 `npm run package:deploy` 打包验证（可选，由用户决定是否部署）
