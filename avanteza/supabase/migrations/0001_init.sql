-- Avanteza — schema inicial (Fase 1)
-- Tudo fica no schema "avanteza" para não misturar com outros sistemas do mesmo projeto Supabase.
-- Acesso: apenas o service role (rotas de servidor/cron) e administradores autenticados (RLS).

create schema if not exists avanteza;
create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── Administradores ─────────────────────────
create table if not exists avanteza.admins (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function avanteza.is_admin() returns boolean
language sql stable security definer set search_path = avanteza, pg_temp as $$
  select exists (
    select 1 from avanteza.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

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
  marketplace text not null check (marketplace in ('mercadolivre','shopee')),
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
  thumbnail text,
  listing_type_id text,
  has_variations boolean default false,
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

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['admins','settings','clients','oauth_states','marketplace_accounts','listings',
    'listing_snapshots','orders','questions','ads_campaigns','daily_snapshots','webhook_events','alert_rules',
    'alerts','action_policies','actions','audit_log','job_runs']
  loop
    execute format('alter table avanteza.%I enable row level security', t);
    execute format('drop policy if exists admin_all on avanteza.%I', t);
    execute format('create policy admin_all on avanteza.%I for all to authenticated using (avanteza.is_admin()) with check (avanteza.is_admin())', t);
  end loop;
end $$;

-- Tokens nunca saem para o navegador: o papel "authenticated" não lê as colunas criptografadas.
revoke all on avanteza.marketplace_accounts from authenticated;
grant select (id, client_id, marketplace, external_user_id, nickname, site_id, token_expires_at, status,
  last_error, last_refreshed_at, last_collected_at, created_at, updated_at)
  on avanteza.marketplace_accounts to authenticated;
revoke all on avanteza.oauth_states from authenticated;

grant usage on schema avanteza to authenticated, service_role;
grant all on all tables in schema avanteza to service_role;
grant all on all sequences in schema avanteza to service_role;
grant select, insert, update, delete on
  avanteza.settings, avanteza.clients, avanteza.listings, avanteza.listing_snapshots, avanteza.orders,
  avanteza.questions, avanteza.ads_campaigns, avanteza.daily_snapshots, avanteza.webhook_events,
  avanteza.alert_rules, avanteza.alerts, avanteza.action_policies, avanteza.actions, avanteza.audit_log,
  avanteza.job_runs
  to authenticated;
grant select on avanteza.admins to authenticated;
grant usage, select on all sequences in schema avanteza to authenticated;
revoke all on schema avanteza from anon;
