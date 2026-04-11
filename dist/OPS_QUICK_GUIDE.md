# 指数罗盘 — 运维上线说明

> 给运维同事看的极简版，照着做就行。

---

## 项目信息

| 项 | 值 |
|---|---|
| 项目名称 | 指数罗盘 (index-compass) |
| 运行时 | Node.js 18+ (推荐 20 LTS) |
| 进程管理 | PM2 |
| 服务端口 | **3200** |
| 部署目录 | `/data/fund/` |
| 日志位置 | `/data/fund/logs/` |

---

## 你拿到了什么

开发那边会给你两个文件：

1. `index-compass-YYYYMMDD-HHMMSS.tar.gz` — 安装包
2. `deploy.sh` — 一键部署脚本（可选）

---

## 方式一：一键脚本部署（推荐）

```bash
# 1. 把安装包和脚本传到服务器
scp index-compass-*.tar.gz deploy.sh root@目标IP:/root/

# 2. 登录服务器
ssh root@目标IP

# 3. 执行一键脚本
chmod +x /root/deploy.sh
bash /root/deploy.sh /root/index-compass-*.tar.gz
```

脚本会自动完成：环境检查 → 备份旧配置 → 解压 → 装依赖 → PM2 启动 → 健康检查。

看到 `部署完成！服务已在端口 3200 运行` 就 OK 了。

---

## 方式二：手动部署

```bash
# 登录服务器
ssh root@目标IP

# 确保 Node 和 PM2 存在
node -v        # 需要 18+
pm2 -v         # 没有就：npm install -g pm2

# 备份旧配置（如果是升级）
mkdir -p /data/fund-backups
cp /data/fund/data/*.json /data/fund-backups/ 2>/dev/null || true

# 解压
mkdir -p /data/fund
tar -xzf /root/index-compass-*.tar.gz -C /data/fund

# 恢复配置（如果有备份）
cp /data/fund-backups/user-config.json /data/fund/data/ 2>/dev/null || true
cp /data/fund-backups/datasource-config.json /data/fund/data/ 2>/dev/null || true

# 装依赖 + 启动
cd /data/fund
npm ci --production
pm2 start ecosystem.config.js   # 首次
# 或 pm2 restart index-compass  # 升级
pm2 save
```

---

## 验证

```bash
# 本机健康检查
curl http://127.0.0.1:3200/api/health
# 返回 {"status":"ok", ...} 即正常

# 外网浏览器访问
http://服务器IP:3200
```

---

## 常用运维命令

| 操作 | 命令 |
|---|---|
| 查状态 | `pm2 status` |
| 看日志 | `pm2 logs index-compass` |
| 重启 | `pm2 restart index-compass` |
| 停止 | `pm2 stop index-compass` |
| 开机自启 | `pm2 startup && pm2 save` |

---

## 注意事项

1. **端口放行**：确保安全组和防火墙都开了 3200
2. **出网访问**：这个服务需要从外网拉金融数据（eastmoney、danjuanfunds 等），服务器必须能出公网
3. **配置文件**：`/data/fund/data/` 下的 JSON 是运行态数据，升级时要备份再恢复
4. **日志清理**：PM2 日志在 `/data/fund/logs/`，长期运行建议配合 `pm2 install pm2-logrotate` 做日志切割

---

*有问题找开发，别自己改 `server.js`。*
