## ADDED Requirements

### Requirement: /admin 路径展示登录界面
系统 SHALL 在用户访问 `/admin` 路径时，隐藏主应用内容，展示独立的登录视图（居中登录卡片），而非正常的 SPA 首页。

#### Scenario: 未登录用户访问 /admin
- **WHEN** 用户在浏览器中访问 `/admin` 路径且当前未登录
- **THEN** 页面 SHALL 隐藏主应用内容（导航栏、数据面板等），展示居中的登录卡片，卡片包含用户名/密码输入框和登录按钮

#### Scenario: 已登录用户访问 /admin
- **WHEN** 用户在浏览器中访问 `/admin` 路径且当前已登录（存在有效 session）
- **THEN** 页面 SHALL 立即跳转至根路径 `/`，不展示登录界面

#### Scenario: /admin 路径登录成功
- **WHEN** 用户在 `/admin` 登录视图中输入正确的账号密码并提交
- **THEN** 系统 SHALL 完成认证，并将页面跳转至根路径 `/`

#### Scenario: /admin 路径登录失败
- **WHEN** 用户在 `/admin` 登录视图中输入错误的账号密码并提交
- **THEN** 系统 SHALL 在登录卡片内显示错误提示，页面保持在 `/admin` 路径，不跳转

### Requirement: 根路径不显示登录入口
系统 SHALL 在根路径 `/` 及其他非 `/admin` 路径下，隐藏所有登录相关的触发入口，包括顶部导航栏的登录按钮。

#### Scenario: 根路径访问
- **WHEN** 用户访问根路径 `/`
- **THEN** 顶部导航栏 SHALL 不显示登录按钮，用户无法通过页面 UI 触发登录弹窗

#### Scenario: 未登录用户触发需认证操作
- **WHEN** 未登录用户触发任何需要认证的操作（如添加关注、修改配置等）
- **THEN** 系统 SHALL 将页面跳转至 `/admin` 路径，而非弹出登录模态框
