# dca-thermometer-recommendation Delta

## REMOVED Requirements

### Requirement: 显示温度计定投实时建议
**Reason**: 投资策略 Tab 整体删除，温度计定投建议随之下线。
**Migration**: 温度计数据本身保留在合并后的"估值温度"页中查看；定投建议功能如需恢复请回滚代码版本。

### Requirement: 修正"低谷"为"低估"
**Reason**: 该文案要求依附于已删除的温度计定投建议展示。
**Migration**: 无需迁移；相关 UI 已随投资策略 Tab 下线。

### Requirement: 删除操作策略部分
**Reason**: 该要求的历史修改对象（温度计定投建议 UI）已随投资策略 Tab 整体下线。
**Migration**: 无需迁移。

### Requirement: 删除综合投资建议部分
**Reason**: 该要求的历史修改对象（温度计定投建议 UI）已随投资策略 Tab 整体下线。
**Migration**: 无需迁移。
