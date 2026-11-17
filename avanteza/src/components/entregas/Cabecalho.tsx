// Cabeçalho do Funil de Entrega: título, abas, indicadores e filtros (servidor).
import Link from "next/link";
import "./entregas.css";
import { PageHeader } from "@/components/shell/GlassCard";
import type { Quadro } from "@/lib/entregas/crm";
import { moeda } from "@/lib/entregas/forms";

export const ABAS = [
  { id: "quadro", rotulo: "Quadro" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "renovacoes", rotulo: "Renovações" },
  { id: "modelos", rotulo: "Modelos e gatilhos" },
] as const;
export type AbaId = (typeof ABAS)[number]["id"];

export interface FiltrosUrl { aba: AbaId; por: "etapa" | "pilar"; q: string; resp: string; pilar: string; atraso: boolean; status: string }

export function hrefEntregas(f: Partial<FiltrosUrl>, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (f.aba && f.aba !== "quadro") sp.set("aba", f.aba);
  if (f.por && f.por !== "etapa") sp.set("por", f.por);
  if (f.q) sp.set("q", f.q);
  if (f.resp) sp.set("resp", f.resp);
  if (f.pilar) sp.set("pilar", f.pilar);
  if (f.atraso) sp.set("atraso", "1");
  if (f.status && f.status !== "EM_ANDAMENTO") sp.set("status", f.status);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  return `/operacoes/entregas${sp.size ? `?${sp}` : ""}`;
}

export function Cabecalho({ f, ind, emFixture }: { f: FiltrosUrl; ind?: Quadro["indicadores"]; emFixture?: boolean }) {
  return (
    <>
      <PageHeader eyebrow="Operações" title={<>Funil de <span className="accent">Entrega</span></>}>
        <p className="muted small" style={{ marginTop: 6 }}>O que vem depois da venda: cartões por pilar, etapa e responsável. Os dados vivem no CRM; esta tela lê e atualiza por lá.</p>
      </PageHeader>
      {emFixture && <div className="notice" role="note" style={{ margin: "10px 0 0" }}><b>Dados simulados</b> (ENTREGAS_FIXTURE, só desenvolvimento). Nada aqui é real e nada é gravado no CRM.</div>}
      <nav className="tabs" aria-label="Seções do Funil de Entrega">
        {ABAS.map((a) => <Link key={a.id} href={hrefEntregas({ ...f, aba: a.id })} aria-current={a.id === f.aba ? "page" : undefined}>{a.rotulo}</Link>)}
      </nav>
      {ind && (
        <div className="ent-kpis" aria-label="Indicadores">
          <div className="kpi"><div className="label">Clientes ativos</div><div className="value">{ind.entregas}</div></div>
          <div className="kpi"><div className="label">Receita mensal</div><div className="value">{moeda(ind.mrr)}</div></div>
          <div className="kpi"><div className="label">Cartões abertos</div><div className="value">{ind.cartoesAbertos}</div></div>
          <div className={`kpi ${ind.atrasados ? "alerta" : ""}`}><div className="label">Atrasados</div><div className="value">{ind.atrasados}</div></div>
          <div className={`kpi ${ind.aguardandoCliente ? "atencao" : ""}`}><div className="label">Aguardando cliente</div><div className="value">{ind.aguardandoCliente}</div></div>
          <div className={`kpi ${ind.emRisco ? "alerta" : ""}`}><div className="label">Em risco</div><div className="value">{ind.emRisco}</div></div>
          <div className={`kpi ${ind.renovacoesProximas ? "atencao" : ""}`}><div className="label">Renovam em 60 dias</div><div className="value">{ind.renovacoesProximas}</div></div>
        </div>
      )}
    </>
  );
}
