#!/usr/bin/env bash
# ============================================================
#  大乐罗盘 一键部署脚本
#  放到服务器上执行即可完成：环境检查 → 备份 → 解压 → 装依赖 → PM2 启动
#
#  用法：
#    chmod +x deploy.sh
#    bash deploy.sh /root/dale-compass-XXXXXXXX-XXXXXX.tar.gz
#
#  如果不传安装包路径，脚本默认去 /root/ 找最新的 dale-compass-*.tar.gz
# ============================================================

set -euo pipefail

# -------------------- 配置区（按需修改） --------------------
DEPLOY_DIR="/data/dale-compass"
BACKUP_BASE="/data/dale-compass-backups"
APP_NAME="dale-compass"
APP_PORT=3200
NODE_MAJOR=20          # 若需自动安装 Node，使用此大版本
# -----------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ======== 1. 确定安装包路径 ========
if [ -n "${1:-}" ]; then
  TAR_FILE="$1"
else
  TAR_FILE=$(ls -t /root/dale-compass-*.tar.gz 2>/dev/null | head -1 || true)
fi
[ -f "${TAR_FILE:-}" ] || fail "找不到安装包。用法：bash deploy.sh <安装包路径>"
info "安装包：$TAR_FILE"

# ======== 2. 检查 / 安装 Node.js ========
if command -v node >/dev/null 2>&1; then
  info "Node.js 已安装：$(node -v)"
else
  warn "未检测到 Node.js，尝试自动安装 Node $NODE_MAJOR ..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    yum install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  else
    fail "无法识别包管理器，请手动安装 Node.js $NODE_MAJOR 后重新执行。"
  fi
  info "Node.js 安装完成：$(node -v)"
fi

# ======== 3. 检查 / 安装 PM2 ========
if command -v pm2 >/dev/null 2>&1; then
  info "PM2 已安装：$(pm2 -v)"
else
  warn "未检测到 PM2，正在安装..."
  npm install -g pm2
  info "PM2 安装完成：$(pm2 -v)"
fi

# ======== 4. 备份旧数据（整个 data 目录） ========
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="$BACKUP_BASE/$TS"
mkdir -p "$BACKUP_DIR"

HAS_BACKUP=false
if [ -d "$DEPLOY_DIR/data" ]; then
  cp -r "$DEPLOY_DIR/data" "$BACKUP_DIR/data"
  HAS_BACKUP=true
  info "旧数据目录已备份到：$BACKUP_DIR/data"
  ls -la "$BACKUP_DIR/data/"
else
  info "未发现旧数据目录，跳过备份。"
  rmdir "$BACKUP_DIR" 2>/dev/null || true
fi

# ======== 5. 停止旧进程（兼容新旧应用名） ========
for OLD_NAME in "$APP_NAME" "index-compass"; do
  if pm2 describe "$OLD_NAME" >/dev/null 2>&1; then
    info "停止旧进程 $OLD_NAME ..."
    pm2 stop "$OLD_NAME" 2>/dev/null || true
    pm2 delete "$OLD_NAME" 2>/dev/null || true
  fi
done

# ======== 6. 解压安装包 ========
mkdir -p "$DEPLOY_DIR"
info "解压安装包到 $DEPLOY_DIR ..."
tar -xzf "$TAR_FILE" -C "$DEPLOY_DIR"

# ======== 7. 恢复旧数据（合并，旧文件优先） ========
if [ "$HAS_BACKUP" = true ]; then
  mkdir -p "$DEPLOY_DIR/data"
  # 将备份中的每个文件恢复回去（覆盖新包中的默认文件）
  for f in "$BACKUP_DIR/data/"*.json; do
    [ -f "$f" ] || continue
    cp "$f" "$DEPLOY_DIR/data/"
    info "  恢复: $(basename "$f")"
  done
  info "旧数据已恢复。"
fi

# ======== 8. 安装依赖 ========
cd "$DEPLOY_DIR"
info "安装 Node.js 依赖..."
if npm ci --production 2>/dev/null; then
  info "npm ci 成功。"
else
  warn "npm ci 失败，回退到 npm install ..."
  npm install --production
fi

# ======== 9. 启动 PM2 ========
info "启动 PM2 进程..."
pm2 start ecosystem.config.js
pm2 save

# ======== 10. 设置开机自启（仅首次需要） ========
if ! systemctl is-enabled pm2-root >/dev/null 2>&1; then
  info "配置 PM2 开机自启..."
  pm2 startup systemd -u root --hp /root --no-setup 2>/dev/null || true
  pm2 startup
  pm2 save
fi

# ======== 11. 健康检查 ========
info "等待服务启动（8 秒）..."
sleep 8

HEALTH=$(curl -s -m 15 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || echo "UNREACHABLE")

if echo "$HEALTH" | grep -q '"status"'; then
  echo ""
  info "============================================"
  info "  🧭 大乐罗盘部署完成！"
  info "  服务已在端口 $APP_PORT 运行"
  info "============================================"
  echo ""
  info "健康检查结果："
  echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
  echo ""
  info "外网访问地址：http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '服务器IP'):${APP_PORT}"
  info "PM2 状态：pm2 status"
  info "实时日志：pm2 logs $APP_NAME"
else
  warn "服务可能还在启动中，健康检查返回：$HEALTH"
  warn "请稍等片刻后手动检查："
  warn "  curl http://127.0.0.1:${APP_PORT}/api/health"
  warn "  pm2 logs $APP_NAME --lines 50"
fi
