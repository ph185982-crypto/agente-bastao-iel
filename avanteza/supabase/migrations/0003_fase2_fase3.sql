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
alter table avanteza.ai_reports enable row level security;
drop policy if exists admin_all on avanteza.ai_reports;
create policy admin_all on avanteza.ai_reports for all to authenticated using (avanteza.is_admin()) with check (avanteza.is_admin());
grant select, insert, update, delete on avanteza.ai_reports to authenticated;
grant all on avanteza.ai_reports to service_role;

-- Autonomia: teto diário de ações automáticas por cliente e IA liga/desliga
alter table avanteza.settings add column if not exists max_auto_actions_per_day integer not null default 20;
alter table avanteza.settings add column if not exists ai_enabled boolean not null default true;
alter table avanteza.clients add column if not exists ai_enabled boolean not null default true;
alter table avanteza.clients add column if not exists ai_instructions text; -- contexto do negócio para a IA

-- Regra pode propor ação automaticamente (ex.: ROAS baixo → reduzir verba)
alter table avanteza.alert_rules add column if not exists propose_action boolean not null default false;
