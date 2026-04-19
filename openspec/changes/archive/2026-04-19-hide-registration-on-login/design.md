## Context

大乐罗盘是私人投资分析系统，登录弹层目前包含"登录"和"注册"两个标签页。注册功能对所有访客开放，但系统不需要开放注册，账号应由管理员在用户管理页统一管理。

当前实现：`public/index.html` 中 `#authTabRegister` 按钮和 `#authFormRegister` 表单默认可见，通过 `switchAuthTab` 函数切换显示。

## Goals / Non-Goals

**Goals:**
- 隐藏登录弹层中的注册标签和注册表单，使访客只能看到登录表单
- 不删除注册相关代码，便于将来重新启用

**Non-Goals:**
- 修改或禁用后端 `/api/auth/register` API（管理员仍可用）
- 改变用户管理页面的账号创建功能

## Decisions

**方案：CSS `display:none` 隐藏 + JS 防护**

- 在 `#authTabRegister` 上直接加 `style="display:none"` 属性，标签页隐藏
- 在 `#authFormRegister` 已有 `style="display:none"`，无需改动
- 在 `openAuthModal` 函数中，当传入 `tab='register'` 时强制降级为 `'login'`，防止程序化调用误触

选择 HTML `style` 属性而非 JS 操控，是因为页面加载时立即生效，无闪烁。

## Risks / Trade-offs

- [风险] 将来需要开放注册时，需手动去掉 `display:none` → 仅一处修改，风险极低
- [风险] 后端 API 仍可访问，技术上可通过直接请求注册 → 可接受，这不是安全加固需求，只是 UI 隐藏
