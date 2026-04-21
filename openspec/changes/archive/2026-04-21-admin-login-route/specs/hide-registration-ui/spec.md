## MODIFIED Requirements

### Requirement: 注册标签页在登录弹层中不可见
登录弹层 SHALL 仅显示登录标签页，注册标签页按钮 SHALL 被隐藏，用户无法通过点击切换到注册表单。此要求仅适用于 `/admin` 路径下的登录视图，根路径下登录弹层不再对外暴露。

#### Scenario: 用户在 /admin 页面看到登录视图
- **WHEN** 用户访问 `/admin` 路径
- **THEN** 登录视图只显示登录表单，注册入口不可见，登录表单为默认激活状态

#### Scenario: 程序化调用 openAuthModal('register')
- **WHEN** 页面中任何代码以 `'register'` 参数调用 `openAuthModal`
- **THEN** 弹层应自动降级，显示登录表单而非注册表单
