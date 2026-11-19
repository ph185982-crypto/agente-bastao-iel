// Cartão “Total gasto até agora” (alerta de recarga): gasto acumulado das campanhas do cliente desde o início do ciclo, com barra até
// o valor combinado, conversas e custo por conversa. Componente de servidor; usado no Início e em Canais do Mapa e na aba Canais do admin.
import { brl, inteiro } from "@/lib/dashboards/format";
import { ddmm } from "@/lib/dashboards/periodo";
import type { GastoCiclo } from "@/lib/channels/alerta-gasto";

const ESTADO = {
  limite: { pill: "pill-danger", texto: "Hora de recarregar", barra: "limite" },
  aviso: { pill: "pill-sand", texto: "Saldo acabando", barra: "aviso" },
  ok: { pill: "pill-ok", texto: "Saldo em dia", barra: "" },
} as const;

export function CartaoGastoCiclo({ g, rotulo = { um: "conversa", plural: "Conversas" }, compacto = false, id = "gasto-ciclo" }: { g: GastoCiclo; rotulo?: { um: string; plural: string }; compacto?: boolean; id?: string }) {
  const e = ESTADO[g.nivel ?? "ok"];
  const largura = Math.min(100, Math.max(0, g.pct));
  const pctTxt = g.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return (
    <section className={`card midia-fonte gasto-ciclo${compacto ? " compacto" : ""}`} aria-labelledby={`${id}-t`}>
      <div className="row">
        <h3 id={`${id}-t`}>Total gasto até agora</h3>
        <span className={`pill ${e.pill}`}>{e.texto}</span>
      </div>
      <p className="gasto-valor"><b>{brl(g.gasto, true)}</b> <span className="muted">de {brl(g.limite, true)}</span></p>
      <div className={`progress ${e.barra}`} role="progressbar" aria-label={`Gasto de ${brl(g.gasto, true)} de ${brl(g.limite, true)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(largura)}>
        <span style={{ width: `${largura}%` }} />
      </div>
      <p className="small muted" style={{ margin: "6px 0 0" }}>
        {pctTxt}% do valor combinado desde {ddmm(g.desde)} · {g.restante > 0 ? `restam ${brl(g.restante, true)}` : "valor combinado atingido"}
      </p>
      <ul className="gasto-kpis">
        <li><span>{rotulo.plural}</span><b>{inteiro(g.conversas)}</b></li>
        <li><span>Custo por {rotulo.um}</span><b>{g.custoPorConversa != null ? brl(g.custoPorConversa, true) : "—"}</b></li>
      </ul>
      {g.nivel === "limite" && <p className="small gasto-nota" role="status">O valor combinado foi atingido. Faça a recarga para os anúncios não pararem; a Avanteza reinicia a contagem em seguida.</p>}
      {g.nivel === "aviso" && <p className="small gasto-nota" role="status">O saldo está acabando: já foram {pctTxt}% do valor combinado. Programe a recarga.</p>}
    </section>
  );
}
