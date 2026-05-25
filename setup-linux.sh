#!/bin/bash
# ============================================================
# VoiceInk — Setup & Lancement sur Linux
# ============================================================
# À utiliser la première fois, ou après un changement de plateforme
# Usage: bash setup-linux.sh
# ============================================================

set -e
cd "$(dirname "$0")"

echo "=== VoiceInk — Setup Linux ==="
echo ""

# ── Node.js ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERREUR] Node.js non trouvé. Installe-le d'abord:"
  echo "  sudo apt install nodejs npm   # Debian/Ubuntu"
  echo "  sudo dnf install nodejs npm   # Fedora"
  exit 1
fi
echo "[OK] Node.js $(node -v)"

# ── Python ─────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "[ERREUR] Python3 non trouvé. Installe-le:"
  echo "  sudo apt install python3 python3-venv python3-pip"
  exit 1
fi
echo "[OK] Python $(python3 --version)"

echo ""
echo "[1/5] Installation des dépendances Node.js..."
echo "      (Rebuild des binaires natifs Electron pour Linux)"
npm install

echo ""
echo "[2/5] Création de l'environnement Python..."
python3 -m venv .venv
source .venv/bin/activate

echo ""
echo "[3/5] Installation des paquets Python (faster-whisper, etc.)..."
pip install --upgrade pip -q
pip install -r requirements.txt

echo ""
echo "[4/5] Compilation TypeScript + Vite..."
npm run build

echo ""
echo "[5/5] Lancement de VoiceInk..."
npm start
