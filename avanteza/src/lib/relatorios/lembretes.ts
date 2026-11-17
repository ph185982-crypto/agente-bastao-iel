// Lembretes ao cliente: pendências dele (ações "depende do cliente" e peças para aprovar) atrasadas ou vencendo em até 2 dias.
// No máximo UM lembrete por cliente por dia (unique client_id, dia), agrupando tudo; aparece no Início do Mapa e vai por e-mail
// ao contato quando há e-mail configurado. Desligável por cliente (clients.lembretes_ativos). Log na ficha do cliente.
import { rawQuery } from "../db/client";
import { appUrl } from "../env";
import { enviarEmail } from "../alerts/channels";
import { addDaysStr } from "../mapa/plan";
import { isUuid } from "../motor/repo";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export interface ItemLembrete { tipo: "acao" | "aprovacao"; id: string; titulo: string; prazo: string; atrasada: boolean; detalhe: string | null }

/** Pendências do cliente que pedem lembrete hoje (só o que ele vê no Mapa). */
export async function pendenciasParaLembrete(clientId: string, hoje: string): Promise<ItemLembrete[]> {
  if (!isUuid(clientId)) return [];
  const limite = addDaysStr(hoje, 2);
  const [acoes, aprovacoes] = await Promise.all([
    rawQuery<{ id: string; title: string; due_date: string; status: string; blocked_reason: string | null }>(
      `select id, title, due_date, status, blocked_reason from avanteza.plan_actions
        where client_id = $1 and visible_to_client and archived_at is null and status <> 'concluida'
          and (owner = 'cliente' or status = 'bloqueada') and due_date is not null and due_date <= $2 order by due_date`,
      [clientId, limite],
    ),
    rawQuery<{ id: string; titulo: string; prazo: string }>(
      "select id, titulo, prazo from avanteza.aprovacoes where client_id = $1 and status = 'pendente' and prazo is not null and prazo <= $2 order by prazo",
      [clientId, limite],
    ),
  ]);
  return [
    ...aprovacoes.map((a) => ({ tipo: "aprovacao" as const, id: a.id, titulo: `Aprovar: ${a.titulo}`, prazo: a.prazo, atrasada: a.prazo < hoje, detalhe: null })),
    ...acoes.map((a) => ({ tipo: "acao" as const, id: a.id, titulo: a.title, prazo: a.due_date, atrasada: a.due_date < hoje, detalhe: a.status === "bloqueada" ? a.blocked_reason : null })),
  ].sort((x, y) => (x.prazo < y.prazo ? -1 : x.prazo > y.prazo ? 1 : 0));
}

export function lembreteHtml(cliente: string, itens: ItemLembrete[]): string {
  const li = itens
    .slice(0, 20)
    .map((i) => `<li style="margin:6px 0"><strong>${esc(i.titulo)}</strong> <span style="color:${i.atrasada ? "#B42318" : "#5b6472"}">(${i.atrasada ? "atrasada desde" : "prazo"} ${dm(i.prazo)})</span>${i.detalhe ? `<br><span style="color:#5b6472">A Avanteza precisa de: ${esc(i.detalhe)}</span>` : ""}</li>`)
    .join("");
  return `<div style="font-family:Manrope,Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
  <h2 style="margin:0 0 8px">avanteza<span style="color:#FF6A1F">.</span> — ${itens.length === 1 ? "1 item precisa" : `${itens.length} itens precisam`} de você</h2>
  <p>Para a ${esc(cliente)} seguir no ritmo combinado, estes itens estão com você:</p><ul style="padding-left:18px">${li}</ul>
  <p style="margin-top:18px"><a href="${appUrl()}/mapa" style="display:inline-block;background:#FF6A1F;color:#0B1B33;font-weight:700;padding:10px 16px;border-radius:6px;text-decoration:none">Abrir o Mapa</a></p>
  <p style="color:#5b6472;font-size:13px">No máximo um lembrete por dia. Para não receber, fale com a Avanteza.</p></div>`;
}

export interface DepsLembretes { enviar?: (to: string, subject: string, html: string) => Promise<boolean> }

/** Job "lembretes" (1×/dia). Idempotente no dia: o 2º disparo não cria nem envia nada. */
export async function rotinaLembretes(hoje: string, deps: DepsLembretes = {}) {
  const enviar = deps.enviar ?? enviarEmail;
  const clientes = await rawQuery<{ id: string; name: string; contact_email: string | null }>("select id, name, contact_email from avanteza.clients where active and lembretes_ativos order by name");
  const out = { clientes: clientes.length, criados: 0, jaEnviadosHoje: 0, semPendencias: 0, emails: 0, semConfiguracao: 0, falhas: 0 };
  for (const c of clientes) {
    const itens = await pendenciasParaLembrete(c.id, hoje);
    if (!itens.length) { out.semPendencias++; continue; }
    const r = await rawQuery<{ id: string }>(
      "insert into avanteza.lembretes_cliente (client_id, dia, itens) values ($1,$2,$3) on conflict (client_id, dia) do nothing returning id",
      [c.id, hoje, JSON.stringify(itens)],
    );
    if (!r.length) { out.jaEnviadosHoje++; continue; }
    out.criados++;
    let status = "sem_contato";
    if (c.contact_email) {
      try {
        const ok = await enviar(c.contact_email, `Avanteza: ${itens.length === 1 ? "1 item precisa" : `${itens.length} itens precisam`} de você`, lembreteHtml(c.name, itens));
        status = ok ? "enviado" : "sem_configuracao";
        if (ok) out.emails++; else out.semConfiguracao++;
      } catch {
        status = "falhou";
        out.falhas++;
      }
    }
    await rawQuery("update avanteza.lembretes_cliente set email_status = $2 where id = $1", [r[0].id, status]);
    await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('lembrete_cliente', 'rotina', $1, $2)", [c.id, JSON.stringify({ itens: itens.length, email: status })]);
  }
  return out;
}

export async function lembretesDoCliente(clientId: string, limite = 30) {
  if (!isUuid(clientId)) return [];
  return rawQuery<{ id: string; dia: string; itens: ItemLembrete[]; email_status: string | null; criado_em: string }>(
    "select id, to_char(dia, 'YYYY-MM-DD') as dia, itens, email_status, criado_em from avanteza.lembretes_cliente where client_id = $1 order by dia desc limit $2",
    [clientId, limite],
  );
}
