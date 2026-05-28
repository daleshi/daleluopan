## 1. 引擎扩展（services/activeFundStrategyEngine.js）

- [x] 1.1 `ALLOWED_FIELDS` 追加 `fundGain1Y`、`fundDistanceToYearHighPct`，`FIELD_LABELS` / `FIELD_UNITS` 同步追加（中文标签：「近1年涨幅」「距近1年新高」，单位 `%`）
- [x] 1.2 `computeFundIndicators(navTrend)` 新增计算逻辑：
  - `gain1y`: 复用 `navAtDaysAgo(365)`，公式 `(latestNav - nav1Y) / nav1Y * 100`，保留 2 位小数；序列不足 365 天时返回 `null`
  - `distanceToYearHighPct`: 在近 365 天窗口内扫描最大净值，计算 `(yearHigh - latestNav) / yearHigh * 100`，保留 2 位小数；窗口数据不足 60 天时返回 `null`
  - 同时返回 `peakNav1Y` / `peakDate1Y`（近一年峰值的净值与日期）
- [x] 1.3 `computeRecommendations` 中 `indicators` 对象补充新字段；响应对象顶层补充 `peakNav1Y` / `peakDate1Y`
- [x] 1.4 在 `computeRecommendations` 主流程中，对每只基金额外提取 `currentManager`（来自 `fetchEastmoneyFundData(code).managers[0]?.name`），并与策略 `managerName` 比对得到 `managerChanged`
- [x] 1.5 当 `managerChanged === true` 时短路：跳过 `matchStrategy`，构造合成 `hitRule = { id: "managerChanged", label: "暂停新增", color: "purple", multiplier: 0 }`，`actualAmount = 0`，`triggerReason` 包含 `基金经理已由 X 变更为 Y，请重新评估`，`ruleScans` 全部标记 `hit: false / summary: "已被经理变更短路"`
- [x] 1.6 响应对象补充顶层字段 `currentManager: string|null` 与 `managerChanged: boolean`
- [x] 1.7 边界处理：`currentManager == null/''` 或 `strategy.managerName == null/''` 时 `managerChanged = false`（不误暂停）

## 2. 默认配置 v2（data/active-fund-strategy.json + server.js）

- [x] 2.1 在 `services/activeFundStrategyEngine.js` 或 `server.js` 中定义 v1 默认 rules 签名生成函数 `signRules(rules)`：先按 `id` 字段排序复制数组，再 `JSON.stringify` 后取 SHA-1 hex（`crypto.createHash('sha1')`）。基于历史现状写入 v1 签名常量（针对 163415 / 008269 各一个）
- [x] 2.2 定义 v2 默认 rules 常量 `DEFAULT_ACTIVE_FUND_STRATEGIES`，按 design.md "Decisions §5" 的顺序与 AND/OR 不对称语义构建：
  - 加仓类（double/boost/boost-mid/normal）每条 `logic: "AND"`，conditions 同时满足才命中
  - 减仓类（pause-*/half）每条 `logic: "OR"`，conditions 中任一命中即触发
  - 大成 5 条业务规则 + normal 兜底；兴全 7 条业务规则 + normal 兜底
- [x] 2.3 修改 `ensureDefaultActiveFundStrategies()`（位于 server.js）：
  - 文件不存在 → 用 v2 默认全量初始化
  - 文件存在 → 对 fundCode='163415' 与 '008269' 两条记录：若当前 rules 签名 == v1 签名 → 仅替换 rules + 刷新 updatedAt（保留 fundCode/fundName/managerName/benchmarkIndex/monthlyAmount/drawdownBaseline 等其他字段）；签名不匹配 → 跳过
- [x] 2.4 POST `/api/strategy/active-fund-plans` 字段白名单校验同步引擎更新（追加 `fundGain1Y` / `fundDistanceToYearHighPct`，通过引擎导出的 `ALLOWED_FIELDS` 自动同步）
- [x] 2.5 启动日志增加：`[主动基金策略] 检测到 v1 默认规则，已升级 fundCode=XXX 到 v2`

## 3. 前端 UI（public/index.html）

- [x] 3.1 CSS 新增 `.afund-badge.color-blue` 样式（蓝色渐变）；`.afund-manager-banner` 经理变更警示横条样式（亮/暗主题适配）；`.afund-peak1y-hint` 近1年高点小字样式
- [x] 3.2 主动基金卡片渲染函数追加"经理变更警示横条"：当 `managerChanged === true` 时在卡片顶部加红色 banner，文案 "⚠ 基金经理已由 {managerName} 变更为 {currentManager}，建议重新评估"
- [x] 3.3 规则一览扫描表格：当 `managerChanged === true` 时，整张表显示灰底（opacity 降低）+ 标题区追加红色"经理变更短路"提示
- [x] 3.4 触发依据文案直接由后端 `triggerReason` 输出（已包含 currentManager / 中文文案），前端透传渲染
- [x] 3.5 可视化策略表单顶部增加 v2 能力提示文案；当编辑现有 v2 高级配置（boost/多 pause/OR 减仓）时，模板下拉自动切换到"v2 高级配置（只读）"，保存时仅允许更新 monthlyAmount / managerName，rules 字段保留不被覆盖
- [x] 3.6 表单顶部说明文案告知用户系统已支持 v2 完整能力（含 fundGain1Y / fundDistanceToYearHighPct）；高级配置可通过 POST API 或直接编辑 JSON 文件落地
- [x] 3.7 卡片下方新增"近1年高点"小提示：当 `peakNav1Y` 非空，显示 "近1年高点 X.XXXX (YYYY-MM-DD)"；卡片指标网格同时新增"近1年涨幅" / "距近1年新高"两个指标项

## 4. 单元测试（tests/）

- [x] 4.1 `tests/activeFundEngine.test.js` 新增 `computeFundIndicators` v2 衍生指标用例：
  - 365+ 天序列正确计算 gain1y
  - distanceToYearHighPct 计算（等于 0 / 约 1.5%）
  - 序列不足 60 天 → peakNav1Y / distanceToYearHighPct 全 null
- [x] 4.2 `tests/activeFundEngine.test.js` 新增 `evaluateCondition` 对 fundGain1Y / fundDistanceToYearHighPct 的命中/缺失三态用例
- [x] 4.3 `tests/activeFundEngine.test.js` 新增 `computeRecommendations` 经理变更短路用例（mock fetchEastmoneyFundData 返回不同 managers[0].name）
- [x] 4.4 `tests/activeFundEngine.test.js` 新增"managerName 缺失 / currentManager 缺失 → managerChanged=false 不短路"两个用例
- [x] 4.5 `tests/activeFundEngine.test.js` 新增 boost 档命中时 `actualAmount = monthlyAmount * 1.5`、`hitRule.color === "blue"`
- [x] 4.6 `tests/activeFundEngine.test.js` 新增 v2 默认规则的 18 个验收场景（大成 7 条 + 兴全 11 条），包含：
  - 减仓类 OR 单边触发用例（PE 高但基金未热 / 基金过热但 PE 不高 各两组）
  - 加仓类 AND 必须双低用例（缺一不命中 → 落到 normal 兜底）
  - 命中即停 + OR 区间上界天然保护（如兴全 PE=92% 命中 pause-extreme，不会越过到 pause-overheat 或 half）
- [x] 4.7 `tests/activeFundStrategy.test.js` 新增 POST 校验对 boost 档 / fundGain1Y / fundDistanceToYearHighPct 三个接受用例 + GET recommendations 响应包含 v2 新字段验证
- [x] 4.8 `tests/activeFundStrategy.test.js` 默认两只基金存在性测试已隐式验证 ensureDefaultActiveFundStrategies；签名升级路径由单元测试 + v1 签名常量手动验证保证（避免污染 fixtures）
- [x] 4.9 全量 `npm test` 回归通过：303/303，含本次 v2 新增 19 项

## 5. 交付与验证

- [x] 5.1 `openspec validate active-fund-strategy-v2 --strict` 通过
- [ ] 5.2 本地 `npm start` 启动后访问 `http://localhost:3200/api/strategy/active-fund-recommendations` 验证响应包含新字段（**待用户决定是否本地启动**）
- [ ] 5.3 浏览器访问「投资策略」Tab → 主动基金子 tab，确认两只基金卡片：
  - **待人工验证**：徽章颜色匹配命中规则 color（含 boost 蓝色徽章）
  - **待人工验证**：规则一览展开后显示扩展后的规则数组（兴全 7 条 / 大成 5 条 + normal）
  - **待人工验证**：若手动篡改 active-fund-strategy.json 中 managerName 触发 managerChanged → 卡片顶部出现红色警示横条
  - **待人工验证**：卡片下方"近1年高点"提示行正确显示
- [ ] 5.4 用 sshpass + tar 包发布到 43.136.122.239 服务器，pm2 reload + tail logs 确认无错误（**待用户确认是否部署**）
