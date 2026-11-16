// Rotina diária "entregas" (cron): gera as recorrências dos próximos 30 dias, recalcula a saúde da carteira, manda o
// resumo matinal a cada responsável e o alerta de risco ao dono. Sem e-mail configurado (RESEND_API_KEY + ALERT_EMAIL_FROM),
// registra no resultado e segue: nunca derruba a rotina.
import { appUrl, envOptional } from "../env";
import { enviarEmail } from "../alerts/channels";
import { rawQuery } from "../db/client";
import { fmtDate } from "../mapa/progress";
import { montarFila } from "./fila";
import { acoesDaFila, carteira, gerarParaTodos, gravarSaude, listarEquipe, type AcaoMotor, type CartaoCarteira } from "./repo";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function lista(titulo: string, itens: AcaoMotor[]): string {
  if (!itens.length) return "";
  const li = itens
    .slice(0, 25)
    .map((a) => `<li style="margin:4px 0"><strong>${esc(a.client_name)}</strong> · ${esc(a.title)} <span style="color:#64748b">(${a.due_date ? fmtDate(a.due_date) : "sem prazo"})</span></li>`)
    .join("");
  return `<h3 style="margin:16px 0 6px;font-size:15px">${esc(titulo)} (${itens.length})</h3><ul style="padding-left:18px;margin:0">${li}</ul>`;
}

const moldura = (titulo: string, corpo: string, link: string) => `<div style="font-family:Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
  <h2 style="margin:0 0 8px">avanteza<span style="color:#FF6A1F">.</span> — ${esc(titulo)}</h2>${corpo}
  <p style="margin-top:18px"><a href="${link}" style="color:#9A3B00;font-weight:700">Abrir na Central</a></p></div>`;

export function resumoMatinalHtml(nome: string, atrasadas: AcaoMotor[], hoje: AcaoMotor[], semana: AcaoMotor[]): string {
  const corpo = `<p>Bom dia, ${esc(nome.split(" ")[0] || nome)}. Isto é o que está com você:</p>${lista("Atrasadas", atrasadas)}${lista("Para hoje", hoje)}${lista("Próximos 7 dias", semana)}`;
  return moldura("seu dia", corpo, `${appUrl()}/operacoes`);
}

export function alertaRiscoHtml(cartoes: CartaoCarteira[]): string {
  const li = cartoes
    .map((c) => `<li style="margin:6px 0"><strong>${esc(c.nome)}</strong> — ${esc(c.saude.motivos.join("; "))}${c.gerente ? ` <span style="color:#64748b">(responsável: ${esc(c.gerente)})</span>` : ""}</li>`)
    .join("");
  return moldura(`${cartoes.length} cliente(s) em risco`, `<ul style="padding-left:18px">${li}</ul>`, `${appUrl()}/operacoes/carteira`);
}

export interface DepsRotina {
  /** Envio de e-mail (injetável nos testes). Devolve false quando não há configuração. */
  enviar?: (to: string, subject: string, html: string) => Promise<boolean>;
}

export async function rotinaEntregas(hoje: string, deps: DepsRotina = {}) {
  const enviar = deps.enviar ?? enviarEmail;
  const geracao = await gerarParaTodos(hoje);
  const cartoes = await carteira(hoje);
  await gravarSaude(hoje, cartoes);
  const saude = { verde: 0, amarelo: 0, vermelho: 0 };
  for (const c of cartoes) saude[c.saude.nivel]++;

  const emails = { enviados: 0, semConfiguracao: false, falhas: 0 };
  const tentar = async (to: string, assunto: string, html: string) => {
    try {
      if (await enviar(to, assunto, html)) emails.enviados++;
      else emails.semConfiguracao = true;
    } catch {
      emails.falhas++;
    }
  };

  // resumo matinal por responsável
  const { acoes } = await acoesDaFila(hoje);
  const equipe = await listarEquipe();
  for (const p of equipe) {
    const minhas = acoes.filter((a) => a.assignee_id === p.id);
    const f = montarFila(minhas, hoje);
    if (!f.atrasadas.length && !f.hoje.length && !f.semana.length) continue;
    await tentar(p.email, `Avanteza: ${f.contadores.atrasadas} atrasada(s), ${f.contadores.hoje} para hoje`, resumoMatinalHtml(p.name || p.email, f.atrasadas, f.hoje, f.semana));
  }

  // alerta de risco ao dono (e-mail de alertas da Central, senão ALERT_EMAIL_TO)
  const risco = cartoes.filter((c) => c.saude.nivel === "vermelho");
  if (risco.length) {
    const [s] = await rawQuery<{ alert_email: string | null }>("select alert_email from avanteza.settings limit 1");
    const dono = s?.alert_email || envOptional("ALERT_EMAIL_TO");
    if (dono) await tentar(dono, `Avanteza: ${risco.length} cliente(s) com entregas em risco`, alertaRiscoHtml(risco));
    else emails.semConfiguracao = true;
  }
  return { geracao, saude, emails };
}
