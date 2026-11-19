// E-mail de boas-vindas ao cliente do Mapa: link, login e passo a passo. NUNCA leva a senha (ela vai pela equipe, por WhatsApp).
import { appUrl, envOptional } from "../env";
import { enviarEmailPara } from "../alerts/channels";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface BoasVindas {
  cliente: string;
  email: string;
  nome?: string | null;
  /** Limite do aviso de recarga dos anúncios, quando configurado no canal. */
  limiteRecarga?: number | null;
}

export function assuntoBoasVindas(cliente: string): string {
  return `Bem-vindo à Avanteza, ${cliente}: seu acesso ao painel`;
}

export function emailBoasVindasHtml(b: BoasVindas): string {
  const url = appUrl();
  const ola = b.nome ? `Olá, ${esc(b.nome.split(/\s+/)[0])}!` : "Olá!";
  const passo = (n: number, titulo: string, texto: string) =>
    `<tr><td style="vertical-align:top;padding:8px 10px 8px 0"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;border-radius:999px;background:#FF6A1F;color:#0B1B33;font-weight:800">${n}</span></td><td style="padding:8px 0"><strong>${titulo}</strong><br><span style="color:#5b6472">${texto}</span></td></tr>`;
  const menu = (item: string, texto: string) => `<li style="margin:4px 0"><strong>${item}</strong>: ${texto}</li>`;
  return `<div style="font-family:'Plus Jakarta Sans',Manrope,Arial,sans-serif;background:#F5F0E6;padding:24px;color:#0B1B33">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:22px;padding:24px;border:1px solid #EAD9C2">
  <p style="margin:0 0 12px;font-size:20px;font-weight:800">avanteza<span style="color:#FF6A1F">.</span></p>
  <h2 style="margin:0 0 8px;font-size:18px">${ola} O painel da ${esc(b.cliente)} está pronto</h2>
  <p style="margin:0 0 16px">Nele você acompanha, a qualquer hora, o plano de trabalho, os resultados dos anúncios, do Instagram e do Google, as reuniões e os arquivos.</p>
  <table style="width:100%;border-collapse:collapse;background:#F5F0E6;border-radius:14px;font-size:14px">
    <tr><td style="padding:10px 14px;color:#5b6472">Endereço</td><td style="padding:10px 14px;font-weight:700"><a href="${url}" style="color:#0B1B33">${esc(url.replace(/^https?:\/\//, ""))}</a></td></tr>
    <tr><td style="padding:10px 14px;color:#5b6472">Login</td><td style="padding:10px 14px;font-weight:700">${esc(b.email)}</td></tr>
    <tr><td style="padding:10px 14px;color:#5b6472">Senha</td><td style="padding:10px 14px">enviada pela equipe Avanteza por WhatsApp</td></tr>
  </table>
  <h3 style="margin:20px 0 4px;font-size:16px">Passo a passo</h3>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${passo(1, "Entre no painel", `Abra <a href="${url}" style="color:#0B1B33">${esc(url.replace(/^https?:\/\//, ""))}</a>, digite o e-mail acima e a senha que você recebeu por WhatsApp.`)}
    ${passo(2, "Troque a senha", "No primeiro acesso, vá em <strong>Conta</strong> e crie uma senha só sua.")}
    ${passo(3, "Explore o menu", "Cada item mostra uma parte do trabalho (veja abaixo).")}
  </table>
  <ul style="margin:8px 0 0;padding-left:18px;font-size:14px">
    ${menu("Início", "resumo da semana e números principais")}
    ${menu("Plano", "o que já foi feito e o que vem a seguir")}
    ${menu("Canais", "anúncios (gasto, conversas, público e onde aparecem), Instagram e Google")}
    ${menu("Reuniões", "resumos e combinados de cada reunião")}
    ${menu("Para aprovar", "peças e conteúdos esperando o seu OK")}
    ${menu("Relatórios e Arquivos", "relatórios publicados e documentos")}
  </ul>
  ${b.limiteRecarga ? `<p style="margin:16px 0 0;font-size:14px;background:#F5F0E6;border-radius:14px;padding:10px 14px"><strong>Aviso de recarga:</strong> quando os anúncios chegarem a 80% e a 100% de ${reais(b.limiteRecarga)}, você recebe um e-mail para programar a recarga a tempo.</p>` : ""}
  <p style="margin:20px 0 0"><a href="${url}" style="display:inline-block;background:#FF6A1F;color:#0B1B33;font-weight:700;padding:10px 18px;border-radius:999px;text-decoration:none">Entrar no painel</a></p>
  <p style="color:#5b6472;font-size:12px;margin:16px 0 0">Por segurança, a senha nunca é enviada por e-mail. Dúvidas? Fale com a equipe Avanteza pelo WhatsApp.</p>
  </div></div>`;
}

export interface DepsBoasVindas {
  enviar?: (m: { to: string[]; cc?: string[]; subject: string; html: string }) => Promise<boolean>;
  copia?: string[];
}

/** Envia ao cliente com cópia ao dono (ALERT_EMAIL_TO). Devolve true se o provedor aceitou. */
export async function enviarBoasVindas(b: BoasVindas, deps: DepsBoasVindas = {}): Promise<boolean> {
  const enviar = deps.enviar ?? enviarEmailPara;
  const copia = deps.copia ?? (envOptional("ALERT_EMAIL_TO") ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  return enviar({ to: [b.email], cc: copia, subject: assuntoBoasVindas(b.cliente), html: emailBoasVindasHtml(b) });
}
