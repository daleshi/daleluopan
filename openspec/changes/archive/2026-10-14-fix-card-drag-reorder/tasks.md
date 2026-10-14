## 1. 修复事件委托选择器

- [x] 1.1 在 `initCardDnD` 中把 `codeAttrMap` 拆成 `attrMap`（`etf: 'data-etf-code'`、`stock: 'data-stock-code'`、`index: 'data-code'`）与 `keyMap`（`etf: 'etfCode'`、`stock: 'stockCode'`、`index: 'code'`）
- [x] 1.2 四处 `closest('[data-' + codeAttr + ']')`（dragstart / dragover / dragleave / drop）改用 `closest('[' + cardAttr + ']')`
- [x] 1.3 `codes` 提取处的 `el.dataset[codeAttr]` 改用 `el.dataset[codeKey]`
- [x] 1.4 确认 `initFundDnD` 的 `[data-fund-code]` 选择器本身正确，无需改动

## 2. 修复初始化时机

- [x] 2.1 `initCardDnD` 开头增加幂等守卫：`if (grid.dataset.dndBound === type) return; grid.dataset.dndBound = type;`
- [x] 2.2 `initFundDnD` 开头增加幂等守卫：`if (grid.dataset.dndBound === 'fund') return; grid.dataset.dndBound = 'fund';`
- [x] 2.3 `renderETFs`：把 `initCardDnD(grid, 'etf')` 从 `if (grid.children.length === 0)` 分支内移出，改为三个分支之后统一调用
- [x] 2.4 `renderStocks`：把 `initCardDnD(grid, 'stock')` 同样移出，改为分支之后统一调用
- [x] 2.5 `renderActiveFunds`：把 `initFundDnD(grid)` 提到 `renderFundGrid` 开头无条件调用（该分支含 `isDraggingCard` 提前 `return`，放在分支之后会被跳过）

## 3. 浏览器实测

- [x] 3.1 管理员态：在 `#etfGrid` 派发 `dragover`，确认 `defaultPrevented === true`（监听已绑定，`dndBound=etf`）
- [x] 3.2 管理员态：`#stockGrid`（`dndBound=stock`）、`#activeFundGrid`（`dndBound=fund`）均为 `true`
- [x] 3.3 ETF 真实拖拽（第 1 张 → 第 3 张）：`159915` 移到第 3 位，只发出 1 个 `POST /api/etfs/reorder`，codes 为裸 code
- [x] 3.4 股票真实拖拽：`600845` 移到第 3 位，`POST /api/stocks/reorder` 提交 `600406.SH / 00700.HK` 等 fullCode，1 次；基金（需先点「主动基金」分类 Tab 展开面板）拖拽 `163415`↔`008269` 互换，`POST /api/active-funds/reorder` 1 次
- [x] 3.5 刷新页面：ETF 与股票顺序均保持拖拽后的新顺序
- [x] 3.6 指数看板回归：`000300.SH` 拖到第 3 位，`POST /api/indices/reorder` 正常，未回退
- [x] 3.7 游客态：`body.guest`，`.pro-drag-handle` 与 `.pro-admin-hint` 均 `display:none`，手动 `dragstart` 被 `preventDefault`，未发起任何请求

## 4. 回归与部署

- [x] 4.1 `npx jest tests/stocks.test.js tests/etfs.test.js tests/funds.test.js` → 46/46 通过
- [x] 4.2 `npm run package:deploy` 打包
- [x] 4.3 部署服务器、备份 `data/`、解压（排除 `data/`）、`pm2 restart dale-compass`
- [x] 4.4 线上抽样：页面 HTML 含 4 处 `dndBound`（修复已上线），`error.log` 无新增报错。⚠️ 3200 端口未对外暴露，无法从本机浏览器直连做线上真实拖拽，前端交互以本地实测为准
