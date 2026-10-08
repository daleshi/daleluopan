## ADDED Requirements

### Requirement: 搜索返回港股正股

股票搜索 SHALL 返回港股个股（东财 `MktNum=116`、5 位代码，如 `00700` 腾讯控股）与 A 股个股（6 位），并 MUST 排除港股窝轮、牛熊证与人民币柜台（`-R`）。搜索结果 MUST 带市场标识，供前端区分展示。

#### Scenario: 按名称搜索港股

- **WHEN** 管理员在「股票总览」搜索「腾讯」
- **THEN** 结果中包含「腾讯控股 00700」且市场标识为港股，`secid` 为 `116.00700`

#### Scenario: 按代码搜索港股

- **WHEN** 管理员搜索 `00700`
- **THEN** 返回腾讯控股，市场标识为港股

#### Scenario: 排除衍生品与人民币柜台

- **WHEN** 搜索结果中包含窝轮（如 `13005 腾讯法兴七三购A`）或人民币柜台（如 `80700 腾讯控股-R`）
- **THEN** 这些条目 MUST NOT 出现在结果中

### Requirement: 添加与移除按市场校验

`POST /api/stocks/add` SHALL 只接受市场白名单 `SH` / `SZ` / `HK`，并按市场校验代码与 secid：SH / SZ 为 6 位且 secid 为 `0.` 或 `1.` 开头，HK 为 5 位且 secid 为 `116.` 开头。判重 MUST 按「代码 + 市场」。`POST /api/stocks/remove` SHALL 接受可选的 market，未传时按代码匹配。

#### Scenario: 添加港股成功

- **WHEN** 管理员添加 `{ code: '00700', market: 'HK', secid: '116.00700', name: '腾讯控股' }`
- **THEN** 接口返回成功，该条目写入股票 watchlist

#### Scenario: 市场与代码不匹配

- **WHEN** 管理员提交 `{ code: '00700', market: 'SH' }`
- **THEN** 接口返回 400 并说明代码与市场不匹配

#### Scenario: 同码不同市场可共存

- **GIVEN** 关注列表中已有 `000001` / `SH`
- **WHEN** 管理员添加 `000001` / `HK`
- **THEN** 添加成功，两条互不覆盖；删除其中一条不影响另一条

### Requirement: 港股实时行情与 52 周水位

港股个股 SHALL 返回与 A 股相同的行情字段（现价、涨跌幅、成交量额、换手率、总市值、PE、PB）与 52 周高低水位。行情备用源（腾讯）MUST 使用 `hk` 前缀，MUST NOT 把港股拼成 `sh` 前缀。

#### Scenario: 东财不可用时走腾讯备用源

- **GIVEN** 东财行情接口不可用
- **WHEN** 采集港股个股行情
- **THEN** 使用 `hk00700` 取到行情，卡片显示价格与涨跌幅

#### Scenario: 52 周水位

- **WHEN** 港股个股的日 K 数据可用
- **THEN** 卡片显示 52 周高低与当前价在区间中的位置

### Requirement: 港股交易时段识别

系统 SHALL 根据股票关注列表中的市场判断当前是否处于交易时段，并据此决定 `/api/stocks` 的 `trading` 字段与缓存 TTL。港股时段（北京时间 09:30–12:00、13:00–16:10）内，即使 A 股已收盘，股票页 MUST 仍按交易时段节奏刷新。

#### Scenario: A 股收盘后港股仍在交易

- **GIVEN** 关注列表中同时有 A 股与港股，当前北京时间 15:30（A 股已收盘、港股仍在交易）
- **WHEN** 请求 `/api/stocks`
- **THEN** `trading` 为 true，缓存按交易时段 TTL

### Requirement: 港股日 K 与估值入库

采集进程 SHALL 为港股个股建立库中镜像（市场 `HK`、secid `116.<5位>`），采集日 K 并在每个交易日记录 PE / PB。日 K MUST 在东财不可用时改用腾讯港股源。东财个股估值报表不覆盖港股，PE / PB SHALL 从每日行情快照记录（来源 `quote_snapshot`），自上线之日起积累。

#### Scenario: 东财历史接口不可用时补齐日 K

- **GIVEN** 东财历史 K 线接口不可用
- **WHEN** 采集港股个股日 K
- **THEN** 使用腾讯港股日 K 写入，并记录来源为 `tencent`

#### Scenario: 估值从快照积累

- **WHEN** 某交易日收盘任务执行且港股个股快照中有 PE / PB
- **THEN** 该交易日写入一条 `quote_snapshot` 来源的估值记录

#### Scenario: 尚无历史估值的市场

- **WHEN** 用户查看一只刚添加的港股个股的 PE / PB 走势
- **THEN** 提示该市场暂无历史估值数据，并说明自哪一天开始积累
