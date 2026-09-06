## Context

指数 K 线降级链（`services/dataFetcher.js` 的 `fetchIndexHistory`）当前顺序为：

1. 东方财富主源（`fetchHistoryKlinesDetailed`）
2. 失败 → 腾讯 fallback（`fetchTencentKlines`）
3. 腾讯也失败 → Yahoo 兜底（`fetchYahooKlines`，仅配置了 `yahooCode` 的美股指数）
4. 全部失败 → stale 缓存 → unavailable

问题出在第 2 → 3 步的连接处。`fetchIndexHistory` 第 1471 行用 `if (tencentKlines.length > 0)` 判断腾讯是否成功，但腾讯对部分美股指数会返回"非空但残缺"的数据：

- 实测 `usNDX`（纳斯达克100）请求 2000 条日 K 仅返回 **1 条**（2026-09 起腾讯接口行为变化）
- 对照组 `us.INX`（标普500）正常返回 2000 条
- 已配置的 Yahoo 兜底 `^NDX` 实测可用（1y 返回 252 条），但因腾讯返回了 1 条（`> 0`），降级链在此中断，Yahoo 永远不触发

后果：NDX 的 52 周高低、多周期动量徽章、sparkline 全部失效或失真。

同时存在第二个 P0：`data/fund-watchlist.json` 混入无效测试代码 `123456`，每次刷新该基金全数据源超时失败。

## Goals / Non-Goals

**Goals:**

- 让纳斯达克100 K 线恢复完整，52 周高低 / 动量 / sparkline 重新有效。
- 通用化修复：任何"非空但残缺"的腾讯 K 线数据都不能中断降级链。
- 保持 A 股 / 港股指数的现有降级行为不变。
- 清理主动基金 watchlist 的垃圾代码 `123456`。

**Non-Goals:**

- 不修复东方财富 K 线接口的 `socket hang up`（上游/网络环境问题，非代码缺陷）。
- 不重构整个降级链架构。
- 不调整 K 线缓存 TTL、并发数、冷却策略（属 P1 体验优化，另立 change）。
- 不为基金 watchlist 增加代码格式校验（防再犯，属 P0 范围外）。

## Decisions

### 决策 1：在 `fetchIndexHistory` 主流程增加腾讯 K 线最小条数校验

在腾讯 fallback 成功后、缓存结果前，对配置了 `yahooCode` 的指数校验返回条数；低于阈值则视为无效，继续走 Yahoo 兜底。

- **为什么在主流程而非 `fetchTencentKlines` 内部**：`fetchTencentKlines` 被多市场通用调用，它自身无法判断"本指数是否还有 Yahoo 兜底"。若在内部一刀切校验，会误伤没有 Yahoo 兜底的 A 股 / 港股指数。
- **为什么阈值定 200**：52 周高低需要约 252 个交易日；200 足以识别"1 条"这类明显残缺，同时对腾讯可能的正常偏少（如次新指数）保留一定容差。正常美股指数腾讯均返回 1000+ 条，不会误触。
- **备选方案（否决）**：直接替换 NDX 的 `txKlineCode` 换腾讯代码。实测探测 `us.NDX100` / `us.NQ` / `us.NDQ` 均无数据，唯一返回 2000 条的 `us.IXIC` 是"纳斯达克综合指数"，与"纳斯达克100"语义错位，沿用会重蹈 6 月 `100.NDX` 错位覆辙。

### 决策 2：校验仅作用于 `cfg.yahooCode` 存在的指数

当前仅 SPX（`^GSPC`）、NDX（`^NDX`）两个美股指数配置了 `yahooCode`。校验用 `cfg.yahooCode` 作为守卫，A 股 / 港股指数继续沿用 `length > 0` 的既有逻辑，零行为变更。

### 决策 3：残缺数据判定无效后，记录失败埋点并输出告警

判定无效时调用 `recordKlineSourceFailure('tencent', code, reason)`，保持 K 线源健康度监控的准确性，并输出 `[K线-腾讯] ... 返回 N 条，数据异常，判定无效` 告警便于排查。

### 决策 4：基金垃圾数据直接删除

`data/fund-watchlist.json` 中删除 `code === '123456'` 的条目，纯数据修复，无代码改动。部署后重启进程生效。

### 决策 5：Yahoo 兜底增加双域名退避重试（实现期新增）

实现验证阶段发现：修复降级链后首次重启服务，Yahoo `^NDX` 返回 **HTTP 429**（限流），NDX 最终 `state: unavailable`、52 周高低/动量全为 `null` —— 即"降级链修好了，但兜底源被限流"仍导致 P0 目标失败。实测该 429 为**间歇性**限流（换 UA / 换 `query2` 域名后均返回 200）。

因此将 `fetchYahooKlines` 拆为「外层重试 + 内层单次请求」：依次尝试 `query1` / `query2` 两个域名，失败退避 `YAHOO_RETRY_DELAY_MS = 1500ms` 后重试；失败埋点由外层在所有尝试结束后统一记录，避免重试期间重复计数。

- **备选方案（否决）**：引入 Stooq 作为额外兜底源 —— 实测其返回 JavaScript 挑战页（`This site requires JavaScript to verify your browser`），无法直接抓取。
- **为什么不做复杂指数退避**：当前仅是偶发 429，一次换域名退避重试即可覆盖；过度设计会延长 K 线刷新耗时。

## Risks / Trade-offs

- [风险] 阈值 200 可能误伤未来新增的、腾讯数据量偏少但有效的美股指数 → 缓解：仅美股指数受此校验，且 Yahoo 兜底数据更全（10 年日 K），误伤代价极低。
- [风险] Yahoo 接口限流或不可用时，NDX 仍可能拿不到数据 → 缓解：Yahoo 失败后继续走 stale 缓存最终兜底，页面不空白。
- [风险] 删除基金数据需进程重启才生效 → 缓解：`readWatchlist` 每次刷新均读取，待 tasks 阶段验证读取时机，必要时 PM2 重启。
- [风险] Yahoo 若持续封禁 IP（非间歇性 429）则重试亦无效 → 缓解：Yahoo 全部失败后仍回退 stale 缓存，页面不空白；实时行情与估值不受影响，仅 K 线衍生字段缺失。已实测 429 为间歇性（换域名/UA 后即返回 200）。

## Migration Plan

1. 代码改动合并后 `npm run package:deploy` 打包 → `deploy.sh` 部署 → `pm2 restart`。
2. 回滚：`git revert` 对应提交并重新部署；`data/fund-watchlist.json` 为文本文件，可用 git 历史恢复。

## Open Questions

- 是否需要在基金 watchlist 新增代码格式校验（6 位数字），防止未来再次混入无效代码？（建议后续另立 change）
