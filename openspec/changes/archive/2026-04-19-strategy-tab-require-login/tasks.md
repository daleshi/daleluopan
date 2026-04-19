## 1. CSS：未登录隐藏投资策略 Tab 入口

- [x] 1.1 在 `public/index.html` CSS `body.guest` 规则（行 247-248 附近）中，将 `body.guest [data-tab="strategy"]` 追加到已有的隐藏选择器列表

## 2. JS：登出时回退到首页

- [x] 2.1 在 `updateAuthUI` 函数登出分支（行 3316 附近）中，将 `tab === 'config' || tab === 'admin-users'` 补充为 `tab === 'config' || tab === 'admin-users' || tab === 'strategy'`

## 3. 验证

- [x] 3.1 未登录时确认导航栏无"投资策略"按钮，移动端更多菜单投资策略入口隐藏
- [x] 3.2 登录后确认"投资策略"Tab 按钮出现并可正常访问
