-- Agendamento das rotinas via pg_cron + pg_net (o plano Hobby da Vercel só permite cron diário).
-- O CRON_SECRET fica no Vault do Supabase (nunca em texto no código).
-- Antes de rodar: select vault.create_secret('<CRON_SECRET>', 'avanteza_cron_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function avanteza.call_job(job text) returns bigint
language plpgsql security definer set search_path = avanteza, public, extensions, pg_temp as $$
declare
  secret text;
  base text := 'https://avanteza.vercel.app';
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'avanteza_cron_secret';
  if secret is null then raise exception 'avanteza_cron_secret ausente no Vault'; end if;
  return net.http_post(
    url := base || '/api/cron/' || job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
end $$;
revoke all on function avanteza.call_job(text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname like 'avanteza-%';
select cron.schedule('avanteza-tick',    '*/5 * * * *',  $$select avanteza.call_job('tick')$$);    -- tokens, webhooks, execução
select cron.schedule('avanteza-collect', '7,37 * * * *', $$select avanteza.call_job('collect')$$); -- coleta (1 conta por vez)
select cron.schedule('avanteza-alerts',  '20,50 * * * *', $$select avanteza.call_job('alerts')$$); -- motor de alertas

-- Fase 2: agente de IA e relatório diário (≈ 7h–8h de Brasília; várias chamadas cobrem todos os clientes)
select cron.schedule('avanteza-ai-daily', '5,20,35,50 10,11 * * *', $$select avanteza.call_job('ai-daily')$$);
