## MODIFIED Requirements

### Requirement: 管理员可拖拽调整 watchlist 卡片顺序
系统 SHALL 在管理员登录状态下，允许用户通过拖拽方式调整指数行情、ETF、股票三个页面中的卡片顺序，调整结果 SHALL 持久化到服务端 watchlist，并在页面刷新后保持。

#### Scenario: 管理员拖拽卡片
- **WHEN** 用户以管理员身份登录，并在指数行情 / ETF / 股票 Tab 中拖拽某张卡片到新位置
- **THEN** 卡片 SHALL 跟随鼠标移动，释放后在新位置落下，页面顺序立即反映新排列

#### Scenario: 拖拽顺序持久化
- **WHEN** 拖拽操作完成（drop 事件触发）
- **THEN** 系统 SHALL 将新顺序以 `{ codes: [...] }` 格式 POST 到对应 reorder 端点，服务端 SHALL 按新顺序重写 watchlist JSON

#### Scenario: 刷新后顺序保持
- **WHEN** 管理员拖拽调整顺序成功后刷新页面
- **THEN** 卡片顺序 SHALL 与拖拽后的顺序一致，不回退到拖拽前的排列

#### Scenario: 非管理员不可拖拽
- **WHEN** 用户未登录或以普通用户身份登录
- **THEN** 卡片 SHALL 不显示拖拽把手，`draggable` 属性 SHALL 为 false 或不存在

#### Scenario: 拖拽中数据刷新不打断
- **WHEN** 用户正在拖拽卡片（拖拽尚未完成），同时后台数据刷新触发
- **THEN** 数据刷新 SHALL 跳过 DOM 重建，仅更新数值，不中断拖拽操作

### Requirement: reorder API 端点
服务端 SHALL 提供以下 4 个端点，接收新的顺序数组并持久化：

- `POST /api/indices/reorder`
- `POST /api/active-funds/reorder`
- `POST /api/etfs/reorder`
- `POST /api/stocks/reorder`

#### Scenario: 有效 reorder 请求
- **WHEN** 管理员 POST `{ codes: ["000300", "000905", ...] }` 到 reorder 端点
- **THEN** 服务端 SHALL 按 codes 顺序重排对应 watchlist 数组并写入 JSON 文件，返回 `{ success: true }`

#### Scenario: 带市场后缀的 code 亦可生效
- **WHEN** 管理员 POST `{ codes: ["000300.SH", "000905.SH", ...] }` 到 `POST /api/indices/reorder`
- **THEN** 服务端 SHALL 剥离市场后缀后按新顺序重排，MUST NOT 因匹配失败而回退为原顺序

#### Scenario: 重排后行情缓存失效
- **WHEN** `POST /api/indices/reorder` 成功写入 watchlist
- **THEN** 服务端 SHALL 使 `index-quotes` 缓存失效并异步刷新，使后续 `/api/indices/quotes` 按新顺序返回

#### Scenario: 无效 reorder 请求（非管理员）
- **WHEN** 非管理员用户调用 reorder 端点
- **THEN** 服务端 SHALL 返回 403 错误
