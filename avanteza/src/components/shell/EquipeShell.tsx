// Casca da equipe (servidor): o AppShell com o menu por departamentos, a busca global (Ctrl/Cmd+K), o usuário e o botão de sair.
import type { ReactNode } from "react";
import type { Session } from "@/lib/session";
import { menuEquipe } from "@/lib/shell/menu";
import { AppShell, type NavGroup } from "./AppShell";
import { SairButton } from "./SairButton";
import { NotificacoesSino } from "./NotificacoesSino";
import { BuscaGlobal } from "./BuscaGlobal";
import { acoesRapidas, paginasDoMenu } from "@/lib/busca/paginas";

export function EquipeShell({ sess, children, extra, tag, homeHref = "/central", banner }: {
  sess: Session;
  children: ReactNode;
  /** Grupos extras (ex.: Aprovações e Alertas dentro de Marketplaces), antes de "Sistema". */
  extra?: NavGroup[];
  tag?: string;
  homeHref?: string;
  banner?: ReactNode;
}) {
  // Páginas e ações rápidas da paleta saem do mesmo menu (mesmos papéis); o resto vem de /api/busca.
  const paginas = paginasDoMenu(sess);
  const rapidas = acoesRapidas(sess);
  return (
    <AppShell
      groups={menuEquipe(sess, extra)}
      tag={tag}
      homeHref={homeHref}
      banner={banner}
      acoesSidebar={<><BuscaGlobal className="sb-busca" paginas={paginas} rapidas={rapidas} /><NotificacoesSino className="sb-sino" /></>}
      acoesBarra={<><BuscaGlobal paginas={paginas} rapidas={rapidas} /><NotificacoesSino /></>}
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
