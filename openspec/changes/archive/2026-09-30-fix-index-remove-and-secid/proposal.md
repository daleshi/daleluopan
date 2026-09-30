## Why

管理员在「指数行情」页遇到两个问题：

1. **删不掉指数**：点删除提示"该指数不在关注列表中"，但卡片还在页面上。原因是前端 `removeIndexFromPanel` 传的是带市场后缀的 code（`931787.CSI`），后端 `/api/indices/remove` 用裸 code（`931787`）做 `findIndex` 匹配，永远匹配不上 → 返回 404。同一个问题此前在 `/api/indices/reorder` 上修过，remove 漏了。
2. **新增的指数没有数据**，尤其"港股创新药"（931787）完全空白。根因是 secid 存错：931787、931250 是**中证指数**，东财 secid 应为 `2.931787`；线上存成了 `100.931787`（美股/港股前缀），东财返回空。成因有两处：
   - 搜索接口把 `MktNum=2/128` 一律判成港股（HI），导致中证系指数添加时就存错（上一变更已修搜索侧，但线上此前添加的条目已成脏数据）
   - secid 推导函数 `isSpecialCSIIndex` 只认**带字母**的中证代码（如 H30269），纯数字的 931787 被排除，因此即便 market 正确，secid 也不会被修正为 `2.xxx`

实测证据：`2.931787` 返回 `f43=152629`（港股创新药，1526.29），`2.931250` 返回 1232.55；而 `100.931787`、`100.931250` 返回 `data:null`。腾讯备用源对中证数字指数不支持（sh/sz/bj/zs 前缀均 `pv_none_match`），因此这类指数只能靠东财 `2.xxx` 通道。

3. **所有指数的 52 周最低点取值错误**：A 股指数的 `low52w` 全是 1 左右（沪深300 显示 `1.05`，实际约 4323）。根因是腾讯备用源解析把字段 48/49 当成了 52 周高低——实测该字段**仅港美股**是 52 周高低（`hkHSTECH` 返回 6715.46 / 4216.34），A 股（`sh000300`）返回的是 `-1` / `1.04`（换手率、量比之类）。东财限流时腾讯成为主源，A 股就被填成了荒谬值。港美股正常，所以问题只体现在 A 股。

## What Changes

- **删除接口归一化 code**：`/api/indices/remove` 剥离入参与 watchlist 项的市场后缀后再匹配，与 `/api/indices/reorder` 的处理方式一致
- **secid 推导覆盖纯数字中证代码**：`isSpecialCSIIndex` 不再要求代码含字母；新增 `deriveSecidForMarket(code, market)` 作为统一的 secid 推导入口
- **启动时自检修正脏数据**：新增 `selfHealWatchlistSecids()`，在启动刷新前逐个探测关注列表条目，**仅当当前配置确实取不到数据**且探测到其他市场可用时，才修正该项的 `secid` / `market` 并写回 watchlist（每次启动最多修正 5 项，避免异常情况下大量请求）。自检 MUST 跳过候选池内的指数——实测曾把池内 `NDX` 从 `US/100.NDX100` 误改成 `HI/100.NDX`，而后者是项目文档明确记录的错位 secid（指向纳斯达克综合指数）
- **52 周高低只采用可信来源**：腾讯解析仅对港美股采用字段 48/49；新增 `isSane52wRange()` 量级校验（要求 `0 < 低 <= 高` 且与当前价比值合理），不合理的值一律用 K 线统计覆盖，不再输出到接口

## Capabilities

### New Capabilities
- `index-secid-integrity`：指数关注列表 secid / market 的正确性保障——按市场推导 secid、启动时自动修正存错的条目、删除与重排接口对 code 格式的容错

### Modified Capabilities
<!-- 无既有 spec 的行为变更 -->

## Impact

- **后端**：`server.js`（`/api/indices/remove` 归一化、启动时调用自检、导出自检函数）、`services/dataFetcher.js`（`isSpecialCSIIndex` / `deriveSecidForMarket` / `selfHealWatchlistSecids`）
- **前端**：无改动
- **运行行为**：服务启动时对关注列表多 N 次行情探测请求（仅在当前配置取不到数据时才会继续探测其他候选）；修正后写一次 `data/index-watchlist.json`
- **数据**：会自动修正 `secid` / `market` 字段，指数名称与关注顺序不变
- **已知限制**：中证数字指数（如 931787）只有东财 `2.xxx` 一个可用源，腾讯不支持；东财限流期间这类指数价格会为 null（与沪深300 等其他指数表现一致）
