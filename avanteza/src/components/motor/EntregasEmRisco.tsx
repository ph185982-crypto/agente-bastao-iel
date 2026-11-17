// Cartão "Entregas em risco" da Visão geral do dono: quantos clientes estão vermelhos/amarelos e por quê.
import Link from "next/link";
import type { CartaoCarteira } from "@/lib/motor/repo";
import { Semaforo } from "./Semaforo";
import "./motor.css";

export function EntregasEmRisco({ cartoes }: { cartoes: CartaoCarteira[] }) {
  const risco = cartoes.filter((c) => c.saude.nivel !== "verde");
  const verm = cartoes.filter((c) => c.saude.nivel === "vermelho").length;
  return (
    <section className="card" aria-label="Entregas em risco" style={{ marginTop: 14 }}>
      <div className="row">
        <h3>Entregas em risco</h3>
        <Link className="btn btn-sm btn-ghost" href="/operacoes/carteira">Abrir a Carteira</Link>
      </div>
      <p className="small muted" style={{ margin: "4px 0 8px" }}>
        {risco.length === 0 ? `Todos os ${cartoes.length} clientes em dia.` : `${verm} em risco · ${risco.length - verm} em atenção · ${cartoes.length - risco.length} em dia`}
      </p>
      {risco.length > 0 && (
        <ul className="list">
          {risco.slice(0, 5).map((c) => (
            <li key={c.id}>
              <div className="row"><strong>{c.nome}</strong><Semaforo nivel={c.saude.nivel} /></div>
              <div className="small muted">{c.saude.motivos.slice(0, 2).join(" · ")}{c.gerente ? ` · ${c.gerente}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
