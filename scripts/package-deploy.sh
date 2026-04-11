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

tar -czf "$TAR_PATH" \
  package.json \
  package-lock.json \
  server.js \
  ecosystem.config.js \
  public \
  services \
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
