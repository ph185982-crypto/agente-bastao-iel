// Alerta de recarga dos anúncios (conta pré-paga): soma o gasto das campanhas FILTRADAS do canal (ids e/ou nome) desde o início do
// ciclo (spend_alert_since) e avisa em dois níveis: “aviso” (saldo acabando, >= spend_alert_warn_pct % do limite) e “limite”
// (faça a recarga, >= 100 %). Cada nível sai no máximo UMA vez por ciclo (unique client_id, ciclo, nivel em spend_alerts); o botão
// “Recarga feita — reiniciar contagem” grava since = hoje e rearma os dois níveis. A base são os snapshots campaign_daily da fonte de
// anúncios do canal: nada vem de outro cliente nem de campanha fora do filtro. Sem e-mail configurado, registra a pendência e avisa no sino.
import { rawQuery } from "../db/client";
import { appUrl, envOptional } from "../env";
import { enviarEmailPara } from "../alerts/channels";
import { notificar } from "../notificacoes";
import { filtrarLinhasCampanhas, type FiltroCampanhas } from "./campanhas";
import { lerSnapshots, obterCanal, type AlertaGastoConfig, type CanalRow } from "./store";
import type { OrigemDado } from "./types";

export type NivelGasto = "aviso" | "limite";
export interface GastoCiclo {
  desde: string; ate: string; limite: number; avisoPct: number;
  gasto: number; conversas: number; custoPorConversa: number | null;
  /** Percentual do limite já gasto (pode passar de 100). */
  pct: number; restante: number; nivel: NivelGasto | null;
}

const arred = (x: number) => Math.round(x * 100) / 100;
const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };

/** Soma pura do gasto e das conversas das campanhas que passam no filtro, de `desde` até `ate` (inclusive). */
export function somarGastoCiclo(rows: Array<{ kind: string; date: string; key: string; metrics: Record<string, any> }>, filtro: FiltroCampanhas, desde: string, ate: string) {
  const camp = filtrarLinhasCampanhas(rows.filter((r) => r.kind === "campaign_daily" && r.date >= desde && r.date <= ate), filtro);
  let gasto = 0, conversas = 0;
  for (const r of camp) { gasto += num(r.metrics.spend); conversas += num(r.metrics.results); }
  return { gasto: arred(gasto), conversas };
}

export function nivelDoGasto(gasto: number, limite: number, avisoPct: number): NivelGasto | null {
  if (!(limite > 0)) return null;
  if (gasto >= limite) return "limite";
  if (gasto >= arred((limite * avisoPct) / 100)) return "aviso";
  return null;
}

export function calcularGastoCiclo(rows: Parameters<typeof somarGastoCiclo>[0], filtro: FiltroCampanhas, cfg: AlertaGastoConfig, hoje: string): GastoCiclo {
  const { gasto, conversas } = somarGastoCiclo(rows, filtro, cfg.desde, hoje);
  return {
    desde: cfg.desde, ate: hoje, limite: cfg.limite, avisoPct: cfg.avisoPct, gasto, conversas,
    custoPorConversa: conversas > 0 ? arred(gasto / conversas) : null,
    pct: cfg.limite > 0 ? Math.round((gasto / cfg.limite) * 1000) / 10 : 0,
    restante: arred(Math.max(0, cfg.limite - gasto)),
    nivel: nivelDoGasto(gasto, cfg.limite, cfg.avisoPct),
  };
}

const fonteAds = (c: CanalRow): OrigemDado | null => (c.adsSource === "meta" || c.adsSource === "windsor") && c.adAccountId ? c.adsSource : null;

/** Gasto do ciclo atual do canal (null = alerta desligado ou sem fonte de anúncios). Lê só os snapshots DESTE cliente e da fonte do canal. */
export async function gastoDoCiclo(canal: CanalRow | null, hoje: string): Promise<GastoCiclo | null> {
  const fonte = canal ? fonteAds(canal) : null;
  if (!canal || !fonte || !canal.alertaGasto) return null;
  const cfg = canal.alertaGasto;
  const rows = cfg.desde <= hoje ? await lerSnapshots(canal.clientId, ["campaign_daily"], cfg.desde, hoje, fonte) : [];
  return calcularGastoCiclo(rows, { campaignIds: canal.campaignIds, campaignNameFilter: canal.campaignNameFilter }, cfg, hoje);
}

// ─── E-mail ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function assuntoAlerta(cliente: string, nivel: NivelGasto, g: GastoCiclo): string {
  return nivel === "limite"
    ? `${cliente}: faça a recarga dos anúncios (${reais(g.gasto)} de ${reais(g.limite)})`
    : `${cliente}: saldo dos anúncios acabando (${reais(g.gasto)} de ${reais(g.limite)})`;
}

export function emailAlertaHtml(cliente: string, nivel: NivelGasto, g: GastoCiclo): string {
  const titulo = nivel === "limite" ? "Hora de recarregar os anúncios" : "O saldo dos anúncios está acabando";
  const texto = nivel === "limite"
    ? `Os anúncios da ${esc(cliente)} já usaram todo o valor combinado desde ${ddmm(g.desde)}. Para as campanhas não pararem, faça a recarga.`
    : `Os anúncios da ${esc(cliente)} já usaram ${g.pct.toLocaleString("pt-BR")}% do valor combinado desde ${ddmm(g.desde)}. Programe a recarga para as campanhas não pararem.`;
  const linha = (rotulo: string, valor: string) => `<tr><td style="padding:6px 0;color:#5b6472">${rotulo}</td><td style="padding:6px 0;text-align:right;font-weight:700">${valor}</td></tr>`;
  const barra = Math.min(100, Math.max(0, g.pct));
  return `<div style="font-family:'Plus Jakarta Sans',Manrope,Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:22px;padding:24px;border:1px solid #EAD9C2">
  <p style="margin:0 0 12px;font-size:20px;font-weight:800">avanteza<span style="color:#FF6A1F">.</span></p>
  <h2 style="margin:0 0 8px;font-size:18px">${titulo}</h2>
  <p style="margin:0 0 16px">${texto}</p>
  <div style="background:#EAD9C2;border-radius:999px;height:10px;overflow:hidden"><div style="width:${barra}%;height:10px;background:#FF6A1F"></div></div>
  <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px">
    ${linha("Total gasto até agora", reais(g.gasto))}
    ${linha("Valor combinado (limite)", reais(g.limite))}
    ${linha("Conversas no WhatsApp", g.conversas.toLocaleString("pt-BR"))}
    ${g.custoPorConversa != null ? linha("Custo por conversa", reais(g.custoPorConversa)) : ""}
  </table>
  <p style="margin:18px 0 0"><a href="${appUrl()}/mapa/canais" style="display:inline-block;background:#FF6A1F;color:#0B1B33;font-weight:700;padding:10px 18px;border-radius:999px;text-decoration:none">Ver no Mapa</a></p>
  <p style="color:#5b6472;font-size:12px;margin:16px 0 0">Valores desde ${ddmm(g.desde)}, só das campanhas deste cliente. Depois da recarga, a Avanteza reinicia a contagem.</p>
  </div></div>`;
}

// ─── Rotina ──────────────────────────────────────────────────────────────────

export interface DepsAlertaGasto {
  enviar?: (m: { to: string[]; cc?: string[]; subject: string; html: string }) => Promise<boolean>;
  /** Cópia ao dono (padrão: ALERT_EMAIL_TO, aceita vários separados por vírgula). */
  copia?: string[];
  /** Só este cliente (ex.: logo após salvar a configuração). */
  clientId?: string;
}

const copiaPadrao = () => (envOptional("ALERT_EMAIL_TO") ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Checa os alertas de todos os canais com alerta ligado. Idempotente: rodar de novo no mesmo ciclo não cria nem envia nada. */
export async function verificarAlertasGasto(hoje: string, deps: DepsAlertaGasto = {}) {
  const enviar = deps.enviar ?? enviarEmailPara;
  const copia = deps.copia ?? copiaPadrao();
  const alvos = await rawQuery<{ client_id: string; name: string }>(
    `select ch.client_id, c.name from avanteza.client_channels ch join avanteza.clients c on c.id = ch.client_id
      where ch.provider = 'meta' and ch.status <> 'desconectado' and ch.spend_alert_limit is not null and ch.spend_alert_since is not null
        and ch.ads_source in ('meta','windsor') and ch.ad_account_id is not null ${deps.clientId ? "and ch.client_id = $1" : ""}
      order by c.name`,
    deps.clientId ? [deps.clientId] : [],
  );
  const out = { canais: alvos.length, novos: 0, emails: 0, semConfiguracao: 0, falhas: 0, detalhes: [] as Array<{ cliente: string; gasto: number; limite: number; nivel: NivelGasto | null; enviados: NivelGasto[] }> };
  for (const a of alvos) {
    const canal = await obterCanal(a.client_id);
    const g = await gastoDoCiclo(canal, hoje);
    if (!canal || !g) continue;
    const atingidos: NivelGasto[] = g.nivel === "limite" ? ["aviso", "limite"] : g.nivel === "aviso" ? ["aviso"] : [];
    const novos: Array<{ id: string; nivel: NivelGasto }> = [];
    for (const nivel of atingidos) {
      const r = await rawQuery<{ id: string }>(
        `insert into avanteza.spend_alerts (client_id, ciclo, nivel, gasto, limite, conversas, destinatarios) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (client_id, ciclo, nivel) do nothing returning id`,
        [a.client_id, g.desde, nivel, g.gasto, g.limite, g.conversas, canal.alertaGasto!.emails],
      );
      if (r[0]) novos.push({ id: r[0].id, nivel });
    }
    out.detalhes.push({ cliente: a.name, gasto: g.gasto, limite: g.limite, nivel: g.nivel, enviados: novos.map((n) => n.nivel) });
    if (!novos.length) continue;
    out.novos += novos.length;
    // Se os dois níveis chegaram juntos (pulou direto para 100 %), só o mais alto vai por e-mail; o outro fica registrado como coberto.
    const principal = novos.find((n) => n.nivel === "limite") ?? novos[0];
    for (const n of novos) if (n !== principal) await rawQuery("update avanteza.spend_alerts set email_status = 'coberto' where id = $1", [n.id]);
    const para = canal.alertaGasto!.emails.length ? canal.alertaGasto!.emails : copia;
    let status: string;
    if (!para.length) status = "sem_destinatario";
    else {
      try {
        const ok = await enviar({ to: para, cc: canal.alertaGasto!.emails.length ? copia : [], subject: assuntoAlerta(a.name, principal.nivel, g), html: emailAlertaHtml(a.name, principal.nivel, g) });
        status = ok ? "enviado" : "sem_configuracao";
      } catch { status = "falhou"; }
    }
    if (status === "enviado") out.emails++; else if (status === "sem_configuracao") out.semConfiguracao++; else if (status === "falhou") out.falhas++;
    await rawQuery("update avanteza.spend_alerts set email_status = $2 where id = $1", [principal.id, status]);
    const rotulo = principal.nivel === "limite" ? "faça a recarga" : "saldo acabando";
    const pendencia = status === "enviado" ? "" : status === "sem_configuracao" ? " E-mail NÃO enviado: o envio de e-mail não está configurado (pendência)." : status === "sem_destinatario" ? " E-mail NÃO enviado: nenhum destinatário configurado (pendência)." : " O envio do e-mail falhou (pendência).";
    await notificar({
      tipo: "alerta_gasto", para: "equipe", clientId: a.client_id, link: `/clientes/${a.client_id}?aba=canais`,
      titulo: `${a.name}: anúncios — ${rotulo} (${reais(g.gasto)} de ${reais(g.limite)})`,
      corpo: `${g.conversas} conversas desde ${ddmm(g.desde)}.${pendencia}`,
      dedupKey: `alerta_gasto:${a.client_id}:${g.desde}:${principal.nivel}`,
    }).catch(() => undefined);
    await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('spend_alert', 'rotina', $1, $2)", [a.client_id, JSON.stringify({ niveis: novos.map((n) => n.nivel), gasto: g.gasto, limite: g.limite, ciclo: g.desde, email: status })]);
  }
  return out;
}

// ─── Configuração e histórico (administrador) ────────────────────────────────

export interface EntradaAlertaGasto { limite: number; avisoPct: number; desde: string; emails: string[] }

/** Liga/ajusta (ou desliga, com null) o alerta do canal. Mudar a data inicial abre outro ciclo (os níveis rearmam). */
export async function salvarAlertaGasto(clientId: string, e: EntradaAlertaGasto | null): Promise<boolean> {
  const r = await rawQuery<{ id: string }>(
    `update avanteza.client_channels set spend_alert_limit = $2, spend_alert_warn_pct = $3, spend_alert_since = $4, spend_alert_emails = $5, updated_at = now()
      where client_id = $1 and provider = 'meta' returning id`,
    e ? [clientId, e.limite, e.avisoPct, e.desde, e.emails] : [clientId, null, 80, null, []],
  );
  return r.length > 0;
}

/** “Recarga feita — reiniciar contagem”: novo ciclo a partir de hoje (os dois níveis voltam a valer). */
export async function reiniciarContagem(clientId: string, hoje: string): Promise<{ antes: string | null } | null> {
  const r = await rawQuery<{ antes: string | null }>(
    `update avanteza.client_channels ch set spend_alert_since = $2, updated_at = now()
       from (select to_char(spend_alert_since, 'YYYY-MM-DD') as antes from avanteza.client_channels where client_id = $1 and provider = 'meta') x
      where ch.client_id = $1 and ch.provider = 'meta' and ch.spend_alert_limit is not null returning x.antes`,
    [clientId, hoje],
  );
  return r[0] ?? null;
}

export interface AlertaEnviado { id: string; ciclo: string; nivel: NivelGasto; gasto: number; limite: number; conversas: number; destinatarios: string[]; email_status: string | null; criado_em: string }
export async function historicoAlertasGasto(clientId: string, limite = 20): Promise<AlertaEnviado[]> {
  return rawQuery<AlertaEnviado>(
    `select id, to_char(ciclo, 'YYYY-MM-DD') as ciclo, nivel, gasto::float8 as gasto, limite::float8 as limite, conversas, destinatarios, email_status,
            to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as criado_em
       from avanteza.spend_alerts where client_id = $1 order by criado_em desc, nivel desc limit $2`,
    [clientId, limite],
  );
}

/** Formulário do alerta (servidor). Limite em reais (aceita “400”, “400,00”, “1.200,50”). */
export function lerCamposAlerta(fd: FormData): { erro: string } | { campos: EntradaAlertaGasto | null } {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  if (s("desligar") === "1") return { campos: null };
  const bruto = s("limite").replace(/^R\$\s*/i, "");
  const limite = Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto);
  if (!Number.isFinite(limite) || limite <= 0 || limite > 10_000_000) return { erro: "Limite: informe o valor em reais (ex.: 400)." };
  const pct = Number(s("aviso_pct") || "80");
  if (!Number.isInteger(pct) || pct < 1 || pct > 99) return { erro: "Aviso: use um percentual inteiro entre 1 e 99." };
  const desde = s("desde");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || Number.isNaN(Date.parse(desde))) return { erro: "Data inicial inválida." };
  const emails = [...new Set(s("emails").split(/[\s,;]+/).map((x) => x.toLowerCase()).filter(Boolean))];
  if (emails.length > 10) return { erro: "No máximo 10 e-mails." };
  if (emails.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return { erro: "E-mail inválido na lista de destinatários." };
  return { campos: { limite: arred(limite), avisoPct: pct, desde, emails } };
}
