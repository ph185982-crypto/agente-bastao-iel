// Mapa: bloco "Depende de você" — o que está com o cliente (ações dele e ações da Avanteza paradas esperando por ele).
// O cliente marca "feito" e pode anexar um link. O id da ação vai no formulário, mas a escrita SEMPRE filtra pela empresa
// do escopo da sessão (resolverPendencia), então um id de outro cliente não faz nada.
import { fmtDate, isOverdue } from "@/lib/mapa/progress";
import { addDaysStr } from "@/lib/mapa/plan";
import { resolverMinhaPendencia } from "@/app/mapa/actions";
import { Submit } from "@/components/Submit";
import "@/components/motor/motor.css";

export function pendenciasDoCliente<T extends { owner: string; status: string }>(acoes: T[]): T[] {
  return acoes.filter((a) => a.status !== "concluida" && (a.owner === "cliente" || a.status === "bloqueada"));
}

export function DependeDeVoce({ acoes, hoje, readOnly, voltar, limite }: { acoes: any[]; hoje: string; readOnly: boolean; voltar: string; limite?: number }) {
  // O que é para agora: atrasadas, paradas esperando o cliente e o que vence nos próximos 30 dias (o resto do ano fica no plano).
  const limiteData = addDaysStr(hoje, 30);
  const lista = pendenciasDoCliente(acoes)
    .filter((a) => a.status === "bloqueada" || !a.due_date || a.due_date <= limiteData)
    .sort((a, b) => (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1);
  if (!lista.length) return null;
  const mostrar = limite ? lista.slice(0, limite) : lista;
  return (
    <section className="mt-voce" aria-label="Depende de você" style={{ marginTop: 18 }}>
      <h2>Depende de você <span className="pill pill-orange">{lista.length}</span></h2>
      {mostrar.map((a) => (
        <div className="item" key={a.id}>
          <strong>{a.title}</strong>
          {a.status === "bloqueada" && a.blocked_reason && <div className="small">A Avanteza precisa de: <b>{a.blocked_reason}</b></div>}
          {a.description && a.status !== "bloqueada" && <div className="small muted">{a.description}</div>}
          <div className={`small ${isOverdue(a, hoje) ? "late" : "muted"}`}>{a.due_date ? `${isOverdue(a, hoje) ? "Atrasada, prazo " : "Prazo "}${fmtDate(a.due_date)}` : "Sem prazo"}</div>
          {!readOnly && (
            <form action={resolverMinhaPendencia}>
              <input type="hidden" name="action_id" value={a.id} /><input type="hidden" name="voltar" value={voltar} />
              <input type="url" name="link" placeholder="Link (opcional): planilha, pasta, arquivo" aria-label={`Link para ${a.title}`} maxLength={2000} />
              <Submit className="btn btn-sm btn-orange">{a.status === "bloqueada" ? "Já enviei" : "Marcar como feito"}</Submit>
            </form>
          )}
        </div>
      ))}
      {limite && lista.length > limite && <p className="small" style={{ marginBottom: 0 }}><a href="/mapa/plano#voce">Ver as {lista.length} pendências</a></p>}
    </section>
  );
}
