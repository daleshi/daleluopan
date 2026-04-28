## 1. 修正错别字"低谷" → "低估"

- [x] 1.1 修改 `DEFAULT_DCA_LEVELS` 常量：将第一个对象的 `label: '低谷'` 改为 `label: '低估'`（第 6022 行）
- [x] 1.2 修改 `renderDcaLevelsEditor()` 函数：将选项 `<option value="低谷">` 改为 `<option value="低估">`（第 6143 行）
- [x] 1.3 修改 `addDcaLevel()` 函数：将默认第一个选项改为 `<option value="低估" selected>低估</option>`（第 6198 行）

## 2. 删除"操作策略"部分

- [x] 2.1 删除 HTML 中"操作策略"section（第 3664-3680 行，包含 section-header 和 strategy-table-wrap）

## 3. 删除"综合投资建议"部分

- [x] 3.1 删除 HTML 中"综合投资建议"section（第 3682-3690 行，包含 section-header 和 advice-grid）
- [x] 3.2 搜索并删除/注释 `adviceGrid` 相关的 JavaScript 渲染函数（如 `renderAdviceGrid()` 等）

## 4. 修改 `renderDcaPlans()` 函数 — 增加温度获取和建议显示

- [x] 4.1 修改 `loadDcaPlans()` 函数：在获取计划后，并行调用 `/api/thermometer/detail?code=` 获取每个策略对应指数的当前温度
- [x] 4.2 编写 `parseTempRange(tempRange)` 辅助函数：解析温度区间文本（如 "30°以下"、"50°-70°"、"70°以上"），返回 `{ min, max }` 对象（`max=null` 表示以上，`min=null` 表示以下）
- [x] 4.3 编写 `matchTemperature(currentTemp, levels)` 辅助函数：根据当前温度匹配对应的 level 配置，返回匹配的 level 或 null
- [x] 4.4 修改 `renderDcaPlans()` 函数：为每个策略卡片添加温度建议区域，显示当前温度、匹配区间和建议文本
- [x] 4.5 处理温度获取失败的情况：显示"温度获取失败"，仍展示原有配置表格
- [x] 4.6 处理温度不在任何配置区间内的情况：显示"未匹配到策略区间，请检查配置"

## 5. 验证与测试

- [x] 5.1 本地启动服务，访问"投资策略"Tab，验证"操作策略"和"综合投资建议"已删除（需手动验证）
- [x] 5.2 验证"温度计定投策略"卡片正确显示当前温度和定投建议（需手动验证）
- [x] 5.3 验证"低估"标签已正确显示（默认配置、编辑表单、新增表单）（需手动验证）
- [x] 5.4 测试温度 API 失败时的降级显示（需手动验证）
