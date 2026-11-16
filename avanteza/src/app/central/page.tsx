// Central: a porta de entrada única. Mostra as ferramentas liberadas para o usuário, organizadas por departamento
// (Operações, Comercial, Marketing, Financeiro), e abre cada uma já logada.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canUseApp } from "@/lib/session";
import { departamentosVisiveis, appsInstitucionais } from "@/lib/shell/departamentos";
import { adminDb } from "@/lib/db";
import { EquipeShell } from "@/components/shell/EquipeShell";
import { ModuloCard } from "@/components/shell/ModuloCard";
import { GlassCard, PageHeader } from "@/components/shell/GlassCard";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

export default async function Central({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const sess = await requireUser();
  const deps = departamentosVisiveis(sess);
  const site = appsInstitucionais();
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
    <EquipeShell sess={sess}>
      <Flash sp={sp} />
      <PageHeader eyebrow="Central Avanteza" title={<>Olá, <span className="accent">{first}</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>Escolha o departamento e a ferramenta. Você entra uma vez e todas abrem com o mesmo acesso.</p>
      </PageHeader>
      {deps.length === 0 && <div className="empty" role="status">Nenhuma ferramenta liberada para este usuário. Peça acesso a um administrador.</div>}
      {deps.map((d) => {
        // No Financeiro a Central mostra a entrada e o Pessoal; as telas internas são abas.
        const modulos = d.id === "financeiro" ? d.modulos.filter((m) => m.id === "fin-visao" || m.id === "fin-pessoal") : d.modulos;
        return (
          <section key={d.id} aria-label={d.nome}>
            <h2><Link href={d.href} style={{ color: "inherit", textDecoration: "none" }}>{d.nome}</Link></h2>
            <p className="small muted dsub">{d.descricao}</p>
            <div className="grid three">
              {modulos.map((m) => (
                <ModuloCard key={m.id} m={m} badges={m.id === "marketplaces" ? [approvals ? `${approvals} aprovações` : "", alerts ? `${alerts} alertas` : ""].filter(Boolean) : []} />
              ))}
            </div>
          </section>
        );
      })}
      {site.length > 0 && (
        <section aria-label="Institucional">
          <h2>Institucional</h2>
          <div className="grid three">
            {site.map((a) => (
              <GlassCard as="a" key={a.id} href={a.url} className="tile" style={{ marginTop: 0 }} target="_blank" rel="noreferrer">
                <span className="mono-ico" aria-hidden="true">{a.name[0]}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ flexWrap: "nowrap" }}><h3>{a.name}</h3><span className="go" aria-hidden="true">›</span></div>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>{a.tagline}</p>
                </div>
              </GlassCard>
            ))}
          </div>
        </section>
      )}
    </EquipeShell>
  );
}
