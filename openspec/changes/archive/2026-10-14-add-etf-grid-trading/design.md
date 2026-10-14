## Context

严选ETF（`data-tab="etf"`）当前只有两层能力：搜索添加（`/api/etfs/search` + `/api/etfs/add`）与卡片看板（`/api/etfs`）。`public/index.html` 中该 tab 的结构仅 15 行（3579-3594）：`etf-toolbar`（搜索框 + 提示）+ `#etfGrid`（卡片网格）。

ETF 网格交易曾完整实现过（`9e55d1c`），随后在 `05dce25`（`优化排版，修复若干bug`：server.js −2682 行 / index.html −5987 行）与黄金、标普、主动基金等策略一起被批量删除。当前状态：

| 层 | 状态 |
|---|---|
| 算法引擎 `services/etfGridEngine.js`（445 行 / 10 导出） | ✅ 完好，可直接 require |
| 测试 `tests/etfStrategy.test.js` | ⚠️ 孤儿（路由已不存在） |
| 数据文件 `data/etf-grid-strategy.json` / `etf-grid-holdings.json` | ✅ 存在但为空数组 |
| 路由 `/api/strategy/etf-grid-*`（server.js） | ❌ 不存在 |
| UI（index.html） | ❌ 不存在 |
| 线上 PM2 | ⚠️ 仍响应，因为跑的是旧代码；重启即失效 |

因此本次是**在既有算法引擎之上重建路由层与 UI 层**，而非首次设计算法。老实现可从 `git show d05be9b:server.js` / `git show d05be9b:public/index.html` 完整取回，字段校验规则、轮次模型、交互流程均照其恢复。

相关既有资产（本设计直接复用，不重写）：
- `services/etfFetcher.js` → `fetchETFQuotes(list)` 拉实时价
- `services/dataFetcher.js` → `fetchYZYXThermometer()` 拉市场温度
- `services/db/atomicWrite.js` → `writeJsonAtomic(file, data, pretty)`
- `server.js:381` → `smartCacheGet(key, fetcher, forceRefresh)`
- 前端 CSS：`section-header` / `section-title` / `section-badge` / `chart-desc` 仍在；`pos-form` / `dca-add-btn` / `afund-empty` **已被删除**

## Goals / Non-Goals

**Goals:**
- 管理员能在严选ETF 内对**看板中已有的 ETF** 增 / 改 / 删网格策略配置
- 提供一个网格交易标的列表：现价、距中线、下一网买卖点、持仓浮盈、状态
- 提供可折叠的网格价位表，逐档展示目标价 / 动作 / 状态 / 单轮预期净利
- 支持手动补录成交（base / buy / sell）与删除记录
- 支持"重置中线"开启新一轮，旧轮次成交自动锁定
- 复用 `etfGridEngine` 全部算法，零算法重写
- 列表公开只读；写操作仅管理员

**Non-Goals:**
- 不重写网格算法 / 不新增引擎文件
- 不做自动下单、不做券商对接（仅手动补录成交）
- 不恢复已删除的黄金 / 标普 / 主动基金策略（本次仅限 ETF 网格）
- 不新增独立"投资策略" tab 或顶部视图切换
- 不接入 SQLite 历史库（`services/db/repo.js` 属于采集进程写入域，网格数据是管理员低频写）
- 不做历史数据迁移（两个 data 文件均为空，全新开始）

## Decisions

### 决策 1：落位 = 严选ETF 页内追加 section（方案 A）+ 卡片快捷入口（方案 C）

```
┌─ 严选ETF ─────────────────────────────────────┐
│ 🔍 搜索 ETF/LOF…                               │
│ ┌──────┐ ┌──────┐ ┌──────┐                    │
│ │创业板│🕸│科创50│ │兴全… │   ← 卡片快捷入口(C) │
│ └──────┘ └──────┘ └──────┘                    │
│ ── ETF 网格交易 ─── ETF Grid ── [＋ 新增网格]   │  ← 新 section (A)
│ 等比对称：基准价 × (1+步长)^档位                 │
│ ┌───────────────────────────────────────────┐ │
│ │ 标的  现价  距中线  下一网  持仓/浮盈  操作 │ │
│ └───────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

- **理由**：A 对现有看板零侵入，网格标的数量天然不多（3-8 个），页内一屏可见；C 让"从看板标的直接建网格"路径最短。
- **否决方案 B（顶部 `看板 | 网格交易` 切换）**：需要新增视图状态机，而 `NAV_TABS` 已无 sub-tab 机制（老实现的 `strategy-subtab` 已被删），且会让看板默认不可见。
- **否决"独立投资策略 tab"**：老实现方案，但用户明确要求放在严选ETF 下；且 8 个 NAV_TABS 已饱和。

### 决策 2：算法 100% 复用 `services/etfGridEngine.js`，一行不改

```js
const { buildGridTable, expectedNetPct, computeNearestGrid, computeFifoGridPnl,
        computeHoldingsAndPnl, computeFilledLevels, computeProtection,
        filterCurrentRoundRecords, buildRecommendation, DEFAULT_FEE_RATE }
    = require('./services/etfGridEngine');
```

`buildRecommendation(strategy, records, currentPrice, marketTemperature, meta)` 单次调用即产出 `gridTable / nearestGrid / distanceToBasePct / holdings / pnl / protection` 完整视图 —— **推荐接口只需约 20 行**：读配置 → 批量拉行情 → 拉温度 → map 调用。

- **理由**：引擎已含 FIFO 配对、轮次切分、温度保护、连续买入冷却等最易出错的逻辑，且已有 `tests/etfStrategy.test.js` 覆盖。重写等于重新踩坑。
- **代价**：引擎内字段命名沿用 `fundCode / fundName / baseAmount` 等"基金"语义（历史包袱）。**保留**，重命名字段会连带改测试与引擎，收益不抵风险。

### 决策 3：持久化 = JSON 文件 + `writeJsonAtomic`，不进 SQLite

- 文件：`data/etf-grid-strategy.json`（`{ strategies: [] }`）、`data/etf-grid-holdings.json`（`{ records: [] }`）
- 写入：`require('./services/db/atomicWrite').writeJsonAtomic(file, data, true)`（与 `site-config` 现有一致）
- 首次启动：`ensureEtfGridDataFiles()`，文件不存在则创建空文件，**不预置任何策略**
- **理由**：管理员低频写、条目个位数、结构简单；`services/db/repo.js` 是采集进程的独占写入域，网站进程不应并发写同一 SQLite。与 watchlist 系列 JSON 保持一致。

### 决策 4：网格标的只能从严选ETF 看板选择

- 表单的标的下拉由 `readEtfWatchlist()` 生成，`fundCode` = 看板 `code`，`fundName` = 看板 `name`，`secid` 从看板项带出
- 后端校验：POST 时校验 `fundCode` 存在于当前 ETF 看板，不存在则 400
- **理由**：保证 `secid` 一定有值（否则拉不到实时价、算不出距中线与下一网）；避免手工输入 secid 出错。用户已确认。
- **影响**：从看板移除某 ETF 后，其已有网格策略**保留**（不级联删除），但现价会取不到 → 列表显示 `--` 并打 stale 标记，管理员可手动删除策略。

### 决策 5：现价独立拉取，不复用 `/api/etfs` 缓存

- 推荐接口内用 `fetchETFQuotes(strategies.map(s => ({ secid: s.secid, code: s.fundCode, market: ... })))` 单独拉
- **理由**：网格策略集合与看板集合不相等（策略 ⊂ 看板），复用看板缓存会引入不必要的耦合与 TTL 差异；单独拉只有 1 次批量请求，成本可忽略。
- market 推导：`secid` 以 `1.` 开头 → `SH`，`0.` 开头 → `SZ`，否则 `SH`。

### 决策 6：轮次模型 —— `updatedAt` 变化即开启新一轮

- 改配置（POST upsert）与"重置中线"都会刷新 `updatedAt`
- `filterCurrentRoundRecords(strategy, records)` 按 `updatedAt` 把旧成交锁定到上一轮，新轮次网格从空白开始
- 前端在编辑 / 重置前弹 `confirm` 二次确认
- **理由**：老实现已验证的模型。网格参数一旦变化，历史成交档位就失去参照意义，必须切轮。

### 决策 7：表单 UI 复用 `auth-modal` + `auth-field`，不重建表单样式

- **理由**：`pos-form` / `pos-form-row` / `dca-add-btn` / `afund-empty` 等老样式在 `05dce25` 已被删除；`auth-modal` + `auth-field` 现存且已被"用户管理"表单复用（`adminUserModalMask`），视觉一致、零新增 CSS 风险。
- 列表空态 / 卡片等新增样式按现有设计 token（`--border-subtle` / `--text-muted` / `--accent-blue`）手写小段 CSS。

### 决策 8：权限 —— GET 公开、写 `requireAdmin`

| 端点 | 权限 |
|---|---|
| `GET /api/strategy/etf-grid-plans` | 公开 |
| `GET /api/strategy/etf-grid-holdings` | 公开 |
| `GET /api/strategy/etf-grid-recommendations` | 公开 |
| `POST /api/strategy/etf-grid-plans` | `requireAdmin` |
| `POST /api/strategy/etf-grid-plans/delete` | `requireAdmin` |
| `POST /api/strategy/etf-grid-plans/reset-base-price` | `requireAdmin` |
| `POST /api/strategy/etf-grid-holdings` | `requireAdmin` |
| `POST /api/strategy/etf-grid-holdings/delete` | `requireAdmin` |

前端用既有 `isAdmin` 变量控制「＋ 新增网格」、编辑 / 记一笔 / 重置 / 删除按钮与卡片 🕸️ 入口的显隐（与 `d05be25` 老实现的 `style="display:none"` + JS 开关一致）。

### 决策 9：推荐结果走 `smartCacheGet`，写操作后主动清缓存

- key：`etf-grid-recommendations`；交易时段 30s / 休市 30min（沿用老实现的 TTL 分支）
- 任意写操作（upsert / delete / reset / 成交增删）后执行 `clearEtfGridRecommendationCache()`：删磁盘缓存文件 + 删内存缓存项
- **理由**：推荐计算含外部行情 + 温度两次网络请求，无缓存会让每次切 tab 都打外部源。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **线上旧进程重启后旧路由消失** → 用户以为功能回退 | 预期行为，本次落地即恢复；部署前告知；部署后立刻抽样验证 3 个 GET 端点 |
| **策略引用的 ETF 被移出看板** → 拿不到现价，距中线 / 下一网为空 | 列表显示 `--` + stale 标记；推荐接口对无现价策略仍返回 `gridTable`（静态价位表可用），仅 `nearestGrid` / `pnl` 降级 |
| **部署包内含 `data/*.json`**（`package-deploy.sh` 仅排除 `data/db` 与 `data/backup`）→ 担心覆盖服务端策略数据 | 服务端 `dist/deploy.sh` 在解压后会用备份的 `data/*.json` 覆盖回来，服务端数据不受影响；新增的两个网格文件服务端已存在，恢复后保持服务端版本（与现有 watchlist 行为一致） |
| **孤儿测试与网格无关**：`tests/etfStrategy.test.js` 覆盖的是 ETF **定投**策略（`/api/strategy/etf-*`，`services/etfStrategyEngine.js`），不是网格；它因另一批被删路由而失败，**不在本变更范围内** | `etfGridEngine` 无专属测试文件，本次以 `tests/etfEngine.test.js`（37/37 通过）作回归基线；ETF 定投的恢复如需进行，另开独立变更 |
| **表单字段较多（8 必填 + 4 可选）**，移动端 `auth-field` 单列布局会很长 | 表单按"标的选择 / 网格参数 / 资金规划 / 保护机制"分组，移动端单列滚动；可接受 |
| **`writeJsonAtomic` 与老实现的 `fs.writeFileSync` 行为差异** | 原子写更安全（tmp + rename）；文件结构 `{ strategies }` / `{ records }` 保持完全一致，向下兼容既有空文件 |
| **市场温度取不到**（`fetchYZYXThermometer` 失败）→ 温度保护失效 | 传 `null` 给 `buildRecommendation`，`computeProtection` 内已有降级；不抛错 |

## Migration Plan

1. 代码实现（server.js 路由 + 校验；index.html 区块 / 列表 / 表单 / 交互）
2. 本地 `npm start`，验证：空态 → 新增策略 → 列表出现 → 记一笔 → 价位表展开 → 重置中线 → 删除
3. `npx jest tests/etfStrategy.test.js` 确认孤儿测试转绿
4. `npm run package:deploy` 打包（`data/` 已排除）
5. 上传服务器 → `dist/deploy.sh` 备份 `data/` → 解压 → 用备份 `*.json` 覆盖回 `data/` → `pm2 restart dale-compass`
6. 服务器本地 `curl` 抽样 3 个 GET 端点；确认无 `[ETF网格]` 报错日志
7. **回滚**：`git revert` 变更 + `pm2 restart`；策略数据在 `data/` 未被打包覆盖，无需额外恢复

## Open Questions

1. 网格列表是否需要排序 / 拖拽调序？（看板已有 `watchlist-drag-reorder`，本次**暂不做**，按 `createdAt` 顺序）—— 如需要可作为后续变更。
2. 卡片 🕸️ 入口：已配置网格的 ETF 点击后是"展开定位到列表行"还是"直接打开编辑弹窗"？—— 暂定**打开编辑弹窗**（若未配置则打开新增弹窗并预选该标的）。
3. 移动端窄屏下列表 7 列如何降级？—— 暂定隐藏"距中线 / 步长×网数"，保留 标的 / 现价 / 下一网 / 操作。
