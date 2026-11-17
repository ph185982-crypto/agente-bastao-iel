// Relatório semanal do cliente — geração (cron "relatorios", toda segunda), revisão da equipe e publicação.
// Lado da EQUIPE/rotina: quem chama confere o papel. O cliente lê só os PUBLICADOS por src/lib/mapa/relatorios.ts (escopo da sessão).
// Só entra no relatório o que o cliente já pode ver no Mapa: ações visíveis, números dos marketplaces e dos canais dele.
// Idempotente: um relatório por cliente e semana (unique client_id, semana); rodar de novo não duplica nem reescreve.
import { z } from "zod";
import { rawQuery } from "../db/client";
import { appUrl } from "../env";
import { enviarEmail } from "../alerts/channels";
import { getAiProvider, type AiProvider } from "../ai/provider";
import { sumPeriod, variation, type SnapRow } from "../mapa/metrics";
import { addDaysStr } from "../mapa/plan";
import { isUuid } from "../motor/repo";
import { lerSnapshots, obterCanal } from "../channels/store";
import { relAnuncios, relInstagram } from "../channels/report";
import { RESULTADO_PADRAO, type OrigemDado } from "../channels/types";
import type { PeriodoResolvido } from "../dashboards/periodo";
import { aberturaModelo, destaquesDe, semanaAnterior, type DadosRelatorio, type ItemRelatorio } from "./semana";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface DepsRelatorio {
  /** IA para o texto de abertura. null = sem IA (modelo fixo). Ausente = a do ambiente (só se tiver chave). */
  provider?: AiProvider | null;
  /** Envio de e-mail (injetável nos testes). Devolve false quando não há configuração. */
  enviar?: (to: string, subject: string, html: string) => Promise<boolean>;
}

// ───────────────────────── Coleta dos números ─────────────────────────

export async function coletarDados(clientId: string, de: string, ate: string, hoje: string): Promise<DadosRelatorio> {
  const [cli] = await rawQuery<{ name: string; kind: string }>("select name, kind from avanteza.clients where id = $1", [clientId]);
  const antDe = addDaysStr(de, -7), antAte = addDaysStr(de, -1);

  // Marketplaces (quando houver conta)
  let marketplaces: DadosRelatorio["marketplaces"] = null;
  const snaps = await rawQuery<SnapRow>(
    `select s.snapshot_date, s.revenue, s.orders_count, s.units_sold, s.visits, s.ads_cost, s.ads_revenue
       from avanteza.daily_snapshots s join avanteza.marketplace_accounts m on m.id = s.account_id
      where m.client_id = $1 and s.snapshot_date between $2 and $3`,
    [clientId, antDe, ate],
  );
  if (snaps.length) {
    const cur = sumPeriod(snaps, de, ate), prev = sumPeriod(snaps, antDe, antAte);
    const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
    marketplaces = {
      faturamento: cur.revenue, pedidos: cur.orders, ticket: cur.ticket, adsCusto: cur.adsCost, adsReceita: cur.adsRevenue, roas: cur.roas, visitas: cur.visits,
      variacaoFaturamento: r1(variation(cur.revenue, prev.revenue)), variacaoPedidos: r1(variation(cur.orders, prev.orders)),
    };
  }

  // Meta Ads e Instagram (cada fonte separada, como no Mapa)
  let anuncios: DadosRelatorio["anuncios"] = null, instagram: DadosRelatorio["instagram"] = null;
  const canal = await obterCanal(clientId);
  if (canal) {
    const periodo: PeriodoResolvido = { id: "7", atual: { de, ate, dias: 7 }, anterior: { de: antDe, ate: antAte, dias: 7 } };
    const adsOk = (canal.adsSource === "meta" || canal.adsSource === "windsor") && Boolean(canal.adAccountId) && Boolean(canal.lastSyncAt);
    const igOk = (canal.igSource === "windsor" || (canal.igSource === "meta" && Boolean(canal.igUserId))) && Boolean(canal.igLastSyncAt);
    if (adsOk) {
      const rows = await lerSnapshots(clientId, ["campaign_daily"], antDe, ate, canal.adsSource as OrigemDado);
      const rel = relAnuncios(rows as any, periodo, canal.campaignIds);
      if (rel.temDadosNoPeriodo) {
        anuncios = {
          gasto: rel.atual.gasto, resultados: rel.atual.resultados, custoPorResultado: rel.atual.custoPorResultado, cliques: rel.atual.cliques, impressoes: rel.atual.impressoes,
          ctr: rel.atual.ctr, variacaoResultados: rel.anterior && rel.anterior.resultados > 0 ? Math.round(((rel.atual.resultados - rel.anterior.resultados) / rel.anterior.resultados) * 1000) / 10 : null,
          rotuloResultado: canal.resultActionType === RESULTADO_PADRAO ? "conversas no WhatsApp" : "resultados",
        };
      }
    }
    if (igOk) {
      const fonte = canal.igSource as OrigemDado;
      const [ig, midias] = await Promise.all([
        lerSnapshots(clientId, ["ig_daily"], addDaysStr(ate, -420), ate, fonte),
        lerSnapshots(clientId, ["ig_media"], de, ate, fonte),
      ]);
      const rel = relInstagram([...ig, ...midias] as any, periodo);
      if (rel.temDados) {
        const k = (id: string) => rel.kpis.find((x) => x.id === id);
        const top = rel.midias.find((m) => m.data >= de && m.data <= ate) ?? null;
        instagram = {
          seguidores: rel.seguidores.atual, ganho: rel.seguidores.ganho, alcance: k("reach")?.atual ?? null, interacoes: k("total_interactions")?.atual ?? null,
          variacaoAlcance: k("reach")?.variacao ?? null,
          melhorPost: top ? { rotulo: top.rotulo, legenda: top.legenda ? top.legenda.slice(0, 140) : null, interacoes: top.interacoes } : null,
        };
      }
    }
  }

  // Entregas (só o que o cliente vê no Mapa)
  const visiveis = "client_id = $1 and visible_to_client and archived_at is null";
  const [feitas, proximas, depende, aprovar] = await Promise.all([
    rawQuery<{ title: string; d: string }>(
      `select title, to_char((completed_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d from avanteza.plan_actions
        where ${visiveis} and status = 'concluida' and (completed_at at time zone 'America/Sao_Paulo')::date between $2 and $3 order by completed_at limit 30`,
      [clientId, de, ate],
    ),
    rawQuery<{ title: string; due_date: string | null }>(
      `select title, due_date from avanteza.plan_actions where ${visiveis} and status <> 'concluida' and owner = 'avanteza' and status <> 'bloqueada'
        and due_date between $2 and $3 order by due_date, priority limit 15`,
      [clientId, hoje, addDaysStr(hoje, 7)],
    ),
    rawQuery<{ title: string; due_date: string | null; status: string; blocked_reason: string | null }>(
      `select title, due_date, status, blocked_reason from avanteza.plan_actions where ${visiveis} and status <> 'concluida'
        and (owner = 'cliente' or status = 'bloqueada') and (status = 'bloqueada' or due_date is null or due_date <= $2) order by due_date nulls last limit 20`,
      [clientId, addDaysStr(hoje, 14)],
    ),
    rawQuery<{ titulo: string; prazo: string | null }>("select titulo, prazo from avanteza.aprovacoes where client_id = $1 and status = 'pendente' order by prazo nulls last limit 10", [clientId]),
  ]);
  const dependeDoCliente: ItemRelatorio[] = [
    ...aprovar.map((a) => ({ titulo: `Aprovar: ${a.titulo}`, data: a.prazo, detalhe: "Em “Para aprovar” no Mapa" })),
    ...depende.map((a) => ({ titulo: a.title, data: a.due_date, detalhe: a.status === "bloqueada" ? a.blocked_reason : null })),
  ];
  return {
    cliente: cli?.name ?? "Cliente",
    periodo: { de, ate },
    marketplaces, anuncios, instagram,
    entregas: feitas.map((a) => ({ titulo: a.title, data: a.d })),
    proximas: proximas.map((a) => ({ titulo: a.title, data: a.due_date })),
    dependeDoCliente,
  };
}

// ───────────────────────── Texto de abertura ─────────────────────────

const AberturaSchema = z.object({ abertura: z.string().min(20).max(900), destaques: z.array(z.string().min(5).max(220)).max(5) });
const SISTEMA = `Você escreve o texto de abertura do relatório semanal que a Avanteza (consultoria de marketplaces e mídia) envia ao cliente.
Português do Brasil, tom próximo e profissional, 2 a 4 frases, sem jargão. Use SOMENTE os números e itens do JSON; não invente métricas,
causas ou promessas. Se algo depende do cliente, mencione com gentileza. "destaques": até 5 frases curtas e factuais.`;

async function abertura(d: DadosRelatorio, deps: DepsRelatorio): Promise<{ texto: string; destaques: string[]; origem: "ia" | "modelo" }> {
  const padrao = { texto: aberturaModelo(d), destaques: destaquesDe(d), origem: "modelo" as const };
  let provider: AiProvider | null;
  try {
    provider = deps.provider === undefined ? getAiProvider() : deps.provider;
  } catch {
    provider = null;
  }
  if (!provider || !provider.enabled()) return padrao;
  try {
    const r = await provider.extract(SISTEMA, JSON.stringify(d), AberturaSchema);
    return { texto: r.output.abertura.trim(), destaques: r.output.destaques.length ? r.output.destaques : padrao.destaques, origem: "ia" };
  } catch {
    return padrao;
  }
}

// ───────────────────────── Geração ─────────────────────────

export interface RelatorioLinha {
  id: string; client_id: string; client_name: string; semana: string; periodo_fim: string; status: string; dados: DadosRelatorio; abertura: string;
  abertura_origem: string; destaques: string[]; publicar_apos: string | null; revisado_por: string | null; publicado_por: string | null;
  publicado_em: string | null; email_status: string | null; criado_em: string; relatorio_modo: string; contact_email: string | null;
}

/** Gera o relatório da semana anterior a `hoje` para UM cliente. Já existe → não faz nada (criado = false). */
export async function gerarRelatorio(clientId: string, hoje: string, deps: DepsRelatorio = {}): Promise<{ criado: boolean; id: string | null; origem?: string }> {
  if (!isUuid(clientId)) return { criado: false, id: null };
  const [cli] = await rawQuery<{ relatorio_modo: string; relatorio_horas: number }>("select relatorio_modo, relatorio_horas from avanteza.clients where id = $1", [clientId]);
  if (!cli) return { criado: false, id: null };
  const { de, ate } = semanaAnterior(hoje);
  const [ja] = await rawQuery<{ id: string }>("select id from avanteza.relatorios_semanais where client_id = $1 and semana = $2", [clientId, de]);
  if (ja) return { criado: false, id: ja.id };
  const dados = await coletarDados(clientId, de, ate, hoje);
  const ab = await abertura(dados, deps);
  const r = await rawQuery<{ id: string }>(
    `insert into avanteza.relatorios_semanais (client_id, semana, periodo_fim, dados, abertura, abertura_origem, destaques, publicar_apos)
     values ($1,$2,$3,$4,$5,$6,$7, case when $8 = 'auto' then now() + ($9::int * interval '1 hour') else null end)
     on conflict (client_id, semana) do nothing returning id`,
    [clientId, de, ate, JSON.stringify(dados), ab.texto, ab.origem, JSON.stringify(ab.destaques), cli.relatorio_modo, cli.relatorio_horas],
  );
  if (!r.length) {
    const [x] = await rawQuery<{ id: string }>("select id from avanteza.relatorios_semanais where client_id = $1 and semana = $2", [clientId, de]);
    return { criado: false, id: x?.id ?? null };
  }
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('relatorio_gerado', 'rotina', $1, $2)", [clientId, JSON.stringify({ id: r[0].id, semana: de, origem: ab.origem })]);
  return { criado: true, id: r[0].id, origem: ab.origem };
}

/** Job "relatorios" (segunda cedo): um relatório por cliente ativo com o relatório ligado; depois publica os vencidos. */
export async function gerarRelatoriosDaSemana(hoje: string, deps: DepsRelatorio = {}, tempoMaxMs = 240_000) {
  const ate = Date.now() + tempoMaxMs;
  const clientes = await rawQuery<{ id: string }>("select id from avanteza.clients where active and relatorio_modo <> 'desligado' order by name");
  const out = { semana: semanaAnterior(hoje).de, clientes: clientes.length, criados: 0, existentes: 0, ia: 0, erros: [] as string[], publicacao: null as unknown };
  for (const c of clientes) {
    if (Date.now() > ate) { out.erros.push("tempo máximo atingido; o restante sai na próxima execução"); break; }
    try {
      const r = await gerarRelatorio(c.id, hoje, deps);
      if (r.criado) { out.criados++; if (r.origem === "ia") out.ia++; } else out.existentes++;
    } catch (e) {
      out.erros.push(`${c.id}: ${e instanceof Error ? e.message.slice(0, 160) : "falha"}`);
    }
  }
  out.publicacao = await publicarVencidos(deps);
  return out;
}

// ───────────────────────── Publicação ─────────────────────────

export function emailRelatorioHtml(cliente: string, de: string, ate: string, link: string, destaques: string[]): string {
  const li = destaques.slice(0, 5).map((d) => `<li style="margin:4px 0">${esc(d)}</li>`).join("");
  return `<div style="font-family:Manrope,Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
  <h2 style="margin:0 0 8px">avanteza<span style="color:#FF6A1F">.</span> — relatório da semana</h2>
  <p>Olá! O relatório da ${esc(cliente)} da semana de ${de.slice(8, 10)}/${de.slice(5, 7)} a ${ate.slice(8, 10)}/${ate.slice(5, 7)} já está no seu Mapa.</p>
  ${li ? `<ul style="padding-left:18px">${li}</ul>` : ""}
  <p style="margin-top:18px"><a href="${link}" style="display:inline-block;background:#FF6A1F;color:#0B1B33;font-weight:700;padding:10px 16px;border-radius:6px;text-decoration:none">Abrir o relatório</a></p>
  <p style="color:#5b6472;font-size:13px">Você recebe este e-mail porque é o contato da sua empresa na Avanteza.</p></div>`;
}

/**
 * Publica um rascunho (a troca de status é condicional: publicar duas vezes não manda dois e-mails).
 * E-mail ao contato do cliente com o link do Mapa quando há contato e e-mail configurado.
 */
export async function publicarRelatorio(id: string, actor: string, deps: DepsRelatorio = {}): Promise<{ ok: boolean; erro?: string; email?: string }> {
  if (!isUuid(id)) return { ok: false, erro: "Relatório não encontrado." };
  const r = await rawQuery<{ client_id: string; semana: string; periodo_fim: string; destaques: string[] }>(
    `update avanteza.relatorios_semanais set status = 'publicado', publicado_em = now(), publicado_por = $2, atualizado_em = now()
      where id = $1 and status = 'rascunho' returning client_id, semana, periodo_fim, destaques`,
    [id, actor],
  );
  if (!r.length) return { ok: false, erro: "Este relatório já foi publicado ou descartado." };
  const rel = r[0];
  const [cli] = await rawQuery<{ name: string; contact_email: string | null }>("select name, contact_email from avanteza.clients where id = $1", [rel.client_id]);
  let email = "sem_contato";
  if (cli?.contact_email) {
    try {
      const ok = await (deps.enviar ?? enviarEmail)(cli.contact_email, `Seu relatório semanal — ${cli.name}`, emailRelatorioHtml(cli.name, rel.semana, rel.periodo_fim, `${appUrl()}/mapa/relatorios/${id}`, rel.destaques ?? []));
      email = ok ? "enviado" : "sem_configuracao";
    } catch {
      email = "falhou";
    }
  }
  await rawQuery("update avanteza.relatorios_semanais set email_status = $2 where id = $1", [id, email]);
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('relatorio_publicado', $1, $2, $3)", [actor, rel.client_id, JSON.stringify({ id, email })]);
  return { ok: true, email };
}

/** Publica os rascunhos cujo prazo de revisão passou (modo automático). Roda no "tick" e no job "relatorios". */
export async function publicarVencidos(deps: DepsRelatorio = {}) {
  const ids = await rawQuery<{ id: string }>(
    "select r.id from avanteza.relatorios_semanais r join avanteza.clients c on c.id = r.client_id where r.status = 'rascunho' and r.publicar_apos is not null and r.publicar_apos <= now() and c.relatorio_modo = 'auto' order by r.publicar_apos limit 50",
  );
  const out = { publicados: 0, emails: 0 };
  for (const { id } of ids) {
    const r = await publicarRelatorio(id, "automatico", deps);
    if (r.ok) { out.publicados++; if (r.email === "enviado") out.emails++; }
  }
  return out;
}

export async function salvarRevisao(actor: string, id: string, d: { abertura: string; destaques: string[] }): Promise<{ ok: boolean; erro?: string }> {
  if (!isUuid(id)) return { ok: false, erro: "Relatório não encontrado." };
  const ab = d.abertura.trim();
  if (ab.length < 10) return { ok: false, erro: "Escreva o texto de abertura." };
  const destaques = d.destaques.map((x) => x.trim()).filter(Boolean).slice(0, 5).map((x) => x.slice(0, 220));
  const r = await rawQuery<{ client_id: string }>(
    `update avanteza.relatorios_semanais set abertura = $2, destaques = $3, abertura_origem = 'equipe', revisado_por = $4, atualizado_em = now()
      where id = $1 and status = 'rascunho' returning client_id`,
    [id, ab.slice(0, 2000), JSON.stringify(destaques), actor],
  );
  if (!r.length) return { ok: false, erro: "Só rascunhos podem ser editados." };
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('relatorio_revisado', $1, $2, $3)", [actor, r[0].client_id, JSON.stringify({ id })]);
  return { ok: true };
}

export async function descartarRelatorio(actor: string, id: string): Promise<{ ok: boolean; erro?: string }> {
  if (!isUuid(id)) return { ok: false, erro: "Relatório não encontrado." };
  const r = await rawQuery<{ client_id: string }>("update avanteza.relatorios_semanais set status = 'descartado', atualizado_em = now() where id = $1 and status = 'rascunho' returning client_id", [id]);
  if (!r.length) return { ok: false, erro: "Só rascunhos podem ser descartados." };
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('relatorio_descartado', $1, $2, $3)", [actor, r[0].client_id, JSON.stringify({ id })]);
  return { ok: true };
}

const COLS_REL = `r.id, r.client_id, c.name as client_name, to_char(r.semana, 'YYYY-MM-DD') as semana, to_char(r.periodo_fim, 'YYYY-MM-DD') as periodo_fim, r.status, r.dados,
  r.abertura, r.abertura_origem, r.destaques, r.publicar_apos, r.revisado_por, r.publicado_por, r.publicado_em, r.email_status, r.criado_em, c.relatorio_modo, c.contact_email`;

export async function relatoriosParaEquipe(o: { clientId?: string | null } = {}) {
  const cli = o.clientId && isUuid(o.clientId) ? o.clientId : null;
  const f = cli ? "and r.client_id = $1" : "";
  const p = cli ? [cli] : [];
  const [rascunhos, recentes] = await Promise.all([
    rawQuery<RelatorioLinha>(`select ${COLS_REL} from avanteza.relatorios_semanais r join avanteza.clients c on c.id = r.client_id where r.status = 'rascunho' ${f} order by r.publicar_apos nulls last, c.name`, p),
    rawQuery<RelatorioLinha>(`select ${COLS_REL} from avanteza.relatorios_semanais r join avanteza.clients c on c.id = r.client_id where r.status <> 'rascunho' ${f} order by r.semana desc, c.name limit ${cli ? 26 : 40}`, p),
  ]);
  return { rascunhos, recentes };
}

export async function relatorioEquipe(id: string): Promise<RelatorioLinha | null> {
  if (!isUuid(id)) return null;
  const [r] = await rawQuery<RelatorioLinha>(`select ${COLS_REL} from avanteza.relatorios_semanais r join avanteza.clients c on c.id = r.client_id where r.id = $1`, [id]);
  return r ?? null;
}

/** Preferências do relatório e dos lembretes (ficha do cliente). */
export async function salvarPreferencias(actor: string, clientId: string, d: { modo: string; horas: number; lembretes: boolean }): Promise<{ ok: boolean; erro?: string }> {
  if (!isUuid(clientId)) return { ok: false, erro: "Cliente inválido." };
  if (!["auto", "revisao", "desligado"].includes(d.modo)) return { ok: false, erro: "Modo inválido." };
  if (!Number.isInteger(d.horas) || d.horas < 1 || d.horas > 168) return { ok: false, erro: "Horas de revisão: de 1 a 168." };
  await rawQuery("update avanteza.clients set relatorio_modo = $2, relatorio_horas = $3, lembretes_ativos = $4 where id = $1", [clientId, d.modo, d.horas, d.lembretes]);
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('cliente_preferencias_mapa', $1, $2, $3)", [actor, clientId, JSON.stringify(d)]);
  return { ok: true };
}
