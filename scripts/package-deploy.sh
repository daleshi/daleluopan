#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST_DIR="$PROJECT_ROOT/dist"
STAMP=$(date +%Y%m%d-%H%M%S)
APP_NAME="dale-compass"
RELEASE_NAME="${APP_NAME}-${STAMP}"
TAR_PATH="$DIST_DIR/${RELEASE_NAME}.tar.gz"
SHA_PATH="$TAR_PATH.sha256"

mkdir -p "$DIST_DIR"
mkdir -p "$PROJECT_ROOT/logs"

cd "$PROJECT_ROOT"

# node_modules/sql.js 只带运行所需的 3 个文件（纯 JS + WASM，与平台无关；服务器上不执行 npm install）
SQLJS_FILES="node_modules/sql.js/package.json node_modules/sql.js/dist/sql-wasm.js node_modules/sql.js/dist/sql-wasm.wasm"
for f in $SQLJS_FILES; do
  if [ ! -f "$f" ]; then
    echo "错误：缺少 $f，请先执行 npm install" >&2
    exit 1
  fi
done

# data/db（采集库）与 data/backup（库备份）是各机器自己的运行态数据，不打包
tar -czf "$TAR_PATH" \
  --exclude="data/db" \
  --exclude="data/backup" \
  package.json \
  package-lock.json \
  server.js \
  collector.js \
  ecosystem.config.js \
  public \
  services \
  $SQLJS_FILES \
  data \
  logs

if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$TAR_PATH" > "$SHA_PATH"
elif command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$TAR_PATH" > "$SHA_PATH"
else
  echo "警告：未找到 shasum/sha256sum，跳过校验文件生成。"
fi

printf '发布包已生成：\n%s\n' "$TAR_PATH"
if [ -f "$SHA_PATH" ]; then
  printf '校验文件已生成：\n%s\n' "$SHA_PATH"
fi
