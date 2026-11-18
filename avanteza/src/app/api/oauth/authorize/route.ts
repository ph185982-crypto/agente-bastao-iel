// Ponto de autorização do OAuth do conector do Claude.
//  GET: confere o pedido; sem sessão do Avanteza ID → /login?next=<este endereço>; com sessão → tela de consentimento
//       (/oauth/autorizar, no visual da Central), que recusa quem não é administrador.
//  POST: resposta da tela (Permitir/Negar). Exige a sessão de administrador e o token do formulário (assinado, 10 min, ligado
//        ao e-mail da sessão e aos parâmetros exatos). Permitir → código de 5 min em redirect_uri; Negar → error=access_denied.
import { adminDb } from "@/lib/db";
import { avaliarPedido, ehDono, formularioConfere, sessaoDoPedido, usuarioDoMcp } from "@/lib/mcp/acesso";
import { emitirCodigo, lerParams, mcpConfigurado, queryDosParams, validarPedido, voltarAoCliente } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const H = { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" };
const texto = (msg: string, status: number) => new Response(msg, { status, headers: H });
const ir = (url: string, status = 302) => new Response(null, { status, headers: { location: url, "cache-control": "no-store" } });
const naoConfigurado = () => texto("Conector do Claude não configurado (AVANTEZA_MCP_SECRET).", 503);

export async function GET(req: Request) {
  if (!mcpConfigurado()) return naoConfigurado();
  const u = new URL(req.url);
  const a = await avaliarPedido((k) => u.searchParams.get(k), await sessaoDoPedido(req));
  if (a.tipo === "invalido") return texto(a.erro, 400);
  if (a.tipo === "login") return ir(a.destino);
  return ir(`/oauth/autorizar?${queryDosParams(lerParams((k) => u.searchParams.get(k)))}`);
}

export async function POST(req: Request) {
  if (!mcpConfigurado()) return naoConfigurado();
  const f = await req.formData().catch(() => null);
  if (!f) return texto("Formulário inválido.", 400);
  const p = lerParams((k) => f.get(k));
  const v = validarPedido(p);
  if ("erro" in v) return texto(v.erro, 400);
  const sess = await sessaoDoPedido(req);
  if (!sess || !ehDono(sess)) return texto("Só administradores da Avanteza podem conectar o Claude.", 403);
  if (!formularioConfere(f.get("form") as string | null, sess.email, p)) return texto("Formulário expirado ou de outra sessão. Volte ao Claude e conecte de novo.", 403);
  if (!(await usuarioDoMcp(sess.email))) return texto("Seu usuário não está ativo como administrador.", 403);
  if (f.get("decisao") !== "permitir") return ir(voltarAoCliente(p, { error: "access_denied" }), 303);
  await adminDb().from("audit_log").insert({ event: "mcp_conector_autorizado", actor: sess.email, details: { cliente: v.nomeCliente.slice(0, 80), redirect: new URL(p.redirect_uri).host, via: "claude" } });
  return ir(voltarAoCliente(p, { code: emitirCodigo(p, sess.email) }), 303);
}
