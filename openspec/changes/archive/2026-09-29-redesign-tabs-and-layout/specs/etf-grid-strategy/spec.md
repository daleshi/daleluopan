# etf-grid-strategy Delta

## REMOVED Requirements

### Requirement: 网格策略配置数据持久化
**Reason**: 投资策略 Tab 整体删除，ETF 网格策略功能随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: 网格成交记录数据持久化
**Reason**: 投资策略 Tab 整体删除，网格成交记录随之下线。
**Migration**: 历史数据保留在 `data/` 目录；如需恢复功能请回滚代码版本。

### Requirement: 网格策略配置字段结构
**Reason**: 投资策略 Tab 整体删除，网格策略数据结构不再使用。
**Migration**: 历史数据文件保留；如需恢复功能请回滚代码版本。

### Requirement: 读取网格策略配置（公开）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 创建或更新网格策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 删除网格策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 重置网格中线（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 网格成交记录管理
**Reason**: 投资策略 Tab 整体删除，成交记录管理随之下线。
**Migration**: 历史数据保留在 `data/` 目录；如需恢复功能请回滚代码版本。

### Requirement: 网格实时推荐视图
**Reason**: 投资策略 Tab 整体删除，实时推荐视图随之下线。
**Migration**: ETF 行情数据仍可通过 ETF 总览页查看；如需恢复功能请回滚代码版本。

### Requirement: 已实现利润与浮动盈亏统计
**Reason**: 投资策略 Tab 整体删除，盈亏统计随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 投资策略 Tab 展示网格 SubTab
**Reason**: 投资策略 Tab 整体删除。
**Migration**: 无替代界面；ETF 行情信息统一在 ETF 总览页查看。

### Requirement: 网格策略配置表单
**Reason**: 投资策略 Tab 整体删除，配置表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: 网格成交补录表单
**Reason**: 投资策略 Tab 整体删除，补录表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: 移动端响应式
**Reason**: 投资策略 Tab 整体删除，网格模块的移动端适配随之下线。
**Migration**: 如需恢复功能请回滚代码版本。
