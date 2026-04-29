#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo
echo "==============================================="
echo "   Fin-Agent Desktop macOS 一键打包工具"
echo "   (当前 Mac 架构 DMG)"
echo "==============================================="
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[X] macOS 安装包必须在 macOS 上构建"
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[X] 未检测到 Python"
  echo "    请安装 Python 3.8+ 并添加到 PATH"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[X] 未检测到 Node.js"
  echo "    请安装 Node.js 16+ 并添加到 PATH"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[X] 未检测到 npm"
  echo "    请安装 Node.js/npm 并添加到 PATH"
  exit 1
fi

echo "[OK] 环境检查通过"
echo

"${PYTHON_BIN}" make.py --target mac

echo
echo "==============================================="
echo "   打包完成！"
echo "==============================================="
