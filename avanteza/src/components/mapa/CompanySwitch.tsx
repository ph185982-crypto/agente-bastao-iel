"use client";
import { selectCompany } from "@/app/mapa/actions";

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

/** Seletor de empresa do grupo. No menu recolhido só aparecem as iniciais; o <select> continua por baixo (clicável e focável). */
export function CompanySwitch({ companies, current }: { companies: { id: string; name: string }[]; current: string }) {
  const atual = companies.find((c) => c.id === current)?.name ?? "";
  return (
    <form action={selectCompany}>
      <label htmlFor="company" className="cs-label" style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)", padding: "0 8px" }}>Empresa do grupo</label>
      <div className="cs-wrap">
        <select id="company" name="company" defaultValue={current} className="company-switch" title={atual ? `Empresa: ${atual}` : undefined} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="cs-initials" aria-hidden="true">{iniciais(atual)}</span>
      </div>
    </form>
  );
}
