## ADDED Requirements

### Requirement: 温度计数据源名称显示正确
温度计 Tab 中数据源的显示名称 SHALL 为"有知有行温度计"，不得显示为"知行温度计"。

#### Scenario: 温度计 Tab 页面标题
- **WHEN** 用户切换到温度计 Tab
- **THEN** 页面中数据源名称显示为"有知有行温度计"

#### Scenario: 温度计卡片描述文案
- **WHEN** 用户查看温度计 Tab 中的说明卡片
- **THEN** 描述文字中品牌名称显示为"有知有行温度计"
