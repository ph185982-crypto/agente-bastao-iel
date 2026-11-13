import Link from "next/link";
import { Logo } from "./Logo";
import { logout } from "@/app/actions";

const NAV = [
  { href: "/", label: "Visão geral", ico: "◧" },
  { href: "/clientes", label: "Clientes", ico: "◉" },
  { href: "/aprovacoes", label: "Aprovações", ico: "✓", key: "approvals" },
  { href: "/alertas", label: "Alertas", ico: "!", key: "alerts" },
  { href: "/configuracoes", label: "Ajustes", ico: "⚙" },
];

export function Shell({
  children,
  counts,
  paused,
  dryRun,
}: {
  children: React.ReactNode;
  counts: { approvals: number; alerts: number };
  paused: boolean;
  dryRun: boolean;
}) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" style={{ textDecoration: "none" }}>
            <Logo />
          </Link>
          <nav className="topnav">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href}>
                {n.label}
                {n.key && counts[n.key as "approvals" | "alerts"] > 0 ? ` (${counts[n.key as "approvals" | "alerts"]})` : ""}
              </Link>
            ))}
            <Link href="/auditoria">Auditoria</Link>
          </nav>
          <form action={logout}>
            <button className="btn btn-sm btn-ghost" style={{ color: "var(--sand)", borderColor: "var(--navy-2)" }}>
              Sair
            </button>
          </form>
        </div>
      </header>
      {(paused || dryRun) && (
        <div style={{ background: paused ? "var(--orange)" : "var(--sand)", color: paused ? "#fff" : "var(--navy)", textAlign: "center", padding: "6px 12px", fontSize: 13, fontWeight: 700 }}>
          {paused ? "PAUSA GERAL ATIVA — nenhuma ação de escrita será executada." : "Modo simulação ativo — ações aprovadas são apenas simuladas."}{" "}
          <Link href="/configuracoes">Alterar</Link>
        </div>
      )}
      <main className="main">{children}</main>
      <nav className="bottomnav" aria-label="Navegação">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href}>
            <span className="ico" aria-hidden="true">{n.ico}</span>
            {n.label}
            {n.key && counts[n.key as "approvals" | "alerts"] > 0 && (
              <span className="badge-count">{counts[n.key as "approvals" | "alerts"]}</span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}
