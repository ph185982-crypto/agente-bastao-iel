# Radar de Reciclagem: o que o integrador precisa ligar

Módulo entregue em `backend/lib/reciclagem/*`, `backend/routes/reciclagem.js`, `static/reciclagem.js`, `static/reciclagem.css` e `.github/workflows/reciclagem.yml`. Ele não edita `server.js`, `mesa.js`, `index.html`, `marca.css`, `mobileStudio.js` nem `sw.js`: as linhas abaixo são para quem integra (Fase 5 da spec `docs/VIDEOS_E_RECICLAGEM_SPEC.md`).

## 1. `backend/server.js`
Junto das outras rotas protegidas (depois de `app.use('/api/radar', …)`):
```js
app.use('/api/reciclagem', require('./routes/reciclagem'));
```
`backend/lib/access.js` já tem `/^\/api\/reciclagem\/coletar$/` em `ROTAS_CRON` (único arquivo compartilhado tocado; só a adição).

## 2. `static/index.html`
```html
<link rel="stylesheet" href="./reciclagem.css">
…
<script src="./reciclagem.js"></script>   <!-- depois de mesa.js e radar.js; antes de recortes.js é indiferente -->
```

## 3. `static/mesa.js`
Aba `reciclagem`, rótulo **Reciclar**, no mesmo lugar das outras:
```js
// tabs (as duas listas, celular e desktop): acrescente
['reciclagem', 'Reciclar'],
// render():
else if (state.tab === 'reciclagem') corpo = window.Reciclagem ? window.Reciclagem.render(ctxEditor()) : '';
// dispatcher de ações (junto de RadarUI/Recortes):
if (window.Reciclagem?.acao && await window.Reciclagem.acao(a, el, ctxEditor())) return;
// case 'tab':
if (state.tab === 'reciclagem') window.Reciclagem?.carregar(ctxEditor(), { forcar: true });
// badge (opcional, como o do Radar): teses em alta ainda não recicladas
const nRec = window.Reciclagem ? window.Reciclagem.badge() : 0;
```
Ícone no padrão do objeto `ICON` (traço 2, 24×24, `currentColor`), setas em círculo = reciclar:
```js
reciclagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-13.7 5.6"/><path d="M4 12a8 8 0 0 1 13.7-5.6"/><path d="M17.7 2.5v3.9h-3.9"/><path d="M6.3 21.5v-3.9h3.9"/></svg>',
```
Prefixo das ações: `rc2-` (`rc-` já é dos Recortes). O módulo expõe `window.Reciclagem = { render(ctx), acao(a, el, ctx), carregar(ctx, forcar), badge() }`.

## 4. `static/sw.js`
A notificação da coleta abre `/?tab=reciclagem`. No clique, além de `tab=radar`:
```js
c.postMessage(String(alvo).includes('tab=reciclagem') ? { tipo: 'abrir-aba', aba: 'reciclagem' } : String(alvo).includes('tab=radar') ? { tipo: 'abrir-aba', aba: 'radar' } : { tipo: 'abrir-central' });
```
`static/reciclagem.js` já escuta `{ tipo: 'abrir-aba', aba: 'reciclagem' }` e o parâmetro `?tab=reciclagem`.

## 5. `package.json`
O glob de testes não cobre a pasta nova. Acrescente ao script `test`:
```
backend/lib/reciclagem/*.test.js
```

## 6. Variáveis de ambiente
| Variável | Obrigatória? | Para quê |
|---|---|---|
| `META_PAGE_ACCESS_TOKEN`, `META_IG_USER_ID` | já existem | `business_discovery` das contas de Instagram (1 chamada por conta, até 40 por coleta) |
| `YOUTUBE_API_KEY` | **opcional** | sem ela o YouTube é pulado (aviso no resumo). Com ela: `channels.list` + `playlistItems` + `videos.list`, teto de 300 unidades por dia |
| `CRON_SECRET` | já existe | `POST /api/reciclagem/coletar` pelo GitHub Actions (`reciclagem.yml`, 09:00 de Brasília = `0 12 * * *` UTC) |
| `VAPID_*` | já existem | push "Reciclagem: N teses em alta hoje" (1× por dia, `url: '/?tab=reciclagem'`) |
| chave de IA (Groq/Gemini via `llmJson`) | já existe | classificação em lote (até 15 itens por chamada, 3 lotes por coleta) e roteiro de reel |

GitHub: variável `MONITOR_URL` e secret `CRON_SECRET` (os mesmos do Radar).

## 7. Rotas
| Rota | O quê |
|---|---|
| `GET /api/reciclagem?dias=7&min_vl=3&mecanismo=&idioma=&rede=` | itens ordenados por VL (sem a legenda de terceiro) + `estado` |
| `GET /api/reciclagem/tendencias` | Google Trends RSS (BR) da última coleta, cruzado com os temas |
| `POST /api/reciclagem/coletar` (também `GET`) | coleta; aceita `CRON_SECRET` ou sessão do app; limite 3 a cada 10 min |
| `GET /api/reciclagem/contas` · `PUT /api/reciclagem/contas` | lista curada + config editável `reciclagem_contas` (`{ instagram: { adicionar, remover }, youtube: { adicionar, remover } }`) |
| `GET /api/reciclagem/:id` | um item |
| `POST /api/reciclagem/:id/reciclar { formato: 'carrossel' \| 'estatico' \| 'reel' }` | carrossel/estatico → `T.criar({ origem: 'reciclagem' })` com `c.top.reciclado_de`; o app conduz `POST /api/top/carrosseis/:id/passo`. reel → `{ id, roteiro, duracao_estimada_s }` e conteúdo `formato: 'reels'`, `video.estado: 'roteiro'` |

## 8. Armazenamento
Tabela `pico_radar` (já existe), tipos `reciclagem` (um documento por post, id `rc_<sha1 do permalink>`) e `reciclagem_estado` (última coleta, tendências, rodízio de contas, dia do push). Retenção de 30 dias pela data do post. A legenda original fica guardada SÓ até a classificação e é apagada depois; a API nunca a devolve.

## 9. Teleprompter (módulo de Vídeos)
O botão "Gravar agora" do roteiro chama `window.Teleprompter.abrir({ roteiro, roteiro_id, titulo, ctx })` se existir; sem ele, copia o roteiro. `roteiro_id` é o id do conteúdo `formato: 'reels'` já salvo com `video.roteiro_texto`.

## 10. Observações para quem integra
- `formato: 'estatico'` é repassado a `T.criar`; o pipeline atual só reconhece `tweet`/`reportagem` e guarda o pedido em `c.top.reciclagem_formato` até a Fase 4 aceitar `estatico`.
- O briefing de reciclagem não traz números: o pipeline "top" extrai fatos só do texto recebido, então o carrossel sai como opinião marcada a menos que a etapa de fatos encontre algo verificável. Se a pauta cair em "PAUTA_FRACA", é a régua normal do pipeline agindo.
