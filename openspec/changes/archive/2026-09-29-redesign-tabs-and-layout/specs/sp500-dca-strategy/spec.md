# sp500-dca-strategy Delta

## REMOVED Requirements

### Requirement: 标普 500 策略数据持久化
**Reason**: 投资策略 Tab 整体删除，标普 500 策略功能随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: 读取标普 500 策略配置（公开）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 更新标普 500 策略配置（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 标普 500 共享指标 — 距 5Y 高点回撤
**Reason**: 投资策略 Tab 整体删除，该策略专属指标随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 场外定投 4 档矩阵
**Reason**: 投资策略 Tab 整体删除，档位矩阵随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 场内 4 信号灯 + 阶梯溢价闸门
**Reason**: 投资策略 Tab 整体删除，信号灯与溢价闸门随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: ETF IOPV 抓取扩展
**Reason**: 该扩展仅为标普 500 策略服务，策略删除后一并下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 实时计算标普 500 推荐
**Reason**: 投资策略 Tab 整体删除，实时推荐随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 投资策略 Tab 新增标普 500 子 tab
**Reason**: 投资策略 Tab 整体删除。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: 管理员可视化配置标普 500 策略
**Reason**: 投资策略 Tab 整体删除，配置表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。
