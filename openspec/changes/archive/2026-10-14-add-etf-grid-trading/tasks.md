## 1. 后端：持久化与校验层

- [x] 1.1 在 `server.js` 顶部 require `./services/etfGridEngine`（10 个导出全量引入）与 `./services/db/atomicWrite` 的 `writeJsonAtomic`
- [x] 1.2 定义 `ETF_GRID_STRATEGY_FILE` / `ETF_GRID_HOLDINGS_FILE` 路径常量，实现 `readEtfGridStrategies()` / `writeEtfGridStrategies()` / `readEtfGridHoldings()` / `writeEtfGridHoldings()`（读写失败降级为空数组 + `[ETF网格]` 警告日志）
- [x] 1.3 实现 `ensureEtfGridDataFiles()` 并在启动时调用：文件不存在则创建空结构，**不预置策略**
- [x] 1.4 实现 `validateEtfGridStrategy(input)`：8 个必填 + 4 个可选字段的取值范围与交叉约束校验，返回 `{ ok, error, processed, warnings }`；满仓资金超预算仅进 `warnings`
- [x] 1.5 在 `validateEtfGridStrategy` 中增加「`fundCode` 必须存在于当前 ETF 看板（`readEtfWatchlist()`）」校验，并从看板项自动带出 `fundName` / `secid`
- [x] 1.6 实现 `clearEtfGridRecommendationCache()`：删除磁盘缓存文件 + 删除内存缓存项

## 2. 后端：策略配置路由

- [x] 2.1 `GET /api/strategy/etf-grid-plans`（公开）：返回 `{ success, data: { strategies } }`
- [x] 2.2 `POST /api/strategy/etf-grid-plans`（`requireAdmin`）：以 `fundCode` 为唯一键 upsert，新增写 `createdAt`，更新保留 `createdAt` 并刷新 `updatedAt`；成功后清缓存
- [x] 2.3 `POST /api/strategy/etf-grid-plans/delete`（`requireAdmin`）：按 `fundCode` 删除，不存在返回 404；成交记录保留不级联
- [x] 2.4 `POST /api/strategy/etf-grid-plans/reset-base-price`（`requireAdmin`）：带 `newBasePrice` 时用之，否则用 `fetchETFQuotes` 取实时价；无 `secid` 或取价失败返回 400 明确文案；刷新 `updatedAt` 并清缓存

## 3. 后端：成交记录与推荐路由

- [x] 3.1 `GET /api/strategy/etf-grid-holdings`（公开）：按 `date` 倒序、`createdAt` 倒序返回全部记录
- [x] 3.2 `POST /api/strategy/etf-grid-holdings`（`requireAdmin`）：校验 `type ∈ {base, buy, sell}`、`date` 匹配 `YYYY-MM-DD`、`price/shares/amount > 0`、`gridLevel` 为整数且与 `type` 符号一致、`|gridLevel| ≤ gridLevels`；生成 `id` + `createdAt` 后追加并清缓存
- [x] 3.3 `POST /api/strategy/etf-grid-holdings/delete`（`requireAdmin`）：按 `id` 删除记录并清缓存
- [x] 3.4 `GET /api/strategy/etf-grid-recommendations`（公开）：策略为空直接返回；否则批量 `fetchETFQuotes`（market 由 `secid` 前缀推导）+ `fetchYZYXThermometer()`，逐策略调用 `buildRecommendation`
- [x] 3.5 推荐接口接入 `smartCacheGet('etf-grid-recommendations', ...)`，支持 `?refresh=1`；行情/温度失败时降级传 `null` 并标记 `stale`，仍返回 200

## 4. 前端：严选ETF 网格区块与列表

- [x] 4.1 在 `#tab-etf` 的 `#etfGrid` 之后插入「ETF 网格交易」section：`section-header`（标题 + `ETF Grid` badge + `＋ 新增网格` 按钮）+ `chart-desc` 说明文案 + `#etfGridStrategyList` 容器
- [x] 4.2 补齐列表所需 CSS（表头 / 行 / 状态徽章 / stale 标记 / 空态 / 折叠块），沿用现有设计 token 与 `section-*` 既有样式
- [x] 4.3 实现 `loadEtfGridData()`：`Promise.all` 拉取 plans / recommendations / holdings，挂载到 ETF tab 激活、`refreshCurrentTab` 与调度器轮询
- [x] 4.4 实现列表渲染：标的 / 现价 / 距中线 / 步长×网数 / 中线 / 下一网 / 持仓浮盈 / 状态徽章；缺价显示 `--` + stale 标记
- [x] 4.5 实现空态：非管理员「暂无网格策略」，管理员追加「点击右上角"＋ 新增网格"开始配置」
- [x] 4.6 实现「📊 网格价位表」折叠块：逐档展示 档位 / 目标价 / 动作 / 状态 / 单轮预期净利；保护生效时买入档显示 `paused` + 暂停原因

## 5. 前端：网格配置表单弹窗

- [x] 5.1 基于现有 `auth-modal` + `auth-field` 样式新增 `#etfGridFormMask` 弹窗骨架，字段分四组：标的选择 / 网格参数 / 资金规划 / 保护机制
- [x] 5.2 标的下拉由 ETF 看板数据生成（复用已加载的 `etfData`），选中后自动带出名称与 secid
- [x] 5.3 实现 `openEtfGridForm(fundCode?)`：新增态标题「添加 ETF 网格策略」并预选标的，编辑态标题「编辑网格策略：<名称>」并预填全部字段
- [x] 5.4 实现「使用当前价」按钮：取该 ETF 实时价填入中线框并展示当前价提示
- [x] 5.5 实现网格价位实时预览：步长 / 单侧网数 / 中线齐全时渲染价位表，否则显示引导文案
- [x] 5.6 实现保存提交：编辑与重置中线前弹 `confirm` 二次确认（提示历史成交锁定到旧轮次），提交后刷新列表并关闭弹窗

## 6. 前端：成交补录与权限显隐

- [x] 6.1 实现「记一笔」交互：填写 type / gridLevel / date / price / shares / amount / note 并提交到 `/api/strategy/etf-grid-holdings`
- [x] 6.2 实现成交记录列表（折叠块，带删除按钮）与「重置中线」按钮及其二次确认
- [x] 6.3 按 `isAdmin` 控制「＋ 新增网格」、编辑 / 记一笔 / 重置 / 删除按钮的显隐（非管理员不渲染）
- [x] 6.4 在看板每张 ETF 卡片上新增 🕸️ 网格快捷入口（仅管理员可见）：已配置则打开编辑弹窗，未配置则打开新增弹窗并预选该标的

## 7. 验证

- [x] 7.1 本地走通：空态 → 新增策略 → 列表出现 → 展开价位表 → 记一笔 → 重置中线 → 删除（浏览器实测 + curl 实测）
- [x] 7.2 回归验证：`npx jest tests/etfEngine.test.js` 37/37 通过。⚠️ 勘误：`tests/etfStrategy.test.js` 覆盖的是 ETF **定投**策略（`/api/strategy/etf-*`，`etfStrategyEngine`），与本次网格无关，其失败源于另一批被删路由，**不在本变更范围**
- [x] 7.3 校验边界用例：步长 0.6、网数 21、底仓 > 预算、buy 档位 ≥ 0、日期格式非法、非看板 fundCode —— 均应 400 且不写盘
- [x] 7.4 游客视角验证：可见列表全部数据列，所有写操作入口隐藏（新增/编辑/记一笔/重置/删除/卡片入口均不可见）；直接调写接口返回 401
- [x] 7.5 移动端窄屏验证（390×844）：列表降为 4 列，隐藏「距中线 / 步长×网数」，行内标签显示，表头隐藏

## 8. 部署

- [x] 8.1 `npm run package:deploy` 生成发布包 → `dist/dale-compass-20261013-213816.tar.gz`（包内含 `data/*.json`，服务端部署脚本会还原备份，不会覆盖线上策略数据）
- [x] 8.2 上传服务器 `43.136.122.239:/data/dale-compass`、备份 `data/`、解压（排除 `data/`）、`pm2 restart` 网站与采集进程
- [x] 8.3 服务器本地 `curl` 抽样 3 个 GET 端点均 200；启动日志无 Error；清理了 Sep 29 遗留的 `data/cache/etf-grid-recommendations.json` 陈旧缓存
- [x] 8.4 线上验证：页面 HTML 含「ETF 网格交易」区块与 `etfGridStrategyList`（2 处）；`server.js` 含 11 处 `etf-grid-plans`。⚠️ 3200 端口未对外暴露（外网访问返回网关 502），无法从本机浏览器直连，前端交互以本地实测为准
