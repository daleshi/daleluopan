## Context

项目现有一套完整的 guest 模式隐藏机制：
- 未登录时 `body` 加 `guest` 类
- CSS `body.guest [data-tab="config"]` 和 `body.guest [data-tab="admin-users"]` 已通过 `display:none !important` 隐藏对应 Tab 按钮（行 247-248）
- `updateAuthUI` 中登出时若当前在 `config`/`admin-users` Tab 会自动切回 `dashboard`（行 3316）
- 移动端通过 `switchMobileTab` 触发顶部 nav-tab click，隐藏 nav-tab 后移动端点击自然无效

投资策略 Tab 的保护方案与 config/admin-users 完全一致，复用已有模式。

## Goals / Non-Goals

**Goals:**
- 未登录时隐藏投资策略 Tab 按钮（桌面端导航栏 + 移动端更多菜单）
- 登出时若当前在策略 Tab，自动切回 dashboard
- 保持与现有 config/admin-users 保护逻辑完全一致

**Non-Goals:**
- 对策略 Tab 内容做服务端权限验证（API 已有 requireAuth 中间件）
- 修改后端逻辑

## Decisions

**方案：复用现有 guest CSS + updateAuthUI 回退逻辑**

1. 在 CSS `body.guest` 规则（行 247-248）中追加 `body.guest [data-tab="strategy"]`，一行改动即可隐藏导航按钮
2. 在 `updateAuthUI` 的登出分支（行 3316）中，将 `tab === 'config' || tab === 'admin-users'` 补充 `|| tab === 'strategy'`
3. 移动端策略按钮通过 `switchMobileTab` 触发 nav-tab click，nav-tab 隐藏后按钮点击自动无效，无需额外改动

选择此方案的原因：零新增代码模式，与系统已有约定完全一致，改动极小（2处）。

## Risks / Trade-offs

- [风险] 用户直接通过 URL hash 或 JS 调用访问策略 Tab → 可接受，前端隐藏为体验层，API 层已有权限控制
