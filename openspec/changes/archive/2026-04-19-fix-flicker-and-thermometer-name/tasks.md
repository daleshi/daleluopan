## 1. 修正文案：知行温度计 → 有知有行温度计

- [x] 1.1 将 `public/index.html:3508` 的 `知行温度计` 改为 `有知有行温度计`
- [x] 1.2 将 `public/index.html:3519` 的 `知行温度计通过历史估值变化` 改为 `有知有行温度计通过历史估值变化`

## 2. 无感刷新：指数行情（renderIndexQuotesGrid）

- [x] 2.1 在 `buildIndexQuoteCard` 生成的卡片根元素上加 `data-code` 属性（值为 `idx.code`）
- [x] 2.2 修改 `renderIndexQuotesGrid`（行 6528-6530）：容器有子节点时，遍历新数据做 diff 更新，仅替换变化的数值节点；容器为空时仍走 `innerHTML` 全量渲染；删除多余的旧子节点

## 3. 无感刷新：股票（renderStocks）

- [x] 3.1 在股票卡片根元素上加 `data-code` 属性（值为股票 code）
- [x] 3.2 修改 `renderStocks`（行 8165 附近的 `grid.innerHTML = ...`）：容器有子节点时做 diff 更新；容器为空时走全量渲染

## 4. 无感刷新：ETF（renderETFs）

- [x] 4.1 在 ETF 卡片根元素上加 `data-code` 属性（值为 etf.code 或 etf.secid）
- [x] 4.2 修改 `renderETFs`（行 7398 的 `grid.innerHTML = ...`）：容器有子节点时做 diff 更新；容器为空时走全量渲染

## 5. 无感刷新：基金（renderActiveFunds）

- [x] 5.1 在基金卡片根元素上加 `data-code` 属性（值为基金 code）
- [x] 5.2 修改 `renderActiveFunds`（行 6878/6888 的 `innerHTML = ...`）：容器有子节点时做 diff 更新；容器为空时走全量渲染

## 6. 验证

- [x] 6.1 确认温度计 Tab 文案显示为"有知有行温度计"
- [x] 6.2 在浏览器中观察交易时段自动刷新，确认列表无整块闪烁
