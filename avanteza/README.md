# Avanteza — gestão autônoma de contas de marketplace

Painel da consultoria para monitorar, alertar, propor e executar ações nas contas de Mercado Livre
dos clientes (Shopee na Fase 3). Next.js (App Router) + TypeScript na Vercel, Postgres no Neon.

- Produção: https://app.avanteza.com.br (também https://avanteza.vercel.app)
- Projeto Vercel: `avanteza` (diretório `avanteza/` deste repositório)
- Banco: **Neon** (Postgres, plano gratuito, São Paulo) via integração da Vercel — schema `avanteza` (`db/schema.sql`).
- Agendador: Vercel Cron (`vercel.json`).
- Login: sessão própria (cookie HttpOnly assinado com `SESSION_SECRET`, senha bcrypt, limite de tentativas).

## Arquitetura

```
src/lib/marketplaces/types.ts            MarketplaceAdapter (interface comum)
src/lib/marketplaces/mercadolivre/       MercadoLivreAdapter (OAuth, leitura, escrita, webhooks)
src/lib/accounts.ts                      tokens criptografados, renovação antecipada com trava
src/lib/crypto.ts                        AES-256-GCM (ENCRYPTION_KEY)
src/lib/db/                              acesso ao Postgres (consultas parametrizadas)
src/lib/session.ts, login.ts             sessão do admin e login
src/lib/http.ts                          retry + backoff (429/5xx, Retry-After)
src/lib/collector.ts                     coleta por conta, snapshots diários
src/lib/webhooks.ts                      fila de notificações
src/lib/alerts/                          regras (puras), motor, canais (e-mail; WhatsApp plugável)
src/lib/executor/                        políticas, limites, dry-run, pausa geral, auditoria
src/app/api/auth/mercadolivre/callback   callback OAuth (state anti-CSRF, uso único)
src/app/api/webhooks/mercadolivre        notificações (grava na fila e responde 200)
src/app/api/cron/[job]                   tick | collect | alerts | webhooks | execute | refresh-tokens | daily
supabase/migrations/                     0001 schema + RLS, 0002 pg_cron
```

### Rotinas
As rotinas rodam na **Vercel Cron** (plano Pro), com `Authorization: Bearer <CRON_SECRET>` (horários agrupados para o Neon dormir entre as rodadas: 100 h de computação/mês no plano grátis). O Supabase não é mais usado., que chama as rotas com `Authorization: Bearer <CRON_SECRET>`
(segredo guardado no Vault, nome `avanteza_cron_secret`):

| Rotina | Frequência | O que faz |
|---|---|---|
| `tick` | a cada 20 min | renova tokens que vencem em < 1 h, processa webhooks, executa aprovadas |
| `collect` | a cada 40 min | coleta 1 conta por vez (a mais desatualizada), até 45 s por chamada |
| `alerts` | de hora em hora | avalia regras, abre/resolve alertas, envia e-mail |
| `ai-daily` | 7h–8h (Brasília) | agente de IA + relatório diário, um cliente por vez |
| `daily` | 1×/dia (Vercel Cron) | fallback: tokens + coleta + alertas + IA |

### Mercado Livre
- Refresh token é de **uso único**: cada renovação salva o novo token; trava otimista evita corrida.
- Access token vale 6 h; renovamos quando falta menos de 1 h.
- Pontos marcados `VERIFICAR` no adapter (escrita de campanhas de Ads e promoções) precisam ser
  validados em modo simulação antes do uso real.

### Executor
proposta → aprovada → executada / simulada / falhou (ou rejeitada / bloqueada).
Modos por tipo de ação (global e por cliente): automático, pedir aprovação (padrão), bloqueado.
Limites diários de variação de preço/verba, simulação global e por ação, pausa geral e log de
auditoria com antes/depois.

### Fase 2 — agente de IA e relatório diário
`src/lib/ai/`: provedor configurável (`AI_PROVIDER`, hoje Anthropic via SDK oficial, saída
estruturada validada com zod e fallback em caso de recusa). Todo dia o agente lê snapshots,
anúncios, perguntas, campanhas, alertas e ações recentes de cada cliente e devolve resumo,
diagnóstico e ações. As ações passam por travas (IDs precisam existir nos dados, sem duplicatas,
nada bloqueado) e entram na fila do executor com justificativa (`source = ia`). O relatório diário
(números calculados pelo sistema + leitura da IA) fica em **Relatórios**, pronto para copiar ou
enviar no WhatsApp. Sem `ANTHROPIC_API_KEY`, o relatório sai só com números.

### Fase 3 — autonomia, Shopee e TikTok Shop
- Tipos de ação em modo **automático** executam sozinhos dentro dos limites diários, respeitando
  a pausa geral, a simulação e um teto de ações automáticas por cliente/dia (acima dele, volta a
  pedir aprovação). Regras podem propor ações (ex.: ROAS abaixo da meta → corte de verba).
  O painel mostra o que foi feito automaticamente nas últimas 24 h, e o relatório também.
- `ShopeeAdapter`: assinatura v2, autorização de loja, tokens (refresh sempre salvo), leitura de
  anúncios e pedidos e escrita de preço/estoque/listagem. Fica ativo quando `SHOPEE_PARTNER_ID` e
  `SHOPEE_PARTNER_KEY` existem. Pontos `VERIFICAR` devem ser validados na documentação oficial.
  Push da Shopee em `/api/webhooks/shopee` (assinatura conferida).
- `TikTokShopAdapter` (`src/lib/marketplaces/tiktok/`): autorização do vendedor (service_id), tokens,
  lojas autorizadas (shop_cipher), produtos, pedidos, preço, estoque, ativar/desativar e webhooks em
  `/api/webhooks/tiktok` (HMAC do app_key + corpo). Caminhos e assinatura conferidos no cliente gerado da
  especificação oficial; a assinatura tem teste com vetor da implementação de referência. Fica ativo com
  `TIKTOK_APP_KEY`, `TIKTOK_APP_SECRET` e `TIKTOK_SERVICE_ID`.

## Variáveis de ambiente
Veja `.env.example`. Segredos (`ML_CLIENT_SECRET`, `ENCRYPTION_KEY`, `RESEND_API_KEY`,
`ANTHROPIC_API_KEY`) são cadastrados só na Vercel. **Nunca troque a `ENCRYPTION_KEY` depois de
conectar contas** (os tokens salvos deixariam de abrir; seria preciso reautorizar).

## Desenvolvimento
```sh
cd avanteza
npm ci
npm test          # testes unitários (criptografia, retry, regras, limites, banco, sessão, variações)
DATABASE_URL=... npm run test:e2e   # ponta a ponta com Mercado Livre simulado (usa o banco real e limpa depois)
DATABASE_URL=... node db/apply.mjs   # cria/atualiza o schema no Postgres
npm run build
```

## Mapa (área do cliente)
Descrição completa em `docs/ARQUITETURA_AVANTEZA.md` (seção “Mapa — área do cliente”).
```sh
# Postgres local descartável (nunca produção)
DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/apply.mjs
DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-clientes.mjs   # lê db/seed-clientes.json; recusa banco remoto
TEST_DATABASE_URL=postgres://postgres@localhost:54329/mapa_test npm test              # testes de isolamento usam o banco de teste (nome com "test")
```
Sem `TEST_DATABASE_URL`, os testes que precisam de banco são ignorados (os demais rodam). URL `localhost` em `DATABASE_URL` usa o driver `pg`
(só desenvolvimento); produção segue na Neon. Acesso do cliente: Clientes → cliente → “Acesso do cliente” (a senha aparece uma vez).

## Dashboards e menu recolhível

Aba inicial `/dashboards` (admin/revisor): comercial e financeiro do Vendedor IA, marketing da Meta Marketing API (somente leitura),
cache de ~15 min. Variáveis: `META_ACCESS_TOKEN`, `AVANTEZA_METRICS_KEY`, `VENDEDORIA_URL` (opcional). Dados simulados só em
desenvolvimento com `DASHBOARDS_FIXTURE=1`. Detalhes em `docs/dashboards.md`.

## Variações (cor/tamanho)
- Mercado Livre: estoque por variação; preço vale para todas as variações (o ML exige enviar todas).
- Shopee: preço e estoque por modelo; sem modelo, o preço vale para todos.
- TikTok Shop: preço e estoque por SKU; sem SKU, o preço vale para todos.
Os IDs aparecem em Clientes → Anúncios → "N variações" e a IA também pode propor por variação.

## Tema e fotos dos anúncios

- **Tema claro/escuro:** botão sol/lua no topo (sidebar no desktop, barra superior no celular, canto da tela no login). A escolha fica em `localStorage` + cookie `avanteza-tema`; na primeira visita vale o `prefers-color-scheme`. Tokens em `src/app/globals.css` por `[data-theme]`; `tests/visual.test.ts` confere contraste AA nos dois temas.
- **Fotos:** `listings.thumbnail` (miniatura https) e `listings.image_urls` (jsonb, até 6) são preenchidas pelo coletor a partir das mesmas chamadas de antes (ML multiget, Shopee `get_item_base_info`, TikTok `get_product`). Anúncios já coletados sem foto são preenchidos no próximo ciclo do coletor (ou ao chegar um webhook `items`); até lá aparece a inicial do título. Em bancos existentes rode `node db/apply.mjs` (adiciona `image_urls`).

## Canais (painel de mídia e tráfego do cliente)
`/mapa/canais` (clientes `midia`/`ambos`): Anúncios, Instagram e Evolução, com período 7/30/90 dias ou mês atual. **Duas fontes independentes**, cada uma com
conexão, “Testar conexão”, “Atualizar agora” (90 dias), status e erro próprios, e selo “Fonte: …” na tela (nunca somadas):
**Tráfego (anúncios) · Meta Ads** (token do cliente, criptografado, `ads_read` + `read_insights`) e **Mídias (Instagram) · Windsor.ai**
(`WINDSOR_API_KEY` da plataforma ou chave própria do canal, criptografada; `account_name` opcional; Meta Graph continua como alternativa).
Admin: Clientes → cliente → aba **Canais**. Somente leitura (só GET). Coleta diária em `/api/cron/channels` (03 10 UTC, com `CRON_SECRET`), gravando em
`channel_snapshots` (coluna `source`). Código em `src/lib/channels/` (`windsor.ts` = Instagram; `graph.ts` = Meta). Migração: `node db/apply.mjs` (idempotente; canais
existentes mantêm a fonte que já tinham; o Instagram do Showman passa a ser escolhido pelo admin ou pelo seed).
```sh
DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/apply.mjs
DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-canais-showman.mjs   # canal do Showman, sem token; recusa banco remoto
CHANNELS_FIXTURE=1 npm run dev   # dados simulados (6 anúncios do Showman e Instagram showmanbarbearia); depois "Atualizar agora" na aba Canais ou GET /api/cron/channels com o CRON_SECRET
```
Passo a passo para o Cowork gerar e colar o token: `docs/PROMPT_COWORK_META_CLIENTE.md`.
