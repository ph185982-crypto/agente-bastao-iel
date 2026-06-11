FROM node:20-slim

# ffmpeg-static traz o binário embutido, mas sharp precisa de libs de sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependências primeiro (camada cacheada)
COPY package*.json ./
RUN npm ci --only=production

# Copiar código + assets (incluindo a fonte DejaVuSans-Bold.ttf)
COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
