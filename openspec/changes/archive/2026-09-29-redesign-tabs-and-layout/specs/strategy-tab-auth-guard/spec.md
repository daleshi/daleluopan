# strategy-tab-auth-guard Delta

## REMOVED Requirements

### Requirement: 未登录用户无法看到投资策略 Tab
**Reason**: 投资策略 Tab 已整体删除，无需权限守卫。
**Migration**: 无需迁移；该功能不存在后隐藏入口的要求自动失效。

### Requirement: 登出时自动离开投资策略 Tab
**Reason**: 投资策略 Tab 已整体删除，无需登出跳转逻辑。
**Migration**: 登出后仍回到基金总览 Tab，此行为保持不变。
