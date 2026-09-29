## ADDED Requirements

### Requirement: 趋势图全量数据首次加载

指数详情弹窗打开时，前端 SHALL 向 `/api/indices/:code/klines` 请求 `range=10y` 的全量历史 K 线（而非仅 1 年），用于后续各周期按钮的可用性判定与本地切片渲染。

#### Scenario: 打开弹窗加载全量 K 线

- **WHEN** 用户打开任一指数的详情弹窗
- **THEN** 前端以 `range=10y` 请求 K 线接口，并基于返回数据总条数初始化趋势按钮状态

#### Scenario: 加载失败展示错误态

- **WHEN** K 线接口请求失败或返回空数据
- **THEN** 趋势图区域展示"行情数据加载失败"提示，不阻塞弹窗其余内容渲染

### Requirement: 趋势周期本地切换

趋势图的 1y/3y/5y/10y 按钮 SHALL 基于已加载的全量数据做本地切片切换，切换时 MUST NOT 重复请求后端（数据已覆盖目标区间时）；按钮 disabled 状态 MUST 基于全量数据条数判定（3y≥500、5y≥1000、10y≥2000 条）。

#### Scenario: 有数据支撑的周期可切换

- **WHEN** 全量 K 线数据条数 ≥ 2000 且用户点击"最近10年"
- **THEN** 趋势图切换为近 10 年区间渲染，按钮处于激活态

#### Scenario: 历史数据不足的周期禁用

- **WHEN** 某指数全量 K 线不足 500 条（如上市不足 3 年）
- **THEN** "最近3年"及以上按钮禁用，并提供"历史数据不足"提示

#### Scenario: 切换响应即时

- **WHEN** 用户在已启用按钮间连续切换
- **THEN** 每次切换仅做本地数据切片与重绘，无网络请求与 loading 闪烁

### Requirement: 后端周期切片能力保持

`/api/indices/:code/klines` SHALL 继续支持 `range` 参数取值 `1y`/`3y`/`5y`/`10y` 的服务端切片（3y≈756、5y≈1260、10y≈2520 个交易日），作为前端全量加载失败或按需加载时的备选路径。

#### Scenario: 服务端按 range 切片

- **WHEN** 请求 `/api/indices/:code/klines?range=5y`
- **THEN** 接口返回约 1260 个交易日的 K 线序列
