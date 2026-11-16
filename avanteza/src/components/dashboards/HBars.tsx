// Barras horizontais em CSS (funil, categorias, ranking). Largura proporcional ao maior valor; rótulo e valor em texto.
export interface ItemBarra { rotulo: string; valor: number; texto: string; sub?: string; cor?: "orange" | "ok" | "danger" | "muted" }

export function HBars({ itens, vazio = "Sem dados no período." }: { itens: ItemBarra[]; vazio?: string }) {
  const max = Math.max(...itens.map((i) => i.valor), 0);
  if (!itens.length || max <= 0) return <div className="empty" role="status">{vazio}</div>;
  return (
    <ul className="hbars">
      {itens.map((i) => (
        <li key={i.rotulo}>
          <div className="hb-top"><span className="hb-l">{i.rotulo}</span><span className="hb-v">{i.texto}</span></div>
          <div className="hb-track" aria-hidden="true"><span className={`c-${i.cor ?? "orange"}`} style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} /></div>
          {i.sub && <div className="small muted">{i.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
