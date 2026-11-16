"use client";
import { selectCompany } from "@/app/mapa/actions";

export function CompanySwitch({ companies, current }: { companies: { id: string; name: string }[]; current: string }) {
  return (
    <form action={selectCompany}>
      <label htmlFor="company" style={{ fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)", padding: "0 8px" }}>Empresa do grupo</label>
      <select id="company" name="company" defaultValue={current} className="company-switch" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </form>
  );
}
