export function Logo({ sub = false, size }: { sub?: boolean; size?: number }) {
  return (
    <div>
      <span className="logo" style={size ? { fontSize: size } : undefined}>
        avanteza<span className="dot" aria-hidden="true" />
      </span>
      {sub && <div className="logo-sub">Consultoria e Estratégia</div>}
    </div>
  );
}
