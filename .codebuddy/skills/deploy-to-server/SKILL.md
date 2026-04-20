---
name: deploy-to-server
description: 将本地 dale-compass 项目打包并发布到指定服务器，自动完成打包、上传、覆盖部署、PM2 重启、日志验证全流程。
metadata:
  author: daleshi
  version: "1.2"
---

将本地代码打包发布到目标服务器。

**Input**: 无需参数，启动时会向用户收集服务器连接信息。

---

## Steps

### 1. 收集服务器连接信息

使用 **AskUserQuestion tool** 一次性向用户收集以下信息（4个问题）：

- **服务器 IP**（如 `192.168.1.1`）
- **SSH 端口**（默认 22）
- **SSH 用户名**（如 `root`）
- **SSH 密码**

同时询问**服务器上的项目目录**（默认 `/data/dale-compass`）。

将上述信息保存为变量：`SSH_HOST`、`SSH_PORT`、`SSH_USER`、`SSH_PASS`、`DEPLOY_DIR`，后续步骤全部使用这些变量，**不在输出中打印密码**。

### 2. 本地打包

```bash
cd /Users/daleshi/git/daleluopan && npm run package:deploy
```

从输出中提取包文件名，格式为 `dale-compass-YYYYMMDD-HHMMSS.tar.gz`，记为 `PKG_NAME`。

### 3. 上传压缩包到服务器

```bash
sshpass -p '<SSH_PASS>' scp -o StrictHostKeyChecking=no -P <SSH_PORT> \
  /Users/daleshi/git/daleluopan/dist/<PKG_NAME> \
  <SSH_USER>@<SSH_HOST>:<DEPLOY_DIR>/
```

### 4. 服务器端部署

通过 SSH 执行以下操作：

```bash
sshpass -p '<SSH_PASS>' ssh -o StrictHostKeyChecking=no -p <SSH_PORT> <SSH_USER>@<SSH_HOST> '
cd <DEPLOY_DIR>

# 备份 data 目录（运行态数据）
cp -r data data.bak.$(date +%Y%m%d-%H%M%S)

# 覆盖解压，排除 data 目录
tar -xzf <PKG_NAME> \
  --exclude="./data" \
  --exclude="data" \
  2>&1 | grep -v "Ignoring unknown extended header" | grep -v "^$" || true

# 重启服务
npx pm2 restart dale-compass

# 等待启动
sleep 3

# 查看状态
npx pm2 status dale-compass

# 查看最新日志
npx pm2 logs dale-compass --lines 15 --nostream 2>&1 | tail -20
'
```

### 5. 清理服务器临时文件及旧备份

```bash
sshpass -p '<SSH_PASS>' ssh -o StrictHostKeyChecking=no -p <SSH_PORT> <SSH_USER>@<SSH_HOST> '
# 删除本次上传的临时包
rm <DEPLOY_DIR>/<PKG_NAME>

# 仅保留最新 1 个备份，删除其余旧备份
cd <DEPLOY_DIR>
ls -dt data.bak.* 2>/dev/null | tail -n +2 | xargs rm -rf
echo "备份清理完成，当前保留：$(ls -d data.bak.* 2>/dev/null || echo 无)"
'
```

### 6. 验证部署结果

检查步骤 4 的输出：
- PM2 status 中 `dale-compass` 状态为 `online`
- 日志中无 crash 或 Error 级别异常
- `public/index.html` 的文件时间戳为今日

---

## 输出格式

**成功时：**

```
## 发布完成

**服务器**: <SSH_HOST>:<SSH_PORT>
**包名**: <PKG_NAME>
**PM2 状态**: online（pid XXXXX）

**本次更新文件时间戳**:
- public/index.html: <日期>
- server.js: <日期>

服务已正常运行。
```

**失败时：**

```
## 发布失败

**阶段**: <打包 / 上传 / 解压 / 重启>
**错误信息**: <具体错误>

**建议排查**:
- <针对该阶段的排查建议>
```

---

## 注意事项

- `data/` 目录包含用户数据和运行态 JSON，**始终排除在解压覆盖之外**，并在部署前自动备份
- macOS 打包的 tar.gz 含 Apple 扩展头（`LIBARCHIVE.xattr.*`），Linux 解压时会有警告，属正常现象，不影响文件内容
- 部署不会执行 `npm install`（`node_modules` 已随包包含），若新增依赖需手动处理
- 每次部署后自动清理旧备份，**始终只保留最新 1 个**，如需回滚请在下次发布前手动操作
- **密码仅用于命令执行，不记录到任何输出、日志或记忆中**
