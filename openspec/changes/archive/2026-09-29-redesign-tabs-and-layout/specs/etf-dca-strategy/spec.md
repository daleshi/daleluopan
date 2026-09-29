# etf-dca-strategy Delta

## REMOVED Requirements

### Requirement: ETF 定投策略数据持久化
**Reason**: 投资策略 Tab 整体删除，ETF 定投策略功能随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: ETF 持仓数据独立持久化
**Reason**: 投资策略 Tab 整体删除，ETF 持仓管理随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: 读取 ETF 策略配置（公开）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 创建或更新 ETF 策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 删除 ETF 策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: ETF 实时推荐计算
**Reason**: 投资策略 Tab 整体删除，实时推荐视图随之下线。
**Migration**: ETF 行情数据仍可通过 ETF 总览页查看；策略推荐功能如需恢复请回滚代码版本。

### Requirement: ETF 持仓记录管理（独立接口）
**Reason**: 投资策略 Tab 整体删除，持仓记录接口一并移除。
**Migration**: 历史数据保留在 `data/` 目录；如需恢复功能请回滚代码版本。

### Requirement: 投资策略 Tab 展示 ETF 卡片
**Reason**: 投资策略 Tab 整体删除。
**Migration**: ETF 行情与估值信息统一在 ETF 总览页查看。

### Requirement: ETF 策略可视化配置
**Reason**: 投资策略 Tab 整体删除，配置表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: ETF 暴跌信号检测
**Reason**: 投资策略 Tab 整体删除，暴跌信号随之下线。
**Migration**: 如需恢复功能请回滚代码版本。
