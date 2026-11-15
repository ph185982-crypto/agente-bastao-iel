// Central: a porta de entrada única. Lista as ferramentas liberadas para o usuário e abre cada uma já logada.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { apps, ssoEnabled } from "@/lib/apps";
import { adminDb } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { Flash } from "@/components/Flash";
import { logout } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Central({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sess = await requireUser();
  const list = apps().filter((a) => a.external || canUseApp(sess, a.id));
  const groups = [...new Set(list.map((a) => a.group))];
  let approvals = 0, alerts = 0;
  if (canUseApp(sess, "marketplaces")) {
    const db = adminDb();
    const [a, b] = await Promise.all([
      db.from("actions").select("id", { count: "exact", head: true }).eq("status", "proposed"),
      db.from("alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
    approvals = a.count ?? 0;
    alerts = b.count ?? 0;
  }
  const first = (sess.name || sess.email.split("@")[0]).split(" ")[0];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          <div className="btn-row">
            {sess.role === "admin" && <Link href="/usuarios" className="btn btn-sm btn-ghost" style={{ color: "var(--sand)", borderColor: "var(--navy-2)" }}>Usuários</Link>}
            <form action={logout}><button className="btn btn-sm btn-ghost" style={{ color: "var(--sand)", borderColor: "var(--navy-2)" }}>Sair</button></form>
          </div>
        </div>
      </header>
      <main className="main">
        <Flash sp={sp} />
        <div className="eyebrow">Central Avanteza</div>
        <h1>Olá, <span className="serif">{first}</span></h1>
        <p className="muted" style={{ marginTop: 4 }}>Escolha a ferramenta. Você entra uma vez e todas abrem com o mesmo acesso.</p>
        {groups.map((g) => (
          <section key={g}>
            <h2>{g}</h2>
            <div className="grid two">
              {list.filter((a) => a.group === g).map((a) => {
                const href = a.external ? a.url : a.url ? (ssoEnabled(a.id) ? `/sso/authorize?app=${a.id}` : a.url) : a.internalPath ?? "/";
                const badges = a.id === "marketplaces" ? [approvals ? `${approvals} aprovações` : "", alerts ? `${alerts} alertas` : ""].filter(Boolean) : [];
                return (
                  <a key={a.id} href={href} className="card" style={{ textDecoration: "none", display: "block", marginTop: 0 }} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                    <div className="row">
                      <h3>{a.name}</h3>
                      <div className="btn-row">
                        {badges.map((b) => <span key={b} className="pill pill-orange">{b}</span>)}
                        {a.url && !a.external && !ssoEnabled(a.id) && <span className="pill pill-outline">login próprio</span>}
                        <span aria-hidden="true">›</span>
                      </div>
                    </div>
                    <p className="small muted" style={{ margin: "6px 0 0" }}>{a.tagline}</p>
                  </a>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
