# Ferramenta em 3 frentes: Carrosséis, Posts estáticos e Vídeos (+ Reciclagem)

Contrato técnico entre os módulos. Quem implementa uma parte segue este arquivo; mudanças no contrato são anotadas aqui.

## Princípios (não negociáveis)
- Nada é publicado no Instagram sem aprovação do Pedro no app (rota existente `POST /api/studio/:id/decidir`).
- Credenciais só no servidor (variáveis de ambiente). O token de leitura/escrita do Blob (`BLOB_READ_WRITE_TOKEN`) nunca sai do servidor: navegador e worker recebem **client tokens** curtos.
- Custo zero: Vercel Hobby, Vercel Blob (plano grátis), GitHub Actions (repositório público: 4 vCPU), IAs gratuitas (Groq/Gemini via `backend/lib/llmJson`), Pexels (fotos e vídeos, mesma chave `PEXELS_API_KEY`), faster-whisper/ffmpeg/OpenCV.
- Reciclagem nunca copia texto nem traduz post de terceiros: extrai TESE + MECANISMO e escreve do zero na voz do Pedro, passando pelos mesmos filtros (fatos, anti-IA, mentes, painel). A fonte fica registrada.
- Linguagem do Pedro: direita assumida, liberdade econômica, crítica dura ao PT e ao governo; fatos com fonte; sem ataque pessoal a quem não é figura pública; respeitar regras eleitorais.
- Código e comentários em português; testes `node --test`; sem segredo em arquivo versionado.

## Onde cada coisa fica
| Área | Backend | Front | Worker |
|---|---|---|---|
| Vídeos | `backend/lib/videos/*`, `backend/routes/videos.js` (montado em `/api/videos`) | `static/videos.js`, `static/videos.css`, `static/teleprompter.js` | `tools/reels/*.py`, `tools/reels/worker.js`, `.github/workflows/video-worker.yml` |
| Reciclagem | `backend/lib/reciclagem/*`, `backend/routes/reciclagem.js` (`/api/reciclagem`) | `static/reciclagem.js`, `static/reciclagem.css` | cron GitHub (`.github/workflows/reciclagem.yml`) + rota |
| Posts estáticos / ensaio | `backend/lib/top/*` (formato `estatico`, variante `ensaio`), `backend/lib/arteTweet.js` | `static/mobileStudio.js` (filtro por formato) | — |
| Integração (abas, index.html, server.js, mesa.js, marca.css) | **só o integrador** | | |

Arquivos compartilhados que **não** devem ser editados pelos módulos: `backend/server.js`, `static/mesa.js`, `static/index.html`, `static/marca.css`, `static/mobileStudio.js` (exceto Fase 4), `vercel.json`. Cada módulo entrega uma lista "para integrar" (linhas de `app.use`, `<script>`, aba, ícone).

## Modelo de dados do vídeo
Um vídeo é um conteúdo normal do app (`static/contentModel.js` → `novoConteudo`) com `formato: 'reels'`, `origem: 'video'` e o campo `video`:
```js
c.video = {
  estado: 'enviado' | 'na_fila' | 'editando' | 'pronto' | 'erro',
  origem: { url, pathname, tamanho, duracao_s, largura, altura, enviado_em },   // Blob do arquivo bruto
  estilo: 'hormozi' | 'beast' | 'caixa',          // preset de legenda (padrão 'hormozi')
  opcoes: { broll: true, musica: false, punch_in: true, remover_pausas: true, remover_muletas: true },
  roteiro_id: null | 'c_xxx',                       // se veio da reciclagem/teleprompter
  roteiro_texto: '',                                 // texto que o Pedro leu (ajuda o Whisper: initial_prompt)
  resultado: { url, pathname, poster_url, duracao_s, tamanho, cortes: n, palavras: n, editado_em } | null,
  transcricao: { texto, frases: [{t0,t1,texto}] } | null,   // tempos JÁ remapeados para o vídeo final
  legenda_ig: { texto, hashtags: [] } | null,       // gerada pela IA a partir da transcrição
  worker: { tentativas, iniciado_em, concluido_em, run_url, erro } ,
  log: [{ em, msg }]
}
```
Quando `estado === 'pronto'`, o módulo também preenche o que o publicador exige para REELS (`backend/lib/publicador.js`):
- `c.copia.versoes` com UMA versão `{ id, slides: [{ id:'s1', layout:'reel', funcao:'reel', texto: legenda_ig.texto }], legenda: legenda_ig.texto, hashtags, hash }` (usar `M.criarVersao` ou o helper de `backend/lib/studio.js`), `c.copia.versao_ativa` apontando para ela;
- `c.motion = { engine: 'blob', estado: 'pronto', hash: v.hash, url: resultado.url, poster: resultado.poster_url, sandbox: false }`;
- `c.status = 'em_revisao'`; `c.studio = { estado: 'pronto' }`; push para o Pedro (`push.notificar({ corpo, url: '/?tab=videos' })`).
Aprovar/agendar/publicar usa o fluxo existente (`/api/studio/:id/decidir`, `Piloto.agendar`, `publicador`), que já manda `media_type: 'REELS'` com `video_url = c.motion.url` (URL pública do Blob).

## Rotas de vídeo (`/api/videos`)
Autenticação: as rotas do app passam pelo acesso normal (`access.exigeAcesso`). As rotas `/api/videos/worker/*` aceitam **também** `Authorization: Bearer <CRON_SECRET>` (registrar em `ROTAS_CRON` de `backend/lib/access.js`).

| Rota | Função |
|---|---|
| `POST /api/videos/blob` | `handleUpload` do `@vercel/blob/client`. `onBeforeGenerateToken`: exige sessão do app **ou** CRON_SECRET; `allowedContentTypes: ['video/mp4','video/quicktime','video/webm','image/jpeg']`; `maximumSizeInBytes: 600 MB`; `addRandomSuffix: true`; pathname deve começar com `videos/<id>/`. `onUploadCompleted`: marca `origem`/`resultado` no documento conforme o `clientPayload` (`{ id, papel: 'origem' | 'resultado' | 'poster' }`). Se o webhook não chegar (ex.: local), a rota `POST /api/videos/:id/enviado` faz o mesmo registro a partir do navegador. |
| `POST /api/videos` | cria o conteúdo (`{ titulo?, estilo?, opcoes?, roteiro_id?, roteiro_texto? }`) → `{ id }` |
| `POST /api/videos/:id/enviado` | `{ url, pathname, tamanho, contentType }` → `estado: 'na_fila'`; dispara `tools/reels` se houver `GITHUB_DISPATCH_TOKEN` (opcional; senão o cron pega em até 5 min) |
| `GET /api/videos` | lista (resumo: id, titulo, estado, criado_em, poster, duracao, legenda) |
| `GET /api/videos/:id` | documento completo (sem campos internos) |
| `POST /api/videos/:id/refazer` | `{ estilo?, opcoes? }` → volta para `na_fila` |
| `DELETE /api/videos/:id` | arquiva e apaga os blobs (`del` com o token do servidor) |
| `GET /api/videos/worker/proximo` | (CRON) pega o job mais antigo em `na_fila`, marca `editando` com lease de 30 min, devolve `{ id, origem, estilo, opcoes, roteiro_texto }` ou `204` |
| `POST /api/videos/worker/token` | (CRON) `{ id, pathname, contentType }` → `{ clientToken }` (`generateClientTokenFromReadWriteToken`), válido 1 h, só para `videos/<id>/` |
| `POST /api/videos/worker/resultado` | (CRON) `{ id, resultado, transcricao, log }` → gera `legenda_ig` com a IA (`llmJson`), monta versão/motion, `estado: 'pronto'`, push |
| `POST /api/videos/worker/erro` | (CRON) `{ id, erro, log }` → `estado: 'erro'` (ou volta a `na_fila` se `tentativas < 2`) |

## Worker de edição (`tools/reels`, GitHub Actions)
- `video-worker.yml`: `schedule: */5 * * * *` + `workflow_dispatch` + `repository_dispatch` (`types: [video]`); `concurrency: video-worker`; `timeout-minutes: 30`; `actions/cache` para o modelo do Whisper (`~/.cache/huggingface`) e pip; `apt-get install ffmpeg` (já vem com libass); fontes em `backend/assets` (Anton, Inter, Montserrat/Poppins).
- `tools/reels/worker.js` (Node 20, sem dependências além de `@vercel/blob`): `GET proximo` → baixa origem → roda `python3 tools/reels/editar.py entrada.mp4 saida/ --estilo … --roteiro roteiro.txt --opcoes json` → envia `saida/final.mp4` e `saida/poster.jpg` com `put(pathname, stream, { access:'public', token: clientToken })` (o client token vem de `worker/token`) → `POST resultado` com `saida/resultado.json`. Em erro → `POST erro`. Repete enquanto houver job (máx. 3 por execução).
- `tools/reels/editar.py` (pipeline; cada etapa em função testável):
  1. `ffprobe` + normalizar rotação (iOS grava deitado com flag) → `-vf transpose` se preciso; áudio WAV 16 kHz mono com `highpass=f=80,afftdn=nf=-25`.
  2. **Transcrição** faster-whisper `small` int8 (`medium` se duração ≤ 90 s), `language='pt'`, `word_timestamps=True`, `vad_filter=True`, `initial_prompt` = roteiro (até 200 palavras) + "É… tipo, né? Hã, então, assim…".
  3. **Cortes**: silêncios (`silencedetect noise=-35dB:d=0.35`, margem 0,15 s) ∪ muletas isoladas por pausa ≥150 ms ({é, éé, hã, ã, hum, ahn, né}) ∪ palavras repetidas consecutivas ∪ **retomadas**: quando o Pedro erra e repete a frase (sequência de ≥3 palavras que reaparece em até 6 s), fica a ÚLTIMA. Lista `[(a,b)]` de trechos mantidos; nunca cortar o 1º segundo.
  4. **Enquadramento 9:16**: se a fonte for horizontal, detectar rosto a 3 fps (OpenCV Haar `haarcascade_frontalface_default`, que vem no pacote), EMA 0,85 + zona morta 3% + limite de passo; crop por trecho (fixo entre jump cuts). Fonte vertical: `scale`+`crop` central para 1080x1920.
  5. **Punch-in** estático alternado por frase (1,0× / 1,12×) quando `opcoes.punch_in`.
  6. **B-roll** (`opcoes.broll`): 1 clipe Pexels Videos (portrait, ≥1080) a cada ~18 s de fala, 2,5–3,5 s, por palavra-chave (substantivo do trecho, traduzida para EN por lista simples), nunca nos 3 primeiros segundos; `overlay` com fade 150 ms. Sem `PEXELS_API_KEY`, pula.
  7. **Legendas ASS** (palavras remapeadas para o tempo final): preset `hormozi` (Montserrat/Poppins ExtraBold caixa-alta 96 px, branco, palavra ativa amarela #FDE047 escala 110%, sombra, 3–4 palavras), `beast` (Anton 100 px amarelo #FFD700 contorno preto grosso, 1–3 palavras), `caixa` (Inter Bold 84 px branco sobre caixa preta 65% `BorderStyle=3`, 4–6 palavras). Alinhamento 2, `MarginV≈560` (fora da UI do Reels). Fonte via `fontsdir`.
  8. **Render** único: `select/aselect` dos trechos → crop → punch-in → overlay b-roll → `ass` → `libx264 -preset veryfast -crf 20 -r 30 -pix_fmt yuv420p`, áudio `aac 160k`; `afade` de 10 ms nas emendas.
  9. **Áudio**: `loudnorm` 2 passos para −14 LUFS; música (`opcoes.musica`) só com faixa CC0 commitada em `tools/reels/musica/` (nenhuma por enquanto → opção desligada).
  10. `poster.jpg` (frame a 1 s, 1080x1920) e `resultado.json` `{ duracao_s, cortes, palavras, transcricao: {texto, frases}, estilo, avisos: [] }`.
- Teste local: `python3 tools/reels/editar.py` num vídeo sintético (ffmpeg testsrc + fala gTTS) e, se houver, num vídeo real; `node --test tools/reels/*.test.js` para as funções puras (remapeamento de tempos, detecção de retomada, ASS).

## Teleprompter (`static/teleprompter.js`)
Tela cheia no celular: câmera frontal (`getUserMedia`, `ideal` 1920×1080, áudio sem processamento), preview espelhado (o arquivo não), roteiro rolando por cima (velocidade ajustável 20–80 px/s, tamanho da letra, pausa ao tocar), contador, Wake Lock. `MediaRecorder` com `video/mp4;codecs=avc1` → fallback `video/webm;codecs=vp9`, chunks de 1 s. Ao parar: botão "Enviar para edição" → `POST /api/videos` → `upload()` do `@vercel/blob/client` (CDN: `https://cdn.jsdelivr.net/npm/@vercel/blob@<versão>/dist/client.browser.js`, ou bundle próprio em `static/vendor/`) com `handleUploadUrl: '/api/videos/blob'`, `multipart: true`, barra de progresso → `POST /api/videos/:id/enviado`. Também aceita **anexar** um arquivo da galeria (`<input type=file accept=video/*>`). Abre pela aba Vídeos ("Gravar com roteiro") e pela Reciclagem (roteiro preenchido).

## Reciclagem (`/api/reciclagem`)
- `backend/lib/reciclagem/contas.js`: lista curada (≈40 handles de Instagram e ≈20 canais de YouTube, de `docs/referencias-copy/…` / pesquisa de 07/11/2026), com país e idioma; editável pelo Pedro (config `reciclagem_contas`).
- Coleta (`coletar.js`, cron diário via GitHub + `POST /api/reciclagem/coletar` com CRON): Graph `business_discovery` (`like_count, comments_count, view_count, caption, permalink, media_type, timestamp`; 1 página por conta; respeitar 200 chamadas/hora); YouTube Data API v3 (`channels.list` + `videos.list` dos uploads recentes) **só se** `YOUTUBE_API_KEY` existir; Google Trends RSS `trends.google.com/trending/rss?geo=BR` (assuntos do dia); Hacker News opcional. Guarda em `armazem().radar`-like (tipo `reciclagem_item`), com `vl` (índice de viralidade = ER do post ÷ mediana da conta; ER = (curtidas + 3×comentários) ÷ seguidores; só posts com ≥72 h), `tema` (3–6 palavras, pela IA), `mecanismo` (identidade | nostalgia | história | lista de erros | número | confissão | polêmica | pergunta), `tese` (1 frase, na voz neutra), `fonte` (handle, permalink, data, métricas). Dedupe por permalink; mantém 30 dias.
- `GET /api/reciclagem?dias=7&min_vl=3` → itens ordenados por VL com filtro por mecanismo/idioma; `GET /api/reciclagem/tendencias` (Trends RSS do dia cruzado com os temas).
- `POST /api/reciclagem/:id/reciclar { formato: 'carrossel' | 'estatico' | 'reel' }`:
  - carrossel/estatico → cria conteúdo top via `T.criar({ texto: <tese+contexto+fatos que a IA precisa checar>, titulo, origem: 'reciclagem', formato })` e registra `c.top.reciclado_de = fonte`; passa por todo o pipeline (fatos exigem fonte: o prompt pede à IA buscar **fatos brasileiros** com `descoberta`/fontes; se não houver fato verificável, o conteúdo sai como OPINIÃO marcada, sem número).
  - reel → gera roteiro falado de 45–75 s na voz do Pedro (gancho nos 2 primeiros segundos, 1 ideia, fechamento com pedido de envio) via `llmJson` com as mentes e o anti-IA; salva como conteúdo `formato:'reels'`, `video.estado:'roteiro'`, e devolve `{ id, roteiro }` para abrir o teleprompter.
- Notificação: após a coleta, push "Reciclagem: 5 teses em alta hoje" (`url: '/?tab=reciclagem'`), no máximo 1 por dia.

## Posts estáticos e variante ensaio (Fase 4)
- `formato: 'estatico'` no pipeline top: 1 slide (ou 2) com headline magnética + legenda LONGA (600–1.500 caracteres, 4–7 parágrafos curtos, na voz do Pedro, com fatos e a leitura dele); publicado como `IMAGE` (ou carrossel de 2). Arte: capa do formato tweet (headline + foto de pessoa) ou tipográfica.
- Variante `ensaio` do formato tweet: fundo escuro (#0B0B0C), texto branco Inter 56–64 px, 2–3 parágrafos por slide, 5–7 slides, sem foto, último slide com a frase de ouro em destaque. Mesmos filtros. Selecionável em `formato_padrao` do piloto (`'ensaio'`) e no "Reciclar".

## Integração final (Fase 5)
Abas: **Aprovar** (central, como hoje), **Carrosséis**, **Posts**, **Vídeos**, **Reciclar**, **Perfil**. Carrosséis/Posts filtram por `formato`; Vídeos lista `origem:'video'` com player, legenda, "Baixar", "Aprovar e publicar/agendar", "Refazer com outro estilo", "Gravar com roteiro". Push do service worker (`static/sw.js`) passa a abrir `tab=videos` e `tab=reciclagem`. Revisão visual com screenshots Playwright (celular 390×844 e desktop) antes de entregar.

## Variáveis de ambiente novas
`BLOB_READ_WRITE_TOKEN` (criado ao ligar o Blob ao projeto na Vercel), `YOUTUBE_API_KEY` (opcional), `GITHUB_DISPATCH_TOKEN` (opcional; sem ele o cron de 5 min pega os jobs). GitHub Secrets: `CRON_SECRET` (já existe), `PEXELS_API_KEY` (para o b-roll no worker).
