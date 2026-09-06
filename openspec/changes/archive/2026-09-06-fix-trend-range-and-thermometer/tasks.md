## 1. 指数趋势历史序列覆盖 10 年

- [x] 1.1 确认前端趋势图取数方式：前端经 `ensureFullIndexData()` 懒加载 `/api/indices?detail=1` 获取 `historySeries`，修复后端数据量即可，无需改前端取数
- [x] 1.2 将 `services/dataFetcher.js` 中 `fetchAllIndexData` 的 `fetchIndexHistory(cfg)` 改为 `fetchIndexHistory(cfg, { range: '10y' })`
- [x] 1.3 验证 `/api/indices?detail=1` 的 `historySeries` 条数 ≥ 2000（实测沪深300/中证500/中证红利/中证消费/标普500/上证指数均为 2000），且默认模式仍不含 `historySeries`
- [x] 1.4 验证 `high10y` / `low10y` 与 `high52w` / `low52w` 不再相等（如沪深300 10y=[5930.91, 2935.83] vs 52w=[5064.27, 4327.51]），10 年口径生效
- [x] 1.5 （实现期新增）修复前端懒加载死锁：`renderIndexCards()` 首次渲染时主动触发 `ensureFullIndexData()`（新增 `_fullIndexDataRequested` 防重标记），完成后重绘 `renderIndexCards()` 与 `renderIndexQuotesGrid()` 同步按钮状态
- [x] 1.6 浏览器端到端验证：懒加载请求发出（200）、按钮从全部 `[disabled]` 变为可点击、点击"近10年"后按钮 `active` 且趋势图时间轴切换为 2018→2026
- [x] 1.7 （用户反馈后新增）`ensureFullIndexData()` 增加 `indexQuotesData` 回填：指数实时行情面板由该数据池渲染，而 `/api/indices/quotes` 不含 `historySeries`，遗漏回填会导致该面板各指数趋势图的按钮永久禁用
- [x] 1.8 遍历 9 个指数验证详情弹窗按钮可用性：7 个 1y/3y/5y 可点击（科创50/恒生科技 10y 因 1620/1504 < 2000 阈值禁用，符合设计）

## 2. 有知有行温度计解析修复

- [x] 2.1 重写 `parseYZYXPage` 指数行解析：改用 `/data/indices/{code}` 详情链接匹配 `<tr>` 行，提取 `code` / `name` / `temperature` / `detailPath`（名称与温度均带降级提取）
- [x] 2.2 在 `tryFetch` 判定 `indices` 为空时增加告警日志（含 HTML 长度、是否含 `/data/indices/`、是否含温度数值、是否含 data-event-params）
- [x] 2.3 验证 `fetchYZYXThermometer()` 返回非空 `indices`（实测 12 个指数，全市场温度 51°），日志出现"获取 12 个指数温度数据"
- [x] 2.4 验证 `GET /api/thermometer/detail?code=000300.SH` 返回 `success: true`（实测沪深300 温度 45、中证红利 28、800消费 2 均正常），指数卡片温度色条已显示

## 3. 收尾验证

- [x] 3.1 重启服务（pm2 restart），确认温度计 Tab 有数据、趋势图时间范围可切换（浏览器截图确认）
- [x] 3.2 运行 `read_lints` 确认 `services/dataFetcher.js` 与 `public/index.html` 无新增错误
