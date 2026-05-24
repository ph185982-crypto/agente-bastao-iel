# Nexos Páginas — Content Tool para Instagram

Ferramenta web para criar conteúdo para o Instagram em 3 passos:

1. **Baixar vídeo** de um Reel ou Story via URL
2. **Extrair legenda** de um print usando Claude Vision (OCR)
3. **Gerar headline + legenda** otimizados para o @pedro_destrava

## Stack

| Camada     | Tecnologia                          |
|------------|-------------------------------------|
| Frontend   | React 18 + Vite + Tailwind CSS      |
| Backend    | Node.js + Express                   |
| IA         | Claude claude-sonnet-4-6 (Anthropic)  |
| Download   | RapidAPI Instagram Downloader       |
| Deploy BE  | Render                              |
| Deploy FE  | Netlify                             |

---

## Rodando localmente

### Pré-requisitos

- Node.js 18+
- Chaves de API: `RAPIDAPI_KEY` e `ANTHROPIC_API_KEY`

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edite .env com suas chaves
npm install
npm run dev        # inicia em http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# Deixe VITE_API_URL em branco (Vite vai proxiar /api → localhost:3001)
npm install
npm run dev        # inicia em http://localhost:5173
```

---

## Deploy

### Backend no Render

1. Acesse [render.com](https://render.com) e crie um **Web Service**
2. Aponte para este repositório
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Runtime:** Node
4. Adicione as variáveis de ambiente em **Environment**:
   - `RAPIDAPI_KEY`
   - `ANTHROPIC_API_KEY`
   - `FRONTEND_URL` → URL do seu site no Netlify
5. O `render.yaml` na raiz já documenta essa configuração.

### Frontend no Netlify

1. Acesse [netlify.com](https://netlify.com) e importe o repositório
2. Configure:
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `frontend/dist`
3. Adicione a variável de ambiente:
   - `VITE_API_URL` → URL do seu serviço Render (ex: `https://nexos-paginas-backend.onrender.com`)

---

## Variáveis de ambiente

| Variável          | Onde        | Descrição                                    |
|-------------------|-------------|----------------------------------------------|
| `RAPIDAPI_KEY`    | Backend     | Chave RapidAPI para download de vídeos       |
| `ANTHROPIC_API_KEY` | Backend   | Chave Anthropic para OCR e geração de copy   |
| `PORT`            | Backend     | Porta do servidor (padrão: 3001)             |
| `FRONTEND_URL`    | Backend     | URL do frontend (para CORS em produção)      |
| `VITE_API_URL`    | Frontend    | URL base do backend em produção              |

Copie `.env.example` para `.env` em cada pasta e preencha os valores.
