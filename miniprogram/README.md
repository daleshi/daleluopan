# 大乐罗盘 · 微信小程序（原生版）

面向**个人主体**的原生小程序骨架。不使用 web-view（个人主体无「业务域名」权限），直接通过 `wx.request` 调用已备案域名 `https://daleluopan.com` 上的现有 API。

## 为什么是原生版

| 约束 | 结论 |
|---|---|
| 个人主体无「业务域名」入口 | web-view 套壳方案不可用 |
| 个人主体可配置「服务器域名」 | `wx.request` 打 `daleluopan.com` 完全可行 |
| 域名已备案 + HTTPS | 服务器域名直接填，无需等待 |

## 已实现的功能

| 页面 | 内容 |
|---|---|
| 估值（首页） | 市场温度概览 + 9 个指数的价格涨跌、PE/PB/ROE/股息率、PE 百分位水位条、30 日迷你走势图（canvas 2d） |
| 温度 | 全市场温度环形图（canvas 2d）、低估/适中/高估三档概率、全部指数温度排序列表、数据源备注 |
| 我的 | 登录态、服务地址、数据来源、退出登录 |
| 登录 | 账号密码登录，token 存本地 |

点击首页任一指数卡片 → 跳转温度页并展示该指数的详细温度、内在收益率、股息率、行业分布。

配色遵循 A 股习惯：**涨=红，跌=绿**。

## 上手步骤

1. 微信开发者工具 → 导入项目 → 选择 `miniprogram/` 目录
2. `project.config.json` 里把 `appid` 换成你的 AppID（个人主体小程序）
3. 小程序后台 → 开发管理 → 开发设置 → **服务器域名** → request 合法域名填 `https://daleluopan.com`
4. 调试阶段可在「详情 → 本地设置」勾选「不校验合法域名」先跑通；真机预览前取消勾选验证正式环境
5. 提交**小程序 ICP 备案**（与域名备案是两回事，1-20 工作日，建议立刻启动）

## 后端配套改动

登录要保持登录态，需要线上后端把 token 返回给客户端。改动在 `server.js` 的 `/api/auth/login`（约 652 行）：

```js
res.json({
    success: true,
    data: {
        username: user.username,
        role: user.role,
        nickname: user.nickname,
        token,                              // ← 新增
        expiresAt: Date.now() + SESSION_TTL,
    },
});
```

后端鉴权已支持 `Authorization: Bearer <token>`（`server.js:532`），无需改动。**未部署此改动前**，估值与温度功能不受影响，只有登录会提示无 token。

## 目录结构

```
miniprogram/
├── app.js / app.json / app.wxss
├── project.config.json          ← 填 AppID
├── sitemap.json
├── utils/
│   ├── api.js                   ← 接口封装 + token 管理
│   └── format.js                ← 数字/涨跌色/估值标签格式化
├── components/
│   ├── sparkline/               ← 迷你走势图（canvas 2d）
│   └── temp-ring/               ← 温度环形图（canvas 2d）
└── pages/
    ├── index/                   ← 估值总览（tab）
    ├── thermometer/             ← 温度计（tab）
    ├── mine/                    ← 我的（tab）
    └── login/                   ← 登录
```

## 发布前的合规提示

个人主体小程序可选类目有限，**不要选金融类目**（A 股行情属「金融业-股票信息服务平台」，需《增值电信业务经营许可证》+ 沪深交易所信息经营许可，个人拿不到）。

建议定位为「个人投研记录工具」，类目选「工具 → 信息查询」，只保存自己的持仓与定投记录，不对外提供行情资讯服务与投资建议。即便如此，审核仍可能按实际内容判定，属于灰度操作，请有心理预期。

## 后续可扩展

- 自选股 / ETF / 基金列表（复用 `/api/stocks`、`/api/etfs`、`/api/active-funds`）
- 定投计划与加仓记录（`/api/strategy/*`，需登录）
- 每日估值全量表（`/api/daily-eval`，63 条，建议分页）
- K 线详情（`/api/indices/:code/klines`，需接入 `ec-canvas`）
