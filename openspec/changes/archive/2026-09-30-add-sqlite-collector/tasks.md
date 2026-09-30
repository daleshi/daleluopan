> 前置：无。服务器保持 CentOS 7.6 + Node 16，sql.js 已在生产机 `/tmp` 实测可用（2026-09-30）。

## 1. 数据库基础

- [x] 1.1 引入 `sql.js@1`；新增 `services/db/`：加载库文件、建表、`schema_version` 版本化迁移
- [x] 1.2 原子落盘工具：写 `*.tmp` → `fsync` → `rename`，`latest.json` 与 `market.db` 共用
- [x] 1.3 建表：instruments、kline_daily、fund_nav_daily、valuation_daily、valuation_bands、collector_runs
- [x] 1.4 只读副本模块（网站用）：按 mtime 检查（结果缓存 1 秒）、变化时重新加载、失败保留旧副本并告警
- [x] 1.5 数据访问层：历史按标的与日期区间查询；`latest.json` 读写
- [x] 1.6 watchlist → instruments 镜像同步：新增插入、消失标记 deleted、重新出现匹配回原记录
- [x] 1.7 一次性导入：4 个 watchlist 文件 → instruments；`indices.json` 的 K 线、`active-funds.json` 的净值 → 历史表
- [x] 1.8 每日备份（复制 `market.db`，保留 14 份）；启动时库损坏自动改用最新备份
- [x] 1.9 用真实数据实测：库文件大小、导出耗时、网站加载耗时、两进程内存；加载超过 500ms 时改为 worker 线程加载

## 2. 交易时段统一

- [x] 2.1 合并 `stockFetcher.js`、`etfFetcher.js` 与前端 `isMarketOpen` 为一个后端共享模块（A 股 / 港股 / 美股，含午休与美股夏令时）
- [x] 2.2 提供市场状态接口，前端改为读取接口结果

## 3. 采集进程

- [x] 3.1 新增 `collector.js` 入口；`ecosystem.config.js` 增加 `dale-collector` 应用
- [x] 3.2 盘中调度：指数 / 股票 / ETF 独立计时，间隔 5～10 秒随机；失败退避（10→20→40→80→120 秒）；数据不变降频（上限 60 秒）；午休与休市停止
- [x] 3.3 复用现有 fetcher 获取数据，每轮写入 `latest.json`（含各类采集状态）
- [x] 3.4 watchlist 变化检测：交易时段每轮检查，休市时每 30 秒检查；新标的立即抓一次行情并排队回补日 K
- [x] 3.5 收盘快照：收盘 +5 分钟抓取日 K、估值、温度；失败每 5 分钟重试，最长 2 小时；最终兜底并标记 `is_fallback`；完成后导出 `market.db`
- [x] 3.6 交易日判断：以最新日 K 日期是否变化判定休市；美股按美东日期归属
- [x] 3.7 基金晚间采集：取得当日净值即停止，设当晚截止时间
- [x] 3.8 启动时检查日 K 与净值缺口并补齐
- [x] 3.9 K 线组装保留开盘价、成交量、成交额；降级源缺失时允许为空并记录 `source`
- [x] 3.10 每日任务（快照、净值、回补、补齐、备份）写 collector_runs

## 4. 历史回补

- [x] 4.1 蛋卷 PE / PB 历史与分位参考线（9 个指数）
- [x] 4.2 中证官网港股创新药 PE（2021-10 起）
- [x] 4.3 东财数据中心 5 只 A 股 PE-TTM / PB-MRQ（2018 起）
- [x] 4.4 国证官网创业板50、自由现金流完整日 K
- [x] 4.5 为每个标的设定 `valuation_source`；ETF 设置 `tracking_instrument_id`，跟踪指数不在关注清单时以隐藏标的存在
- [x] 4.6 回补串行执行、请求间随机间隔；每完成一个标的导出一次库，可中断重跑

## 5. 网站读库

- [x] 5.1 行情接口（指数 / 股票 / ETF / 基金）改为读 `latest.json` 与 `market.db`，返回数据时间；关注清单接口保持不变
- [x] 5.2 新增估值历史、温度历史查询接口
- [x] 5.3 `site-config.json` 增加 `dataSourceMode`（legacy / db），管理端可切换

## 6. 页面

- [x] 6.1 区间走势增加 价格 / PE / PB / 温度 切换，复用周期按钮
- [x] 6.2 PE、PB 曲线：按日期横轴，30 / 50 / 70 分位参考线，当前值标注
- [x] 6.3 温度曲线起点标注"自 2026-09-30 起记录"
- [x] 6.4 股票详情接入 PE / PB 曲线；ETF 显示跟踪指数估值
- [x] 6.5 无数据源标的显示"暂无估值数据"
- [x] 6.6 页面显示数据时间（外部源故障时提示"X 分钟前"）；轮询间隔与后台节奏对齐

## 7. 部署与验证

- [x] 7.1 `scripts/package-deploy.sh` 打包 `node_modules/sql.js`；更新 `deploy-to-server` 技能中新增依赖与 `dale-collector` 的说明
- [x] 7.2 部署：建库、导入、回补；`pm2 start ecosystem.config.js --only dale-collector` 并 `pm2 save`（2026-09-30 18:46 上线）
- [x] 7.3 ~~双跑 1～3 个交易日：对比库中数据与原接口输出~~（按用户决定跳过双跑，直接切换 db 模式；上线前在生产机 /tmp 副本用 Node 16 冒烟验证）
- [x] 7.4 切换 `dataSourceMode=db`，验证各接口响应时间与页面（生产各接口 3～180ms）
- [x] 7.5 故障演练：停止采集进程，网站仍返回数据；采集导出中途 kill，确认正式文件完整；模拟外部源失败，确认退避生效
- [x] 7.6 验证收盘快照、节假日跳过、美股交易日归属、基金晚间采集、删除后重新添加历史接续
- [x] 7.7 更新 `CODEBUDDY.md`、`README.md`（架构、进程、数据目录）
