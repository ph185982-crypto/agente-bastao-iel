#!/bin/bash
# Atualiza o backend quando você fizer git push no repositório
# Execute na VM: bash /opt/nexos-paginas/deploy/update.sh
set -e

APP_DIR="/opt/nexos-paginas"

echo "Atualizando Nexos Páginas..."
cd "$APP_DIR"
git pull origin main
cd backend
npm install --omit=dev --silent
pm2 restart nexos-paginas
echo "✓ Atualizado e reiniciado"
pm2 status
