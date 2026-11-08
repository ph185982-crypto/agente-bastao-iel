# Vídeos (backend) — o que o integrador precisa ligar

Módulo: `backend/lib/videos/index.js` + `backend/routes/videos.js` (contrato em `docs/VIDEOS_E_RECICLAGEM_SPEC.md`). Testes: `node --test backend/lib/videos/*.test.js`.

## 1. server.js (uma linha, junto das outras rotas)
```js
app.use('/api/videos', require('./routes/videos'));
```
A rota precisa ficar DEPOIS de `app.use('/api', access.exigeAcesso)` e de `express.json()` (os corpos são pequenos: o vídeo em si vai direto do navegador para o Vercel Blob, nunca passa pela função).

`backend/lib/access.js` já foi alterado por este módulo: `ROTAS_CRON` ganhou `/api/videos/worker/(proximo|token|resultado|erro)` e `/api/videos/blob` (aceitam `Authorization: Bearer <CRON_SECRET>`, que é o que o worker do GitHub Actions manda).

## 2. Dependência
`@vercel/blob` (^2.8.2) em `dependencies` do `package.json` da raiz. O módulo usa `@vercel/blob/client` (`handleUpload`, `generateClientTokenFromReadWriteToken`) e `@vercel/blob` (`del`).

## 3. Variáveis de ambiente (Vercel)
| Variável | Obrigatória | Para quê |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | sim | Criada ao ligar o Blob ao projeto (Storage → Blob). Sem ela toda rota de vídeo responde `503 SEM_BLOB` com a mensagem "O armazenamento de vídeo ainda não foi ligado na Vercel (Storage → Blob)". Nunca sai do servidor: navegador e worker recebem client tokens de 1 h restritos a `videos/<id>/`. |
| `PUBLIC_BASE_URL` | recomendada | Já existe. Usada como `callbackUrl` do webhook do Blob (`<base>/api/videos/blob`). Sem ela (e sem `VERCEL_URL`) o webhook não é configurado e só `POST /api/videos/:id/enviado` registra o envio. |
| `CRON_SECRET` | já existe | O worker chama `/api/videos/worker/*` e `/api/videos/blob` com `Authorization: Bearer <CRON_SECRET>`. Precisa estar também em GitHub Secrets. |
| `GITHUB_DISPATCH_TOKEN` | opcional | Token do GitHub com permissão `contents:write`/`repo` no repositório `ph185982-crypto/agente-bastao-iel`. Com ele, `POST /:id/enviado` e `/:id/refazer` disparam `repository_dispatch` (`event_type: 'video'`) e o worker começa na hora; sem ele, o cron de 5 min do workflow pega o job. |

Nada de IA nova: a legenda usa `backend/lib/llmJson` (Groq/Gemini já configurados). Push usa as chaves VAPID já existentes.

## 4. O que o front chama (`static/videos.js` / `static/teleprompter.js`)
Todas com o cabeçalho `Authorization: Bearer <token do app>` (igual às outras rotas).

1. **Criar**: `POST /api/videos` `{ titulo?, estilo?: 'hormozi'|'beast'|'caixa', opcoes?: { broll, musica, punch_in, remover_pausas, remover_muletas }, roteiro_id?, roteiro_texto? }` → `201 { id, prefixo_blob: 'videos/<id>/', ... }`.
2. **Enviar o arquivo** direto ao Blob, com `upload()` de `@vercel/blob/client`:
   ```js
   import { upload } from 'https://cdn.jsdelivr.net/npm/@vercel/blob@2.8.2/dist/client.browser.js'; // ou bundle em static/vendor/
   const blob = await upload(`videos/${id}/bruto.mp4`, arquivo, {
     access: 'public', multipart: true, contentType: arquivo.type || 'video/mp4',
     handleUploadUrl: '/api/videos/blob',
     clientPayload: JSON.stringify({ id, papel: 'origem' }),
     headers: { Authorization: `Bearer ${tokenDoApp}` },      // a rota /blob confere a sessão antes de gerar o token
     onUploadProgress: ({ percentage }) => barra(percentage),
   });
   ```
   O pathname DEVE começar com `videos/<id>/`; tipos aceitos `video/mp4`, `video/quicktime`, `video/webm` (e `image/jpeg` para poster); até 600 MB.
3. **Registrar o envio** (sempre, mesmo que o webhook chegue; é idempotente): `POST /api/videos/:id/enviado` `{ url: blob.url, pathname: blob.pathname, tamanho: arquivo.size, contentType, duracao_s?, largura?, altura? }` → `{ estado: 'na_fila', ... }`.
4. **Listar**: `GET /api/videos` → `{ videos: [{ id, titulo, estado, status, criado_em, atualizado_em, estilo, poster, url, duracao_s, legenda, hashtags, hash, erro, tentativas }] }` (ordem: mais novo primeiro; arquivados não aparecem). Estados: `enviado | na_fila | editando | pronto | erro`.
5. **Abrir um vídeo**: `GET /api/videos/:id` → documento completo (`video`, `motion`, `copia.versoes`, `revisao`, `studio`, `historico`; sem o lease interno). O player usa `motion.url` (ou `video.resultado.url`) e `motion.poster`; "Baixar" é o mesmo `url`.
6. **Aprovar / agendar / publicar**: fluxo existente — `POST /api/studio/:id/decidir { acao: 'aprovar', hash: <hash da versão ativa> }` (o `hash` vem em `GET /api/videos/:id` → `copia.versoes[...]` ativa, ou no `hash` do resumo da lista). Editar a legenda antes: `ContentModel.editarLegenda` + sync, como nos carrosséis.
7. **Refazer com outro estilo**: `POST /api/videos/:id/refazer { estilo?, opcoes? }` → volta a `na_fila` (recusa `409` se o editor estiver trabalhando ou se já aprovado).
8. **Apagar**: `DELETE /api/videos/:id` → `{ arquivado: true, blobs_apagados: n }`.
9. Push: o módulo envia `push.notificar({ url: '/?tab=videos' })` quando o vídeo fica pronto; o service worker precisa abrir essa aba.

## 5. O que o worker (`tools/reels/worker.js`) chama
Cabeçalho `Authorization: Bearer <CRON_SECRET>` em todas.
- `GET /api/videos/worker/proximo` → `200 { id, origem: { url, pathname, ... }, estilo, opcoes, roteiro_texto, tentativa, lease_ate }` ou `204` (fila vazia). O job fica `editando` com lease de 30 min; se o worker não responder, volta à fila (máx. 2 tentativas; depois `erro`).
- `POST /api/videos/worker/token { id, pathname: 'videos/<id>/final.mp4', contentType }` → `{ clientToken }` (1 h, só esse pathname, sufixo aleatório). Repetir para `poster.jpg`. Depois `put(pathname, stream, { access: 'public', token: clientToken, contentType })` do `@vercel/blob/client`.
- `POST /api/videos/worker/resultado { id, resultado: { url, pathname, poster_url, duracao_s, tamanho, cortes, palavras, avisos? }, transcricao: { texto, frases: [{ t0, t1, texto }] }, log?: [], run_url? }` → gera a legenda, monta versão/motion, `pronto`, push.
- `POST /api/videos/worker/erro { id, erro, log?, run_url? }` → `na_fila` (1ª falha) ou `erro`.

## 6. Observações para o integrador
- O webhook do Blob (`blob.upload-completed`) chega SEM cabeçalho de acesso do app e SEM `CRON_SECRET`: a assinatura é conferida pela biblioteca (`x-vercel-signature`), mas o `exigeAcesso` global devolve 401 antes de chegar à rota quando o app está protegido. Por isso o navegador sempre chama `POST /:id/enviado`. Se quiserem o webhook funcionando em produção, `/api/videos/blob` precisa entrar em `ROTAS_LIVRES` (a rota em si já recusa qualquer pedido de token sem sessão/CRON_SECRET) — decisão deixada para quem cuida do `access.js`.
- `c.origem` é `{ tipo: 'video' }` (o modelo trata `origem` como objeto em todo lugar); a aba Vídeos pode filtrar por `id.startsWith('vd_')` ou `origem?.tipo === 'video'`.
- A "arte" de um vídeo é o próprio vídeo no Blob: o módulo grava um registro em `c.arte.renders` (sem `blob_key`, com `poster_url`) só para o portão `arte_pendente` não travar a aprovação. Telas que desenham prévias por `blob_key` devem usar `motion.poster` quando `blob_key` for `null`.
- Fluxo local (sem Vercel): tudo funciona com `BLOB_READ_WRITE_TOKEN` de um store de desenvolvimento; sem o token, 503 claro.
