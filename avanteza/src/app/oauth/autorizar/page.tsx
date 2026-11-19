// Tela de consentimento do conector do Claude (OAuth). Pública no middleware: ela mesma confere a sessão do Avanteza ID.
// Sem sessão → login (volta para /api/oauth/authorize). Membro, revisor ou cliente → recusa clara. Administrador → Permitir/Negar,
// enviado por POST para /api/oauth/authorize com o token do formulário (anti-CSRF, ligado à sessão e ao pedido).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SESSION_COOKIE, verifySessionFull } from "@/lib/session";
import { avaliarPedido } from "@/lib/mcp/acesso";
import { CAMPOS_AUTORIZACAO, mcpConfigurado } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Conectar o Claude · Avanteza" };

type SP = Record<string, string | string[] | undefined>;

function Caixa({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-wrap">
      <ThemeToggle className="theme-float" />
      <div className="login-box">
        <Logo sub size={36} />
        <div className="card stack">{children}</div>
      </div>
    </div>
  );
}

export default async function Autorizar({ searchParams }: { searchParams: Promise<SP> }) {
  if (!mcpConfigurado()) {
    return <Caixa><h1 style={{ fontSize: 20 }}>Conector indisponível</h1><p className="muted">O conector do Claude ainda não foi configurado nesta Central.</p></Caixa>;
  }
  const sp = await searchParams;
  const um = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const sess = await verifySessionFull((await cookies()).get(SESSION_COOKIE)?.value).catch(() => null);
  const a = await avaliarPedido(um, sess);
  if (a.tipo === "login") redirect(a.destino);
  if (a.tipo === "invalido") {
    return <Caixa><h1 style={{ fontSize: 20 }}>Pedido inválido</h1><div className="notice danger small">{a.erro}</div><p className="muted small">Volte ao Claude e tente conectar de novo.</p></Caixa>;
  }
  if (a.tipo === "recusado") {
    return (
      <Caixa>
        <h1 style={{ fontSize: 20 }}>Acesso não permitido</h1>
        <div className="notice danger small">{a.motivo}</div>
        <p className="muted small">Você está logado como {a.email}.</p>
        <a className="btn btn-ghost" href="/central">Voltar para a Central</a>
      </Caixa>
    );
  }
  return (
    <Caixa>
      <h1 style={{ fontSize: 20 }}>Permitir que o Claude acesse a Avanteza como <span className="accent">{a.email}</span>?</h1>
      <p className="muted small">
        <b>{a.nomeCliente}</b> poderá consultar clientes, tarefas, planos, reuniões, canais, financeiro, comercial e entregas, e também
        criar e atualizar tarefas, registrar combinados e reuniões, lançar no financeiro e pedir a coleta dos canais — sempre em seu nome
        e com registro na auditoria. Ele não exclui nada, não mexe em acessos ou senhas e não envia e-mails a clientes.
      </p>
      <p className="muted small">Para cortar o acesso depois, desative o usuário ou troque a chave do conector (AVANTEZA_MCP_SECRET).</p>
      <form method="post" action="/api/oauth/authorize" className="stack">
        {CAMPOS_AUTORIZACAO.map((k) => <input key={k} type="hidden" name={k} value={a.params[k]} />)}
        <input type="hidden" name="form" value={a.form} />
        <div className="btn-row full">
          <button className="btn btn-ghost" type="submit" name="decisao" value="negar">Negar</button>
          <button className="btn btn-orange" type="submit" name="decisao" value="permitir">Permitir</button>
        </div>
      </form>
    </Caixa>
  );
}
