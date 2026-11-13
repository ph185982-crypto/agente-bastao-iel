// Agente diário: lê os dados de cada cliente, gera resumo/diagnóstico, propõe ações na fila
// (sempre com justificativa) e monta o relatório diário pronto para envio.
import { adminDb } from "../db";
import { addDays, spDate } from "../dates";
import { proposeAction } from "../executor/executor";
import { ACTION_LABEL, resolvePolicy, type PolicyRow } from "../executor/policy";
import { getAiProvider } from "./provider";
import { toExecutorPayload, type AgentOutput, type ProposedAction } from "./schema";
import { buildReportText, type ReportData } from "./report";
import type { ActionType } from "../marketplaces/types";

export const SYSTEM_PROMPT = `Você é o analista sênior da Avanteza, consultoria que gere contas de Mercado Livre de médias e grandes empresas.
Recebe os dados de UM cliente (JSON) e devolve: um resumo executivo, um diagnóstico e ações propostas.

Como trabalhar:
- Baseie tudo nos números recebidos. Cite os números na justificativa de cada ação. Não invente dados nem IDs.
- Use apenas IDs (conta_id, anúncio, pergunta, campanha) que aparecem no contexto.
- Proponha só ações com impacto claro em receita, margem ou reputação. Se nada se justifica, devolva a lista de ações vazia.
- Respeite os limites informados em "limites" (variação máxima de preço/verba por dia). Nunca proponha ações bloqueadas.
- Não repita ações que já estão na fila ou foram executadas nos últimos 7 dias ("acoes_recentes").
- Respostas a perguntas: cordiais, objetivas, em português do Brasil, sem prometer o que o anúncio não garante, sem dados de contato externos (proibido pelo Mercado Livre).
- Títulos: até 60 caracteres, palavras de busca relevantes primeiro, sem caixa alta exagerada nem símbolos.
- Verba de Ads: reduza onde o ROAS está abaixo da meta com gasto relevante; aumente só onde o ROAS está bem acima da meta e a verba limita.
- Tom do texto: preciso, institucional, direto. Sem emojis.`;

type Json = Record<string, any>;

export async function buildContext(clientId: string) {
  const db = adminDb();
  const today = spDate();
  const { data: client } = await db.from("clients").select("*").eq("id", clientId).single();
  const { data: accounts } = await db
    .from("marketplace_accounts")
    .select("id, nickname, marketplace, external_user_id")
    .eq("client_id", clientId)
    .eq("status", "active");
  const accIds = (accounts ?? []).map((a) => a.id);
  if (!accIds.length) return null;

  const [snaps, listings, questions, campaigns, alerts, actions, policies] = await Promise.all([
    db.from("daily_snapshots").select("*").in("account_id", accIds).gte("snapshot_date", addDays(today, -14)).order("snapshot_date"),
    db.from("listings").select("account_id, external_id, title, status, sub_status, price, available_quantity, sold_quantity, visits_30d").in("account_id", accIds),
    db.from("questions").select("account_id, external_id, item_id, text, date_created").in("account_id", accIds).eq("status", "UNANSWERED").order("date_created").limit(30),
    db.from("ads_campaigns").select("account_id, external_id, name, status, budget, strategy, roas_target, metrics_7d").in("account_id", accIds),
    db.from("alerts").select("rule_type, severity, title, message").eq("client_id", clientId).neq("status", "resolved").limit(30),
    db.from("actions").select("action_type, target_id, status, created_at").eq("client_id", clientId).gte("created_at", addDays(today, -7)),
    db.from("action_policies").select("*"),
  ]);

  const L = listings.data ?? [];
  const top = [...L].sort((a, b) => (b.sold_quantity ?? 0) - (a.sold_quantity ?? 0)).slice(0, 40);
  const problems = L.filter((l) => l.status !== "active" || (l.available_quantity ?? 0) === 0).slice(0, 20);
  const listingSet = new Map<string, Json>();
  for (const l of [...top, ...problems]) listingSet.set(l.external_id, l);
  for (const q of questions.data ?? []) {
    const l = L.find((x) => x.external_id === q.item_id);
    if (l) listingSet.set(l.external_id, l);
  }

  const P = (policies.data ?? []) as PolicyRow[];
  const limites = Object.fromEntries(
    (Object.keys(ACTION_LABEL) as ActionType[]).map((t) => {
      const p = resolvePolicy(t, clientId, P);
      return [t, { modo: p.mode, max_variacao_pct_dia: p.max_change_pct_per_day }];
    }),
  );

  const context = {
    data_hoje: today,
    cliente: { nome: client?.name, observacoes: client?.notes ?? null, instrucoes: client?.ai_instructions ?? null },
    contas: (accounts ?? []).map((a) => ({ conta_id: a.id, apelido: a.nickname, marketplace: a.marketplace })),
    historico_diario: (snaps.data ?? []).map((s) => ({
      conta_id: s.account_id,
      data: s.snapshot_date,
      parcial: s.snapshot_date === today,
      pedidos: s.orders_count,
      faturamento: Number(s.revenue ?? 0),
      visitas: s.visits,
      ads_custo: s.ads_cost,
      ads_receita: s.ads_revenue,
      ads_roas: s.ads_roas,
      reputacao: s.reputation_level,
      reclamacoes: s.claims_rate,
      atrasos: s.delayed_rate,
      cancelamentos: s.cancellations_rate,
      anuncios_ativos: s.active_listings,
      anuncios_pausados: s.paused_listings,
      sem_estoque: s.out_of_stock_listings,
    })),
    anuncios: [...listingSet.values()].map((l) => ({
      conta_id: l.account_id,
      id: l.external_id,
      titulo: l.title,
      status: l.status,
      sub_status: l.sub_status,
      preco: l.price,
      estoque: l.available_quantity,
      vendidos_total: l.sold_quantity,
      visitas_30d: l.visits_30d,
    })),
    perguntas_sem_resposta: (questions.data ?? []).map((q) => ({
      conta_id: q.account_id,
      id: q.external_id,
      anuncio: q.item_id,
      texto: q.text,
      recebida_em: q.date_created,
    })),
    campanhas_ads: (campaigns.data ?? []).map((c) => ({
      conta_id: c.account_id,
      id: c.external_id,
      nome: c.name,
      status: c.status,
      verba: c.budget,
      estrategia: c.strategy,
      roas_meta: c.roas_target,
      metricas_7d: c.metrics_7d,
    })),
    alertas_abertos: alerts.data ?? [],
    acoes_recentes: (actions.data ?? []).map((a) => ({ tipo: a.action_type, alvo: a.target_id, status: a.status })),
    limites,
  };

  const valid = {
    accounts: new Set(accIds),
    listings: new Set(L.map((l) => l.external_id)),
    questions: new Set((questions.data ?? []).map((q) => q.external_id)),
    campaigns: new Set((campaigns.data ?? []).map((c) => c.external_id)),
    pending: new Set(
      (actions.data ?? [])
        .filter((a) => ["proposed", "approved", "executing"].includes(a.status))
        .map((a) => `${a.action_type}:${a.target_id}`),
    ),
    blocked: new Set(Object.entries(limites).filter(([, v]) => v.modo === "blocked").map(([k]) => k)),
  };
  return { client, context, valid };
}

/** Filtra ações da IA: IDs precisam existir no contexto; sem duplicatas; nada bloqueado. */
export function filterProposals(
  acoes: ProposedAction[],
  valid: { accounts: Set<string>; listings: Set<string>; questions: Set<string>; campaigns: Set<string>; pending: Set<string>; blocked: Set<string> },
): { ok: ProposedAction[]; dropped: { acao: ProposedAction; motivo: string }[] } {
  const ok: ProposedAction[] = [];
  const dropped: { acao: ProposedAction; motivo: string }[] = [];
  const seen = new Set<string>();
  for (const a of acoes.slice(0, 8)) {
    const key = `${a.tipo}:${a.alvo}`;
    const targetOk =
      a.tipo === "answer_question" ? valid.questions.has(a.alvo) :
      a.tipo.startsWith("update_ads") ? valid.campaigns.has(a.alvo) :
      valid.listings.has(a.alvo);
    if (!valid.accounts.has(a.conta_id)) dropped.push({ acao: a, motivo: "conta inexistente" });
    else if (!targetOk) dropped.push({ acao: a, motivo: "alvo não encontrado nos dados" });
    else if (valid.blocked.has(a.tipo)) dropped.push({ acao: a, motivo: "tipo de ação bloqueado" });
    else if (valid.pending.has(key) || seen.has(key)) dropped.push({ acao: a, motivo: "duplicada" });
    else {
      ok.push(a);
      seen.add(key);
    }
  }
  return { ok, dropped };
}

async function reportData(clientId: string, clientName: string, ai: AgentOutput | null): Promise<ReportData> {
  const db = adminDb();
  const today = spDate();
  const { data: accounts } = await db.from("marketplace_accounts").select("id").eq("client_id", clientId).eq("status", "active");
  const ids = (accounts ?? []).map((a) => a.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [snaps, alerts, actions] = await Promise.all([
    db.from("daily_snapshots").select("*").in("account_id", ids.length ? ids : none).gte("snapshot_date", addDays(today, -15)),
    db.from("alerts").select("severity").eq("client_id", clientId).neq("status", "resolved"),
    db.from("actions").select("action_type, target_id, status, decided_by, executed_at").eq("client_id", clientId).in("status", ["executed", "simulated"]).gte("executed_at", new Date(Date.now() - 86400_000).toISOString()),
  ]);
  return {
    clientName,
    today,
    snapshots: (snaps.data ?? []) as ReportData["snapshots"],
    openAlerts: (alerts.data ?? []).length,
    criticalAlerts: (alerts.data ?? []).filter((a) => a.severity === "critical").length,
    actions: (actions.data ?? []) as ReportData["actions"],
    aiSummary: ai?.resumo ?? null,
    aiDiagnosis: ai?.diagnostico ?? [],
  };
}

export async function runAgentForClient(clientId: string, opts: { force?: boolean } = {}) {
  const db = adminDb();
  const today = spDate();
  if (!opts.force) {
    const { data: existing } = await db.from("ai_reports").select("id").eq("client_id", clientId).eq("report_date", today).maybeSingle();
    if (existing) return { clientId, skipped: true };
  }
  const built = await buildContext(clientId);
  if (!built) return { clientId, skipped: true, reason: "sem contas ativas" };
  const { client, context, valid } = built;

  const { data: settings } = await db.from("settings").select("ai_enabled").single();
  const provider = getAiProvider();
  const useAi = Boolean(settings?.ai_enabled) && client?.ai_enabled !== false && provider.enabled();

  let output: AgentOutput | null = null;
  let meta: { provider?: string; model?: string; usage?: unknown } = {};
  let error: string | null = null;
  let proposed = 0;
  const dropped: unknown[] = [];

  if (useAi) {
    try {
      const r = await provider.analyze(SYSTEM_PROMPT, `Dados do cliente (JSON):\n${JSON.stringify(context)}`);
      output = r.output;
      meta = { provider: r.provider, model: r.model, usage: r.usage };
      const { ok, dropped: d } = filterProposals(output.acoes, valid);
      dropped.push(...d.map((x) => ({ tipo: x.acao.tipo, alvo: x.acao.alvo, motivo: x.motivo })));
      for (const a of ok) {
        try {
          await proposeAction({
            clientId,
            accountId: a.conta_id,
            type: a.tipo,
            targetId: a.alvo,
            payload: toExecutorPayload(a),
            reason: `[IA · prioridade ${a.prioridade}] ${a.justificativa}`,
            source: "ia",
            actor: "agente IA",
          });
          proposed++;
        } catch (err) {
          dropped.push({ tipo: a.tipo, alvo: a.alvo, motivo: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const data = await reportData(clientId, client?.name ?? "Cliente", output);
  const report_text = buildReportText(data);
  await db.from("ai_reports").upsert(
    {
      client_id: clientId,
      report_date: today,
      status: error ? "error" : "ok",
      summary: output?.resumo ?? null,
      diagnosis: output ? { itens: output.diagnostico, descartadas: dropped } : null,
      proposed_count: proposed,
      report_text,
      provider: meta.provider ?? null,
      model: meta.model ?? null,
      usage: (meta.usage as object) ?? null,
      error: error ?? (useAi ? null : "IA desligada ou sem ANTHROPIC_API_KEY: relatório só com números."),
      created_at: new Date().toISOString(),
    },
    { onConflict: "client_id,report_date" },
  );
  return { clientId, proposed, dropped: dropped.length, error };
}

/** Rotina diária: um cliente por vez, dentro do orçamento de tempo da função. */
export async function runDailyAgent(budgetMs = 50_000) {
  const db = adminDb();
  const started = Date.now();
  const today = spDate();
  const { data: clients } = await db.from("clients").select("id").eq("active", true);
  const { data: done } = await db.from("ai_reports").select("client_id").eq("report_date", today);
  const doneSet = new Set((done ?? []).map((d) => d.client_id));
  const results = [];
  for (const c of clients ?? []) {
    if (doneSet.has(c.id)) continue;
    if (Date.now() - started > budgetMs) break;
    results.push(await runAgentForClient(c.id));
  }
  return { processed: results.length, pending: (clients ?? []).length - doneSet.size - results.length, results };
}
