// Cartão de KPI: rótulo, valor, variação vs. período anterior (texto + seta, nunca só cor) e minigráfico opcional.
import { percentual } from "@/lib/dashboards/format";

export interface DeltaProps {
  /** Variação em %; null = sem base de comparação. */
  pct: number | null;
  /** Custos: subir é ruim. */
  inverso?: boolean;
  /** Texto do período anterior, para o title. */
  anterior?: string;
}

export function Delta({ pct, inverso, anterior }: DeltaProps) {
  if (pct == null) return <span className="delta muted" title={anterior}>sem base anterior</span>;
  if (pct === 0) return <span className="delta muted" title={anterior}>= igual ao anterior</span>;
  const bom = inverso ? pct < 0 : pct > 0;
  return (
    <span className={`delta ${bom ? "up" : "down"}`} title={anterior}>
      <span aria-hidden="true">{pct > 0 ? "▲" : "▼"}</span> {percentual(Math.abs(pct))}
      <span className="sr"> {pct > 0 ? "acima" : "abaixo"} do período anterior</span>
      <span className="muted dv"> vs. anterior</span>
    </span>
  );
}

export function Spark({ valores, cor = "orange" }: { valores: number[]; cor?: "orange" | "ok" | "danger" }) {
  if (valores.length < 2 || valores.every((v) => v === valores[0])) return null;
  const min = Math.min(...valores), max = Math.max(...valores), span = max - min || 1;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * 100, 26 - ((v - min) / span) * 24] as const);
  const linha = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className={`spark c-${cor}`} viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={`${linha} L100 28 L0 28 Z`} className="spark-area" />
      <path d={linha} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Kpi({ label, valor, sub, delta, spark, cor, indisponivel }: {
  label: string; valor: string; sub?: React.ReactNode; delta?: DeltaProps; spark?: number[]; cor?: "orange" | "ok" | "danger"; indisponivel?: boolean;
}) {
  return (
    <div className={`kpi dkpi${indisponivel ? " off" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{valor}</div>
      {delta && <Delta {...delta} />}
      {sub && <div className="small muted ksub">{sub}</div>}
      {spark && <Spark valores={spark} cor={cor} />}
    </div>
  );
}
