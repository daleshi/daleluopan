## Why

用户反馈「严选股票这里删除不指定的股票」。排查发现：删除接口本身正确，但**股票关注列表里存在大量重复项**——点删除只移除第一个匹配项，页面上仍留有同名的另一条，表现为"删不掉 / 删错了"。

重复项的来源是上一个变更 `hk-stock-support` 引入的回归：

- 为了让 A 股与港股同码标的能区分，前端拖拽排序改为提交 `fullCode`（`600845.SH` / `00700.HK`）
- 后端 `/api/stocks/reorder` 的兜底追加判断仍是 `codesSet.has(s.code)`，用的是**裸 code**（`600845`）
- `codesSet` 里只有 `600845.SH`，`has('600845')` 恒为 `false` → 认为"这些条目不在新顺序里" → **把整个列表再追加一遍**

即：**每拖拽排序一次，股票关注列表整体翻倍**。实测复现：5 条 → 一次 reorder → 10 条。

生产环境实测已膨胀到 **96 条（唯一仅 10 只）**；ETF（6/6）与指数（14/14）不受影响，因为这两个前端仍提交裸 code。

## What Changes

- **后端 `/api/stocks/reorder`**：兜底追加判断同时认裸 code 与 `fullCode`（`codesSet.has(s.code) || codesSet.has(stockKey(s))`），并按「代码 + 市场」对结果去重，杜绝重复项产生
- **`services/stockFetcher.js` `readWatchlist()`**：读取时按「代码 + 市场」去重自愈（发现重复时打印 `[股票] 关注列表存在重复项，已自动去重` 警告），使已损坏的数据在任意一次读 + 写循环中被收敛
- **生产数据清洗**：`data/stock-watchlist.json` 96 → 10，顺序取最后一次拖拽的结果（每次 reorder 的新顺序位于前半段），清洗前已备份为 `data/stock-watchlist.json.bak.<时间戳>`
- **回归测试**：`tests/stocks.test.js` 新增 reorder 用例（未登录 401、非数组 400、fullCode 重排不翻倍且顺序正确、裸 code 重排不翻倍）

## Capabilities

### New Capabilities

（无 — 不新增能力，属于既有能力的缺陷修复）

### Modified Capabilities

- `hk-stock-support`: 修正其引入的 fullCode 与后端兜底判断不匹配问题，使「按代码 + 市场区分标的」在 reorder 路径上真正成立

## Impact

**代码**
- `server.js`：`/api/stocks/reorder` 约 +17 行（去重 + 双形态匹配）
- `services/stockFetcher.js`：`readWatchlist()` 约 +14 行（读取去重自愈）
- `tests/stocks.test.js`：新增 4 个用例（23/23 通过）

**数据**
- 生产 `data/stock-watchlist.json` 由 96 条清洗为 10 条（已备份）
- 本地 `data/stock-watchlist.json` 同样去重（测试期间曾膨胀到 10 条）
- 新增的读取去重会在下次写入时自动收敛任何残留重复，无需手工迁移

**风险**
- 读取去重是只读侧的自愈，不改变文件内容；只有发生写操作（增删 / 重排）时才会落盘，因此不会在用户无感知时改写数据
- 清洗后的顺序取"最后一次拖拽结果"，若用户对当前顺序不满意，重新拖拽一次即可
