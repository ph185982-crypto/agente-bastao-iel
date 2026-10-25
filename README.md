# Pedro Destrava / Nexos Páginas

## Versão atual: Mesa e Central de aprovação

Interface em `static/`, API Node/Express em `backend/`, implantação Vercel em
`api/index.js`. Esta é a branch de trabalho `claude/create-nexos-paginas-5Yvxh`.
O conteúdo pode ser criado por link ou texto, revisado com evidências, transformado
em arte 1080×1350, aprovado por versão e exportado. Publicação real depende das
conexões do servidor e de aprovação explícita.

### Abrir a versão atual no computador

Com Node.js 20 ou superior (validação desta entrega em Node 24):

```sh
npm ci
npm start
```

Abra **http://localhost:3001**. A interface e a API usam o mesmo servidor.
Não é necessário iniciar o frontend legado. `FRONTEND_URL` só deve ser definido
se você quiser redirecionar a página inicial para uma hospedagem separada.

Sem chave de IA, a geração informa que falta configuração; sem `DATABASE_URL`,
o armazenamento fica só no navegador. As chaves ficam exclusivamente no servidor.
Não use chaves ou tokens que tenham sido expostos em conversas.

### Validar

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

O primeiro comando executa a suíte unitária e de integração. O último inicia
servidores locais isolados, usa IA e Meta simuladas e bloqueia rede externa.
O armazenamento do executor de navegador é **em memória**, renovado a cada
arquivo; não substitui a validação com PostgreSQL. Veja [testes de navegador](tests/e2e/README.md).

Resultado e pendências desta entrega: [VALIDACAO.md](docs/VALIDACAO.md).
Configuração real: [acesso](docs/ACESSO.md), [banco](docs/ARMAZENAMENTO.md)
e [Instagram](docs/META_SETUP.md).

**Radar de Negócios** (pesquisa diária às 7h, carrossel “Ideias que dão dinheiro”, fila de aprovação): [docs/RADAR.md](docs/RADAR.md).

**Não promover para `main`, publicar em produção nem enviar posts sem a
autorização explícita do Pedro.**

---

## Histórico das ferramentas legadas

As instruções abaixo documentam o frontend e as ferramentas anteriores à Mesa.
Para a versão atual, use os comandos no início deste documento.

### Nexos Páginas — Content Tool para Instagram

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
- Nenhuma chave é obrigatória para o Editor de Vídeo: enviando o arquivo do
  aparelho (ou colando o link direto do `.mp4`), o reel é montado e a legenda é
  escrita pelo robô, sem IA e sem API de download.
- As chaves melhoram o resultado, não destravam o básico:
  - `GROQ_API_KEY` (gratuita) — a IA ouve a fala do vídeo e escreve gancho e
    legenda sobre o conteúdo real, em vez do texto estrutural do robô;
  - `SOCIALKIT_API_KEY` (cota paga) — baixa o vídeo a partir do link de um post
    do Instagram. `RAPIDAPI_KEY` é a reserva, se a socialkit.dev falhar.

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
   - `GROQ_API_KEY`
   - `SOCIALKIT_API_KEY`
   - `RAPIDAPI_KEY`
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

### IA (texto)

O backend tenta os provedores **nesta ordem** e pula pro próximo quando um falha —
chave inválida, cota estourada, modelo desativado ou prompt grande demais.
**Basta uma chave** para o app funcionar; as outras são reforço para ele não parar.

| Variável             | Custo   | Onde pegar                        |
|----------------------|---------|-----------------------------------|
| `GROQ_API_KEY`       | Grátis  | console.groq.com/keys             |
| `GEMINI_API_KEY`     | Grátis  | aistudio.google.com/apikey        |
| `CEREBRAS_API_KEY`   | Grátis  | cloud.cerebras.ai                 |
| `OPENROUTER_API_KEY` | Grátis  | openrouter.ai/keys (modelos `:free`) |
| `OPENAI_API_KEY`     | **Pago** | Último recurso — deixe vazia para não gerar custo |

Se a lista fixa de modelos de um provedor se esgotar, o backend consulta o
endpoint `/models` dele e tenta os modelos disponíveis no momento. Foi isso que
resolveu a parada geral quando o Groq desativou os modelos antigos.

### Modo robô — gerar carrossel sem IA

Quando a cota gratuita da IA acaba, o app **não para**: um gerador
determinístico assume e monta o carrossel sem chamar modelo nenhum.

```bash
# força o robô (não gasta cota nenhuma)
curl -X POST .../api/carousels/generate \
  -H 'Content-Type: application/json' \
  -d '{"topic":"como vender mais","slideCount":6,"modo":"robo"}'
```

A resposta traz `fonte`, que diz de onde veio o conteúdo:

| `fonte`        | Significado                                     |
|----------------|-------------------------------------------------|
| `ia`           | gerado pela IA normalmente                      |
| `robo`         | robô por pedido (`modo: 'robo'`) ou falta de chave |
| `robo-reserva` | a IA falhou no meio e o robô assumiu            |

O robô monta o que é fórmula: framework de copy (PAS, lista, mito × verdade,
passo a passo), gancho de capa, ritmo das telas, CTA, legenda e hashtags.

**O que ele não faz de propósito:** inventar fato, número ou explicação sobre o
tema. Sem IA não há como verificar se seria verdade, e post com dado falso é
pior que post nenhum — então onde entra o fato específico fica o marcador
`[troque por um exemplo ou número real]` para você preencher antes de postar.

Cada chamada gera uma versão diferente do mesmo tema. Para repetir uma versão
exata, mande `variante` (o número vem na resposta).

Testes: `node --test backend/lib/roboCopy.test.js` — rodam sem chave e sem rede.

### Demais variáveis

| Variável                | Onde     | Descrição                                      |
|-------------------------|----------|------------------------------------------------|
| `SOCIALKIT_API_KEY`     | Backend  | Download de Reels do Instagram — principal (cota paga) |
| `RAPIDAPI_KEY`          | Backend  | Reserva do download do Instagram; download de TikTok/YouTube (cota paga) |
| `SHOTSTACK_PROD_KEY`    | Backend  | Renderização de vídeo — **pago por render**    |
| `SHOTSTACK_SANDBOX_KEY` | Backend  | Renderização em sandbox (testes)               |
| `PEXELS_API_KEY`        | Backend  | Banco de imagens (gratuito)                    |
| `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` | Backend | Imagens nos carrosséis (exige billing no GCP; opcional) |
| `PROFILE_HANDLE` / `PROFILE_NAME`  | Backend | Identidade exibida nos carrosséis      |
| `PORT`                  | Backend  | Porta do servidor (padrão: 3001)               |
| `FRONTEND_URL`          | Backend  | URL do frontend (para CORS em produção)        |
| `VITE_API_URL`          | Frontend | URL base do backend em produção                |

Copie `.env.example` para `.env` em cada pasta e preencha os valores.
