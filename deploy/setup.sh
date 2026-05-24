#!/bin/bash
# Nexos Páginas — Oracle Cloud ARM (Ubuntu 22.04) setup script
# Run from the repo root: bash deploy/setup.sh
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="/opt/nexos-paginas"
NODE_VERSION="20"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Nexos Páginas — Oracle Cloud Setup      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. System update ──────────────────────────────────────────────────────────
echo "[1/8] Atualizando o sistema..."
sudo apt-get update -y -q
sudo apt-get upgrade -y -q

# ── 2. Node.js 20 ─────────────────────────────────────────────────────────────
echo "[2/8] Instalando Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash - -q
sudo apt-get install -y -q nodejs
echo "      Node.js $(node --version) instalado"

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
echo "[3/8] Instalando PM2..."
sudo npm install -g pm2 --silent

# ── 4. Nginx ──────────────────────────────────────────────────────────────────
echo "[4/8] Instalando Nginx..."
sudo apt-get install -y -q nginx

# ── 5. Firewall (ufw + iptables Oracle Cloud) ─────────────────────────────────
echo "[5/8] Configurando firewall..."
sudo ufw allow 22/tcp  > /dev/null
sudo ufw allow 80/tcp  > /dev/null
sudo ufw allow 443/tcp > /dev/null
sudo ufw --force enable > /dev/null

# Oracle Cloud bloqueia portas por padrão via iptables — abrir 80 e 443
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo apt-get install -y -q iptables-persistent
sudo netfilter-persistent save > /dev/null 2>&1 || true

# ── 6. Deploy da aplicação ────────────────────────────────────────────────────
echo "[6/8] Instalando dependências do backend..."
sudo cp -r "$REPO_DIR" "$APP_DIR" 2>/dev/null || true
if [ "$REPO_DIR" != "$APP_DIR" ]; then
  sudo cp -r "$REPO_DIR/." "$APP_DIR/"
fi
sudo chown -R "$USER:$USER" "$APP_DIR"

cd "$APP_DIR/backend"
npm install --omit=dev --silent

# ── 7. Variáveis de ambiente ──────────────────────────────────────────────────
echo "[7/8] Configurando variáveis de ambiente..."
if [ ! -f "$APP_DIR/backend/.env" ]; then
  cat > "$APP_DIR/backend/.env" << 'ENV'
PORT=3001
NODE_ENV=production
OPENAI_API_KEY=COLOQUE_SUA_CHAVE_AQUI
RAPIDAPI_KEY=COLOQUE_SUA_CHAVE_AQUI
FRONTEND_URL=https://nexos-paginas.netlify.app
ENV
  echo ""
  echo "  ⚠  Edite o arquivo com suas chaves antes de continuar:"
  echo "     nano $APP_DIR/backend/.env"
  echo ""
  read -p "  Pressione ENTER após editar o .env..." _
fi

# ── PM2 ───────────────────────────────────────────────────────────────────────
pm2 delete nexos-paginas 2>/dev/null || true
pm2 start "$APP_DIR/backend/ecosystem.config.js"
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -1 | sudo bash - 2>/dev/null || true
pm2 save

# ── 8. Nginx ──────────────────────────────────────────────────────────────────
echo "[8/8] Configurando Nginx..."
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

sudo tee /etc/nginx/sites-available/nexos-paginas > /dev/null << NGINX
server {
    listen 80;
    server_name $PUBLIC_IP _;

    client_max_body_size 110M;

    # Timeouts generosos para processamento de vídeo (até 6 min)
    proxy_read_timeout    360s;
    proxy_connect_timeout  60s;
    proxy_send_timeout    360s;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/nexos-paginas /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✓ Setup concluído!                      ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  IP público do servidor: http://$PUBLIC_IP"
echo ""
echo "  Próximos passos:"
echo "  1. Copie o IP acima"
echo "  2. Abra o arquivo frontend/public/_redirects no seu projeto"
echo "  3. Substitua a URL do Render por: http://$PUBLIC_IP"
echo "  4. Faça git push → Netlify vai rebuildar automaticamente"
echo ""
echo "  Para verificar se está rodando:"
echo "  pm2 status"
echo "  curl http://$PUBLIC_IP/health"
echo ""
