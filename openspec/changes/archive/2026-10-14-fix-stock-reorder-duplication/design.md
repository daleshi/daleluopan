## Context

上一个变更 `hk-stock-support` 为了区分 A 股与港股同码标的，把前端拖拽排序提交的内容从裸 code 改为 `fullCode`：

```js
// public/index.html · initCardDnD
const mk = el.dataset.stockMarket || el.dataset.etfMarket || '';
return mk ? `${base}.${mk}` : base;     // "600845.SH" / "00700.HK"
```

后端 `/api/stocks/reorder` 当时只补了「按 code 与 code.market 双键建索引」：

```js
const map = new Map();
stocks.forEach(s => { map.set(s.code, s); map.set(stockKey(s), s); });
const reordered = codes.map(c => map.get(c)).filter(Boolean);
const codesSet = new Set(codes);
stocks.forEach(s => { if (!codesSet.has(s.code)) reordered.push(s); });   // ← 漏改
```

`codesSet` 里是 `600845.SH`，而判断用的是 `s.code`（`600845`），恒不匹配 → 每次调用把整个列表再追加一遍。

**实测复现（本地，5 条）**：

```
POST /api/stocks/reorder {"codes":["600845.SH","600406.SH","600900.SH","600887.SH","00700.HK"]}
→ {"success":true,"data":{"total":10}}
  顺序: 600845.SH, 600406.SH, 600900.SH, 600887.SH, 00700.HK,
        600406.SH, 600845.SH, 600900.SH, 600887.SH, 00700.HK
```

**生产实测**：`data/stock-watchlist.json` 96 条，唯一 10 只（ETF 6/6、指数 14/14 未受影响，因为这两个前端仍提交裸 code）。

用户感知到的现象是「删除不指定的股票」：删除接口用 `findIndex` 只删第一个匹配项，页面上同名的另一条还在，看起来像删不掉或删错了。

## Goals / Non-Goals

**Goals:**
- `/api/stocks/reorder` 无论收到裸 code 还是 fullCode 都不产生重复
- 已损坏的数据能自动收敛，无需用户手工编辑 JSON
- 补齐回归测试，防止再次引入
- 清洗生产与本地已膨胀的关注列表

**Non-Goals:**
- 不改前端提交格式（fullCode 是区分 A 股 / 港股同码的正确做法，予以保留）
- 不改 `/api/etfs/reorder`、`/api/indices/reorder`、`/api/active-funds/reorder`（未受影响）
- 不新增去重运维脚本（读取自愈 + 一次性清洗已足够）
- 不改动删除接口的 `findIndex` 语义（去重后列表唯一，一次删除即一条）

## Decisions

### 决策 1：兜底判断同时认两种形态 + 输出侧去重

```js
const codesSet = new Set(codes);
stocks.forEach(s => {
    const k = stockKey(s);
    if (codesSet.has(s.code) || codesSet.has(k)) return;   // 裸 code 或 fullCode 任一命中即视为已覆盖
    ...
});
```

并在 `reordered` 构建过程中用 `seen`（key = `code.market`）去重，顺带抵御 `codes` 本身含重复项的情况。

- **理由**：只改匹配还不够——`codes` 若含重复（或未来再次出现键不一致）仍会放大列表。输出侧去重是最后一道防线，成本极低。
- **否决方案**：把前端改回只提交裸 code —— 会让 A 股与港股同码标的（如未来加入 `00700` 的 A 股）无法区分，是倒退。

### 决策 2：`readWatchlist()` 读取侧去重自愈

- **理由**：生产数据已被污染（96 条），只修接口无法收敛存量。读取侧去重让**任意一次读 + 写循环**（增删、重排）自动把文件收敛为唯一列表，不需要用户干预，也不需要额外的迁移脚本。
- **代价**：多一次遍历（条目个位数，开销可忽略）；去重只在内存生效，不主动写盘，因此不会在用户无感知时改写文件。
- **异常兜底**：若去重结果为空（极端脏数据），回退返回原始列表，避免把列表清空。

### 决策 3：一次性清洗 + 备份，而非依赖自愈慢慢收敛

生产 96 条如果不清洗，用户每次拖拽只会维持 96 条（去重后写回 10 条？不——reorder 从 `readWatchlist()` 读到的已是去重后的 10 条，写入即收敛）。所以其实**自愈在下一次写操作时就会收敛**。仍然选择主动清洗，是因为：

- 96 条会让 `/api/stocks` 拉 96 次重复行情，浪费外部请求配额
- 未清洗期间页面会渲染大量重复卡片

清洗策略：每次 reorder 产生的新顺序位于结果前半段，因此取前 `length/2` 条去重，保留最后一次拖拽的顺序；若结果少于全表去重数量则退回全表去重。清洗前先 `cp` 备份为 `data/stock-watchlist.json.bak.<时间戳>`。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 清洗后顺序不是用户期望 | 顺序取最后一次拖拽结果；若不满意重新拖一次即可。已明确告知用户 |
| 读取去重掩盖了其他写入路径产生的重复 | 写入路径只有 add（判重 code+market）/ remove / reorder（已去重）/ watchlist 批量（已校验），无其他来源 |
| 生产清洗误删数据 | 清洗前已 `cp` 备份；且只去「代码 + 市场」完全相同的重复项，不丢标的 |
| 其他地方依赖 `readWatchlist()` 返回原始条数 | 调用点均为渲染 / 市场探测 / 校验，去重只会让结果更正确 |

## Migration Plan

1. 修 `/api/stocks/reorder`（双形态匹配 + 输出去重）
2. `readWatchlist()` 加读取去重自愈
3. 补测试并本地复现验证（5 条 reorder 后仍 5 条）
4. 备份并清洗生产 `data/stock-watchlist.json`（96 → 10）
5. 打包部署、`pm2 restart`，线上确认 `/api/stocks/watchlist` 返回 10 条且日志无异常

**回滚**：`git revert` 两项代码改动 + `pm2 restart`；数据用 `data/stock-watchlist.json.bak.<时间戳>` 覆盖回退。

## Open Questions

1. 是否要把同样的读取去重加到 ETF / 指数 / 基金关注列表？—— 当前三者无重复（6/6、14/14），**暂不加**，避免无谓改动；若将来出现同类问题再补。
2. 是否需要在管理端暴露"一键去重"？—— 读取自愈已覆盖，**不做**。
