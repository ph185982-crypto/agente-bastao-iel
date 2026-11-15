# Google Cloud Run: o mesmo servidor Express que roda na Vercel (backend/server.js), sem as filas da Vercel —
# fora da Vercel o trabalho continua no próprio processo e o relógio do piloto vem do Cloud Scheduler.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/server.js"]
