// Seed idempotente do canal Meta do cliente Showman (SEM token): conta de anúncios 605261696580859 e a campanha
// "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km" (120252388371430661). O token é colado depois, pelo administrador,
// na aba Canais (Central). Rodar de novo atualiza a configuração sem tocar no token, no status nem no histórico já coletado.
// SEGURANÇA: só roda em Postgres local. Para outro banco é preciso --permitir-remoto (decisão consciente).
//   Uso: DATABASE_URL=postgres://postgres@localhost:54329/mapa_dev node db/seed-canais-showman.mjs
import { connect, isLocalUrl } from "./connect.mjs";

const remote = process.argv.includes("--permitir-remoto");
const url = process.env.DATABASE_URL ?? process.env.NEON_URL;
if (!url) throw new Error("Defina DATABASE_URL");
if (!isLocalUrl(url) && !remote) throw new Error("Recusado: DATABASE_URL não é um Postgres local. Use --permitir-remoto só se for de propósito.");

const db = await connect(url);
try {
  const { rows: cli } = await db.query("select id from avanteza.clients where slug = 'showman'");
  if (!cli.length) throw new Error("Cliente Showman não encontrado (rode antes db/seed-clientes.mjs).");
  const { rows } = await db.query(
    `insert into avanteza.client_channels (client_id, provider, ad_account_id, campaign_ids, result_action_type, status)
     values ($1, 'meta', 'act_605261696580859', array['120252388371430661'], 'onsite_conversion.messaging_conversation_started_7d', 'pendente')
     on conflict (client_id, provider) do update set
       ad_account_id = excluded.ad_account_id, campaign_ids = excluded.campaign_ids, result_action_type = excluded.result_action_type, updated_at = now()
     returning (token_enc is not null) as tem_token, status`,
    [cli[0].id],
  );
  console.log(`canal do Showman ok (status ${rows[0].status}, token ${rows[0].tem_token ? "já salvo (preservado)" : "ainda não informado"})`);
} finally {
  await db.end();
}
