## 1. 后端：数据持久化与配置初始化

- [x] 1.1 新建 `data/active-fund-strategy.json` 默认数据（包含 163415 乔迁规则、008269 徐彦规则）—— 参考 `design.md` 数据结构小节
- [x] 1.2 在 `server.js` 中新增 `ACTIVE_FUND_STRATEGY_FILE` 常量与 `readActiveFundStrategies()` / `writeActiveFundStrategies()` 函数（参考既有 `readDcaPlans()` 模式）
- [x] 1.3 实现首次启动自检：若文件不存在，自动写入预设配置（在 `ensureDataDir()` 之后调用 `ensureDefaultActiveFundStrategies()`）
- [x] 1.4 编写白名单常量：`ALLOWED_FIELDS`（5 个）+ `ALLOWED_OPS`（5 个）

## 2. 后端：规则引擎模块

- [x] 2.1 新建 `services/activeFundStrategyEngine.js`
- [x] 2.2 实现 `computeFundIndicators(navTrend)` — 基于净值序列计算 `drawdownAbs / gain3m / gain6m`（回撤口径：从历史最高净值）
- [x] 2.3 实现 `evaluateCondition(condition, indicators)` — 单条件判断，缺失指标返回 `null`（视为不命中）
- [x] 2.4 实现 `evaluateRule(rule, indicators)` — 多条件按 `logic` 聚合（AND/OR）；空 conditions 返回 `true`（兜底）
- [x] 2.5 实现 `matchStrategy(strategy, indicators)` — 按数组顺序逐条匹配，命中即停，返回 `hitRule + ruleScans[]`
- [x] 2.6 实现 `buildTriggerReason(rule, indicators)` — 生成可读的中文触发依据字符串
- [x] 2.7 实现 `computeRecommendations(strategies)` — 主入口：拉取 PE 分位、基金净值，逐个调用 matchStrategy

## 3. 后端：API 路由

- [x] 3.1 新增 `GET /api/strategy/active-fund-plans`（公开）
- [x] 3.2 新增 `POST /api/strategy/active-fund-plans`（requireAdmin） — 含完整字段校验（参考 spec 中各 Scenario）
- [x] 3.3 新增 `POST /api/strategy/active-fund-plans/delete`（requireAdmin）
- [x] 3.4 新增 `GET /api/strategy/active-fund-recommendations`（公开） — 通过 `smartCacheGet('active-fund-recommendations', ...)` 接入缓存层
- [x] 3.5 在 services 层暴露 `getNetWorthTrend(fundCode)` 工具函数（如 `fundFetcher.js` 尚未暴露），供引擎读取净值序列

## 4. 前端：数据加载与状态管理

- [x] 4.1 在 `public/index.html` 顶层 JS 区新增 `activeFundStrategies = []` 与 `activeFundRecommendations = null` 模块级变量
- [x] 4.2 实现 `loadActiveFundRecommendations()` — fetch `/api/strategy/active-fund-recommendations`，写入状态并触发渲染
- [x] 4.3 在 `switchTab('strategy')` 切换到投资策略 Tab 时调用 `loadActiveFundRecommendations()` 与现有的 `loadDcaPlans()`
- [x] 4.4 在交易时段定时刷新（复用现有 `setInterval` 机制；非交易时段不刷新）

## 5. 前端：HTML 与 CSS

- [x] 5.1 在 `tab-strategy` section 内、温度计定投策略之上，插入新容器：
      ```html
      <div class="section-header" id="activeFundDcaHeader">
        <div class="section-title">主动基金定投策略</div>
        <div class="section-actions" id="activeFundDcaAdminActions" style="display:none">
          <button onclick="openActiveFundForm()">＋ 添加策略</button>
        </div>
      </div>
      <div class="active-fund-context" id="activeFundContext"></div>
      <div class="active-fund-cards" id="activeFundCards"></div>
      ```
- [x] 5.2 新增 CSS：`.active-fund-card` 卡片样式 / `.afund-badge-{red,green,yellow,purple}` 档位徽章 / `.afund-rule-scan-list` 折叠列表
- [x] 5.3 复用现有 `--dca-low/--dca-mid-low/--dca-mid-high/--dca-high` 颜色变量
      （注：项目实际未定义这些 CSS 变量，温度计采用 `linear-gradient` 直写颜色；主动基金沿用同一风格，定义 `.afund-badge.color-{red,yellow,green,purple}` 4 档独立配色）

## 6. 前端：渲染逻辑

- [x] 6.1 实现 `renderActiveFundContext(marketContext)` — 顶部市场状态（沪深300 PE/分位/日期）
- [x] 6.2 实现 `renderActiveFundCards(recommendations)` — 遍历每只基金渲染卡片
- [x] 6.3 实现 `renderRuleScanList(ruleScans)` — 渲染规则一览的折叠列表（每条带「⚠ 当前」或「未触发」徽章）
- [x] 6.4 stale 状态显示灰色"⚠ 数据陈旧"标签
- [x] 6.5 空态显示："暂无主动基金定投策略" + 管理员可见的添加按钮
- [x] 6.6 根据 `currentUser.role === 'admin'` 控制管理按钮（添加/编辑/删除）显隐
      （实现：使用项目既有的 `body.role-admin` CSS 选择器 + `dca-add-btn` / `dca-plan-action-btn` 复用 class，无需新增显隐逻辑）

## 7. 前端：管理员配置表单

- [x] 7.1 实现 `openActiveFundForm(existing?)` — 打开模态框，若传入已有策略则填充
- [x] 7.2 模板选择器：`<select>` 切换"单因子 PE 模板"/"双因子 PE+基金 模板"
- [x] 7.3 单因子模板字段：基金选择器 + 月定投基准 + 4 个 PE 阈值 + 加倍档回撤阈值
- [x] 7.4 双因子模板字段：基金选择器 + 月定投基准 + 加倍档（PE 上限 + 回撤阈值）+ 减半档（PE 区间 + 涨3月阈值）+ 暂停档（PE 下限）
- [x] 7.5 实现 `templateToRules(formValues, templateType)` — 将表单转成通用 `rules[]` 结构（确保包含 `id="normal"` 兜底）
- [x] 7.6 提交时调用 `POST /api/strategy/active-fund-plans`，成功后刷新推荐
- [x] 7.7 编辑/删除按钮接入对应 API（删除前 `confirm()` 二次确认）

## 8. 验证

- [x] 8.1 本地启动服务，`data/active-fund-strategy.json` 自动生成且包含两只基金的预设规则
      （已通过 `ensureDefaultActiveFundStrategies()` + `node` dry-run 验证：两只基金、各 4 条规则）
- [x] 8.2 调用 `GET /api/strategy/active-fund-recommendations`，校验：
      - 兴全商业模式 → `hitRule.id === "pause"`，`actualAmount === 0`
      - 大成睿享 A → `hitRule.id === "half"`，`actualAmount === 500`
      （已通过 `computeRecommendations` 真实数据 dry-run 验证。沪深300 PE 分位 92.08% 时，乔迁档 pause / 徐彦档 half，金额 0 / 500）
- [ ] 8.3 前端「投资策略」Tab 正确展示两张卡片 + 顶部市场状态 + 规则一览折叠展开（**待用户启动服务后人工验证**）
- [ ] 8.4 管理员通过 UI 修改某档阈值并保存，刷新后档位/金额随阈值更新（**待人工验证**）
- [ ] 8.5 普通用户与未登录用户看不到任何管理按钮，但能看到推荐结果（**待人工验证**；CSS 上靠 `body.role-admin` 切换；后端 requireAdmin 已生效）
- [ ] 8.6 模拟蛋卷 API 失败（断网），验证 stale 标记与降级展示（**待人工验证**）
- [x] 8.7 校验所有规格场景对应的 API 行为（参考 `specs/active-fund-dca-strategy/spec.md` 各 Scenario）
      （引擎层场景已通过 dry-run；API 层场景由 task 9.1 单元测试覆盖）

## 9. 测试（可选，跟现有 `tests/strategy.test.js` 风格保持一致）

- [x] 9.1 新增 `tests/activeFundStrategy.test.js`：覆盖 GET / POST / DELETE / Recommendations 的认证、校验、Upsert 等核心场景（15 项测试，全部通过）
- [x] 9.2 新增引擎单元测试 `tests/activeFundEngine.test.js`：覆盖规则匹配、命中即停、空 conditions 兜底、缺失指标降级（27 项测试，全部通过）
