## Context

当前"投资策略"Tab (`tab-strategy`) 包含三个部分：
1. **操作策略**（第 3664-3680 行）— 静态操作建议表格，内容与用户实际配置关联弱
2. **综合投资建议**（第 3682-3690 行）— 自动生成的投资建议卡片，实用性有限
3. **温度计定投策略**（第 3692 行起）— 用户配置的指数定投策略，但未根据当前温度给出实时建议

用户反馈：操作策略和综合投资建议信息过载、价值不高；温度计定投策略需要手动对照温度表，体验不佳。此外界面存在错别字"低谷"，应改为"低估"。

## Goals / Non-Goals

**Goals:**
- 删除"操作策略"和"综合投资建议"两个低价值部分，简化页面
- 在温度计定投策略卡片上，根据当前温度自动显示定投建议（如"减半定投，每月定投 500 元"）
- 修正错别字："低谷" → "低估"

**Non-Goals:**
- 不修改后端 API（现有 `/api/thermometer/detail` 和 `/api/strategy/dca-plans` 已足够）
- 不修改数据结构（`dca-plans.json` 无需变更）
- 不增加新的配置项

## Decisions

### Decision 1: 纯前端修改，无需后端变更

**选择**: 仅修改 `public/index.html`，不修改 `server.js` 或 services。

**理由**:
- 现有 API 已提供所需数据：`/api/thermometer/detail?code=` 返回指数温度，`/api/strategy/dca-plans` 返回策略配置
- 前端可在 `renderDcaPlans()` 中并行获取温度数据并计算建议
- 避免后端变更带来的部署成本

**备选方案**: 在后端 API 中预计算建议 — 否决，因为增加后端复杂度且建议展示是纯前端关注点。

### Decision 2: 在 `renderDcaPlans()` 中并行获取温度数据

**选择**: 在渲染策略卡片时，对每个策略并行调用 `/api/thermometer/detail?code=` 获取当前温度。

**理由**:
- 策略数量有限（watchlist 上限 20，实际配置更少），并行请求无性能问题
- 温度数据有缓存层（L1 内存 5s~5min TTL），实际 API 响应快
- 并行请求使用 `Promise.allSettled()` 避免单个失败阻塞整体渲染

**实现要点**:
```javascript
async function renderDcaPlans() {
    // 1. 并行获取所有策略对应指数的温度
    const tempResults = await Promise.allSettled(
        dcaPlans.map(plan =>
            fetch(`/api/thermometer/detail?code=${plan.indexCode}`).then(r => r.json())
        )
    );
    // 2. 匹配温度与配置的温度区间，计算建议
    // 3. 渲染卡片，包含建议信息
}
```

### Decision 3: 温度区间匹配逻辑

**选择**: 解析 `tempRange` 字段（如 "30°以下"、"50°-70°"、"70°以上"），提取数值范围，与当前温度匹配。

**理由**:
- `tempRange` 是用户配置的文本字段，格式相对固定
- 前端解析可覆盖所有已有配置，无需修改数据结构
- 解析失败时降级显示"温度数据获取中..."

**解析规则**:
- `X°以下` → 温度 < X
- `X°-Y°` → X ≤ 温度 ≤ Y
- `X°以上` → 温度 ≥ X

### Decision 4: 错别字修正范围

**选择**: 修改所有"低谷"为"低估"，涉及：
- `DEFAULT_DCA_LEVELS` 常量（第 6022 行）
- `renderDcaLevelsEditor()` 编辑表单（第 6143 行）
- `addDcaLevel()` 新增表单模板（第 6198 行）

**理由**: "低估"是金融领域标准术语，符合用户认知。

## Risks / Trade-offs

**[风险] 温度 API 请求失败 → 缓解**: 使用 `Promise.allSettled()`，单个失败不影响其他策略卡片渲染；失败时显示"温度获取失败"，保留原有配置表格。

**[风险] 温度数据过期 → 缓解**: 温度数据来自有知有行，已有缓存层处理；显示温度值时附带"更新时间"。

**[Trade-off] 页面加载时间略微增加 → 接受**: 增加 1-2 个 API 调用（并行），在用户可接受范围内；可考虑后续增加加载状态提示。

**[Trade-off] 删除两个部分可能让页面显得空 → 接受**: 简化是目标，核心功能（温度计定投策略）保留并增强。
