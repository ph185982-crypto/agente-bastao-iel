export function Bars({ data, format }: { data: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="bars" role="img" aria-label="Gráfico de barras">
        {data.map((d, i) => (
          <div
            key={d.label}
            className={`b${i === data.length - 1 ? " today" : ""}`}
            style={{ height: `${(d.value / max) * 100}%` }}
            title={`${d.label}: ${format ? format(d.value) : d.value}`}
          />
        ))}
      </div>
      <div className="bars-labels">
        {data.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
