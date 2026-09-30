## Context

线上关注列表（13 项）中，用户新增的 4 个指数里有两个完全无数据：

```
{"name":"港股通创新药","code":"931250","market":"HI","secid":"100.931250"}
{"name":"港股创新药","code":"931787","market":"HI","secid":"100.931787"}
```

实测东财：

| secid | 结果 |
|---|---|
| `100.931787` / `100.931250` | `data: null`（无数据） |
| `2.931787` | `f43=152629`、名称"港股创新药" |
| `2.931250` | `f43=123255`、名称"港股通创新药" |
| `0.980092`（自由现金流）、`0.399673`（创业板50） | 正常 |

即：`931xxx` 是中证指数，secid 前缀必须是 `2.`；`100.` 是美股/港股前缀，拿不到数据。

两条成因链：
1. 搜索接口 `searchIndex` 把 `MktNum=2/128`（东财对中证与港股的合并分类）一律判为 HI → 添加时就写错（上一变更已在搜索侧修正，但线上已存在的条目仍是脏数据）
2. `isSpecialCSIIndex(cfg)` 判定为 `market === 'CSI' && /[A-Za-z]/.test(code)`，纯数字中证代码被排除 → 即使 market 正确，secid 也不会被推导为 `2.xxx`

删除 bug：`removeIndexFromPanel(code, name)` 传入的是 `indexQuotesData` 元素的 code（带后缀，由 `fetchIndexQuotesForWatchlist` 拼装 `${idx.code}.${idx.market}`），而 `/api/indices/remove` 用 `indices.findIndex(i => i.code === code)` 按裸码匹配 → 永远 -1 → 404。

约束：中证数字指数只有东财 `2.xxx` 可用（腾讯 sh/sz/bj/zs 全部无匹配），不能依赖备用源兜底；修正脏数据要避免误改正常条目。

## Goals / Non-Goals

**Goals:**
- 删除接口对 code 格式容错，带后缀与裸码都能删掉
- 中证数字指数的 secid 被正确推导为 `2.xxx`
- 已存在的脏数据在服务启动时自动修正，无需人工改 JSON

**Non-Goals:**
- 不为中证数字指数新增备用数据源（腾讯不支持，无可用替代）
- 不做持续性的 secid 探测（只在启动时自检一次）
- 不改前端

## Decisions

### D1：remove 归一化，与 reorder 保持同一种写法

**选择**：`/api/indices/remove` 用 `String(c).replace(/\.[A-Z]{2,5}$/i, '')` 对入参与 watchlist 项双向归一化后再匹配。

**理由**：与已修的 reorder 一致，双端容错；前端不改也能修好。
**备选方案**：改前端发裸码。放弃原因：前端多处拼装 code，改一处不彻底，且后端容错更稳。

### D2：`isSpecialCSIIndex` 去掉"必须含字母"的限制

**选择**：判定改为 `cfg?.market === 'CSI'`，并抽出 `deriveSecidForMarket(code, market)`。

**理由**：中证代码既有字母开头（H30269）也有纯数字（931787、931250），原判定漏掉后者。限定 market 为 CSI 才改，不影响 SH/SZ/HI/US。
**风险**：`buildIndexKlineProfile` 对 CSI 一律优先用 `2.${code}`——这正是期望行为（CSI 的 secid 前缀就是 `2.`），且只对 market 为 CSI 的条目生效。

### D3：启动时自检，且"先验证当前配置，只有取不到数据才改"

**选择**：`selfHealWatchlistSecids()` 对每个条目按顺序探测「当前 market 的 secid → 其他候选市场」，返回第一个能取到价格且返回代码与目标一致的候选；**仅当结果落在与当前不同的 market** 才修正，最多改 5 项，写回 watchlist。

**理由**：这是避免误改的关键。若直接按 CSI 优先探测，像 000300 这种正常指数会被探测结果带偏（`2.000300` 也可能有返回），导致正常条目被改错。先验证当前配置则不会动正常条目——实测中 000300、399673、980092 均未被改动。
**备选方案**：提供管理端"一键修复"按钮。放弃原因：用户已经因为数据缺失困扰，自动修更省事；且自检只在启动时跑一次。
**兜底**：探测用东财单条接口，失败（网络/限流）时该条目跳过不修改，不会因数据源抖动误改数据。

### D4：自检时机放在启动 Phase 2 的最前面

**选择**：在 Phase 2a（K 线刷新）之前执行。

**理由**：`fetchIndexQuotesForWatchlist` 与 `fetchAllIndexData` 都用 watchlist 的 secid 采集，必须在它们之前修正，否则本轮采集仍用错误的 secid。
**代价**：启动多几次探测请求，仅在有异常条目时继续探测其他候选。

## Risks / Trade-offs

- [东财限流时自检跳过] → 该条目本次不修正，下次启动再试；不会误改
- [中证数字指数在东财限流时无价格] → 只有东财 `2.xxx` 一个源，无备用；此时显示为空，与同期限流的其他指数一致，不是本次改动引入的问题
- [自检最多修正 5 项] → 极端情况下需多次启动才能修完，属保守设计，避免请求放大
- [自动改写用户文件] → 只改 `secid` / `market` 两个字段，名称与顺序不变；修正前会在日志打印前后值，可追溯

## Migration Plan

1. 代码已改（后端两处 + dataFetcher 三处）
2. 发布：`npm run package:deploy` → 上传 → 解压排除 data → `pm2 restart`
3. 重启后自检会自动修正线上 `931787` / `931250` 的 secid（日志出现「[自检] 已修正 N 个指数的 secid」）
4. 回滚：git revert 后重启；已修正的 secid 是正确的，无需回退

## Open Questions

- 无
