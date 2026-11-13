# Avanteza — gestão autônoma de contas de marketplace

Painel da consultoria para monitorar, alertar, propor e executar ações nas contas de Mercado Livre
dos clientes (Shopee na Fase 3). Next.js (App Router) + TypeScript na Vercel, Supabase (Postgres + Auth).

- Produção: https://app.avanteza.com.br (também https://avanteza.vercel.app)
- Projeto Vercel: `avanteza` (diretório `avanteza/` deste repositório)
- Banco: schema `avanteza` no projeto Supabase `nexo-vendedoria`

## Arquitetura

```
src/lib/marketplaces/types.ts            MarketplaceAdapter (interface comum)
src/lib/marketplaces/mercadolivre/       MercadoLivreAdapter (OAuth, leitura, escrita, webhooks)
src/lib/accounts.ts                      tokens criptografados, renovação antecipada com trava
src/lib/crypto.ts                        AES-256-GCM (ENCRYPTION_KEY)
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
O plano Hobby da Vercel só permite cron **diário**; por isso as rotinas frequentes rodam no
**pg_cron do Supabase**, que chama as rotas com `Authorization: Bearer <CRON_SECRET>`
(segredo guardado no Vault, nome `avanteza_cron_secret`):

| Rotina | Frequência | O que faz |
|---|---|---|
| `tick` | a cada 5 min | renova tokens que vencem em < 1 h, processa webhooks, executa aprovadas |
| `collect` | a cada 30 min | coleta 1 conta por vez (a mais desatualizada), até 45 s por chamada |
| `alerts` | a cada 30 min | avalia regras, abre/resolve alertas, envia e-mail |
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

### Fase 3 — autonomia e Shopee
- Tipos de ação em modo **automático** executam sozinhos dentro dos limites diários, respeitando
  a pausa geral, a simulação e um teto de ações automáticas por cliente/dia (acima dele, volta a
  pedir aprovação). Regras podem propor ações (ex.: ROAS abaixo da meta → corte de verba).
  O painel mostra o que foi feito automaticamente nas últimas 24 h, e o relatório também.
- `ShopeeAdapter`: assinatura v2, autorização de loja, tokens (refresh sempre salvo), leitura de
  anúncios e pedidos e escrita de preço/estoque/listagem. Fica ativo quando `SHOPEE_PARTNER_ID` e
  `SHOPEE_PARTNER_KEY` existem. Pontos `VERIFICAR` devem ser validados na documentação oficial.

## Variáveis de ambiente
Veja `.env.example`. Segredos (`ML_CLIENT_SECRET`, `ENCRYPTION_KEY`, `RESEND_API_KEY`,
`ANTHROPIC_API_KEY`) são cadastrados só na Vercel. **Nunca troque a `ENCRYPTION_KEY` depois de
conectar contas** (os tokens salvos deixariam de abrir; seria preciso reautorizar).

## Desenvolvimento
```sh
cd avanteza
npm ci
npm test          # testes unitários (criptografia, retry, regras, limites)
npm run build
```
