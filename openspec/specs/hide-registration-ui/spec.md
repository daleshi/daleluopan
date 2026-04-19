# hide-registration-ui

## Requirement: 注册标签页在登录弹层中不可见
登录弹层 SHALL 仅显示登录标签页，注册标签页按钮 SHALL 被隐藏，用户无法通过点击切换到注册表单。

### Scenario: 用户打开登录弹层
- **WHEN** 用户点击任意触发登录弹层的按钮
- **THEN** 弹层只显示登录标签，注册标签不可见，登录表单为默认激活状态

### Scenario: 程序化调用 openAuthModal('register')
- **WHEN** 页面中任何代码以 `'register'` 参数调用 `openAuthModal`
- **THEN** 弹层应自动降级，显示登录表单而非注册表单
