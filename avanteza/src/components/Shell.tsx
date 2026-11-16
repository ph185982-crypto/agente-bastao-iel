import Link from "next/link";
import type { NavGroup } from "./shell/AppShell";
import { EquipeShell } from "./shell/EquipeShell";
import type { Session } from "@/lib/session";

/** Casca do painel Marketplaces: menu por departamentos + atalhos do módulo (aprovações, alertas, relatórios, auditoria) + faixas de estado. */
export function Shell({
  children,
  sess,
  counts,
  paused,
  dryRun,
}: {
  children: React.ReactNode;
  sess: Session;
  counts: { approvals: number; alerts: number };
  paused: boolean;
  dryRun: boolean;
}) {
  const reviewer = sess.role === "reviewer";
  const modulo: NavGroup = {
    label: "Marketplaces",
    items: [
      { href: "/aprovacoes", label: "Aprovações", icon: "check", badge: counts.approvals },
      { href: "/alertas", label: "Alertas", icon: "bell", badge: counts.alerts },
      { href: "/relatorios", label: "Relatórios", icon: "chart" },
      { href: "/auditoria", label: "Auditoria", icon: "shield" },
    ],
  };
  const banner = (reviewer || paused || dryRun) && (
    <>
      {reviewer && (
        <div className="banner" role="status">
          Acesso de revisão — somente leitura. Você pode navegar, cadastrar um cliente de teste e gerar o link de autorização.
        </div>
      )}
      {(paused || dryRun) && (
        <div className={`banner${paused ? " orange" : ""}`} role="status">
          {paused ? "PAUSA GERAL ATIVA — nenhuma ação de escrita será executada." : "Modo simulação ativo — ações aprovadas são apenas simuladas."}{" "}
          <Link href="/configuracoes" style={{ fontWeight: 800 }}>Alterar</Link>
        </div>
      )}
    </>
  );
  return (
    <EquipeShell sess={sess} extra={[modulo]} tag="Marketplaces" homeHref="/" banner={banner || undefined}>
      {children}
    </EquipeShell>
  );
}
