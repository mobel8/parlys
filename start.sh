#!/bin/bash
cd "$(dirname "$0")"

echo "=== VoiceInk - Lancement ==="

# Build
echo "[1/2] Compilation..."
node node_modules/typescript/bin/tsc -p tsconfig.main.json 2>&1
node node_modules/vite/bin/vite.js build 2>&1

# Start
echo "[2/2] Démarrage de VoiceInk..."
node_modules/.bin/electron --no-sandbox dist/main/index.js
