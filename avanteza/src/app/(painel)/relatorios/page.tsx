import Link from "next/link";
import { userDb } from "@/lib/supabase/server";
import { spDate } from "@/lib/dates";
import { CopyButton } from "@/components/CopyButton";
import { dt } from "@/lib/format";

export default async function Relatorios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const date = typeof sp.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? sp.data : spDate();
  const db = await userDb();
  const { data: reports } = await db
    .from("ai_reports")
    .select("*, clients(name, contact_phone)")
    .eq("report_date", date)
    .order("created_at", { ascending: false });
  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Fase 2 · Agente</div><h1>Relatórios <span className="serif">diários</span></h1></div>
        <form className="btn-row">
          <input type="date" name="data" defaultValue={date} style={{ width: 170 }} />
          <button className="btn btn-sm btn-ghost">Ver</button>
        </form>
      </div>
      {(reports ?? []).length === 0 && <div className="card empty" style={{ marginTop: 12 }}>Nenhum relatório em {date}. A rotina roda às 7h–8h (Brasília) ou use “Gerar análise agora” na página do cliente.</div>}
      {(reports ?? []).map((r: any) => {
        const phone = String(r.clients?.contact_phone ?? "").replace(/\D/g, "");
        const wa = `https://wa.me/${phone ? (phone.startsWith("55") ? phone : "55" + phone) : ""}?text=${encodeURIComponent(r.report_text ?? "")}`;
        return (
          <div key={r.id} className="card" style={{ marginTop: 12 }}>
            <div className="row">
              <Link href={`/clientes/${r.client_id}`}><h3>{r.clients?.name}</h3></Link>
              <div className="btn-row">
                {r.proposed_count > 0 && <Link href="/aprovacoes" className="pill pill-orange">{r.proposed_count} ação(ões) propostas</Link>}
                <span className={`pill ${r.status === "ok" ? "pill-ok" : "pill-danger"}`}>{r.status === "ok" ? (r.summary ? "com IA" : "só números") : "erro na IA"}</span>
              </div>
            </div>
            {r.error && <div className="small muted" style={{ marginTop: 4 }}>{r.error}</div>}
            <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font)", background: "var(--cream)", border: "1px solid var(--sand)", borderRadius: 6, padding: 12, marginTop: 10 }}>{r.report_text}</pre>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <CopyButton text={r.report_text ?? ""} label="Copiar relatório" />
              <a className="btn btn-sm btn-ghost" href={wa} target="_blank" rel="noreferrer">Enviar no WhatsApp</a>
            </div>
            {Array.isArray(r.diagnosis?.itens) && r.diagnosis.itens.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="small">Diagnóstico completo da IA</summary>
                <ul className="list">
                  {r.diagnosis.itens.map((d: any, i: number) => (
                    <li key={i}><span className={`pill ${d.severidade === "critica" ? "pill-orange" : d.severidade === "atencao" ? "pill-sand" : "pill-outline"}`}>{d.severidade}</span> <strong>{d.tema}</strong><div className="small">{d.texto}</div></li>
                  ))}
                </ul>
                {r.diagnosis.descartadas?.length > 0 && <div className="small muted">Descartadas pelas travas: {r.diagnosis.descartadas.map((x: any) => `${x.tipo} ${x.alvo} (${x.motivo})`).join("; ")}</div>}
              </details>
            )}
            <div className="small muted" style={{ marginTop: 6 }}>{dt(r.created_at)}{r.model ? ` · ${r.model}` : ""}</div>
          </div>
        );
      })}
    </>
  );
}
