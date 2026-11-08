# Aba Vídeos e Teleprompter: o que o integrador precisa ligar

Entregues pelo módulo de front: `static/videos.js`, `static/teleprompter.js`, `static/videos.css`,
`tests/e2e/videosTest.js`. Nenhum arquivo compartilhado foi editado. Abaixo, as linhas exatas para
`static/index.html`, `static/mesa.js`, `static/sw.js` e `tests/e2e/executar.js`.

Contrato seguido: `docs/VIDEOS_E_RECICLAGEM_SPEC.md` (seções "Modelo de dados do vídeo", "Rotas de vídeo",
"Teleprompter" e "Integração final").

## 1. `static/index.html`

CSS (depois de `radar.css`, para herdar os tokens `--pd-*` de `marca.css`):

```html
<link rel="stylesheet" href="./videos.css">
```

Scripts (depois de `radar.js`; antes de `mobileStudio.js`, que precisa existir só para o fluxo de aprovação):

```html
<script src="./videos.js"></script>
<script src="./teleprompter.js"></script>
```

Observação: `videos.js` carrega `@vercel/blob/client` por `import()` dinâmico do CDN
(`https://cdn.jsdelivr.net/npm/@vercel/blob@2.8.2/+esm`) só na hora do envio. Se o app tiver uma
Content-Security-Policy, libere `script-src https://cdn.jsdelivr.net` e `connect-src https://*.blob.vercel-storage.com`
(mais o domínio do Blob para `media-src`/`img-src`, para o player e o poster).

## 2. `static/mesa.js`

### Ícone (objeto `ICON`, ao lado de `radar`)

```js
videos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="M16 10l5-3v10l-5-3"/><path d="M8 10l4 2-4 2z" fill="currentColor" stroke="none"/></svg>',
```

### Aba no menu (array `tabs` dentro de `render()`)

Com rótulo **"Vídeos"**, entre `radar` e `criar` nas duas listas:

```js
const tabs = window.StudioMobile
  ? [['central', 'Aprovar'], ['mesa', 'Criar'], ['radar', 'Radar'], ['videos', 'Vídeos'], ['criar', 'Ferramentas'], ['resultados', 'Resultados'], ['ajustes', 'Perfil']]
  : [['mesa', 'Mesa'], ['central', 'Central'], ['radar', 'Radar'], ['videos', 'Vídeos'], ['criar', 'Criar'], ['resultados', 'Resultados'], ['ajustes', 'Ajustes']];
```

Contador na aba (opcional, igual ao do Radar), na linha que monta `<nav class="es-nav">`:

```js
const nVideos = window.Videos ? window.Videos.badge() : 0;
// ...dentro do map das abas:
${id === 'videos' && nVideos ? `<i class="es-badge" aria-label="${nVideos} vídeo(s) para aprovar">${nVideos}</i>` : ''}
```

### Render (bloco `if (state.tab === ...)` em `render()`)

```js
else if (state.tab === 'videos') corpo = window.Videos ? window.Videos.render(ctxEditor()) : '';
```

### Ações (no `root.addEventListener('click', ...)`, junto dos outros módulos)

```js
if (window.Videos?.acao && await window.Videos.acao(a, el, ctxEditor())) return;
```

### Carregar ao abrir a aba (no `case 'tab':`)

```js
if (state.tab === 'videos') window.Videos?.carregar(ctxEditor(), true);
```

O módulo também se carrega sozinho na primeira renderização e se atualiza a cada 10 s enquanto houver vídeo
em fila ou em edição (só com a aba aberta e a página visível).

## 3. `static/sw.js`

A push do worker chega com `url: '/?tab=videos'`. No `notificationclick`, troque a linha do `postMessage`
por uma que reconheça `radar`, `videos` e `reciclagem`:

```js
const aba = (String(alvo).match(/tab=(radar|videos|reciclagem)/) || [])[1];
c.postMessage(aba ? { tipo: 'abrir-aba', aba } : { tipo: 'abrir-central' });
```

`videos.js` já escuta `{ tipo: 'abrir-aba', aba: 'videos' }` e também abre a aba quando a página carrega com
`?tab=videos`.

## 4. Reciclagem → Teleprompter

Quando `POST /api/reciclagem/:id/reciclar { formato: 'reel' }` devolver `{ id, roteiro }`:

```js
window.Videos.abrirComRoteiro({ roteiro, roteiro_id: id, titulo }, ctx);
// ou direto: window.Teleprompter.abrir({ roteiro, roteiro_id: id, titulo, ctx });
```

Ao enviar, o teleprompter chama `window.Videos.enviarArquivo(blob, { nome, titulo, roteiro_id, roteiro_texto, estilo, onProgress }, ctx)`,
que faz `POST /api/videos` → `upload()` → `POST /api/videos/:id/enviado`.

## 5. `tests/e2e/executar.js`

Adicione `'videosTest'` à `suite` padrão e ao `Set` `permitidos`, e inclua-o na lista de suítes com
`TESTE_MEMORIA` (a lista `banco`). O teste roda sozinho também: `node tests/e2e/videosTest.js` sobe o
servidor de teste se `BASE` não estiver definido. A API `/api/videos*` e `/api/studio/:id/decidir` são
simuladas com `page.route`, e o `upload()` do Blob é um dublê (`window.__vercelBlobUpload`).

## 6. Contrato que o front espera do backend

- `GET /api/videos` → array (ou `{ videos: [...] }`) com, por item: `id, titulo, estado, criado_em, estilo, poster, url, duracao,
  legenda` (string ou `{ texto, hashtags }`), `hash` (hash da versão ativa; se faltar, o front busca `GET /api/videos/:id` e usa
  `motion.hash`), `status`, `agenda`, `studio`, `publicacao`, `erro`. Itens com `status: 'arquivado'` são escondidos.
- `503` em qualquer rota de vídeo = "armazenamento não ligado": o front mostra o aviso com a variável `BLOB_READ_WRITE_TOKEN`.
- Decisões: `POST /api/studio/:id/decidir` com `{ acao: 'aprovar', hash, agora: true }` (publicar agora),
  `{ acao: 'aprovar', hash, agora: false }` (agendar na grade do piloto) e `{ acao: 'descartar', hash, motivos: [], detalhe: '' }`.
  Códigos `PAUSADO` e `ACESSO_ABERTO` viram mensagens específicas.
- `POST /api/videos/:id/refazer { estilo, opcoes }` e `DELETE /api/videos/:id`.
