// Motor de alertas: avalia regras por cliente/conta, abre alertas novos, resolve os que sumiram e notifica.
import { adminDb } from "../supabase/admin";
import { addDays, spDate } from "../dates";
import { DEFAULT_RULES, evaluateRule, type AccountContext, type AlertCandidate, type Rule } from "./rules";
import { getChannels, type AlertMessage } from "./channels";

export async function ensureDefaultRules(clientId: string) {
  await adminDb()
    .from("alert_rules")
    .upsert(DEFAULT_RULES.map((r) => ({ client_id: clientId, ...r })), { onConflict: "client_id,rule_type", ignoreDuplicates: true });
}

export async function runAlerts() {
  const db = adminDb();
  const today = spDate();
  const { data: clients } = await db.from("clients").select("id, name").eq("active", true);
  const created: (AlertMessage & { id: string })[] = [];
  let resolved = 0;

  for (const client of clients ?? []) {
    const { data: rules } = await db.from("alert_rules").select("*").eq("client_id", client.id).eq("enabled", true);
    const { data: accounts } = await db
      .from("marketplace_accounts")
      .select("id, nickname, external_user_id")
      .eq("client_id", client.id)
      .eq("status", "active");
    for (const acc of accounts ?? []) {
      const [snaps, listings, questions, campaigns] = await Promise.all([
        db.from("daily_snapshots").select("*").eq("account_id", acc.id).gte("snapshot_date", addDays(today, -21)).order("snapshot_date"),
        db.from("listings").select("external_id,title,status,sub_status,available_quantity").eq("account_id", acc.id),
        db.from("questions").select("external_id,item_id,text,status,date_created").eq("account_id", acc.id).eq("status", "UNANSWERED"),
        db.from("ads_campaigns").select("external_id,name,status,metrics_7d").eq("account_id", acc.id),
      ]);
      const ctx: AccountContext = {
        accountId: acc.id,
        nickname: acc.nickname ?? acc.external_user_id,
        snapshots: (snaps.data ?? []) as AccountContext["snapshots"],
        listings: (listings.data ?? []) as AccountContext["listings"],
        questions: (questions.data ?? []) as AccountContext["questions"],
        campaigns: (campaigns.data ?? []) as AccountContext["campaigns"],
        now: new Date(),
      };
      for (const rule of (rules ?? []) as Rule[]) {
        const candidates: AlertCandidate[] = evaluateRule(rule, ctx);
        const keys = new Set(candidates.map((c) => c.dedupKey));
        // Resolve alertas abertos dessa regra/conta que não se repetem mais (exceto eventos pontuais)
        if (!["reputation_drop", "sales_drop"].includes(rule.rule_type)) {
          const { data: open } = await db
            .from("alerts")
            .select("id, dedup_key")
            .eq("account_id", acc.id)
            .eq("rule_type", rule.rule_type)
            .neq("status", "resolved");
          const toResolve = (open ?? []).filter((a) => !keys.has(a.dedup_key)).map((a) => a.id);
          if (toResolve.length) {
            await db.from("alerts").update({ status: "resolved", resolved_at: new Date().toISOString() }).in("id", toResolve);
            resolved += toResolve.length;
          }
        }
        for (const c of candidates) {
          const { data: ins, error } = await db
            .from("alerts")
            .insert({
              client_id: client.id,
              account_id: acc.id,
              rule_type: rule.rule_type,
              severity: c.severity,
              title: c.title,
              message: c.message,
              dedup_key: c.dedupKey,
              data: c.data ?? null,
            })
            .select("id")
            .maybeSingle();
          if (!error && ins) created.push({ id: ins.id, clientName: client.name, title: c.title, message: c.message, severity: c.severity });
          // erro 23505 = já existe alerta aberto com essa chave (deduplicação)
        }
      }
    }
  }

  // Notificação agrupada
  const sent: string[] = [];
  if (created.length) {
    const { data: settings } = await db.from("settings").select("alert_email").single();
    for (const ch of getChannels()) {
      try {
        await ch.send(created, settings?.alert_email);
        sent.push(ch.name);
      } catch (err) {
        console.error(`[alertas] canal ${ch.name} falhou:`, err instanceof Error ? err.message : err);
      }
    }
    if (sent.length) await db.from("alerts").update({ notified_channels: sent }).in("id", created.map((c) => c.id));
  }
  return { created: created.length, resolved, channels: sent };
}
