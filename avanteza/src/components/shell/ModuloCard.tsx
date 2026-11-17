import { GlassCard } from "./GlassCard";
import { Icon } from "./Icons";
import type { Modulo } from "@/lib/shell/departamentos";
import { ssoEnabled } from "@/lib/apps";

/** Cartão de um módulo: leva à tela da Central ou abre o aplicativo (login único). */
export function ModuloCard({ m, badges = [] }: { m: Modulo; badges?: string[] }) {
  const semSso = m.externo && "app" in (m.requer as object) && !ssoEnabled((m.requer as { app: string }).app);
  return (
    <GlassCard as="a" href={m.href} className="tile" style={{ marginTop: 0 }}>
      <span className="mono-ico" aria-hidden="true"><Icon name={m.icon} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <h3>{m.nome}</h3>
          <span className="go" aria-hidden="true">›</span>
        </div>
        <p className="small muted" style={{ margin: "6px 0 0" }}>{m.descricao}</p>
        {(badges.length > 0 || semSso) && (
          <div className="btn-row" style={{ marginTop: 10 }}>
            {badges.map((b) => <span key={b} className="pill pill-orange">{b}</span>)}
            {semSso && <span className="pill pill-outline">login próprio</span>}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
