#!/bin/bash
# ============================================================
# VoiceInk — Build all installers (Linux / macOS hosts).
# ============================================================
set -e
cd "$(dirname "$0")"

echo ""
echo " VoiceInk - Build All Installers"
echo " ================================"
echo "   Native build for the current OS,"
echo "   plus whatever cross-builds electron-builder supports."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "[OK] Node.js $(node -v)"

if [ ! -d "node_modules/.bin" ]; then
  echo ""
  echo "[1/3] Installing dependencies..."
  npm ci
else
  echo "[1/3] Dependencies OK"
fi

# Linux: make sure fpm is available so .deb / .rpm can be produced.
if [ "$(uname)" = "Linux" ] && ! command -v fpm >/dev/null 2>&1; then
  echo ""
  echo "[hint] fpm not found — .deb/.rpm targets will fail without it."
  echo "       Install with: sudo apt-get install -y ruby ruby-dev rubygems build-essential rpm"
  echo "                     sudo gem install --no-document fpm"
  echo ""
fi

echo ""
echo "[2/3] Running build-all..."
node scripts/build-all.js "$@"

echo ""
echo "[3/3] Release folder:"
ls -lh release/ 2>/dev/null | grep -E '\.(exe|AppImage|deb|rpm|dmg|zip|tar\.gz)$' || true

echo ""
echo "==================================="
echo " Build complete."
echo "==================================="
