# 指数罗盘 Linux 部署手册

## 1. 这次交付了什么

本次已经为你准备好一个可直接上传到 Linux 服务器的发布包：

- 安装包：`/Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz`
- 校验文件：`/Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz.sha256`

这个项目不是前端 `dist` 静态站点，而是一个 Node.js/Express 服务。也就是说，服务器上的安装方式不是“解压就能跑”，而是：

1. 上传安装包到服务器
2. 解压到 `/data/fund/`
3. 安装 Node.js 依赖
4. 用 PM2 启动服务
5. 检查 3200 端口和接口是否正常

---

## 2. 发布包里包含什么

安装包已经包含这些运行时文件：

- `package.json`
- `package-lock.json`
- `server.js`
- `ecosystem.config.js`
- `public/`
- `services/`
- `data/`
- `logs/`

其中需要特别注意的运行态文件是：

- `data/user-config.json`
- `data/datasource-config.json`

如果你的服务器上已经跑过旧版本，**部署前一定先备份这两个文件**。否则你服务器上的自定义配置会被新包里的默认文件覆盖。

---

## 3. 部署目标

本手册按下面这个目标写：

- 服务器 IP：`43.129.21.173`
- 登录用户：`root`
- SSH 端口：`22`
- 部署目录：`/data/fund/`
- 服务端口：`3200`
- 进程管理：`PM2`

---

## 4. 部署前检查

### 4.1 检查服务器是否已安装 Node.js

先登录服务器：

```bash
ssh root@43.129.21.173
```

登录后执行：

```bash
node -v
npm -v
```

建议：

- 优先使用 Node.js 18 或 20 LTS
- 如果 `npm ci` 报 lockfile 版本不兼容，再考虑升级 Node/npm

如果服务器没有安装 Node.js，可以按下面示例安装 Node 20：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
yum install -y nodejs
```

如果你的系统不是 CentOS/RHEL 系，改用对应发行版的安装方式：

- Ubuntu / Debian：`apt`
- CentOS / Rocky / AlmaLinux：`yum` 或 `dnf`

### 4.2 检查 PM2 是否已安装

```bash
pm2 -v
```

如果没有安装：

```bash
npm install -g pm2
```

### 4.3 检查 3200 端口是否允许访问

至少确认下面两层：

1. 服务器防火墙放行 3200
2. 云厂商安全组放行 3200

如果这两层没放行，服务可能已经启动，但你浏览器还是打不开。

---

## 5. 上传安装包到服务器

在你本机执行下面命令，把安装包传到服务器：

```bash
scp /Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz root@43.129.21.173:/root/
scp /Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz.sha256 root@43.129.21.173:/root/
```

如果你想先校验文件完整性，登录服务器后执行：

```bash
cd /root
sha256sum -c index-compass-20260319-180441.tar.gz.sha256
```

如果服务器没有 `sha256sum`，可以用：

```bash
shasum -a 256 index-compass-20260319-180441.tar.gz
```

然后和 `.sha256` 文件中的值手动对比。

---

## 6. 首次安装 / 覆盖安装步骤

下面这套步骤适用于两种情况：

- 第一次部署
- 已有旧版本，需要升级

### 6.1 创建目录

```bash
mkdir -p /data/fund
mkdir -p /data/fund-backups
```

### 6.2 备份旧配置

如果服务器上之前已经有旧版本，先备份运行态配置：

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/data/fund-backups/$TS
mkdir -p "$BACKUP_DIR"

if [ -f /data/fund/data/user-config.json ]; then
  cp /data/fund/data/user-config.json "$BACKUP_DIR/user-config.json"
fi

if [ -f /data/fund/data/datasource-config.json ]; then
  cp /data/fund/data/datasource-config.json "$BACKUP_DIR/datasource-config.json"
fi

echo "备份目录：$BACKUP_DIR"
ls -la "$BACKUP_DIR"
```

### 6.3 解压安装包

```bash
cd /data/fund
tar -xzf /root/index-compass-20260319-180441.tar.gz
```

### 6.4 恢复旧配置

如果你在上一步做了备份，把旧配置恢复回去：

```bash
mkdir -p /data/fund/data

if [ -f "$BACKUP_DIR/user-config.json" ]; then
  cp "$BACKUP_DIR/user-config.json" /data/fund/data/user-config.json
fi

if [ -f "$BACKUP_DIR/datasource-config.json" ]; then
  cp "$BACKUP_DIR/datasource-config.json" /data/fund/data/datasource-config.json
fi
```

### 6.5 安装依赖

```bash
cd /data/fund
npm ci
```

如果 `npm ci` 因为 npm 版本或 lockfile 问题失败，可以退一步：

```bash
npm install
```

但优先还是建议用 `npm ci`，更稳定，也更接近发布包的锁定依赖状态。

---

## 7. 使用 PM2 启动服务

### 7.1 启动

发布包里已经带了 `ecosystem.config.js`，直接执行：

```bash
cd /data/fund
pm2 start ecosystem.config.js
```

### 7.2 查看进程状态

```bash
pm2 status
pm2 show index-compass
```

### 7.3 查看日志

```bash
pm2 logs index-compass --lines 100
```

你应该能看到类似：

- 服务监听 3200 端口
- 启动后开始预加载指数数据
- 预加载完成，服务已就绪

如果只看到预加载失败，也不要马上慌。这个项目启动后会访问外部金融数据源。某些源超时，不一定代表服务起不来；要继续看 `api/health` 和网页是否可用。

---

## 8. 设置 PM2 开机自启

先保存当前进程列表：

```bash
pm2 save
```

然后执行：

```bash
pm2 startup
```

PM2 会输出一条真正需要你执行的命令。通常会长这样：

```bash
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
```

**把 PM2 输出的那条命令原样再执行一遍。**

最后再跑一次：

```bash
pm2 save
```

这样服务器重启后，服务会自动拉起。

---

## 9. 上线验证

### 9.1 本机健康检查

在服务器上执行：

```bash
curl http://127.0.0.1:3200/api/health
```

正常情况下会返回类似：

```json
{
  "status": "ok",
  "cached": true,
  "lastFetch": "2026-03-20T...Z",
  "uptime": "...s"
}
```

说明：

- `status: ok`：服务本身是活的
- `cached: true`：说明至少抓到过一轮数据
- `lastFetch` 有值：说明缓存里有数据

如果 `cached` 是 `false`，说明服务启动了，但外部数据可能还没取到。先看日志，不要直接判定部署失败。

### 9.2 对外访问检查

在你本机浏览器打开：

```text
http://43.129.21.173:3200
```

或者命令行执行：

```bash
curl http://43.129.21.173:3200/api/health
```

如果服务器本地正常、外网不通，优先排查：

- 安全组
- 防火墙
- 云平台网络 ACL

---

## 10. 这个项目依赖外网数据源

这个服务启动后和运行中会访问多家公开数据站点。如果服务器出不了公网，或者这些站点被拦截，页面会出现数据缺失、接口报错、估值为空等问题。

建议确认服务器能访问这些域名：

- `danjuanfunds.com`
- `fundmobapi.eastmoney.com`
- `push2.eastmoney.com`
- `push2his.eastmoney.com`
- `youzhiyouxing.cn`
- `www.etf.run`
- `eniu.com`
- `www.csindex.com.cn`
- `web.ifzq.gtimg.cn`
- `hq.sinajs.cn`
- `fonts.googleapis.com`
- `fonts.gstatic.com`

可用下面命令做简单连通性测试：

```bash
curl -I https://danjuanfunds.com
curl -I https://youzhiyouxing.cn
curl -I https://push2.eastmoney.com
```

---

## 11. 常见问题排查

### 11.1 `node: command not found`

说明服务器没有安装 Node.js，先装 Node，再执行 `npm ci`。

### 11.2 `pm2: command not found`

说明 PM2 没装，执行：

```bash
npm install -g pm2
```

### 11.3 `npm ci` 失败

可能原因：

- npm 版本太老
- Node 版本太老
- 服务器无法访问 npm registry

处理顺序建议：

1. `node -v && npm -v`
2. 升级到较新的 Node LTS
3. 再执行 `npm ci`
4. 实在不行再尝试 `npm install`

### 11.4 服务能启动，但页面没有数据

优先检查：

- `pm2 logs index-compass --lines 100`
- `curl http://127.0.0.1:3200/api/health`
- 服务器是否能访问上面的外部数据源

### 11.5 本机能访问，外网打不开

大概率不是程序问题，而是网络策略问题。查：

- 3200 端口是否放行
- 云防火墙 / 安全组是否允许入站

---

## 12. 升级到新版本时怎么做

以后如果你再拿到一个新安装包，重复下面步骤即可：

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/data/fund-backups/$TS
mkdir -p "$BACKUP_DIR"

[ -f /data/fund/data/user-config.json ] && cp /data/fund/data/user-config.json "$BACKUP_DIR/user-config.json"
[ -f /data/fund/data/datasource-config.json ] && cp /data/fund/data/datasource-config.json "$BACKUP_DIR/datasource-config.json"

tar -xzf /root/新安装包.tar.gz -C /data/fund

[ -f "$BACKUP_DIR/user-config.json" ] && cp "$BACKUP_DIR/user-config.json" /data/fund/data/user-config.json
[ -f "$BACKUP_DIR/datasource-config.json" ] && cp "$BACKUP_DIR/datasource-config.json" /data/fund/data/datasource-config.json

cd /data/fund
npm ci
pm2 restart index-compass
pm2 save
```

---

## 13. 一套最短可执行命令

如果你已经确认服务器有 Node 和 PM2，下面这套最短流程基本就够了：

```bash
scp /Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz root@43.129.21.173:/root/

ssh root@43.129.21.173

TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/data/fund-backups/$TS
mkdir -p "$BACKUP_DIR"
[ -f /data/fund/data/user-config.json ] && cp /data/fund/data/user-config.json "$BACKUP_DIR/user-config.json"
[ -f /data/fund/data/datasource-config.json ] && cp /data/fund/data/datasource-config.json "$BACKUP_DIR/datasource-config.json"

mkdir -p /data/fund
cd /data/fund
tar -xzf /root/index-compass-20260319-180441.tar.gz
[ -f "$BACKUP_DIR/user-config.json" ] && cp "$BACKUP_DIR/user-config.json" /data/fund/data/user-config.json
[ -f "$BACKUP_DIR/datasource-config.json" ] && cp "$BACKUP_DIR/datasource-config.json" /data/fund/data/datasource-config.json
npm ci
pm2 start ecosystem.config.js
pm2 save
curl http://127.0.0.1:3200/api/health
```

---

## 14. 你现在应该看哪个文件

你现在最需要的两个文件就在这里：

- 安装包：`/Users/daleshi/WorkBuddy/20260313100002/dist/index-compass-20260319-180441.tar.gz`
- 部署手册：`/Users/daleshi/WorkBuddy/20260313100002/dist/DEPLOYMENT_MANUAL.md`

如果你愿意，我下一步还可以继续帮你补一份：

1. **适合直接复制执行的服务器部署脚本**
2. **适合发给运维同事的极简版上线说明**

前者省手，后者省口舌。两种都挺实用。