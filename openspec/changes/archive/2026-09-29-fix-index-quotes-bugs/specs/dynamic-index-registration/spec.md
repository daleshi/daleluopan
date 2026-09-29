## ADDED Requirements

### Requirement: 池外指数纳入历史数据构建

`/api/indices` 的指数配置构建（`buildIndexConfig`）SHALL 对候选池（POOL_MAP）未命中的 watchlist 指数，基于 watchlist 条目中的 `code`/`name`/`market`/`secid` 动态构造配置并纳入 `fetchAllIndexData` 流程，使其获得历史 K 线采集、52 周统计与动量计算能力，并写入 indices.json 缓存。

#### Scenario: 新增池外指数获得历史数据

- **WHEN** 用户通过 `/api/indices/add` 添加一个池外指数（secid 有效），且下一次数据刷新周期完成
- **THEN** `/api/indices` 返回中包含该指数，含历史 K 线与 52w 统计，`data/cache/indices.json` 中写入其数据条目

#### Scenario: 池内指数行为不变

- **WHEN** watchlist 仅包含候选池内指数
- **THEN** `/api/indices` 返回结构与字段与现有行为完全一致

#### Scenario: 无效 secid 容错

- **WHEN** 池外指数的 secid 无效导致 K 线采集失败
- **THEN** 该指数在 `/api/indices` 中以空数据形式存在或被跳过，不影响其他指数的数据构建

### Requirement: 添加后异步预热

`/api/indices/add` 成功写入 watchlist 后 SHALL 触发新指数历史数据的异步预热（fire-and-forget），MUST NOT 阻塞添加接口的响应。

#### Scenario: 添加接口快速返回

- **WHEN** 用户添加新指数
- **THEN** 接口在 watchlist 写入后立即返回成功，历史数据拉取在后台异步执行

#### Scenario: 预热失败可自愈

- **WHEN** 异步预热因数据源故障失败
- **THEN** 后续常规刷新周期会重试采集，系统无脏状态残留
