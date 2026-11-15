export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const erro = typeof sp.erro === "string" ? sp.erro : null;
  if (!ok && !erro) return null;
  return (
    <div className={`notice ${erro ? "danger" : "ok"}`} role="status" style={{ marginBottom: 12 }}>
      {erro ?? ok}
    </div>
  );
}
