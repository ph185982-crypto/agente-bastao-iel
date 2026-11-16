import type { ElementType, ReactNode } from "react";

/** Cartão de vidro (raio 22px). `as` permite usar <a>, <section>, <form>… */
export function GlassCard({ as: Tag = "div", className = "", children, ...rest }: { as?: ElementType; className?: string; children: ReactNode; [k: string]: unknown }) {
  return <Tag className={`card ${className}`.trim()} {...rest}>{children}</Tag>;
}

/** Cabeçalho de página: sobretítulo + título (+ ações à direita). */
export function PageHeader({ eyebrow, title, actions, children }: { eyebrow?: string; title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {children}
      </div>
      {actions}
    </div>
  );
}
