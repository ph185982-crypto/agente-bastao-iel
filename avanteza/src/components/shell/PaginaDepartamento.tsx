import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { departamento, type DepId } from "@/lib/shell/departamentos";
import { PageHeader } from "./GlassCard";
import { ModuloCard } from "./ModuloCard";

/** Página de entrada de um departamento: cartões dos módulos e atalhos para o que o usuário pode abrir. */
export async function PaginaDepartamento({ id, atalhos = [] }: { id: DepId; atalhos?: { href: string; label: string }[] }) {
  const sess = await requireUser();
  const d = departamento(id, sess);
  if (!d) redirect("/central?erro=" + encodeURIComponent("Você não tem acesso a este departamento."));
  return (
    <>
      <PageHeader eyebrow="Departamento" title={<>{d.nome.slice(0, -2)}<span className="accent">{d.nome.slice(-2)}</span></>}>
        <p className="muted" style={{ marginTop: 6 }}>{d.descricao}</p>
      </PageHeader>
      <div className="grid three" style={{ marginTop: 18 }}>
        {d.modulos.map((m) => <ModuloCard key={m.id} m={m} />)}
      </div>
      {atalhos.length > 0 && (
        <>
          <h2>Atalhos</h2>
          <div className="btn-row">{atalhos.map((a) => <Link key={a.href} href={a.href} className="btn btn-ghost btn-sm">{a.label}</Link>)}</div>
        </>
      )}
    </>
  );
}
