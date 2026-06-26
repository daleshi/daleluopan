## ADDED Requirements

### Requirement: 股票卡片透出真正的 52 周高低字段

后端 `/api/stocks` 响应 SHALL 在每只股票对象上输出基于"约 252 个交易日（≈ 52 周）"的 `high52w` 与 `low52w` 字段，确保字段名与语义一致。

#### Scenario: 252 日 K 线计算高低

- **GIVEN** 某股票（如 600519）已成功拉取 252 条日线
- **WHEN** 客户端调用 `GET /api/stocks`
- **THEN** 该股票对象 `high52w === Math.max(...klines.map(k => k.high))`、`low52w === Math.min(...klines.map(k => k.low))`，二者基于全部 252 条 K 线

#### Scenario: K 线不足 252 时按实际数据计算

- **GIVEN** 某新股仅有 80 条历史 K 线
- **WHEN** 调用接口
- **THEN** `high52w` / `low52w` 基于这 80 条计算，**不**返回 null（仍可用于水位估算，但视为不足"完整 52 周"）

#### Scenario: K 线获取完全失败时为 null

- **GIVEN** 某股票主备数据源全部失败、本地无缓存
- **WHEN** 调用接口
- **THEN** `high52w === null`、`low52w === null`

---

### Requirement: 股票卡片透出价格水位字段 pricePosition52w

后端 `/api/stocks` 响应 SHALL 为每只股票计算并输出 `pricePosition52w`（number 或 null），表示当前价在 52 周高低区间内的百分位。

#### Scenario: 标准计算

- **GIVEN** price=180、low52w=120、high52w=200
- **WHEN** 后端计算
- **THEN** `pricePosition52w === Number(((180 - 120) / (200 - 120) * 100).toFixed(1)) === 75.0`

#### Scenario: 价格突破上界

- **GIVEN** price=210、low52w=120、high52w=200（盘中创新高，K 线尚未更新）
- **WHEN** 后端计算
- **THEN** `pricePosition52w === 100.0`（截断到 100，不返回 >100 或负值）

#### Scenario: 价格跌破下界

- **GIVEN** price=110、low52w=120、high52w=200
- **WHEN** 后端计算
- **THEN** `pricePosition52w === 0.0`

#### Scenario: 区间退化或字段缺失

- **GIVEN** high52w === low52w（如停牌或新股价格未变）
- **WHEN** 后端计算
- **THEN** `pricePosition52w === null`，前端不渲染水位条

---

### Requirement: 股票卡片渲染 52 周水位条

前端股票总览卡片（`buildStockCardHtml`）SHALL 在每张卡片渲染一行"52 周水位条"，含：
- 左侧 52w 最低价（`low52w`，2 位小数）
- 右侧 52w 最高价（`high52w`，2 位小数）
- 中央渐变进度条 + 圆形游标（位置 = `pricePosition52w%`）
- 进度条下方紧贴显示「水位 X.X%」徽章

#### Scenario: 数据完整时正常渲染

- **GIVEN** 股票对象 `low52w=120, high52w=200, pricePosition52w=75.0`
- **WHEN** 渲染卡片
- **THEN** 卡片包含 `.stock-52w-row` 元素，左标 `120.00`、右标 `200.00`、游标 `style="left:75%"`、徽章文字"水位 75.0%"

#### Scenario: 数据缺失时整行隐藏

- **GIVEN** `pricePosition52w === null` 或 `high52w === null`
- **WHEN** 渲染卡片
- **THEN** 不输出 `.stock-52w-row` 元素，卡片其它部分布局不受影响

#### Scenario: 移动端单行不溢出

- **GIVEN** 屏幕宽度 ≤ 480px
- **WHEN** 渲染卡片
- **THEN** `.stock-52w-row` 仍为单行，进度条最小宽度 80px，左右价格字号缩至 10px，不出现换行或溢出

#### Scenario: 不影响既有卡片元素

- **GIVEN** 卡片同时含有 sparkline、价格、涨跌幅、行业标签、删除按钮等
- **WHEN** 添加 52 周水位条后渲染
- **THEN** 上述既有元素位置、样式、功能不变（仅新增一行展示，纵向插入）

---

### Requirement: 移动端响应式与视觉一致性

新增的 52w 水位条 SHALL 复用项目现有的 CSS 变量与设计语言（如 ETF 详情的 `.etf-detail-52w-bar` 配色），保持视觉风格统一；移动端断点（≤480px）使用更紧凑的间距与字号。

#### Scenario: 配色复用

- **WHEN** 渲染水位条
- **THEN** 进度条背景使用 `linear-gradient(90deg, var(--green-value), var(--accent-gold), var(--red-danger))`（与 ETF 详情一致），游标使用 `var(--accent-blue)` + 卡片背景描边

#### Scenario: 暗色 / 亮色主题切换不破坏

- **GIVEN** 用户在浅色主题下查看
- **WHEN** 切换为深色主题
- **THEN** 水位条配色随 CSS 变量自适应（无需硬编码颜色）
