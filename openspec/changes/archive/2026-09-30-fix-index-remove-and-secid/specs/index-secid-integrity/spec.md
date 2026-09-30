## ADDED Requirements

### Requirement: 移除指数对 code 格式容错

`POST /api/indices/remove` SHALL 对入参 code 与关注列表项 code 做同样的归一化（剥离市场后缀）后再匹配，使带市场后缀（`931787.CSI`）与裸码（`931787`）两种写法都能成功移除。

#### Scenario: 带后缀的 code 可以删除

- **WHEN** 管理员传入 `{ code: '931787.CSI' }`，而 watchlist 中该条目 code 为 `931787`
- **THEN** 接口返回成功，条目从 watchlist 移除，MUST NOT 返回"该指数不在关注列表中"

#### Scenario: 裸码仍可删除

- **WHEN** 管理员传入 `{ code: '931787' }`
- **THEN** 接口返回成功，条目被移除

#### Scenario: 真正不存在的指数仍报错

- **WHEN** 管理员传入一个不在 watchlist 中的 code
- **THEN** 接口返回 404 与"该指数不在关注列表中"

### Requirement: 中证指数 secid 正确推导

系统 SHALL 为 `market` 为 CSI 的指数统一推导 secid 为 `2.<code>`，MUST NOT 因代码是纯数字（如 931787、931250）而漏掉该推导。

#### Scenario: 纯数字中证代码使用 2. 前缀

- **GIVEN** 关注条目 `code=931787`、`market=CSI`
- **WHEN** 构造行情采集配置
- **THEN** 使用的 secid 为 `2.931787`

#### Scenario: 带字母中证代码行为不变

- **GIVEN** 关注条目 `code=H30269`、`market=CSI`
- **WHEN** 构造行情采集配置
- **THEN** 使用的 secid 为 `2.H30269`

#### Scenario: 其他市场不受影响

- **GIVEN** 关注条目 `market` 为 SH / SZ / HI / US
- **WHEN** 构造行情采集配置
- **THEN** secid 推导与变更前一致

### Requirement: 启动时自动修正存错的 secid

系统 SHALL 在网站进程启动时（legacy 与 db 两种数据源模式都执行）对关注列表做一次 secid 自检：对每个条目先验证当前配置的 secid 能否取到行情；只有当前配置取不到、且探测到其他市场可取到数据时，才把该项的 `secid` / `market` 修正为可用值并写回 watchlist。探测 SHALL 优先使用东财批量行情接口，单只接口作为备用。

#### Scenario: 修正存错的中证指数

- **GIVEN** 关注条目 `code=931787`、`market=HI`、`secid=100.931787`（取不到数据）
- **WHEN** 服务启动并执行自检
- **THEN** 该条目被修正为 `market=CSI`、`secid=2.931787`，日志输出修正记录

#### Scenario: 正常条目不被误改

- **GIVEN** 关注条目 `code=000300`、`market=SH`、`secid=1.000300`（可正常取到数据）
- **WHEN** 服务启动并执行自检
- **THEN** 该条目的 secid 与 market MUST NOT 被修改

#### Scenario: 数据源不可用时不误改

- **GIVEN** 自检期间行情数据源请求失败或限流
- **WHEN** 自检执行
- **THEN** 相关条目保持不变，不写入 watchlist，下次启动再次自检

#### Scenario: 东财不可达时修正错存为港股的中证指数

- **GIVEN** 服务器到东财行情接口全部不可达，关注条目为 6 位纯数字代码且 `market=HI`
- **WHEN** 自检执行，且中证官网确认该代码是中证指数
- **THEN** 该条目被修正为 `market=CSI`、`secid=2.<code>`；其他形态的条目保持不变

#### Scenario: db 模式下修正生效

- **GIVEN** 数据源模式为 db
- **WHEN** 自检修正了 watchlist
- **THEN** 采集进程感知 watchlist 变化，按新的市场重新同步库中镜像并回补日 K，行情在下一轮采集中出现
