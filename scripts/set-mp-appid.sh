#!/bin/bash
# 把微信小程序 AppID 写入 miniprogram/project.config.json
# 用法: bash scripts/set-mp-appid.sh wx1234567890abcdef

set -euo pipefail

APPID="${1:-}"
CONF="miniprogram/project.config.json"

if [ -z "$APPID" ]; then
  echo "用法: bash scripts/set-mp-appid.sh <你的AppID>"
  echo "示例: bash scripts/set-mp-appid.sh wx1234567890abcdef"
  exit 1
fi

if ! echo "$APPID" | grep -qE '^wx[0-9a-f]{16}$'; then
  echo "错误: AppID 格式不对（应为 wx 开头 + 16 位小写十六进制，共 18 位）"
  echo "你输入的是: $APPID"
  exit 1
fi

if [ ! -f "$CONF" ]; then
  echo "错误: 找不到 $CONF，请在项目根目录执行本脚本"
  exit 1
fi

PYBIN="$(command -v python3 || command -v /usr/bin/python3)"
if [ -z "$PYBIN" ]; then echo "错误: 找不到 python3"; exit 1; fi

"$PYBIN" - "$CONF" "$APPID" <<'PY'
import json, sys, collections
conf, appid = sys.argv[1], sys.argv[2]
with open(conf, encoding='utf-8') as f:
    cfg = json.load(f, object_pairs_hook=collections.OrderedDict)
old = cfg.get('appid', '(空)')
cfg['appid'] = appid
with open(conf, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f"已写入: {old}  ->  {appid}")
PY

echo "完成。现在可以在微信开发者工具里重新导入 miniprogram/ 目录。"
