## Why

严选ETF 目前只有"看板 + 搜索添加"两层能力：用户能跟踪 ETF 行情，却无法把看板里的标的转成可执行的交易计划。ETF 网格交易（等比对称网格：`基准价 × (1 + 步长)^档位`）是震荡市吃波动的核心策略，此前在 `9e55d1c` 已完整实现过，但在 `05dce25`（`优化排版，修复若干bug`，server.js -2682 行 / index.html -5987 行）中与黄金、标普等策略一起被整批删除——`services/etfGridEngine.js`（445 行，10 个导出函数）与 `tests/etfStrategy.test.js` 保留了下来，但路由层与 UI 层已不存在。线上 PM2 仍在响应 `/api/strategy/etf-grid-plans` 只是因为跑的是旧代码，一旦重启即消失。

现在需要在严选ETF 下重建该功能：让管理员能把看板里的 ETF 配置成网格标的（中线 / 步长 / 网数 / 预算），系统自动计算每档价位、下一网买卖点、持仓浮盈与保护状态，并支持手动补录成交。

## What Changes

- **后端新增 ETF 网格策略路由组**（`/api/strategy/etf-grid-*`）：标的 upsert / 删除 / 重置中线、成交记录新增 / 删除、推荐视图计算
- **后端新增策略与持仓持久化**：`data/etf-grid-strategy.json`、`data/etf-grid-holdings.json`（文件已存在但为空），改用 `services/db/atomicWrite.js` 的 `writeJsonAtomic` 原子写
- **后端新增字段校验**：步长、网数、中线、预算、手续费率、温度阈值、连续买入冷却的取值范围与交叉约束（超配仅软警告）
- **前端严选ETF 页内新增"ETF 网格交易"区块**：标的列表（公开只读）+ 网格价位表折叠块，管理员可见「＋ 新增网格」与编辑 / 记一笔 / 重置中线 / 删除操作
- **前端 ETF 卡片新增网格快捷入口**：每张卡片可直接为对应标的创建 / 跳转网格配置
- **复用既有引擎**：`services/etfGridEngine.js` 的 `buildGridTable` / `buildRecommendation` / `computeFifoGridPnl` / `computeProtection` 等直接 require，不重写算法
- **权限模型**：列表公开只读（游客可见），增删改仅管理员（`requireAdmin`）

## Capabilities

### New Capabilities

- `etf-grid-trading`: ETF 网格交易标的的配置管理（增改删、重置中线）、成交记录补录、网格价位表与推荐计算，以及严选ETF 页内的网格区块与卡片快捷入口

### Modified Capabilities

（无 — 不改动既有 spec 的需求；本次为纯新增能力）

## Impact

**代码**
- `server.js`（2222 行）：新增约 200 行——数据文件读写、字段校验、7 条路由
- `public/index.html`（10133 行）：新增约 600 行——区块 HTML、列表渲染、表单弹窗、价位表、4 个交互

**复用的既有资产**
- `services/etfGridEngine.js`（不动）
- `services/etfFetcher.js` → `etfFetchQuotes()` 拉实时价
- `fetchYZYXThermometer()` 拉市场温度（保护机制）
- `services/db/atomicWrite.js` → `writeJsonAtomic()`
- 前端现有 CSS：`section-header` / `section-title` / `section-badge` / `chart-desc`（`pos-form` / `dca-add-btn` / `afund-empty` 已被删，表单改用 `auth-modal` + `auth-field` 样式）

**数据**
- `data/etf-grid-strategy.json`、`data/etf-grid-holdings.json`：首次启动自动创建空文件，不预置任何策略

**API**
- 新增 7 个端点，均为 `/api/strategy/etf-grid-*` 前缀；GET 类公开，写类 `requireAdmin`

**风险**
- 部署包 `scripts/package-deploy.sh` **包含** `data/*.json`（仅排除 `data/db` 与 `data/backup`）；服务端 `dist/deploy.sh` 会在解压后用备份的 `data/*.json` 覆盖回去，因此服务端策略与 watchlist 数据不受覆盖影响——新增的两个网格文件在服务端已存在（旧版本创建的空文件），恢复后保持服务端版本
- 线上旧进程重启后旧路由消失属预期，本次落地即为恢复
