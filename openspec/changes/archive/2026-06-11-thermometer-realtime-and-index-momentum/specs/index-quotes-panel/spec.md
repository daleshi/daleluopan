## ADDED Requirements

### Requirement: 全市场指数多周期动量字段后端透出

后端 SHALL 在 `/api/indices/quotes` 与 `/api/indices` 的响应中，为**全部市场**（A 股 / 港股 / 美股）的每个指数对象统一透出多周期涨跌幅字段，基于现有 `historySeries` 在后端计算（避免前端重复计算）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `momentum1m` | number\|null | 近 1 月（约 21 个交易日）涨跌幅 %（保留两位小数） |
| `momentum3m` | number\|null | 近 3 月（约 63 个交易日）涨跌幅 % |
| `momentum6m` | number\|null | 近 6 月（约 126 个交易日）涨跌幅 % |
| `momentum1y` | number\|null | 近 1 年（约 252 个交易日）涨跌幅 % |

#### Scenario: A 股指数响应包含全部 4 个动量字段

- **GIVEN** watchlist 含沪深 300（`000300.SH`）且 historySeries 长度 ≥ 252
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 沪深 300 对象同时包含 `momentum1m` / `momentum3m` / `momentum6m` / `momentum1y` 四个字段，类型为 number 或 null

#### Scenario: 港股指数响应包含全部 4 个动量字段

- **GIVEN** watchlist 含恒生科技（`HSTECH.HK`）
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 恒生科技对象包含 `momentum1m` / `momentum3m` / `momentum6m` / `momentum1y` 四个字段

#### Scenario: 历史数据不足时对应字段为 null

- **GIVEN** 某指数 historySeries 长度 = 30（不足 3 月）
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 该对象 `momentum1m` 为有效数字，`momentum3m` / `momentum6m` / `momentum1y` 均为 `null`

#### Scenario: 字段数值与口径一致

- **GIVEN** 沪深 300 当前价 = 4000，21 个交易日前收盘 = 3800
- **WHEN** 后端计算 `momentum1m`
- **THEN** 字段值 = `((4000 - 3800) / 3800 * 100).toFixed(2)` = `5.26`

#### Scenario: 美股指数兼容现有口径

- **GIVEN** watchlist 含 SPX.US
- **WHEN** 调用 `GET /api/indices/quotes`
- **THEN** 美股指数对象仍保留原有 `momentum1m` / `momentum3m` / `ytdChange` 字段，新增的 `momentum6m` / `momentum1y` 采用与其它市场相同的口径（基于交易日数）

---

### Requirement: 指数卡片多周期动量徽章

前端 SHALL 在**每张**指数卡片（不论市场）渲染一行"多周期动量"，以 4 列徽章形式展示近 1 月 / 3 月 / 6 月 / 1 年涨跌幅。

#### Scenario: A 股卡片显示 4 列动量徽章

- **GIVEN** `/api/indices/quotes` 返回沪深 300 `momentum1m=2.50`、`momentum3m=-1.20`、`momentum6m=8.30`、`momentum1y=15.50`
- **WHEN** 渲染指数卡片
- **THEN** 卡片显示 `1月 +2.50%`、`3月 -1.20%`、`6月 +8.30%`、`1年 +15.50%` 四列徽章

#### Scenario: 港股卡片显示 4 列动量徽章

- **GIVEN** 恒生科技返回 `momentum1m=3.10`、`momentum3m=null`、`momentum6m=null`、`momentum1y=null`
- **WHEN** 渲染卡片
- **THEN** 显示 `1月 +3.10%`、`3月 --`、`6月 --`、`1年 --`

#### Scenario: 红涨绿跌配色一致

- **GIVEN** `momentum1m > 0`
- **WHEN** 渲染徽章
- **THEN** 数字文字颜色使用 CSS 变量 `--color-rise`（红）；`< 0` 使用 `--color-fall`（绿）；`= 0` 使用次级文本色

#### Scenario: null 值显示横线

- **GIVEN** 任一周期值为 `null`
- **WHEN** 渲染该列
- **THEN** 显示 `--`，颜色使用次级文本色（不进入红/绿配色）

#### Scenario: 移动端纵向自适应

- **GIVEN** 屏幕宽度 ≤ 480px
- **WHEN** 渲染指数卡片
- **THEN** 4 列动量徽章自适应为 2×2 网格，不溢出卡片宽度

---

### Requirement: 多周期动量与现有美股展示元素并存

新增的"多周期动量徽章"行 SHALL 不替换或破坏现有美股卡片上的 52 周区间条、Sparkline 与原有 3 列动量徽章；A 股 / 港股卡片仍不显示美股专属元素。

#### Scenario: 美股卡片同时显示新旧元素

- **GIVEN** SPX.US 卡片
- **WHEN** 渲染
- **THEN** 同时包含：52 周区间水位条、原 3 列动量徽章（近1月 / 近3月 / 今年以来）、30 天 Sparkline、**以及**新增的 4 列多周期动量行

#### Scenario: A 股卡片仅显示新增多周期动量

- **GIVEN** 沪深 300 卡片
- **WHEN** 渲染
- **THEN** 包含基础信息 + 新增 4 列多周期动量行，**不**包含 52 周区间条 / Sparkline / 原 3 列美股动量徽章
