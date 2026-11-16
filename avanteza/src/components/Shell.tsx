import Link from "next/link";
import { AppShell, type NavGroup } from "./shell/AppShell";
import { ITEM_DASHBOARDS } from "@/lib/dashboards/nav";
import { SairButton } from "@/components/shell/SairButton";

/** Casca do painel Marketplaces (admin): sidebar de vidro agrupada + faixas de estado. */
export function Shell({
  children,
  counts,
  paused,
  dryRun,
  reviewer = false,
  admin = false,
  dashboards = false,
  who,
}: {
  children: React.ReactNode;
  counts: { approvals: number; alerts: number };
  paused: boolean;
  dryRun: boolean;
  reviewer?: boolean;
  admin?: boolean;
  /** Mostra "Dashboards" como primeiro item (administrador e revisor). */
  dashboards?: boolean;
  who?: string;
}) {
  const groups: NavGroup[] = [
    { items: [...(dashboards ? [ITEM_DASHBOARDS] : []), { href: "/central", label: "Central", icon: "grid", exact: true }] },
    {
      label: "Operação",
      items: [
        { href: "/", label: "Visão geral", icon: "home", exact: true },
        { href: "/clientes", label: "Clientes", icon: "users" },
        { href: "/aprovacoes", label: "Aprovações", icon: "check", badge: counts.approvals },
        { href: "/alertas", label: "Alertas", icon: "bell", badge: counts.alerts },
        { href: "/entregas", label: "Entregas", icon: "truck" },
      ],
    },
    {
      label: "Análise",
      items: [
        { href: "/relatorios", label: "Relatórios", icon: "chart" },
        { href: "/auditoria", label: "Auditoria", icon: "shield" },
      ],
    },
    {
      label: "Sistema",
      items: [
        { href: "/configuracoes", label: "Ajustes", icon: "settings" },
        ...(admin ? [{ href: "/usuarios", label: "Usuários", icon: "user" }] : []),
      ],
    },
  ];
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
    <AppShell
      groups={groups}
      tag="Marketplaces"
      homeHref="/"
      banner={banner || undefined}
      bottom={
        <>
          {who && <div className="sb-who" title={who}>{who}</div>}
          <SairButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
