## 1. 删除 ETF Tab 内的状态 UI

- [x] 1.1 在 `public/index.html` ETF Tab（约行 3391-3397）中，删除整个 `etf-toolbar-right` div（包含 `etfStatusDot`、`etfStatusText`、`etfUpdateTime`）

## 2. 删除股票 Tab 内的状态 UI

- [x] 2.1 在 `public/index.html` 股票 Tab（约行 3420-3426）中，删除整个状态+时间区块 div（包含 `stockStatusDot`、`stockStatusText`、`stockUpdateTime`）

## 3. 修改 renderETFs() 函数

- [x] 3.1 移除 `renderETFs()` 中对 `etfStatusDot`、`etfStatusText`、`etfUpdateTime` 的 `getElementById` 引用和赋值语句
- [x] 3.2 在 `renderETFs()` 中新增对顶部 `#statusDot` 的更新逻辑：`isTrading` 为 true 时设为 `meta-dot live`，否则设为 `meta-dot`

## 4. 修改 renderStocks() 函数

- [x] 4.1 移除 `renderStocks()` 中对 `stockStatusDot`、`stockStatusText`、`stockUpdateTime` 的 `getElementById` 引用和赋值语句（含 `loadStockData` 错误处理分支）
- [x] 4.2 在 `renderStocks()` 中新增对顶部 `#statusDot` 的更新逻辑：降级时设为 `meta-dot warn`，交易中设为 `meta-dot live`，否则设为 `meta-dot`

## 5. 验证

- [ ] 5.1 重启服务（`npm run pm2:restart`），打开 http://localhost:3200 检查 ETF Tab 和股票 Tab 内不再有状态点/状态文字/更新时间
- [ ] 5.2 切换到 ETF Tab，确认顶部 updateTime 显示 ETF 数据的更新时间，statusDot 反映交易状态
- [ ] 5.3 切换到股票 Tab，确认顶部 updateTime 显示股票数据的更新时间，statusDot 反映交易状态
- [ ] 5.4 切换回 dashboard Tab，确认顶部 statusDot 和 updateTime 恢复为指数数据的状态
