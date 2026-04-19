## Why

登录弹层中的注册入口目前对所有访客开放，但本系统为私人投资分析工具，不需要用户自行注册账号，应由管理员统一管理用户。隐藏注册功能可防止陌生人创建账号，降低安全风险。

## What Changes

- 隐藏登录弹层中的"注册"标签页按钮（`#authTabRegister`）
- 隐藏注册表单（`#authFormRegister`）
- `switchAuthTab` 只保留 `login` 逻辑，外部调用 `openAuthModal('register')` 时自动降级到登录页

## Capabilities

### New Capabilities
- `hide-registration-ui`: 通过 CSS/HTML 隐藏注册 UI 元素，不删除代码，保留后端 API（管理员仍可通过用户管理页创建账号）

### Modified Capabilities

## Impact

- `public/index.html`：修改登录弹层 HTML 和 JS，隐藏注册相关元素
- `server.js`：不做改动，`/api/auth/register` 路由保留（管理后台使用）
