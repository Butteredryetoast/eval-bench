#!/bin/sh
set -e
cd "$(dirname "$0")"

CASEBENCH_NODE="$(command -v node || true)"
if [ -z "$CASEBENCH_NODE" ]; then
  CASEBENCH_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$CASEBENCH_NODE" ]; then
  echo "请先安装 Node.js LTS。"
  exit 1
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")"
if [ -z "$IP" ]; then
  echo "没有取到局域网 IP。请确认已连接 WiFi 或有线网络后重试。"
  exit 1
fi

export CASEBENCH_HOST=0.0.0.0
export CASEBENCH_ALLOWED_HOSTS="$IP"

if [ ! -f apps/web/.next/BUILD_ID ]; then
  echo "首次启动，正在构建，请稍等……"
  "$CASEBENCH_NODE" node_modules/next/dist/bin/next build apps/web --webpack
fi

echo ""
echo "局域网地址： http://$IP:43110"
echo "同一网络下的同事用这个地址打开。关掉本窗口即停止服务。"
echo "如果 macOS 弹出防火墙询问，请选择「允许」。"
echo ""

exec "$CASEBENCH_NODE" scripts/dev.mjs --production
