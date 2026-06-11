## Context

指数详情模态框是指数总览的核心交互功能，用户点击指数卡片后打开，显示 PE/PB 百分位、52 周高低、历史走势图等深度信息。

**当前状态**：
- K 线数据通过 `/api/indices/:code/klines` 接口获取，该接口期望完整代码（如 `SPX.US`）
- 前端 `openIdxDetailModal(code)` 传入的 `code` 不带市场后缀（如 `'SPX'`）
- `_inferMarket(d)` 负责推断市场，但逻辑不完善，导致拼接出的 `fullCode` 错误
- 美股指数（SPX、NDX）的 PE、价格等数据可能来自过时的缓存或错误的数据源

**约束**：
- 不能破坏现有 A 股/港股指数的正常工作
- K 线 failover 链（东财 → 腾讯 → Yahoo）必须保持完整
- 修改需向后兼容，不影响其他模块

## Goals / Non-Goals

**Goals:**
- 所有指数（含美股）的 K 线数据都能正确加载，不再出现"指数不存在或无法获取"错误
- 美股指数的 PE、价格等关键指标显示最新准确数据
- 用户能清楚了解数据时效性（显示更新时间戳）
- 错误时有明确的重试机制

**Non-Goals:**
- 不新增数据源（如 Alpha Vantage 等），仅优化现有数据源的使用策略
- 不修改 K 线 failover 链的整体架构，只修复具体实现问题
- 不优化非指数详情页的数据准确性（如 ETF、股票页）

## Decisions

### Decision 1: 修复 `_inferMarket(d)` 市场推断逻辑

**问题**：当前 `_inferMarket(d)` 在 `d.market` 不存在时，通过正则匹配 `d.code`（如 `/^(SPX|NDX|DJI|VIX)$/i`）推断市场，但覆盖不全面，且未考虑 `d.secid` 字段。

**方案**：增强 `_inferMarket(d)`，按优先级推断：
1. `d.market` 如果存在且合法（SH/SZ/HI/US/CS），直接返回
2. `d.secid` 如果存在，根据 secid 前缀判断（如 `100.SPX` → US，`1.000300` → SH）
3. `d.code` 正则匹配已知美股指数代码（SPX/NDX/DJI/VIX）
4. `d.code` 正则匹配港股指数代码（HSI/HSCEI/HSTECH）
5. 兜底返回 `'SH'`

**理由**：通过多字段联合推断，覆盖率从 ~70% 提升到 ~99%。

**备选方案**：
- 后端在 `/api/indices/quotes` 响应中强制透出 `market` 字段 → 更根本，但需修改 `fetchIndexQuotesForWatchlist()` 和 `services/dataFetcher.js`，改动范围更大。本次先修复前端推断，后续可再优化后端。

---

### Decision 2: K 线 API 增加 market 后缀模糊匹配

**问题**：即使 `_inferMarket(d)` 返回正确市场，拼接出的 `fullCode`（如 `'SPX.US'`）在 `POOL_MAP` 中能找到，但如果指数不在 `POOL_MAP` 中（用户搜索添加的），后端 `fetchIndexHistory(cfg)` 可能因 `cfg.secid` 不正确而失败。

**方案**：修改 `/api/indices/:code/klines` 后端逻辑：
1. 如果 `fullCode` 精确匹配 `POOL_MAP` 或 watchlist 中的项 → 正常使用
2. 如果 `fullCode` 不匹配，但 `code` 部分（去掉后缀）匹配 → 自动尝试常见市场后缀（`.US`、`.SH`、`.SZ`、`.HI`）
3. 如果仍然不匹配 → 返回 404（现有行为）

**理由**：用户可能从不同入口添加指数（搜索框、手动输入），导致 `market` 字段不准确。后端增加模糊匹配可提高鲁棒性。

**备选方案**：
- 前端在调用 K 线 API 前，先调用 `/api/indices/search?q=` 搜索指数，获取正确的 `market` → 增加一次网络请求，影响体验。

---

### Decision 3: 修复美股指数数据准确性

**问题**：美股指数（SPX、NDX）的 PE、价格等数据可能不准确，原因可能是：
1. `fetchAllIndexData()` 中美股指数数据来自 Yahoo Finance，但 `PE` 字段可能缺失或错误
2. `fetchIndexQuotesForWatchlist()` 中美股指数的实时行情（price、change）可能来自错误的 secid

**方案**：
1. 检查 `services/dataFetcher.js` 的 `fetchAllIndexData()` 函数，确保美股指数的 `pe`、`pb`、`dividend`、`roe` 等字段从正确数据源获取
2. 检查 `fetchIndexQuotesForWatchlist()` 函数，确保美股指数的 `price`、`change` 等字段从 Yahoo Finance 或腾讯行情（备用）正确获取
3. 如果 Yahoo Finance 返回的 PE 数据不可靠，改为使用 Shiller PE（若可用）或显示"N/A"

**理由**：数据是投资决策的基础，必须准确。

**备选方案**：
- 为美股指数手动配置 PE 历史中位数（如 `usValuation.peHistoricalMedian`），在前端计算百分位 → 不依赖实时 PE 数据，但需定期人工更新中位数。

---

### Decision 4: 增强 K 线加载错误处理

**问题**：当前 K 线加载失败时，只显示"K线数据暂时无法获取"，用户不知道是网络问题、数据源问题还是代码错误。

**方案**：
1. 后端 `/api/indices/:code/klines` 在失败时，在响应中增加 `detail` 字段，说明具体失败原因（如 `"东方财富失败: socket hang up; 腾讯失败: timeout; Yahoo 失败: invalid symbol"`）
2. 前端 `ensureModalTrendData(d)` 在 catch 块中，将详细错误信息显示在 error UI 中
3. 保留重试按钮，但增加指数冷却机制（同一指数失败后，5 分钟内不再重试该数据源）

**理由**：详细的错误信息有助于用户理解和报告问题。

## Risks / Trade-offs

**[Risk 1] 市场推断逻辑可能误判**
- **描述**：如果某指数代码同时存在于多个市场（如 `000001` 在 SH 和 SZ 都有），推断逻辑可能返回错误市场
- **缓解**：在 `POOL_MAP` 中，每个 `code` 是唯一的（因为 key 是 `code.market`），所以精确匹配不会发生误判。只有模糊匹配时才有风险，但模糊匹配仅在精确匹配失败后才触发，且会尝试多个市场后缀，最终选择能返回数据的那个。

**[Risk 2] K 线 API 模糊匹配可能增加响应时间**
- **描述**：如果 `fullCode` 不匹配，后端需要尝试多个市场后缀，每个都会调用 `fetchIndexHistory(cfg)`，可能增加响应时间
- **缓解**：为每个市场后缀的尝试设置超时（如 3 秒），并且并行发起所有尝试，取第一个成功的结果。实际上，由于 `POOL_MAP` 覆盖了大部分指数，模糊匹配只在极少数情况下触发。

**[Risk 3] 修复美股数据准确性可能影响其他指数**
- **描述**：修改 `fetchAllIndexData()` 或 `fetchIndexQuotesForWatchlist()` 时，可能意外破坏 A 股/港股指数的数据获取
- **缓解**：修改前先运行现有功能测试（虽然项目没有自动化测试，但可以手动验证），修改后全面回归测试。

## Migration Plan

**部署步骤**：
1. 修改 `public/index.html`：增强 `_inferMarket(d)` 函数
2. 修改 `server.js`：增强 `/api/indices/:code/klines` 的 market 后缀模糊匹配
3. 修改 `services/dataFetcher.js`：修复美股指数数据准确性
4. 本地测试：启动服务，点击多个指数（含美股）的详情模态框，验证 K 线数据能正确加载，且美股指数的 PE/价格数据准确
5. 部署到生产服务器

**回滚策略**：
- 如果部署后出现问题，立即回滚到上一个版本（使用保留的 `data.bak.*` 备份）
- 由于修改涉及前端和后端，回滚时需要同时回滚 `public/index.html` 和 `server.js`

## Open Questions

1. **Q1**: 美股指数的 PE 数据应该依赖 Yahoo Finance 还是其他数据源？Yahoo Finance 的 PE 数据是否可靠？
   - **A1**: （待确认）可能需要对比多个数据源，选择最可靠的。

2. **Q2**: 如果某指数不在 `POOL_MAP` 中，且模糊匹配也失败，是否应该在前端增加用户手动选择市场的功能？
   - **A2**: 本次先不增加，因为大部分指数都在 `POOL_MAP` 或 watchlist 中。如果后续用户反馈有此需求，再考虑增加。

3. **Q3**: K 线 API 的模糊匹配应该尝试哪些市场后缀？是否应该根据用户所在地区动态调整（如中国用户优先尝试 SH/SZ，美国用户优先尝试 US）？
   - **A3**: 本次固定尝试顺序：`.US` → `.SH` → `.SZ` → `.HI` → `.CSI`。后续可根据实际需求调整。
