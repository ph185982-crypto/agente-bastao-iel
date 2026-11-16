// Central: a porta de entrada única. Lista as ferramentas liberadas para o usuário e abre cada uma já logada.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { ITEM_DASHBOARDS, podeVerDashboards } from "@/lib/dashboards/nav";
import { apps, ssoEnabled } from "@/lib/apps";
import { adminDb } from "@/lib/db";
import { AppShell } from "@/components/shell/AppShell";
import { GlassCard, PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";
import { SairButton } from "@/components/shell/SairButton";

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
    <AppShell
      groups={[{ items: [...(podeVerDashboards(sess) ? [ITEM_DASHBOARDS] : []), { href: "/central", label: "Todas as ferramentas", icon: "grid", exact: true }, ...(sess.role === "admin" ? [{ href: "/usuarios", label: "Usuários e acessos", icon: "users" }] : [])] }]}
      homeHref="/central"
      bottom={
        <>
          <div className="sb-who" title={sess.email}>{sess.name || sess.email}</div>
          <SairButton />
        </>
      }
    >
      <Flash sp={sp} />
      <PageHeader eyebrow="Central Avanteza" title={<>Olá, <span className="accent">{first}</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>Escolha a ferramenta. Você entra uma vez e todas abrem com o mesmo acesso.</p>
      </PageHeader>
      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="grid three">
            {list.filter((a) => a.group === g).map((a) => {
              const href = a.external ? a.url : a.url ? (ssoEnabled(a.id) ? `/sso/authorize?app=${a.id}` : a.url) : a.internalPath ?? "/";
              const badges = a.id === "marketplaces" ? [approvals ? `${approvals} aprovações` : "", alerts ? `${alerts} alertas` : ""].filter(Boolean) : [];
              return (
                <GlassCard as="a" key={a.id} href={href} className="tile" style={{ marginTop: 0 }} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>
                  <span className="mono-ico" aria-hidden="true">{a.name[0]}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ flexWrap: "nowrap" }}>
                      <h3>{a.name}</h3>
                      <span className="go" aria-hidden="true">›</span>
                    </div>
                    <p className="small muted" style={{ margin: "6px 0 0" }}>{a.tagline}</p>
                    {(badges.length > 0 || (a.url && !a.external && !ssoEnabled(a.id))) && (
                      <div className="btn-row" style={{ marginTop: 10 }}>
                        {badges.map((b) => <span key={b} className="pill pill-orange">{b}</span>)}
                        {a.url && !a.external && !ssoEnabled(a.id) && <span className="pill pill-outline">login próprio</span>}
                      </div>
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </section>
      ))}
    </AppShell>
  );
}
