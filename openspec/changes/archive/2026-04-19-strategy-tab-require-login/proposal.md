## Why

投资策略 Tab 包含定投建议、仓位操作等个性化数据，属于登录用户专属功能。当前对未登录访客完全可见，需要隐藏该入口，仅登录后方可访问。

## What Changes

- **导航栏**（桌面端）：未登录时隐藏"投资策略" Tab 按钮
- **移动端"更多"菜单**：未登录时隐藏"投资策略"菜单项
- **Tab 切换保护**：若未登录用户通过其他方式触发策略 Tab，自动拦截并弹出登录弹层
- **登出回退**：已登录用户在策略 Tab 时退出登录，自动切回首页

## Capabilities

### New Capabilities
- `strategy-tab-auth-guard`: 投资策略 Tab 登录保护

### Modified Capabilities

## Impact

- `public/index.html`：
  - CSS `body.guest` 规则中新增 `[data-tab="strategy"]` 隐藏选择器
  - `updateAuthUI` 函数中登出时的 Tab 回退逻辑补充 `strategy`
  - 移动端"更多"菜单中投资策略按钮增加登录检查
