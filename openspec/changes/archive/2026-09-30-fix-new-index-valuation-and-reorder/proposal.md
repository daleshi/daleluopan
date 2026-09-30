## Why

「指数行情」页有两个管理员才能触发的问题：

1. **手动添加的指数卡片缺字段**：已有指数显示 PE、PB、PE/PB 百分位和估值档位，新添加的指数这些位置整块空白。原因是行情接口的估值字段只有一个来源——候选池配置里的蛋卷 `djCode` 与蛋卷估值映射匹配。搜索结果和关注列表都不保存 `djCode`，所以搜索添加的指数拿不到估值；更麻烦的是搜索接口会把中证系指数（如中证红利低波 H30269）的市场判成港股 `HI`，导致池内指数添加后连行情和估值一起失效。
2. **拖拽排序不生效**：拖完顺序立刻变了，刷新页面又恢复原样。原因是前端发给 `/api/indices/reorder` 的是带市场后缀的 code（`000300.SH`），后端用裸 code（`000300`）建索引匹配，全部匹配失败后走兜底分支，把原数组按原顺序写回；而且这个接口成功后没有让行情缓存失效，就算写对了，刷新时还会拿到缓存里的旧顺序。

两个问题都只影响管理员操作后的结果，普通用户看不到，但会让管理员以为自己的操作没保存。

## What Changes

### 新增指数的估值覆盖

- **搜索接口修正市场推断**：`MktNum=2/128` 时按代码特征区分中证（CSI，`secid` 前缀 `2.`）与港股（HI，`secid` 前缀 `100.`）；并优先按 code 在候选池中查找（不限市场）得到 icon / category
- **添加接口补齐元数据**：`/api/indices/add` 命中候选池时，用池里的 `market` / `secid` 校正入参，并把 `djCode` / `csCode` 一起持久化进 watchlist
- **行情接口加估值兜底**：蛋卷没命中时，用天天基金估值映射（已支持按 `code` / `csCode` 匹配，5 分钟缓存）作为二级来源，补上 PE / PB / 百分位；`evaType` 在百分位可用时按现有阈值推导，不可用则为 `null`
- **watchlist 支持携带 djCode**：`fetchIndexQuotesForWatchlist` 优先用 watchlist 项自带的 `djCode`（若已持久化），其次用候选池的

### 拖拽排序持久化

- **前端**：发送 code 前剥离市场后缀，与 ETF / 股票分支保持一致
- **后端**：reorder 入参做同样的归一化（兼容裸码与带后缀两种写法），不再出现全量匹配失败
- **缓存失效**：reorder 成功后删除 `index-quotes` 内存缓存并异步强制刷新，与 add / remove 的行为保持一致，保证刷新页面看到新顺序

## Capabilities

### New Capabilities
- `index-valuation-coverage`：新增（含搜索添加）指数在行情接口中获得估值数据的能力——market 正确推断、djCode 持久化、估值二级数据源兜底

### Modified Capabilities
- `watchlist-drag-reorder`：reorder 端点需兼容带市场后缀的 code，且重排成功后必须让行情缓存失效，使新顺序在刷新后保持

## Impact

- **后端**：`services/dataFetcher.js`（`searchIndex` 的 MktNum→market 映射、`fetchIndexQuotesForWatchlist` 的估值兜底）、`server.js`（`/api/indices/add` 持久化 djCode/csCode、`/api/indices/reorder` 归一化 + 缓存失效）
- **前端**：`public/index.html`（拖拽保存时剥离 code 后缀）
- **API 行为**：`/api/indices/add` 写入的 watchlist 项增加 `djCode` / `csCode` 字段（旧数据缺失时按候选池回退，向后兼容）；`/api/indices/reorder` 接受带后缀 code（此前静默失效）；`/api/indices/quotes` 对部分此前为 `null` 的指数开始返回估值（新增字段值，不改动字段名）
- **数据源**：新增对天天基金估值接口的实际调用（仅在蛋卷未命中时），该数据源已在数据源管理中可开关，受其配置控制
- **无影响**：认证、行情采集、K 线、温度计、基金 / ETF / 股票总览
