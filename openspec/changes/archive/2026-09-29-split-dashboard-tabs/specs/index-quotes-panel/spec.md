## MODIFIED Requirements

### Requirement: 指数行情面板按市场分类切换

系统 SHALL 在「指数行情」页面的指数实时行情区域提供「全部 / A股 / 港股 / 美股」四个 Tab 按钮，点击后仅显示对应市场的指数卡片。

#### Scenario: 默认加载全部

- **GIVEN** 用户进入指数行情页
- **WHEN** 页面首次渲染
- **THEN** 「全部」Tab 高亮，所有指数卡片可见

#### Scenario: 切换至 A 股 Tab

- **GIVEN** watchlist 包含沪深 300（SH）、中证 500（SH）、恒生指数（HK）、标普 500（US）
- **WHEN** 用户点击「🇨🇳 A股」Tab
- **THEN** 仅显示沪深 300、中证 500 卡片，恒生与标普不可见

#### Scenario: 切换 Tab 后 URL 不刷

- **WHEN** 用户点击任意市场 Tab
- **THEN** 页面不重新加载，仅 `display` 属性变化

#### Scenario: 市场归类规则

- **GIVEN** 指数 code 后缀为 `.SH`、`.SZ`、`.BJ` → 归入 A 股
- **GIVEN** 指数 code 后缀为 `.HK` → 归入港股
- **GIVEN** 指数 code 后缀为 `.US` → 归入美股
- **GIVEN** 无后缀或未知后缀 → 归入 A 股（兜底）
