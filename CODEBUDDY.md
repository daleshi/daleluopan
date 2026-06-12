# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## 语言规范
- 所有文档和对话使用中文
- 专业术语保持英文（如 React、TypeScript、API 等）

---

## 常用命令

```bash
# 安装依赖
npm install

# 本地开发启动（访问 http://localhost:3200）
npm start
# 或
npm run dev

# PM2 生产管理
npm run pm2:start     # 启动
npm run pm2:restart   # 重启
npm run pm2:stop      # 停止
npm run pm2:logs      # 查看日志（最近 100 行）
npm run pm2:status    # 查看进程状态

# 打包发布
npm run package:deploy  # 生成 dist/dale-compass-YYYYMMDD-HHMMSS.tar.gz
```

> **注意**: 该项目无测试框架、无 Lint 工具，不存在 `npm test` / `npm run lint` 命令。

---

## 项目概述

**大乐罗盘 (Dale Compass)** 是一个面向个人投资者的 A 股价值分析系统，提供指数估值、股票行情、ETF 跟踪、基金管理和投资策略等一站式分析工具。

- **项目名称**: `dale-compass`
- **版本**: 1.0.0
- **运行端口**: 3200（可通过环境变量 `PORT` 修改）
- **许可**: 私有项目，仅供个人使用

---

## 技术栈

| 层面 | 技术 |
|---|---|
| **运行时** | Node.js 18/20 LTS |
| **Web 框架** | Express 4.18 |
| **HTTP 客户端** | node-fetch 2.7 |
| **编码转换** | iconv-lite 0.6（处理 GBK 编码的金融数据源） |
| **压缩** | compression 1.8（Gzip 中间件） |
| **进程管理** | PM2 6.0 |
| **前端** | 纯原生 HTML/CSS/JS 单文件 SPA（零构建依赖，无框架） |
| **字体** | Google Fonts — Noto Serif SC, Noto Sans SC, DM Mono |
| **数据持久化** | JSON 文件（无数据库） |

---

## 项目结构

```
daleluopan/
├── server.js                    # 主入口（~1979行）Express 服务 + 全部 API 路由 + 认证系统 + 缓存层
├── package.json                 # 项目配置（5 个依赖）
├── ecosystem.config.js          # PM2 进程管理配置
├── CODEBUDDY.md                 # 本文件 — 项目规范说明
├── README.md                    # 项目说明文档
├── services/                    # 后端数据采集服务层
│   ├── dataFetcher.js          #   指数数据采集核心（~2306行，最大文件）— 13个数据源
│   ├── stockFetcher.js         #   股票实时行情采集（~790行）
│   ├── fundFetcher.js          #   基金数据采集（~712行）
│   └── etfFetcher.js           #   ETF 数据采集（~600行）
├── public/                      # 前端静态资源
│   ├── index.html              #   单文件 SPA（~9509行，包含全部 HTML+CSS+JS）
│   ├── about/                  #   关于页面图片资源
│   ├── favicon.svg             #   SVG 图标
│   ├── favicon-32.png          #   32x32 图标
│   ├── favicon-180.png         #   Apple Touch Icon
│   ├── favicon-192.png         #   Android 图标
│   ├── qrcode-tip.jpg          #   二维码提示图
│   └── qrcode-wechat.jpg       #   微信二维码
├── data/                        # 运行态数据（JSON 持久化）
│   ├── index-watchlist.json    #   指数关注列表
│   ├── stock-watchlist.json    #   股票关注列表
│   ├── etf-watchlist.json      #   ETF 关注列表
│   ├── fund-watchlist.json     #   基金关注列表
│   ├── datasource-config.json  #   数据源启用/禁用配置
│   ├── dca-plan.json           #   温度计定投策略
│   ├── position-benchmark.json #   加仓基准
│   ├── position-records.json   #   加仓记录
│   ├── site-config.json        #   站点配置（登录开关等）
│   ├── site-stats.json         #   站点访问统计
│   ├── users.json              #   用户账户数据
│   └── cache/                  #   磁盘缓存目录
│       ├── indices.json        #   指数数据缓存
│       ├── index-quotes.json   #   指数行情缓存
│       ├── daily-eval.json     #   每日估值缓存
│       ├── stocks.json         #   股票数据缓存
│       ├── etfs.json           #   ETF 数据缓存
│       └── active-funds.json   #   基金数据缓存
├── scripts/
│   └── package-deploy.sh       #   打包发布脚本
├── dist/                        # 部署相关文档和脚本
│   ├── deploy.sh               #   一键部署脚本
│   ├── DEPLOYMENT_MANUAL.md    #   详细部署手册
│   └── OPS_QUICK_GUIDE.md     #   运维快速指南
├── screenshots/                 # 项目截图
└── logs/                        # PM2 日志（out.log + error.log）
```

---

## 架构设计

### 整体架构

单体全栈应用，前后端均在同一 Express 进程中运行：

```
浏览器 (单文件 SPA)
  ↓ HTTP
Express Server (server.js)
  ├── 静态文件服务 (public/)
  ├── API 路由层 (~30+ 个 API 端点)
  ├── 三级认证中间件 (optionalAuth → requireAuth → requireAdmin)
  ├── 智能缓存层 (内存 + 磁盘 + 并发去重)
  └── 数据采集服务层 (services/)
        ├── dataFetcher.js → 蛋卷/东财/知有行/天天基金/中证/腾讯/新浪/Yahoo 等 13 个数据源
        ├── stockFetcher.js → 东方财富/腾讯 行情源
        ├── fundFetcher.js → 东方财富/天天基金/蛋卷基金
        └── etfFetcher.js → 东方财富/腾讯 行情源
```

### 数据流

1. **两阶段启动**:
   - Phase 1: 毫秒级加载磁盘缓存（`data/cache/*.json`），实现秒开
   - Phase 2: 后台 `Promise.allSettled` 并行刷新 6 类数据（指数/行情/估值/基金/股票/ETF）

2. **三层缓存降级**:
   - L1 内存缓存（交易时段 5s~5min / 休市 30min~4h 自适应 TTL）
   - L2 磁盘缓存（`data/cache/` 目录下的 JSON 文件）
   - L3 Stale 缓存回退（过期数据仍可用，带 stale 标记）

3. **并发去重**: `_smartFetchPromises` 防止同一缓存键的并发请求重复获取

4. **多源 Failover**: 所有数据采集服务均有主源→备用源→缓存回退的三级容灾链

### 缓存核心函数（server.js）

| 函数 | 行号 | 功能 |
|---|---|---|
| `getCacheTTL()` | ~245 | 返回交易时段感知的 TTL |
| `readDiskCache()` | ~255 | 读取磁盘缓存 JSON |
| `writeDiskCache()` | ~269 | 写入磁盘缓存 JSON |
| `smartCacheGet()` | ~290 | 三层缓存统一入口 + 并发去重 |

### 前端架构

- **单文件 SPA**: `public/index.html`（~9509 行）包含全部 HTML 结构 + CSS 样式 + JavaScript 逻辑
- **零构建依赖**: 无 React/Vue/Webpack，纯原生实现
- **Tab 导航**: 通过 `data-tab` 属性控制页面切换
- **页面模块**: 基金总览 / ETF 总览 / 股票总览 / 每日估值 / 温度计 / PE 分析 / 投资策略 / 数据源管理 / 用户管理
- **状态管理**: 模块级全局变量（如 `indexData`, `stockData`, `etfData`, `activeFundLoaded` 等）
- **主题系统**: CSS 变量 + `data-theme` 属性（深色/浅色一键切换）
- **实时刷新**: 交易时段内自动轮询（3-5 秒随机间隔），基于 `isTradingHours()` 判断

---

## 认证与安全

- **密码哈希**: PBKDF2-SHA512（10000 轮迭代 + 随机 salt）
- **会话管理**: `crypto.randomBytes(32)` 生成 token + HttpOnly Cookie + 7 天过期
- **三级权限中间件**:
  - `optionalAuth`: 可选认证（有 token 则解析用户，无 token 也放行）
  - `requireAuth`: 必须登录
  - `requireAdmin`: 管理员权限
- **默认账户**: admin / admin123（首次启动自动创建）

---

## 数据源概览

| 数据源 | 提供内容 | 状态 |
|---|---|---|
| 蛋卷基金 (Wind) | PE/PB/百分位/股息率/ROE | 🔒 强制启用 |
| 东方财富 push2 | 实时行情、历史 K 线、搜索 | 🔒 强制启用 |
| 有知有行（知有行） | 指数温度计（TTL 交易时段感知：A股开盘 60s / 港美股开盘 5min / 全休市 30min / 4h 兜底强制刷新） | 🔒 强制启用 |
| 天天基金 | 估值/净值（备用源） | ⚙️ 可选 |
| 腾讯行情 | 实时行情（备用源，GBK 编码）；**美股指数主源**（`qt.gtimg.cn`，比东财准确，含 52w 高/低/动量） | ⚙️ 可选 |
| 新浪行情 | 实时行情（第三道防线，GBK 编码） | ⚙️ 可选 |
| Yahoo Finance | 美股 K 线兜底 | ⚙️ 可选 |
| ETF.run | ETF 估值 | ⚙️ 可选 |
| 亿牛网 | 估值数据 | ⚙️ 可选 |
| 中证指数 | 官方估值 | ⚙️ 可选 |

---

## API 路由结构

### 认证
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 获取当前用户信息 |

### 指数
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/indices` | 获取全部指数数据（含估值） |
| GET | `/api/indices/quotes` | 获取指数实时行情 |
| GET | `/api/indices/watchlist` | 获取关注列表 |
| GET | `/api/indices/search?q=` | 搜索指数 |
| POST | `/api/indices/add` | 添加指数 |
| POST | `/api/indices/remove` | 移除指数 |

### 基金
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/active-funds` | 获取基金数据 |
| GET | `/api/active-funds/watchlist` | 获取关注列表 |
| GET | `/api/active-funds/search?q=` | 搜索基金 |
| POST | `/api/active-funds/add` | 添加基金 |
| POST | `/api/active-funds/remove` | 移除基金 |

### 股票
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/stocks` | 获取股票行情 |
| GET | `/api/stocks/watchlist` | 获取关注列表 |
| GET | `/api/stocks/search?q=` | 搜索股票 |
| POST | `/api/stocks/add` | 添加股票 |
| POST | `/api/stocks/remove` | 移除股票 |

### ETF
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/etfs` | 获取 ETF 行情 |
| GET | `/api/etfs/watchlist` | 获取关注列表 |
| GET | `/api/etfs/search?q=` | 搜索 ETF |
| POST | `/api/etfs/add` | 添加 ETF |
| POST | `/api/etfs/remove` | 移除 ETF |
| GET | `/api/etfs/minute?secid=` | ETF 分时数据 |
| GET | `/api/etfs/klines?secid=&range=` | ETF K 线数据 |

### 估值与温度计
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/daily-eval` | 每日估值全量数据 |
| GET | `/api/thermometer/detail?code=` | 单指数温度详情 |
| POST | `/api/thermometer/refresh` | 强制刷新有知有行温度计缓存（管理员）|

### 投资策略
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/strategy/dca-plans` | 温度计定投策略 CRUD |
| GET/POST | `/api/position/benchmarks` | 加仓基准管理 |
| GET/POST | `/api/position/records` | 加仓记录管理 |

### 运维
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查 |
| GET/POST | `/api/datasources` | 数据源配置管理 |
| GET/POST | `/api/site-config` | 站点配置（登录开关） |
| GET | `/api/site-stats` | 站点访问统计 |

---

## 关键文件说明

### `server.js`（~1979 行）
后端核心，包含：
- Express 中间件配置（compression、静态文件、JSON 解析）
- 站点 PV/UV 访问统计（内存缓存 + 30 秒定期磁盘持久化）
- 数据源配置读写（JSON 文件 + 白名单校验）
- 智能缓存层（内存→磁盘→异步刷新，交易时段感知 TTL）
- PBKDF2 密码认证系统
- 全部 API 路由（指数/基金/股票/ETF/估值/策略/管理）
- SPA fallback（非 API 路径均返回 index.html）
- 两阶段启动（快速磁盘缓存 + 后台并行刷新）

### `services/dataFetcher.js`（~2306 行）
最大的文件，指数数据采集核心：
- 22 个指数的完整候选池（A 股 16 + 港股 4 + 美股 2）
- 13 个数据源的采集与解析
- 三级行情 failover: 东方财富(批量) → 腾讯(补漏) → 新浪(单独)
- K 线多层降级: 东方财富 → 降级参数重试 → stale 缓存 → 腾讯 → Yahoo
- 东方财富冷却机制（连续失败后暂停请求一段时间）

### `services/stockFetcher.js`（~790 行）
股票行情采集：
- 东方财富 push2 批量行情（主源）+ 腾讯行情（备用源，GBK 编码）
- 日 K 线获取（60 个交易日，用于迷你走势图）
- 冷却机制 + stale 缓存回退
- 行业板块自动识别

### `services/fundFetcher.js`（~712 行）
基金数据采集：
- 东方财富 pingzhongdata（主源，完整数据）
- 天天基金 fundmobapi（备用源，核心指标）
- 蛋卷基金 djapi（持仓详情补充）
- 风格标签自动生成 + 风险等级估算（R1~R5）

### `services/etfFetcher.js`（~600 行）
ETF 数据采集：
- 东方财富批量行情 + 腾讯备用源
- 分时数据 + 多周期 K 线（1y/3y/5y）
- 冷却机制 + 并发限制

### `public/index.html`（~9509 行）
纯原生单文件 SPA，包含：
- CSS 样式（~4050 行）: 暗色/亮色主题、渐变卡片、毛玻璃效果、响应式设计
- HTML 结构: Tab 导航、数据面板、弹窗、搜索框、表单
- JavaScript 逻辑（~5450 行）: 数据获取、UI 渲染、图表绘制、交易时段轮询、认证流程

---

## 编码约定

### 后端
- CommonJS 模块规范（`require` / `module.exports`）
- 所有 HTTP 请求带 `User-Agent` + `Referer` 模拟浏览器
- 数据采集函数统一命名: `fetch{Source}{DataType}()`
- failover 函数命名: `fetch{DataType}WithFailover()`
- 中文日志前缀: `[模块名]` 格式（如 `[股票]`, `[主动基金]`）
- JSON 文件持久化统一使用 `fs.readFileSync` / `fs.writeFileSync`
- 缓存键格式: `{code}.{market}` 或 `{type}-{identifier}`

### 前端
- 模块用 `// ===== 模块名 =====` 分隔注释
- 状态用模块级全局变量管理
- DOM 操作使用 `document.querySelector` / `innerHTML`
- API 请求使用 `fetch()`
- CSS 变量统一在 `:root` 和 `[data-theme="light"]` 中定义

### 数据格式
- Watchlist JSON 结构: `{ stocks: [...] }` / `{ etfs: [...] }` / `{ funds: [...] }`
- 每个 watchlist 项包含: `code`, `name`, `icon`, `iconBg`, `iconColor`, `market`, `secid`
- 缓存 JSON: 直接序列化完整响应对象

---

## 运行与部署

### 本地开发
```bash
npm install
npm start       # 启动服务，访问 http://localhost:3200
```

### PM2 生产部署
```bash
npm run pm2:start      # 启动
npm run pm2:restart    # 重启
npm run pm2:stop       # 停止
npm run pm2:logs       # 查看日志
```

### 打包发布
```bash
npm run package:deploy  # 生成 dist/dale-compass-YYYYMMDD-HHMMSS.tar.gz
```

### 服务器一键部署
```bash
bash deploy.sh <安装包路径>
```

---

## 注意事项

1. **网络要求**: 服务器需访问外网金融数据源（eastmoney、danjuanfunds、youzhiyouxing 等）
2. **端口放行**: 确保防火墙和安全组已放行 3200 端口
3. **数据备份**: `data/` 目录下的 JSON 文件是运行态数据，升级时务必备份
4. **各类上限**: 关注列表最多 20 项，用户数上限 100，加仓记录上限 500 条
5. **单文件前端**: `index.html` 约 9500 行，修改时建议按模块注释定位目标区域
6. **无数据库**: 所有持久化通过 JSON 文件，并发写入场景需注意文件锁
7. **美股指数 secid 陷阱**: 东方财富内部 `100.NDX` 实际指向"纳斯达克综合指数 (IXIC)" 而非纳斯达克 100；正确的纳斯达克 100 是 `100.NDX100`。腾讯 K 线接口 `us.NDX`（带点）2026-06 起也错位指向德尼克斯投资 (DX.N)，必须使用 `usNDX`（不带点）。新增美股指数前请用东方财富搜索 API（`searchapi.eastmoney.com/api/suggest/get?input=<name>`）验证 secid 与 f14 中文名一致，并对腾讯 K 线代码二次抓取确认。后端 `fetchRealtimeQuotesEastmoney()` 已加 name 自检，错位响应会被自动丢弃并告警 `[美股映射]`。
