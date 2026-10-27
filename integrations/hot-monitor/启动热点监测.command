#!/bin/zsh
# 双击启动本机服务；保持电脑唤醒时才会持续采集。
cd -- "${0:A:h}" || exit 1
monitor_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$monitor_node" ]]; then monitor_node="$(command -v node)"; fi
if [[ -z "$monitor_node" ]]; then print '未找到Node.js 24，请先完成本机依赖安装。'; read '?按回车关闭'; exit 1; fi
"$monitor_node" scripts/monitor-local.mjs start || { read '?启动失败，按回车关闭'; exit 1; }
/usr/bin/open 'http://localhost:3002/admin/monitor'
print '网站已打开。关闭这个终端窗口不会停止已启动的后台服务。电脑休眠或关机期间不持续采集。'
