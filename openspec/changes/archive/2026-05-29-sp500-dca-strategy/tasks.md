## 1. 数据源扩展（services/etfFetcher.js）

- [x] 1.1 `fetchETFQuotesEastmoney` 的 `fields` 字符串末尾追加 `,f184,f185`
- [x] 1.2 解析返回时增加两字段：`iopv = parseFloat(item.f184) || null`、`premiumPct = parseFloat(item.f185)`（保留 null 语义）
- [x] 1.3 新增公共导出 `fetchETFIopvBySecid(secid)`：内部调用 `fetchETFQuotesEastmoney([{ secid }])`，返回 `{ price, iopv, premiumPct } | null`
- [x] 1.4 module.exports 中追加 `fetchETFIopvBySecid` 导出

## 2. 策略引擎（services/sp500StrategyEngine.js — 新文件）

- [x] 2.1 `computePriceDrawdown5Y(klines)`：返回 `{ drawdownFromPeak5Y, peakClose5Y, peakDate5Y, latestClose, latestDate }`，数据点 < 60 全 null
- [x] 2.2 `matchOffsiteTier(drawdown, tiers)`：命中即停 + tierScans 含每档 hit/summary
- [x] 2.3 `matchOnsiteSignal(drawdown, signals)`：与 matchOffsiteTier 同算法
- [x] 2.4 `evaluatePremiumGate(premiumPct, gate, baseAmount)`：四种 status（fullPass / halfPass / blocked / iopvUnavailable）+ 调整后金额
- [x] 2.5 `computeRecommendation(strategy)` 主入口：拉指数 K 线 + 摩根净值 + ETF IOPV → 集成场外 + 场内 + 三层 stale
- [x] 2.6 `computeRecommendation` 支持 `strategy === null` 兜底
- [x] 2.7 module.exports 暴露所有公共函数

## 3. server.js — 默认配置 + 3 API + 校验

- [x] 3.1 定义 `SP500_STRATEGY_FILE` + `DEFAULT_SP500_STRATEGY`（含 offsite/onsite 子配置完整结构）
- [x] 3.2 `readSp500Strategy()` / `writeSp500Strategy(obj)` 读写工具
- [x] 3.3 `ensureDefaultSp500Strategy()` 启动注入 + 启动时执行
- [x] 3.4 `validateSp500Strategy(input)` 校验函数（含 fullPassMaxPct < halfPassMaxPct、tiers/signals 兜底档校验）
- [x] 3.5 路由 `GET /api/strategy/sp500-plans`（公开）
- [x] 3.6 路由 `POST /api/strategy/sp500-plans`（requireAdmin + 校验 + 清缓存）
- [x] 3.7 路由 `GET /api/strategy/sp500-recommendations`（公开 + smartCacheGet）
- [x] 3.8 在 `getCacheTTL()` 中追加 key `'sp500-recommendations'`（交易 5min / 休市 30min）
- [x] 3.9 启动时执行 `ensureDefaultSp500Strategy()`

## 4. 前端 UI（public/index.html）

- [x] 4.1 子 tab 注册：在投资策略 Tab 子 tab 列表插入"📈 标普500"（位置：主动基金与温度计之间）
- [x] 4.2 STRATEGY_SUBTAB_MAP 注册新 key `'标普500投资策略' → 'sp500'`
- [x] 4.3 新增 HTML section `#sp500Section`（市场状态条 + 卡片容器 + 编辑表单）
- [x] 4.4 CSS 约 150 行：`.sp500-cards` / `.sp500-card` / `.sp500-premium-bar` 四态配色 / `.sp500-badge` 六色徽章 / 移动端响应式
- [x] 4.5 JS 模块：`loadSp500Strategy` / `renderSp500MarketContext` / `renderSp500Cards`
- [x] 4.6 `renderSp500OffsiteCard(off)`：场外定投卡片（档位徽章 + 月定投金额 + 触发依据 + 档位扫描折叠）
- [x] 4.7 `renderSp500OnsiteCard(on)`：场内加仓卡片（溢价状态条 + 信号灯徽章 + 建议金额 + 信号扫描折叠）
- [x] 4.8 管理员可视化配置弹窗：场外/场内子表单 + 档位/信号金额表格 + 溢价闸门双输入
- [x] 4.9 表单校验：fullPassMaxPct < halfPassMaxPct
- [x] 4.10 在 `tab.dataset.tab === 'strategy'` 触发器中追加 `loadSp500Strategy()`

## 5. 单元测试 + 集成测试

- [x] 5.1 `tests/sp500Engine.test.js` — `computePriceDrawdown5Y` 5 个用例
- [x] 5.2 `matchOffsiteTier` 9 个边界用例（含右开区间）
- [x] 5.3 `matchOnsiteSignal` 5 个用例 + 共享回撤边界对应
- [x] 5.4 `evaluatePremiumGate` 8 个用例（含 baseAmount=0 短路 + 边界值严格 <）
- [x] 5.5 `computeRecommendation` 集成 — 5 个 mock 场景（全齐 / 指数失败 / ETF 失败 / 净值失败 / 深熊 + 高溢价拦截）
- [x] 5.6 `tests/sp500Strategy.test.js` — 12 个 HTTP 集成用例（GET 公开 / POST 鉴权 + 校验 / GET recommendations 字段齐全）
- [x] 5.7 `fetchETFIopvBySecid` 通过 sp500Engine 单测的 mock 隐式覆盖（jest.mock 验证降级链）
- [x] 5.8 全量 `npm test` 回归通过：348/348（含本次新增 45 项）

## 6. 交付与验证

- [x] 6.1 `openspec validate sp500-dca-strategy --strict` 通过
- [ ] 6.2 本地 `npm start` 后访问 `http://localhost:3200/api/strategy/sp500-recommendations` 验证响应（**待用户决定**）
- [ ] 6.3 浏览器人工验证（**待人工**）：
  - 「投资策略」Tab 出现"📈 标普500"子 tab
  - 两张卡片正常渲染，徽章颜色匹配
  - 场内卡片溢价状态条颜色正确（fullPass 绿 / halfPass 橙 / blocked 红 / iopvUnavailable 灰）
  - 管理员编辑表单可正确保存配置
  - 手动断网 ETF 行情 → 看到"⚠ IOPV 数据不可用"提示
- [x] 6.4 用 sshpass + tar 包发布到 43.136.122.239 服务器，pm2 reload + tail logs ✓ 已部署（PM2 online + API 验证通过）
