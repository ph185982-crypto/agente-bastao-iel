# Arquitetura da plataforma Avanteza

Uma entrada, um login, uma identidade visual — sem mover nem misturar os bancos de dados.

## Princípios
1. **Aplicativos independentes, identidade única.** Cada ferramenta continua sendo um projeto próprio na
   Vercel, com seu banco. Se uma cair, as outras continuam. O que é comum (login, usuários, marca) fica
   num lugar só.
2. **Nada de segredo compartilhado.** A Central assina; os aplicativos só conferem com a chave pública.
3. **Dados não se movem sem cópia conferida.** Migração de banco só com cópia, contagem tabela a tabela,
   troca em horário de baixo uso e o banco antigo guardado por 30 dias.
4. **Reversível por padrão.** Cada aplicativo mantém o login próprio como reserva até o login único
   estar provado em produção.

## Mapa

```
                         app.avanteza.com.br
                ┌───────────────────────────────────┐
                │  CENTRAL  (Avanteza ID)            │
                │  login · usuários · permissões     │
                │  menu de ferramentas · auditoria   │
                └───────┬───────────────────────────┘
        token ES256 (60 s, 1 app)  │  chave pública: /.well-known/jwks.json
   ┌──────────────┬───────────────┼────────────────┬─────────────────┐
   ▼              ▼               ▼                ▼                 ▼
Marketplaces     CRM         Vendedor IA       Contratos         Conteúdo
(módulo da     nexo-crm     nexo-vendedoria   nexo-presenter   agente-bastao-iel
 Central)                                                       (Pedro Destrava)
   │              │               │                │                 │
 Neon         Supabase         Supabase        sem banco           Neon + Blob
 avanteza     schema crm      schema public   (navegador)         pico_*
```

Site institucional (`avanteza.com.br`) e UFFIR (`uffir.com.br`) são estáticos, sem login.

## Login único (Avanteza ID)
1. O usuário abre qualquer ferramenta. Sem sessão local, ela redireciona para
   `app.avanteza.com.br/sso/authorize?app=<id>&return=<caminho>`.
2. A Central confere a sessão (ou pede login) e a permissão do usuário para aquele aplicativo.
3. A Central emite um JWT **ES256 válido por 60 segundos, para um único aplicativo** (`aud`) e redireciona
   para o endereço de retorno **registrado** do aplicativo (`/api/sso/callback?token=…`) — o destino nunca
   vem da URL, então não serve para redirecionar a sites de terceiros.
4. O aplicativo confere assinatura, emissor, destinatário e validade (`packages/avanteza-kit/avanteza-sso.js`),
   localiza o usuário pelo e-mail e cria a **sessão local dele** (o mecanismo que já existia).
5. Todo login único fica no log de auditoria da Central.

Papéis: **admin** (tudo; precisa constar em `ADMIN_EMAILS`), **member** (só os aplicativos marcados),
**reviewer** (somente leitura em Marketplaces). Gestão em `app.avanteza.com.br/usuarios`.

Funciona com qualquer domínio (hoje `*.vercel.app`). Quando os subdomínios existirem
(`crm.`, `vendas.`, `contratos.`, `conteudo.avanteza.com.br`), basta trocar as variáveis `APP_*_URL` na Central.

## Mapa — área do cliente (`app.avanteza.com.br/mapa`)
Mesmo domínio e mesmo `/login`; o usuário de cliente (papel `client`) cai em `/mapa`, a equipe continua na Central.
- **Tipos**: `marketplace` (Início, Plano, Marketplaces, Reuniões, Arquivos, Conta), `midia` (Início, Plano, Canais, …) e `ambos` (união).
- **Dados**: estende `clients` (slug, kind, start_date, drive_folder_id, group_slug, owner_name) e `admins` (papel `client`); novas tabelas
  `plan_phases`, `plan_actions`, `meetings`, `client_files`, `client_user_clients` (usuário ↔ empresas do grupo). Tudo em `db/schema.sql`, idempotente.
- **Isolamento (requisito crítico)**: o client_id NUNCA vem de URL, corpo ou formulário. A sessão assinada carrega a LISTA de empresas do usuário;
  `src/lib/mapa/scope.ts` emite o único objeto de escopo aceito por `src/lib/mapa/repo.ts`, onde toda consulta filtra por `scope.clientId`
  (a empresa ativa, escolhida no seletor só se estiver na lista). A lista é conferida no banco a cada acesso (só pode diminuir).
  O middleware confina o papel `client` a `/mapa`. Cliente nunca recebe tokens de contas, transcrições, notas internas ou arquivos ocultos.
- **Grupo**: um login pode ver várias empresas do mesmo titular (ex.: Vulk Jeans, Lumiere, Plenitude → grupo `rodrigo`), com seletor no topo
  (some com uma só empresa) e visão consolidada no Início.
- **Ver como cliente**: cookie assinado (`avz_view`, 2 h, preso ao e-mail da equipe), somente leitura, com faixa “Visualizando como …”.
- **Plano de 12 meses**: `src/lib/mapa/plan.ts` (função pura) gera as 4 fases e as ações por tipo a partir de `start_date`; botão admin “Gerar plano”.
- **Reuniões → ações**: `ingestMeeting()` (`src/lib/mapa/meetings.ts`) usa `src/lib/ai` (método `extract`, saída validada por zod). Sem `ANTHROPIC_API_KEY`
  a reunião fica “aguardando análise” e a equipe preenche à mão. `POST /api/mapa/reunioes` (admin ou `Authorization: Bearer $CRON_SECRET`).
- **Tráfego**: a tela Canais usa a seção “Canais” abaixo (Meta Graph direto, somente leitura). A interface `TrafficProvider` (`src/lib/mapa/traffic.ts`) continua só na Visão geral e não é usada por Canais.
- **Admin** (Central): `/clientes` (tipo e andamento do plano), `/clientes/[id]` (abas Plano, Arquivos, Reuniões, Acesso, Dados), `/entregas` (pendências de todos).
  Só administradores escrevem; revisor só lê. Senha de cliente é gerada, exibida uma vez e guardada só como hash (bcrypt).
- **Variáveis**: `MAPA_CONTATO_NOME`, `MAPA_CONTATO_EMAIL`, `MAPA_CONTATO_WHATSAPP` (contato da Avanteza na tela Conta).

## Motor de Entregas (Operações, F1 — `app.avanteza.com.br/operacoes`)
Objetivo: ninguém depende de memória — o sistema diz **o que fazer hoje, para quem e até quando** em cada cliente.
- **Modelo** (`db/schema.sql`, idempotente; estende sem duplicar): `service_catalog` (o que a Avanteza vende), `playbooks` + `playbook_tasks`
  (fase 1–4 do plano, papel, prazo relativo D+n, recorrência `none|semanal|quinzenal|mensal` com dia preferido, checklist, critério de pronto,
  depende do cliente, visível ao cliente, tempo estimado, prioridade), `client_services` (cliente, serviço, início/fim, valor, contrato, responsável, situação),
  `delivery_runs` (registro de cada geração), `client_health` (semáforo diário) e `capturas` (Inbox de combinados, hash único).
  `plan_actions` ganhou `playbook_task_id`, `client_service_id`, `assignee_id` (→ `admins.id`, coluna nova), `role`, `recurrence_key` (única por cliente),
  `checklist`, `done_criteria`, `blocked_reason`, `evidence_url`, `sla_due`, `priority`, `estimated_min`, `client_dependent`, `visible_to_client`,
  `ai_generated`, `captura_id`, `edited_at`, `archived_at`; `origin` aceita também `playbook`, `captura` e `ia`. `admins.delivery_roles` diz quem cobre cada papel
  e `clients.manager_id` é o responsável pela conta.
- **Gerador** (`src/lib/motor/gerador.ts`, puro e testado): a partir dos serviços (ou do tipo do cliente: marketplace → Onboarding + Marketplace; mídia →
  Onboarding + Tráfego + Mídias; ambos → todos) gera as tarefas de prazo único e as recorrências dos próximos 30 dias (3 dias de recuperação para trás).
  Chave `tarefa` ou `tarefa@AAAA-MM-DD`: rodar 2× não duplica. Concluídas, em andamento, bloqueadas, editadas (`edited_at`) e dispensadas (`archived_at`) nunca
  são sobrescritas; intocadas acompanham a mudança do modelo; serviço pausado/encerrado arquiva as geradas intocadas. Tarefa com o mesmo título de uma ação
  do plano de 12 meses é **vinculada** a ela (sem duplicar). Sem plano, o plano de 12 meses é gerado e as ações entram nas fases certas.
- **Saúde** (`src/lib/motor/saude.ts`, pura): atrasadas, bloqueadas pelo cliente, dias sem entrega concluída, dias sem reunião, canais/contas com erro ou
  desconectados → verde/amarelo/vermelho com motivos legíveis; a Carteira ordena por risco.
- **Telas** (vidro, claro/escuro, celular): **Hoje** (`/operacoes`, fila atrasadas → hoje → 7 dias → esperando o cliente, filtros e ações rápidas: concluir com
  evidência, “depende do cliente” com motivo, reatribuir, adiar, checklist, editar, dispensar, desfazer IA), **Carteira**, **Calendário** (semana/mês),
  **Playbooks** (admin edita serviços, tarefas, recorrências e papéis; “aplicar a clientes existentes” com prévia) e a aba **Entregas** do cliente
  (serviços, aplicar playbooks, quadro fase × situação). O membro da equipe cai em Hoje ao logar; o dono continua na Visão geral com o cartão “Entregas em risco”.
  Permissões em `src/lib/motor/acesso.ts`: equipe vê; admin e membro trabalham nas ações; só admin edita playbooks/serviços; revisor só lê.
- **Mapa**: o cliente só vê ações `visible_to_client` não dispensadas; o bloco **Depende de você** (Início e Plano) lista as ações dele e as da Avanteza paradas
  esperando por ele; “Marcar como feito”/“Já enviei” com link opcional (`resolverPendencia`, filtrada pelo escopo da sessão; testado contra IDOR).
- **Capturas** (`src/lib/motor/capturas.ts`): `ingestCaptura()` reaproveita o extrator das reuniões (provedor de `src/lib/ai`, zod); ações entram direto com selo
  “gerado por IA” (sem prazo dito: D+3). `POST /api/capturas` com `Authorization: Bearer $AVANTEZA_CAPTURE_KEY` (503 sem variável, 401 errada, comparação em tempo
  constante; cliente por id, slug ou nome, 409 se ambíguo). A integração com o Max e a importação de conversa exportada ficam para a F2.
- **Rotina** `/api/cron/entregas` (1×/dia, 09:12 UTC = 06:12 em Brasília): recorrências, saúde (`client_health`), resumo matinal por e-mail a cada responsável e
  alerta de risco ao dono (`settings.alert_email` ou `ALERT_EMAIL_TO`); sem Resend configurado registra `semConfiguracao` e segue.
- **Semente**: `db/seed-playbooks.mjs` (idempotente; recusa banco remoto sem `--permitir-remoto`); `--aplicar-clientes` cria os serviços pelo tipo e as ações.

## Canais (painel de mídia e tráfego do cliente)
- **DUAS FONTES INDEPENDENTES** (cada uma com credencial, teste, coleta, status e erro próprios; nunca somadas nem misturadas):
  1. **Tráfego/anúncios = Meta Ads** (`ads_source` = `meta`|`none`; token do cliente via Graph; Windsor `facebook` fica para o futuro). Status em `last_sync_at`/`last_error`.
  2. **Mídias/Instagram = Windsor.ai** (`ig_source` = `windsor`|`meta`|`none`; padrão Windsor). `src/lib/channels/windsor.ts`: GET `connectors.windsor.ai/instagram`
     (perfil e mídias em consultas separadas; null tratado; zod; `safeImageUrl`; retry via `src/lib/http.ts`). Chave: própria do canal (`windsor_key_enc`, cifrada,
     hint de 4 caracteres) ou `WINDSOR_API_KEY` da plataforma; `windsor_account_name` filtra por `account_name` (várias contas sem filtro = erro, não mistura). Status em
     `ig_last_sync_at`/`ig_last_error`. Produz os MESMOS snapshots do Instagram da Meta (`ig_daily`, `ig_media`) e `ig_audience` (idade/gênero/cidades).
  `channel_snapshots.source` (`meta`|`windsor`) faz parte da chave; o Mapa lê o Instagram só da fonte configurada e os anúncios só da Meta, com selo “Fonte: …”.
  Falha ou falta de credencial em uma fonte não derruba a outra (cron, “Atualizar agora” e backfill de 90 dias são por fonte). Seguidores: o Windsor só traz
  `followers_count` no dia atual; o histórico é reconstruído para trás com o saldo diário (`follower_count`) e marcado como estimado.
- **Fonte**: Meta Graph API v21.0, SOMENTE GET (`src/lib/channels/graph.ts`; retry/backoff de `src/lib/http.ts`, pausa entre chamadas, paginação, janelas de 30 dias).
  Anúncios: insights por dia de campanha e de anúncio + criativo (miniatura, vídeo, status); resultado = `actions` do tipo configurado
  (padrão `onsite_conversion.messaging_conversation_started_7d`). Instagram: perfil (seguidores), `follower_count` diário (~30 dias), métricas do dia em
  `total_value` (reach, views, profile_views, accounts_engaged, total_interactions; as indisponíveis viram “indisponível”) e mídias recentes com insights.
- **Dados**: `client_channels` (1 por cliente/provedor; token AES-256-GCM em `token_enc`, só `token_hint` de 4 caracteres visível; `use_platform_token` autoriza o
  `META_ACCESS_TOKEN` da plataforma como reserva) e `channel_snapshots` (kind `campaign_daily`/`ad_daily`/`ig_daily`/`ig_media`, upsert idempotente por
  (cliente, tipo, dia, chave); é o histórico que alimenta a Evolução).
- **Rotina**: `/api/cron/channels` 1×/dia (10:03 UTC, junto do `ai-daily`), um canal por vez, com tempo máximo; 1ª coleta/“Atualizar agora” = 90 dias, depois 7 dias
  (reprocessa a atribuição recente) e o histórico diário do Instagram é completado aos poucos.
- **Isolamento**: `src/lib/channels/cliente.ts` exige o escopo da sessão (`assertScope`); a saída não tem token, hint, conta, Página, Instagram nem IDs de campanha/anúncio/mídia.
  Admin: só `requireOwner` conecta, testa, atualiza ou desconecta; revisor só lê. A fixture (`CHANNELS_FIXTURE=1`) é ignorada em produção.
- **Ranking de criativos**: só anúncios com gasto mínimo de R$ 30 no período, ordenados por resultados e depois pelo menor custo por resultado; selos melhor/pior com ≥ 2 comparáveis.
- **Central**: o bloco Marketing de `/dashboards` ganhou “Canais dos clientes” como SUBTOTAL separado; conta já lida pela Meta da agência não é somada de novo.

## Identidade visual única
`packages/avanteza-kit/tokens.css` é a fonte única: Marinho #0B1B33, Creme #F5F0E6, Areia #EAD9C2,
Laranja #FF6A1F; Manrope + Instrument Serif; sem sombras, sem degradês, bordas de 1px, laranja só para ação.
Cada aplicativo mapeia o próprio tema para esses tokens. Todos têm, no topo, o atalho de grade (2×2) que volta
para a Central.

## Bancos de dados
| Sistema | Onde está | Situação |
|---|---|---|
| Marketplaces / Central | Neon `avanteza-db` (schema `avanteza`) | fica |
| Conteúdo | Neon `pedro-destrava-db-2` + Blob `videos-pedro` | fica |
| Vendedor IA | Supabase `nexo-vendedoria`, schema `public` | fica; migrar para Neon depois, com cópia conferida |
| CRM | Supabase `nexo-vendedoria`, schema `crm` | idem |
| Contratos | sem banco (histórico no navegador) | ganhar histórico no servidor depois |

## Ordem de execução
1. Central + Avanteza ID + kit (feito).
2. Login único e tema em cada aplicativo, em prévia → teste → produção, um por vez.
3. Subdomínios `*.avanteza.com.br`.
4. Banco único na Vercel (Neon), um sistema por vez, com cópia conferida.
5. Painel da Central com os números de todas as ferramentas.

## Encerrados em 2026-11-15
Felyne (site) e PRF Estudo excluídos da Vercel; banco do PRF desligado no Supabase.
`nexos-paginas-api` e `dist` pausados (duplicados/abandonados).
