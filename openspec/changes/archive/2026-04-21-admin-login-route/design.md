## Context

当前 `public/index.html` 是单文件 SPA，页面路由完全由前端 JS 控制。顶部导航栏有登录按钮，点击后弹出认证模态框（`#authModal`）。`server.js` 中所有非 API 路径均通过 SPA fallback 返回 `index.html`，因此 `/admin` 路径天然可用，无需修改后端。

## Goals / Non-Goals

**Goals:**
- 根路径 `/` 完全隐藏登录入口（按钮、弹窗触发）
- 访问 `/admin` 时直接展示登录界面
- 已登录用户访问 `/admin` 自动跳转回 `/`
- 未登录用户触发需要认证的操作时，跳转至 `/admin`

**Non-Goals:**
- 不修改 `server.js`（SPA fallback 已满足需求）
- 不新增独立的 admin HTML 页面
- 不改变登录后的跳转逻辑（仍在同一 SPA 内）
- 不影响 API 的认证鉴权逻辑

## Decisions

**决策 1：前端路由判断，而非新页面**

通过 `window.location.pathname` 在 `DOMContentLoaded` 时判断当前路径：
- 路径为 `/admin` → 隐藏主应用内容，直接展示登录表单（或触发登录模态框全屏展示）
- 其他路径 → 正常渲染，且隐藏所有登录相关 UI

替代方案：新建独立 `admin.html`。  
放弃原因：需要维护两份 HTML，且共享的 JS/CSS 复用困难；SPA 方案改动最小。

**决策 2：`/admin` 下展示专用登录视图，而非复用模态框**

在 `/admin` 路径下渲染一个居中的登录卡片（复用现有登录表单的 HTML 结构和样式），而非弹出 `#authModal`。  
原因：模态框需要背景遮罩和触发按钮，`/admin` 场景下没有"底层页面"，直接渲染更自然。

**决策 3：登录成功后跳转 `/`**

在 `/admin` 页的登录成功回调中执行 `window.location.href = '/'`，确保跳回主页。

## Risks / Trade-offs

- [风险] 用户直接刷新 `/admin` 页时，server 返回完整 `index.html`，前端路由需在 JS 加载后才判断，可能有短暂白屏 → 缓解：在 `<body>` 初始状态隐藏主内容，路由判断完成后再显示
- [风险] 书签了根路径登录按钮的用户找不到入口 → 可接受，属于预期行为变更
- [Trade-off] 登录 UI 复用现有 HTML 结构，样式调整范围有限
