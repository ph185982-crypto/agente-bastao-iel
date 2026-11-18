-- Avanteza — schema completo para Postgres (Neon). Gerado a partir de supabase/migrations
-- (0001 + 0003) sem as partes específicas do Supabase (Auth/RLS/grants). O acesso ao banco é
-- só do servidor; o painel exige sessão de administrador assinada.
-- Avanteza — schema inicial (Fase 1)
-- Tudo fica no schema "avanteza" para não misturar com outros sistemas do mesmo projeto Supabase.
-- Acesso: apenas o service role (rotas de servidor/cron) e administradores autenticados (RLS).

create schema if not exists avanteza;
create extension if not exists pgcrypto;

-- ───────────────────────── Administradores ─────────────────────────
create table if not exists avanteza.admins (
  email text primary key,
  password_hash text,             -- bcrypt
  role text not null default 'admin' check (role in ('admin','member','reviewer')), -- admin = tudo; member = apps liberados; reviewer = somente leitura
  name text,
  apps text[] not null default '{}',   -- aplicativos liberados para membros
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists avanteza.login_attempts (
  id bigserial primary key,
  ip text not null,
  email text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_ip_idx on avanteza.login_attempts(ip, created_at);


-- ───────────────────────── Configuração global ─────────────────────────
create table if not exists avanteza.settings (
  id boolean primary key default true check (id), -- linha única
  global_pause boolean not null default false,       -- pausa geral de toda escrita
  dry_run boolean not null default true,             -- simulação global (começa ligada)
  alert_email text,
  updated_at timestamptz not null default now()
);
insert into avanteza.settings (id) values (true) on conflict do nothing;

-- ───────────────────────── Clientes e contas ─────────────────────────
create table if not exists avanteza.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists avanteza.oauth_states (
  state text primary key,
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  marketplace text not null default 'mercadolivre',
  code_verifier text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists avanteza.marketplace_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  marketplace text not null check (marketplace in ('mercadolivre','shopee','tiktok')),
  external_user_id text not null,
  nickname text,
  site_id text,
  access_token_enc text,       -- AES-256-GCM (ENCRYPTION_KEY)
  refresh_token_enc text,      -- AES-256-GCM (ENCRYPTION_KEY)
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'active' check (status in ('active','reauth_required','disabled')),
  last_error text,
  last_refreshed_at timestamptz,
  refresh_lock_until timestamptz, -- trava contra renovação concorrente (refresh token é de uso único)
  last_collected_at timestamptz,
  ads_advertiser_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace, external_user_id)
);
create index if not exists marketplace_accounts_client_idx on avanteza.marketplace_accounts(client_id);

-- ───────────────────────── Dados coletados ─────────────────────────
create table if not exists avanteza.listings (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  external_id text not null,
  title text,
  status text,
  sub_status text[],
  price numeric,
  currency_id text,
  available_quantity integer,
  sold_quantity integer,
  visits_30d integer,
  permalink text,
  thumbnail text,                 -- URL https da miniatura (ML secure_thumbnail / Shopee e TikTok: 1ª foto); preenchida pelo coletor
  image_urls jsonb,               -- fotos do anúncio: ["https://…", …] (até 6)
  listing_type_id text,
  has_variations boolean default false,
  variations jsonb,               -- [{id, name, price, stock, sku}] (variações/modelos/SKUs)
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, external_id)
);

create table if not exists avanteza.listing_snapshots (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  external_id text not null,
  snapshot_date date not null,
  status text,
  price numeric,
  available_quantity integer,
  sold_quantity integer,
  visits_30d integer,
  primary key (account_id, external_id, snapshot_date)
);

create table if not exists avanteza.orders (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  external_id text not null,
  status text,
  total_amount numeric,
  paid_amount numeric,
  currency_id text,
  units integer,
  date_created timestamptz,
  date_closed timestamptz,
  shipping_id text,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, external_id)
);
create index if not exists orders_date_idx on avanteza.orders(account_id, date_created);

create table if not exists avanteza.questions (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  external_id text not null,
  item_id text,
  text text,
  status text,
  answer_text text,
  date_created timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, external_id)
);
create index if not exists questions_status_idx on avanteza.questions(account_id, status);

create table if not exists avanteza.ads_campaigns (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  external_id text not null,
  name text,
  status text,
  budget numeric,
  strategy text,
  roas_target numeric,
  metrics_1d jsonb,
  metrics_7d jsonb,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, external_id)
);

-- Snapshot diário por conta (histórico)
create table if not exists avanteza.daily_snapshots (
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  snapshot_date date not null,
  orders_count integer default 0,
  units_sold integer default 0,
  revenue numeric default 0,
  visits integer,
  active_listings integer,
  paused_listings integer,
  out_of_stock_listings integer,
  unanswered_questions integer,
  reputation_level text,
  power_seller_status text,
  claims_rate numeric,
  delayed_rate numeric,
  cancellations_rate numeric,
  ads_cost numeric,
  ads_revenue numeric,
  ads_roas numeric,
  ads_clicks integer,
  ads_prints integer,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, snapshot_date)
);

-- ───────────────────────── Webhooks (fila) ─────────────────────────
create table if not exists avanteza.webhook_events (
  id bigserial primary key,
  marketplace text not null default 'mercadolivre',
  topic text,
  resource text,
  external_user_id text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','done','error','ignored')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists webhook_events_pending_idx on avanteza.webhook_events(status, received_at);

-- ───────────────────────── Alertas ─────────────────────────
create table if not exists avanteza.alert_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  rule_type text not null check (rule_type in (
    'reputation_drop','listing_paused','out_of_stock','roas_below','unanswered_question','sales_drop')),
  enabled boolean not null default true,
  params jsonb not null default '{}'::jsonb,   -- ex.: {"hours":12}, {"min_roas":4}, {"drop_pct":25}
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  created_at timestamptz not null default now(),
  unique (client_id, rule_type)
);

create table if not exists avanteza.alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  account_id uuid references avanteza.marketplace_accounts(id) on delete cascade,
  rule_type text not null,
  severity text not null default 'warning',
  title text not null,
  message text,
  dedup_key text not null,
  data jsonb,
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  notified_channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists alerts_open_dedup on avanteza.alerts(dedup_key) where status <> 'resolved';
create index if not exists alerts_status_idx on avanteza.alerts(status, created_at desc);

-- ───────────────────────── Executor (fila de ações) ─────────────────────────
-- Modo por tipo de ação: padrão global (client_id nulo) e sobrescrita por cliente.
create table if not exists avanteza.action_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references avanteza.clients(id) on delete cascade,
  action_type text not null,
  mode text not null default 'approval' check (mode in ('auto','approval','blocked')),
  max_change_pct_per_day numeric,  -- preço/verba: variação máxima acumulada no dia
  created_at timestamptz not null default now()
);
create unique index if not exists action_policies_uniq
  on avanteza.action_policies(coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), action_type);

insert into avanteza.action_policies (client_id, action_type, mode, max_change_pct_per_day) values
  (null,'update_price','approval',10),
  (null,'update_stock','approval',null),
  (null,'pause_listing','approval',null),
  (null,'activate_listing','approval',null),
  (null,'update_listing','approval',null),
  (null,'answer_question','approval',null),
  (null,'update_ads_budget','approval',20),
  (null,'update_ads_status','approval',null),
  (null,'create_promotion','approval',null)
on conflict do nothing;

create table if not exists avanteza.actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  account_id uuid not null references avanteza.marketplace_accounts(id) on delete cascade,
  action_type text not null,
  target_id text,                 -- ex.: item_id, question_id, campaign_id
  payload jsonb not null,
  reason text,                    -- justificativa
  source text not null default 'manual', -- manual | regra | ia
  status text not null default 'proposed' check (status in (
    'proposed','approved','executing','executed','simulated','failed','rejected','blocked')),
  dry_run boolean not null default false,
  before_state jsonb,
  after_state jsonb,
  error text,
  decided_by text,
  decided_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists actions_status_idx on avanteza.actions(status, created_at desc);
create index if not exists actions_target_idx on avanteza.actions(account_id, action_type, target_id, executed_at);

create table if not exists avanteza.audit_log (
  id bigserial primary key,
  action_id uuid references avanteza.actions(id) on delete set null,
  client_id uuid references avanteza.clients(id) on delete set null,
  event text not null,             -- proposed, approved, rejected, executed, simulated, failed, blocked, setting_changed...
  actor text,
  before_state jsonb,
  after_state jsonb,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on avanteza.audit_log(created_at desc);

create table if not exists avanteza.job_runs (
  id bigserial primary key,
  job text not null,
  status text not null,
  details jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);


-- Fase 2 (agente de IA + relatório diário) e Fase 3 (autonomia por regras + Shopee)

create table if not exists avanteza.ai_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  report_date date not null,
  status text not null default 'ok' check (status in ('ok','error','skipped')),
  summary text,                 -- resumo executivo da IA
  diagnosis jsonb,              -- [{tema, severidade, texto}]
  proposed_count integer default 0,
  report_text text,             -- relatório pronto para envio (WhatsApp/e-mail)
  provider text,
  model text,
  usage jsonb,
  error text,
  created_at timestamptz not null default now(),
  unique (client_id, report_date)
);

-- Fotos dos anúncios (bancos criados antes da miniatura; o próximo ciclo do coletor preenche)
alter table avanteza.listings add column if not exists thumbnail text;
alter table avanteza.listings add column if not exists image_urls jsonb;

-- Autonomia: teto diário de ações automáticas por cliente e IA liga/desliga
alter table avanteza.settings add column if not exists max_auto_actions_per_day integer not null default 20;
alter table avanteza.settings add column if not exists ai_enabled boolean not null default true;
alter table avanteza.clients add column if not exists ai_enabled boolean not null default true;
alter table avanteza.clients add column if not exists ai_instructions text; -- contexto do negócio para a IA

-- Regra pode propor ação automaticamente (ex.: ROAS baixo → reduzir verba)
alter table avanteza.alert_rules add column if not exists propose_action boolean not null default false;


-- ═════════════════════════ Mapa — área do cliente (V1) ═════════════════════════
-- Estende clients/admins (não duplica). Tudo idempotente: pode rodar `node db/apply.mjs` quantas vezes quiser.

-- Clientes: identificação, tipo de serviço, pasta no Drive e início do plano de 12 meses.
alter table avanteza.clients add column if not exists slug text;
alter table avanteza.clients add column if not exists kind text not null default 'marketplace';
alter table avanteza.clients add column if not exists drive_folder_id text;
alter table avanteza.clients add column if not exists start_date date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clients_kind_check' and conrelid = 'avanteza.clients'::regclass) then
    alter table avanteza.clients add constraint clients_kind_check check (kind in ('marketplace','midia','ambos'));
  end if;
end $$;
create unique index if not exists clients_slug_uniq on avanteza.clients(slug) where slug is not null;

-- Usuários do cliente: reaproveitam avanteza.admins (mesmo /login, mesma sessão) com o papel "client".
-- Regra de integridade: papel "client" SEMPRE tem client_id; os demais papéis NUNCA têm.
alter table avanteza.admins add column if not exists client_id uuid references avanteza.clients(id) on delete cascade;
alter table avanteza.admins drop constraint if exists admins_role_check;
alter table avanteza.admins add constraint admins_role_check check (role in ('admin','member','reviewer','client'));
alter table avanteza.admins drop constraint if exists admins_client_id_check;
alter table avanteza.admins add constraint admins_client_id_check check ((role = 'client') = (client_id is not null));
create index if not exists admins_client_idx on avanteza.admins(client_id) where client_id is not null;

-- Reuniões (resumo, decisões e gravação). transcript_text é interno: nunca é mostrado ao cliente.
create table if not exists avanteza.meetings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  title text not null,
  held_at timestamptz not null,
  recording_url text,
  transcript_url text,
  transcript_text text,
  summary text,
  decisions jsonb not null default '[]'::jsonb,   -- ["decisão", …]
  status text not null default 'aguardando_analise' check (status in ('aguardando_analise','analisada','manual','erro')),
  analysis_error text,
  ai_provider text,
  ai_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meetings_client_idx on avanteza.meetings(client_id, held_at desc);
create unique index if not exists meetings_seed_uniq on avanteza.meetings(client_id, title, held_at);

-- Fases do plano de 12 meses.
create table if not exists avanteza.plan_phases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  position integer not null,
  name text not null,
  description text,
  start_month integer not null,   -- 1..12 (mês do plano em que a fase começa)
  end_month integer not null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  unique (client_id, position)
);

-- Ações do plano (do plano padrão, saídas de reuniões ou manuais).
create table if not exists avanteza.plan_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  phase_id uuid references avanteza.plan_phases(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'planejada' check (status in ('planejada','em_execucao','concluida','bloqueada')),
  owner text not null default 'avanteza' check (owner in ('avanteza','cliente')),
  due_date date,
  origin text not null default 'plano' check (origin in ('plano','reuniao','manual')),
  meeting_id uuid references avanteza.meetings(id) on delete set null,
  position integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_actions_client_idx on avanteza.plan_actions(client_id, status, due_date);
create index if not exists plan_actions_meeting_idx on avanteza.plan_actions(meeting_id) where meeting_id is not null;

-- Arquivos entregues ao cliente (links; o conteúdo fica no Drive).
create table if not exists avanteza.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  title text not null,
  url text not null,
  drive_file_id text,
  kind text,
  file_date date,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists client_files_client_idx on avanteza.client_files(client_id, file_date desc);
create unique index if not exists client_files_drive_uniq on avanteza.client_files(client_id, drive_file_id) where drive_file_id is not null;

-- Grupo de empresas do mesmo titular (ex.: Vulk Jeans, Lumiere e Plenitude → grupo "rodrigo").
alter table avanteza.clients add column if not exists group_slug text;
alter table avanteza.clients add column if not exists owner_name text;          -- titular
alter table avanteza.clients add column if not exists drive_folder_ids text[] not null default '{}'; -- pastas extras do Drive
create index if not exists clients_group_idx on avanteza.clients(group_slug) where group_slug is not null;

-- Vínculo usuário do cliente ↔ empresas que ele pode ver (inclui a empresa principal, admins.client_id).
create table if not exists avanteza.client_user_clients (
  user_email text not null references avanteza.admins(email) on delete cascade on update cascade,
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_email, client_id)
);
create index if not exists client_user_clients_client_idx on avanteza.client_user_clients(client_id);

-- Cache do painel Dashboards (respostas da Meta Marketing API por período; TTL de ~15 min aplicado no código).
-- Só guarda agregados de marketing; nenhum segredo. Idempotente.
create table if not exists avanteza.dashboard_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ───────────────────────── Canais do cliente (painel de mídia e tráfego, Meta somente leitura) ─────────────────────────
-- Um canal por cliente e provedor. O token do cliente (se houver) fica CRIPTOGRAFADO (AES-256-GCM, ENCRYPTION_KEY) em token_enc
-- e nunca sai do servidor: nem para o navegador, nem para logs. token_hint guarda só os 4 últimos caracteres.
create table if not exists avanteza.client_channels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  provider text not null default 'meta' check (provider in ('meta')),
  ad_account_id text,                                   -- ex.: act_605261696580859
  campaign_ids text[] not null default '{}',            -- filtro opcional (vazio = todas as campanhas da conta)
  ig_user_id text,                                      -- ID do Instagram profissional
  page_id text,                                         -- ID da Página do Facebook
  result_action_type text not null default 'onsite_conversion.messaging_conversation_started_7d',
  token_enc text,                                       -- token do cliente (cifrado)
  token_hint text,                                      -- últimos 4 caracteres
  use_platform_token boolean not null default false,    -- usa META_ACCESS_TOKEN da plataforma quando não há token do cliente
  status text not null default 'pendente' check (status in ('pendente','ativo','erro','desconectado')),
  info jsonb not null default '{}'::jsonb,              -- dados não secretos do último teste (nome da conta, moeda, @ do Instagram)
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, provider)
);
create index if not exists client_channels_status_idx on avanteza.client_channels(status, last_sync_at);

-- ── Duas fontes independentes por canal (migração idempotente, sem perda) ──
--   ads_source: 'meta' | 'windsor' | 'none'                    → tráfego/anúncios (Meta Ads; colunas antigas: ad_account_id, token_enc, status, last_sync_at, last_error)
--   ig_source:  'meta' | 'windsor' | 'none'          → mídias/Instagram (Windsor.ai ou Meta Graph)
--   windsor_account_name: filtro opcional por account_name; windsor_key_enc/hint: chave própria opcional (cifrada), senão WINDSOR_API_KEY.
--   ig_last_sync_at / ig_last_error: coleta do Instagram, separada da coleta de anúncios (last_sync_at / last_error).
alter table avanteza.client_channels add column if not exists windsor_account_name text;
alter table avanteza.client_channels add column if not exists windsor_key_enc text;
alter table avanteza.client_channels add column if not exists windsor_key_hint text;
alter table avanteza.client_channels add column if not exists ig_last_sync_at timestamptz;
alter table avanteza.client_channels add column if not exists ig_last_error text;
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'avanteza' and table_name = 'client_channels' and column_name = 'ads_source') then
    -- canais existentes: a fonte segue o que já estava configurado (conta de anúncios → Meta; Instagram do Graph → Meta)
    alter table avanteza.client_channels add column ads_source text, add column ig_source text;
    update avanteza.client_channels set
      ads_source = case when ad_account_id is not null then 'meta' else 'none' end,
      ig_source = case when ig_user_id is not null then 'meta' else 'none' end,
      ig_last_sync_at = case when ig_user_id is not null then last_sync_at end;
    alter table avanteza.client_channels
      alter column ads_source set default 'none', alter column ads_source set not null,
      alter column ig_source set default 'none', alter column ig_source set not null;
    alter table avanteza.client_channels
      add constraint client_channels_ads_source_check check (ads_source in ('meta','none')),
      add constraint client_channels_ig_source_check check (ig_source in ('meta','windsor','none'));
  end if;
end $$;
-- Anúncios também podem vir do Windsor.ai (conector facebook): amplia o check de ads_source (idempotente).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'client_channels_ads_source_check' and pg_get_constraintdef(oid) not like '%windsor%') then
    alter table avanteza.client_channels drop constraint client_channels_ads_source_check;
    alter table avanteza.client_channels add constraint client_channels_ads_source_check check (ads_source in ('meta','windsor','none'));
  end if;
end $$;

-- Filtro de campanhas por NOME (contém, sem caixa/acento), além dos ids. Ex.: Showman = 'SHOW MAN' (campanhas novas entram sozinhas;
-- campanhas de outros projetos na mesma conta de anúncios ficam de fora da coleta, do painel e do alerta).
alter table avanteza.client_channels add column if not exists campaign_name_filter text;
-- Alerta de recarga (saldo pré-pago): soma do gasto das campanhas filtradas desde spend_alert_since. Dois níveis:
-- 'aviso' (>= spend_alert_warn_pct % do limite) e 'limite' (>= 100 %). Cada nível no máximo UMA vez por ciclo (ciclo = since).
alter table avanteza.client_channels add column if not exists spend_alert_limit numeric(12,2);
alter table avanteza.client_channels add column if not exists spend_alert_warn_pct integer not null default 80;
alter table avanteza.client_channels add column if not exists spend_alert_since date;
alter table avanteza.client_channels add column if not exists spend_alert_emails text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_channels_spend_alert_check') then
    alter table avanteza.client_channels add constraint client_channels_spend_alert_check
      check ((spend_alert_limit is null or spend_alert_limit > 0) and spend_alert_warn_pct between 1 and 99);
  end if;
end $$;
create table if not exists avanteza.spend_alerts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  ciclo date not null,                                   -- = spend_alert_since do ciclo
  nivel text not null check (nivel in ('aviso','limite')),
  gasto numeric(12,2) not null,
  limite numeric(12,2) not null,
  conversas integer not null default 0,
  destinatarios text[] not null default '{}',
  email_status text,                                     -- enviado | sem_configuracao | sem_destinatario | falhou | coberto
  criado_em timestamptz not null default now(),
  unique (client_id, ciclo, nivel)
);
create index if not exists spend_alerts_cliente_idx on avanteza.spend_alerts(client_id, criado_em desc);


-- Histórico das séries coletadas (backup para a Evolução). Upsert idempotente por (cliente, tipo, dia, chave).
--   kind: campaign_daily (key = campanha) | ad_daily (key = anúncio) | ig_daily (key = 'account') | ig_media (key = mídia; date = dia da postagem)
--         | ig_audience (key = 'account'; idade/gênero/cidades)
--         | ads_breakdown (key = '<idade_genero|regiao|posicionamento>|<campanha>|<valores>'; por dia) | adset_targeting (key = conjunto; date = dia da coleta, vale o último)
--   source: de onde veio a linha ('meta' | 'windsor'). Faz parte da chave: trocar a fonte do Instagram nunca mistura nem sobrescreve dados de outra fonte.
create table if not exists avanteza.channel_snapshots (
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  provider text not null default 'meta',
  kind text not null check (kind in ('campaign_daily','ad_daily','ig_daily','ig_media','ig_audience','ads_breakdown','adset_targeting')),
  date date not null,
  key text not null,
  metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  source text not null default 'meta',
  primary key (client_id, kind, date, key, source)
);
alter table avanteza.channel_snapshots add column if not exists source text not null default 'meta';
alter table avanteza.channel_snapshots drop constraint if exists channel_snapshots_kind_check;
alter table avanteza.channel_snapshots add constraint channel_snapshots_kind_check check (kind in ('campaign_daily','ad_daily','ig_daily','ig_media','ig_audience','ads_breakdown','adset_targeting'));
do $$
begin
  -- chave primária antiga (cliente, tipo, dia, chave) → inclui a fonte
  if not exists (select 1 from pg_constraint c where c.conrelid = 'avanteza.channel_snapshots'::regclass and c.contype = 'p' and array_length(c.conkey, 1) = 5) then
    alter table avanteza.channel_snapshots drop constraint channel_snapshots_pkey;
    alter table avanteza.channel_snapshots add primary key (client_id, kind, date, key, source);
  end if;
end $$;
create index if not exists channel_snapshots_lookup_idx on avanteza.channel_snapshots(client_id, kind, date);


-- ═════════════════════════ Motor de Entregas (Operações, F1) ═════════════════════════
-- Estende clients/admins/plan_phases/plan_actions (não duplica). Idempotente: `node db/apply.mjs` quantas vezes quiser.
-- Ideia: o que cada cliente contratou (client_services) aplica playbooks (tarefas-modelo com prazo relativo e recorrência)
-- e vira ações em plan_actions — as mesmas que o Mapa já mostra ao cliente. A chave recurrence_key impede duplicatas.

-- Usuários da equipe ganham um id (para responsável das ações) e os papéis de entrega que cobrem.
alter table avanteza.admins add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists admins_id_uniq on avanteza.admins(id);
alter table avanteza.admins add column if not exists delivery_roles text[] not null default '{}'; -- gestor_conta, marketplace, trafego, social, design

-- Responsável pela conta do cliente (aparece na Carteira; é o padrão quando o papel da tarefa não tem dono).
alter table avanteza.clients add column if not exists manager_id uuid references avanteza.admins(id) on delete set null;

-- Catálogo do que a Avanteza vende.
create table if not exists avanteza.service_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  kind text not null default 'marketplace' check (kind in ('marketplace','midia','ambos','geral')),
  default_monthly_value numeric,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Playbook = conjunto de tarefas-modelo de um serviço.
create table if not exists avanteza.playbooks (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references avanteza.service_catalog(id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists playbooks_service_idx on avanteza.playbooks(service_id);

-- Tarefa-modelo. offset_days = prazo relativo (D+n) a partir do início do serviço; com recorrência, é quando ela começa.
--   recurrence: none | semanal | quinzenal | mensal; recurrence_day: dia da semana ISO (1=seg … 7=dom) ou dia do mês (1–28).
create table if not exists avanteza.playbook_tasks (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references avanteza.playbooks(id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  phase_position integer not null default 1 check (phase_position between 1 and 4),
  role text not null default 'gestor_conta' check (role in ('gestor_conta','marketplace','trafego','social','design')),
  offset_days integer not null default 0 check (offset_days between 0 and 400),
  recurrence text not null default 'none' check (recurrence in ('none','semanal','quinzenal','mensal')),
  recurrence_day integer check (recurrence_day between 1 and 31),
  checklist jsonb not null default '[]'::jsonb,
  done_criteria text,
  client_dependent boolean not null default false,
  client_visible boolean not null default true,
  estimated_min integer,
  priority smallint not null default 2 check (priority between 1 and 3), -- 1 alta · 2 média · 3 baixa
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (playbook_id, slug)
);

-- O que cada cliente contratou.
create table if not exists avanteza.client_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  service_id uuid not null references avanteza.service_catalog(id) on delete restrict,
  start_date date not null,
  end_date date,
  monthly_value numeric,
  contract_ref text,
  assignee_id uuid references avanteza.admins(id) on delete set null,   -- responsável pelo serviço (vence o papel)
  status text not null default 'ativo' check (status in ('ativo','pausado','encerrado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, service_id)
);
create index if not exists client_services_client_idx on avanteza.client_services(client_id, status);

-- Registro de cada geração (por cliente e dia): quantas ações criou/atualizou/arquivou. A idempotência real é a recurrence_key.
create table if not exists avanteza.delivery_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  archived_count integer not null default 0,
  actor text,
  created_at timestamptz not null default now(),
  unique (client_id, period_start)
);

-- Saúde do cliente calculada pela rotina diária (histórico; a Carteira recalcula ao abrir).
create table if not exists avanteza.client_health (
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  day date not null,
  level text not null check (level in ('verde','amarelo','vermelho')),
  reasons jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  primary key (client_id, day)
);

-- Capturas (Inbox de combinados): WhatsApp pelo Max, conversa exportada, extensão, reunião ou manual. hash impede duplicata.
create table if not exists avanteza.capturas (
  id uuid primary key default gen_random_uuid(),
  origem text not null check (origem in ('whatsapp_max','whatsapp_export','extensao','reuniao','manual')),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  autor text,
  texto text,
  midia_url text,
  transcricao text,
  hash text not null unique,
  status text not null default 'recebida' check (status in ('recebida','processada','sem_ia','erro')),
  erro text,
  acoes_geradas uuid[] not null default '{}',
  ai_provider text,
  ai_model text,
  criado_em timestamptz not null default now()
);
create index if not exists capturas_client_idx on avanteza.capturas(client_id, criado_em desc);

-- Ações do plano ganham o que o Motor precisa.
alter table avanteza.plan_actions add column if not exists playbook_task_id uuid references avanteza.playbook_tasks(id) on delete set null;
alter table avanteza.plan_actions add column if not exists client_service_id uuid references avanteza.client_services(id) on delete set null;
alter table avanteza.plan_actions add column if not exists assignee_id uuid references avanteza.admins(id) on delete set null;
alter table avanteza.plan_actions add column if not exists role text;
alter table avanteza.plan_actions add column if not exists recurrence_key text;
alter table avanteza.plan_actions add column if not exists checklist jsonb not null default '[]'::jsonb;  -- [{"t":"item","ok":false}]
alter table avanteza.plan_actions add column if not exists done_criteria text;
alter table avanteza.plan_actions add column if not exists blocked_reason text;
alter table avanteza.plan_actions add column if not exists evidence_url text;
alter table avanteza.plan_actions add column if not exists sla_due date;              -- prazo original (adiar muda due_date, não o SLA)
alter table avanteza.plan_actions add column if not exists priority smallint not null default 2;
alter table avanteza.plan_actions add column if not exists estimated_min integer;
alter table avanteza.plan_actions add column if not exists client_dependent boolean not null default false;
alter table avanteza.plan_actions add column if not exists visible_to_client boolean not null default true;
alter table avanteza.plan_actions add column if not exists ai_generated boolean not null default false;
alter table avanteza.plan_actions add column if not exists captura_id uuid references avanteza.capturas(id) on delete set null;
alter table avanteza.plan_actions add column if not exists edited_at timestamptz;     -- editada à mão: o gerador não sobrescreve mais
alter table avanteza.plan_actions add column if not exists archived_at timestamptz;   -- dispensada: some das listas e não volta
alter table avanteza.plan_actions add column if not exists blocked_at timestamptz;
create unique index if not exists plan_actions_recurrence_uniq on avanteza.plan_actions(client_id, recurrence_key) where recurrence_key is not null;
create index if not exists plan_actions_assignee_idx on avanteza.plan_actions(assignee_id, status, due_date) where archived_at is null;
create index if not exists plan_actions_due_idx on avanteza.plan_actions(due_date) where archived_at is null and status <> 'concluida';
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'plan_actions_origin_check' and pg_get_constraintdef(oid) not like '%playbook%') then
    alter table avanteza.plan_actions drop constraint plan_actions_origin_check;
    alter table avanteza.plan_actions add constraint plan_actions_origin_check check (origin in ('plano','reuniao','manual','playbook','captura','ia'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'plan_actions_priority_check') then
    alter table avanteza.plan_actions add constraint plan_actions_priority_check check (priority between 1 and 3);
  end if;
end $$;

-- ───────────────────────── F2: barramento de eventos, onboarding automático, notificações e importação de conversas ─────────────────────────
-- CNPJ do cliente (só dígitos): chave do casamento do contrato assinado com o cadastro.
alter table avanteza.clients add column if not exists cnpj text;
create unique index if not exists clients_cnpj_uniq on avanteza.clients(cnpj) where cnpj is not null;

-- Barramento de eventos entre módulos. id determinístico (ex.: "contrato.assinado:<envelopeId>") = idempotência na entrada.
-- O consumidor (cron "eventos" e a própria rota, logo após receber) processa com retentativa e backoff exponencial.
create table if not exists avanteza.eventos (
  id text primary key,
  tipo text not null,
  origem text not null,
  ocorrido_em timestamptz,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  status text not null default 'pendente' check (status in ('pendente','processado','falhou')),
  processado_em timestamptz,
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  erro text,
  resultado jsonb
);
create index if not exists eventos_fila_idx on avanteza.eventos(proxima_tentativa_em) where status = 'pendente';
create index if not exists eventos_recebido_idx on avanteza.eventos(recebido_em desc);

-- Estado do onboarding de cada contrato (um por envelope): o que já foi feito, para rodar de novo sem duplicar.
create table if not exists avanteza.onboardings (
  envelope_id text primary key,
  evento_id text not null,
  client_id uuid references avanteza.clients(id) on delete set null,
  cliente_criado boolean not null default false,
  kickoff_action_id uuid references avanteza.plan_actions(id) on delete set null,
  acesso_email text,
  acesso_status text,                 -- criado | vinculado | sem_email | email_da_equipe
  financeiro_status text not null default 'pendente' check (financeiro_status in ('pendente','feito','sem_valor','simulacao')),
  financeiro_ref text,
  financeiro_erro text,
  financeiro_tentativas integer not null default 0,
  pendencias jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Notificações da equipe (sino do AppShell). para: admin (só administradores) | equipe (admin, membro e revisor).
-- segredo_enc: senha inicial do acesso do cliente cifrada (AES-256-GCM); revelada UMA vez e apagada.
create table if not exists avanteza.notificacoes (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  titulo text not null,
  corpo text,
  link text,
  para text not null default 'admin' check (para in ('admin','equipe')),
  client_id uuid references avanteza.clients(id) on delete cascade,
  segredo_enc text,
  segredo_revelado_em timestamptz,
  dedup_key text unique,
  lidas_por text[] not null default '{}',
  criado_em timestamptz not null default now()
);
create index if not exists notificacoes_criado_idx on avanteza.notificacoes(criado_em desc);

-- Importação de conversa exportada do WhatsApp: cada mensagem entra uma vez por cliente (hash de autor + data + texto).
create table if not exists avanteza.captura_mensagens (
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  hash text not null,
  captura_id uuid references avanteza.capturas(id) on delete set null,
  enviada_em timestamptz,
  criado_em timestamptz not null default now(),
  primary key (client_id, hash)
);
-- Conversa/grupo → cliente lembrado para as próximas importações.
create table if not exists avanteza.captura_conversas (
  chave text primary key,
  titulo text not null,
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  atualizado_em timestamptz not null default now()
);
alter table avanteza.capturas add column if not exists conversa text;

-- ───────────────────────── F7: Mapa — aprovações, relatório semanal e lembretes ao cliente ─────────────────────────
-- Preferências por cliente (ficha do cliente → aba "Aprovações e relatórios").
--   relatorio_modo: auto (publica sozinho se ninguém revisar em relatorio_horas) | revisao (só publica quando a equipe aprova) | desligado
alter table avanteza.clients add column if not exists relatorio_modo text not null default 'auto';
alter table avanteza.clients add column if not exists relatorio_horas integer not null default 12;
alter table avanteza.clients add column if not exists lembretes_ativos boolean not null default true;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_relatorio_modo_check') then
    alter table avanteza.clients add constraint clients_relatorio_modo_check check (relatorio_modo in ('auto','revisao','desligado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_relatorio_horas_check') then
    alter table avanteza.clients add constraint clients_relatorio_horas_check check (relatorio_horas between 1 and 168);
  end if;
  -- ações criadas por um pedido de ajuste do cliente
  if exists (select 1 from pg_constraint where conname = 'plan_actions_origin_check' and pg_get_constraintdef(oid) not like '%aprovacao%') then
    alter table avanteza.plan_actions drop constraint plan_actions_origin_check;
    alter table avanteza.plan_actions add constraint plan_actions_origin_check check (origin in ('plano','reuniao','manual','playbook','captura','ia','aprovacao'));
  end if;
end $$;

-- Peça enviada ao cliente para aprovação. action_id = tarefa da equipe ligada (aprovar conclui); ajuste_action_id = última
-- ação criada por um pedido de ajuste (a nova versão a conclui).
create table if not exists avanteza.aprovacoes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  tipo text not null default 'criativo' check (tipo in ('criativo','post','legenda','calendario','contrato_midia','relatorio','outro')),
  titulo text not null,
  descricao text,
  prazo date,
  status text not null default 'pendente' check (status in ('pendente','aprovada','ajuste','cancelada')),
  versao_atual integer not null default 1,
  action_id uuid references avanteza.plan_actions(id) on delete set null,
  ajuste_action_id uuid references avanteza.plan_actions(id) on delete set null,
  criado_por text not null,
  decidido_por text,
  decidido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists aprovacoes_cliente_idx on avanteza.aprovacoes(client_id, status, prazo);
create index if not exists aprovacoes_pendentes_idx on avanteza.aprovacoes(prazo) where status = 'pendente';

-- Versões da peça (link ou arquivo do cliente). Uma linha por versão.
create table if not exists avanteza.aprovacao_versoes (
  id uuid primary key default gen_random_uuid(),
  aprovacao_id uuid not null references avanteza.aprovacoes(id) on delete cascade,
  numero integer not null,
  link text not null,
  arquivo_id uuid references avanteza.client_files(id) on delete set null,
  nota text,
  criado_por text not null,
  criado_em timestamptz not null default now(),
  unique (aprovacao_id, numero)
);

-- Histórico: envio, nova versão, aprovação, pedido de ajuste (com comentário), comentário e cancelamento.
create table if not exists avanteza.aprovacao_eventos (
  id uuid primary key default gen_random_uuid(),
  aprovacao_id uuid not null references avanteza.aprovacoes(id) on delete cascade,
  versao integer not null,
  tipo text not null check (tipo in ('enviada','nova_versao','aprovada','ajuste','comentario','cancelada')),
  autor text not null,
  autor_tipo text not null check (autor_tipo in ('equipe','cliente')),
  texto text,
  criado_em timestamptz not null default now()
);
create index if not exists aprovacao_eventos_idx on avanteza.aprovacao_eventos(aprovacao_id, criado_em);

-- Relatório semanal do cliente: um por cliente e semana (segunda-feira da semana relatada). Só "publicado" aparece no Mapa.
create table if not exists avanteza.relatorios_semanais (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  semana date not null,
  periodo_fim date not null,
  status text not null default 'rascunho' check (status in ('rascunho','publicado','descartado')),
  dados jsonb not null default '{}'::jsonb,
  abertura text not null default '',
  abertura_origem text not null default 'modelo' check (abertura_origem in ('ia','modelo','equipe')),
  destaques jsonb not null default '[]'::jsonb,
  publicar_apos timestamptz,
  revisado_por text,
  publicado_por text,
  publicado_em timestamptz,
  email_status text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (client_id, semana)
);
create index if not exists relatorios_semanais_fila_idx on avanteza.relatorios_semanais(publicar_apos) where status = 'rascunho';

-- Lembretes ao cliente (pendências dele atrasadas ou vencendo em 2 dias): no máximo UM por cliente por dia, agrupado.
create table if not exists avanteza.lembretes_cliente (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references avanteza.clients(id) on delete cascade,
  dia date not null,
  itens jsonb not null default '[]'::jsonb,
  email_status text,
  criado_em timestamptz not null default now(),
  unique (client_id, dia)
);
