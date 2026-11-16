// Casca da equipe (servidor): o AppShell com o menu por departamentos, o usuário e o botão de sair.
import type { ReactNode } from "react";
import type { Session } from "@/lib/session";
import { menuEquipe } from "@/lib/shell/menu";
import { AppShell, type NavGroup } from "./AppShell";
import { SairButton } from "./SairButton";
import { NotificacoesSino } from "./NotificacoesSino";

export function EquipeShell({ sess, children, extra, tag, homeHref = "/central", banner }: {
  sess: Session;
  children: ReactNode;
  /** Grupos extras (ex.: Aprovações e Alertas dentro de Marketplaces), antes de "Sistema". */
  extra?: NavGroup[];
  tag?: string;
  homeHref?: string;
  banner?: ReactNode;
}) {
  return (
    <AppShell
      groups={menuEquipe(sess, extra)}
      tag={tag}
      homeHref={homeHref}
      banner={banner}
      acoesSidebar={<NotificacoesSino className="sb-sino" />}
      acoesBarra={<NotificacoesSino />}
      bottom={
        <>
          <div className="sb-who" title={sess.email}>{sess.name || sess.email}</div>
          <SairButton />
        </>
      }
    >
      {children}
    </AppShell>
  );
}
