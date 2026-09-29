# active-fund-dca-strategy Delta

## REMOVED Requirements

### Requirement: 主动基金定投策略数据持久化
**Reason**: 投资策略 Tab 整体删除，主动基金定投策略功能随之下线。
**Migration**: 历史数据保留在 `data/` 目录 JSON 文件中；如需恢复功能请回滚代码版本。

### Requirement: 读取主动基金定投策略配置（公开）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 创建或更新主动基金策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 删除主动基金策略（管理员）
**Reason**: 投资策略 Tab 整体删除，对应 API 路由一并移除。
**Migration**: 无替代接口；如需恢复功能请回滚代码版本。

### Requirement: 实时计算主动基金当前定投档位
**Reason**: 投资策略 Tab 整体删除，档位计算随之下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 投资策略 Tab 展示主动基金定投卡片
**Reason**: 投资策略 Tab 整体删除。
**Migration**: 基金信息统一在基金总览页查看。

### Requirement: 管理员可视化配置主动基金策略
**Reason**: 投资策略 Tab 整体删除，配置表单随之下线。
**Migration**: 无替代界面；如需恢复功能请回滚代码版本。

### Requirement: 主动基金近一年涨幅衍生指标
**Reason**: 该指标仅为主动基金定投策略服务，随策略一并下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 主动基金距近一年新高衍生指标
**Reason**: 该指标仅为主动基金定投策略服务，随策略一并下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 主动基金经理更换自动检测
**Reason**: 该检测仅为主动基金定投策略服务，随策略一并下线。
**Migration**: 如需恢复功能请回滚代码版本。

### Requirement: 加强定投（boost）档位支持
**Reason**: 投资策略 Tab 整体删除，boost 档位随之下线。
**Migration**: 如需恢复功能请回滚代码版本。
