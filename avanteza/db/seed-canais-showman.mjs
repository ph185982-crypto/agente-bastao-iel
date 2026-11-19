// Seed idempotente do canal do cliente Showman (SEM token nem chave):
//   • anúncios pelo Windsor.ai (conector facebook, conta 605261696580859) com a chave da agência WINDSOR_ADS_API_KEY (Vercel);
//     campanhas pelo NOME “SHOW MAN” (sem ids fixos: campanhas novas entram sozinhas; “Destrava - SHOPEE” e outras da mesma conta ficam de fora);
//   • Instagram pelo Windsor.ai, conta showmanbarbearia (WINDSOR_API_KEY: outra conta Windsor, nunca misturada com a dos anúncios);
//   • Google · Perfil da Empresa pelo Windsor.ai (conector google_my_business), local “SHOW MAN BARBEARIA”, com a MESMA chave do Instagram;
//   • alerta de recarga: limite R$ 400, aviso em 80%, ciclo desde 2026-11-01, e-mail do cliente (cópia ao dono via ALERT_EMAIL_TO).
// Rodar de novo atualiza a configuração sem tocar em token/chave, status, histórico coletado nem nos alertas já enviados.
// Mantém o ciclo (spend_alert_since) se ele já tiver sido reiniciado depois de 2026-11-01 (“Recarga feita”), para não reenviar avisos.
// SEGURANÇA: só roda em Postgres local. Para outro banco é preciso --permitir-remoto (decisão consciente).
//   Uso: DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-canais-showman.mjs
import { connect, isLocalUrl } from "./connect.mjs";

const remote = process.argv.includes("--permitir-remoto");
const url = process.env.DATABASE_URL ?? process.env.NEON_URL;
if (!url) throw new Error("Defina DATABASE_URL");
if (!isLocalUrl(url) && !remote) throw new Error("Recusado: DATABASE_URL não é um Postgres local. Use --permitir-remoto só se for de propósito.");

const GOOGLE_LOCAL = "SHOW MAN BARBEARIA";
const ALERTA = { limite: 400, avisoPct: 80, desde: "2026-11-01", emails: ["paulohenriqueph.ph23@gmail.com"] };

const db = await connect(url);
try {
  const { rows: cli } = await db.query("select id from avanteza.clients where slug = 'showman'");
  if (!cli.length) throw new Error("Cliente Showman não encontrado (rode antes db/seed-clientes.mjs).");
  const { rows } = await db.query(
    `insert into avanteza.client_channels (client_id, provider, ad_account_id, campaign_ids, campaign_name_filter, result_action_type, ads_source, ig_source, windsor_account_name, status,
                                           spend_alert_limit, spend_alert_warn_pct, spend_alert_since, spend_alert_emails, gbp_source, gbp_location_name)
     values ($1, 'meta', 'act_605261696580859', '{}', 'SHOW MAN', 'onsite_conversion.messaging_conversation_started_7d', 'windsor', 'windsor', 'showmanbarbearia', 'pendente', $2, $3, $4, $5, 'windsor', $6)
     on conflict (client_id, provider) do update set
       ad_account_id = excluded.ad_account_id, campaign_ids = excluded.campaign_ids, campaign_name_filter = excluded.campaign_name_filter,
       result_action_type = excluded.result_action_type,
       last_sync_at = case when avanteza.client_channels.ads_source is distinct from excluded.ads_source then null else avanteza.client_channels.last_sync_at end,
       last_error = case when avanteza.client_channels.ads_source is distinct from excluded.ads_source then null else avanteza.client_channels.last_error end,
       ads_source = excluded.ads_source, ig_source = excluded.ig_source, windsor_account_name = excluded.windsor_account_name,
       spend_alert_limit = excluded.spend_alert_limit, spend_alert_warn_pct = excluded.spend_alert_warn_pct, spend_alert_emails = excluded.spend_alert_emails,
       gbp_last_sync_at = case when avanteza.client_channels.gbp_location_name is distinct from excluded.gbp_location_name then null else avanteza.client_channels.gbp_last_sync_at end,
       gbp_source = excluded.gbp_source, gbp_location_name = excluded.gbp_location_name,
       spend_alert_since = greatest(coalesce(avanteza.client_channels.spend_alert_since, excluded.spend_alert_since), excluded.spend_alert_since),
       status = case when avanteza.client_channels.status = 'desconectado' then 'pendente' else avanteza.client_channels.status end,
       updated_at = now()
     returning status, ads_source, campaign_name_filter, spend_alert_limit::float8 as limite, to_char(spend_alert_since, 'YYYY-MM-DD') as desde, gbp_source, gbp_location_name`,
    [cli[0].id, ALERTA.limite, ALERTA.avisoPct, ALERTA.desde, ALERTA.emails, GOOGLE_LOCAL],
  );
  const r = rows[0];
  console.log(`canal do Showman ok: anúncios=${r.ads_source} (nome contém “${r.campaign_name_filter}”), status ${r.status}, alerta R$ ${r.limite} desde ${r.desde} (${ALERTA.avisoPct}% e 100%) → ${ALERTA.emails.join(", ")}; Google=${r.gbp_source} (local “${r.gbp_location_name}”)`);
} finally {
  await db.end();
}
