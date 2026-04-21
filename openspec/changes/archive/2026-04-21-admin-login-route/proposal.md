## Why

当前网站根路径 `/` 直接展示登录入口，对于普通访客来说界面显得突兀，且暴露了后台管理的存在感。将登录功能移至专属路径 `/admin`，使根路径呈现更干净的内容页面，同时让管理员通过固定路径访问登录。

## What Changes

- 根路径 `/` 不再显示登录按钮、登录弹窗及任何认证相关 UI 元素
- 新增 `/admin` 路由，访问时直接展示登录页面（独立页面或覆盖层）
- 已登录用户访问 `/admin` 时自动跳转回根路径 `/`
- 未登录用户访问需要认证的页面时，跳转至 `/admin` 而非弹出登录框
- 后端 SPA fallback 保持不变（非 API 路径均返回 `index.html`），路由逻辑在前端处理

## Capabilities

### New Capabilities

- `admin-login-route`: 独立的 `/admin` 登录路由——访问 `/admin` 时展示登录界面，登录成功后跳转回 `/`；已登录则直接跳回 `/`

### Modified Capabilities

- `hide-registration-ui`: 根路径下的登录按钮和登录弹窗需同步隐藏，与该 capability 的隐藏注册 UI 逻辑保持一致

## Impact

- `public/index.html`：移除顶部导航登录按钮，隐藏登录弹窗触发逻辑；新增前端路由判断（`window.location.pathname`），`/admin` 路径下渲染登录视图
- `server.js`：无需修改，SPA fallback 已覆盖 `/admin` 路径
