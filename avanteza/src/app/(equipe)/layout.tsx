// Telas internas da equipe organizadas por departamento (/operacoes, /comercial, /marketing, /financeiro).
// Cliente do Mapa nunca chega aqui (o middleware o prende em /mapa); mesmo assim o layout exige sessão de equipe.
import { requireUser } from "@/lib/auth";
import { EquipeShell } from "@/components/shell/EquipeShell";

export const dynamic = "force-dynamic";

export default async function EquipeLayout({ children }: { children: React.ReactNode }) {
  const sess = await requireUser();
  return (
    <EquipeShell sess={sess} banner={sess.role === "reviewer" ? <div className="banner" role="status">Acesso de revisão — somente leitura.</div> : undefined}>
      {children}
    </EquipeShell>
  );
}
