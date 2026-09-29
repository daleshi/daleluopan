# gold-dca-strategy Delta

## REMOVED Requirements

### Requirement: 黄金定投策略数据持久化
**Reason**: 投资策略 Tab 整体删除，黄金定投策略功能随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: 读取黄金策略配置（公开）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 创建或更新黄金策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 删除黄金策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 实时计算黄金买入档位与止盈状态
**Reason**: 投资策略 Tab 整体删除，档位计算随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 持仓记录管理（黄金）
**Reason**: 投资策略 Tab 整体删除，持仓记录接口一并移除。
**Migration**: 历史数据保留在 `data/` 目录；如需恢复功能请回滚代码版本。

### Requirement: 投资策略 Tab 展示黄金定投卡片
**Reason**: 投资策略 Tab 整体删除。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: 用户确认型止盈
**Reason**: 投资策略 Tab 整体删除，止盈确认交互随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 管理员可视化配置黄金策略
**Reason**: 投资策略 Tab 整体删除，配置表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。
