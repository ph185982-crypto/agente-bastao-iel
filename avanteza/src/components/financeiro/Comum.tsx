// Peças compartilhadas das telas do Financeiro (servidor): cabeçalho com área e abas, seletor de mês, avisos, campos ocultos.
import Link from "next/link";
import { PageHeader } from "@/components/shell/GlassCard";
import { somarMeses, rotuloMes, mesDe, hojeBrasilia } from "@/lib/financeiro/periodo";
import type { EscopoFin } from "@/lib/financeiro/acesso";
import type { Fonte } from "@/lib/financeiro";

export const ABAS = [
  { id: "", rotulo: "Visão geral" },
  { id: "lancamentos", rotulo: "Lançamentos" },
  { id: "contas", rotulo: "Contas a pagar" },
  { id: "receber", rotulo: "A receber" },
  { id: "contratos", rotulo: "Contratos" },
  { id: "dre", rotulo: "DRE" },
  { id: "metas", rotulo: "Metas" },
  { id: "categorias", rotulo: "Categorias" },
] as const;
export type AbaId = (typeof ABAS)[number]["id"];

export const baseDe = (escopo: EscopoFin) => (escopo === "pessoal" ? "/financeiro/pessoal" : "/financeiro");
export const hrefAba = (escopo: EscopoFin, aba: string, mes?: string) => `${baseDe(escopo)}${aba ? `/${aba}` : ""}${mes ? `?mes=${mes}` : ""}`;

export function Aviso({ titulo, texto, tipo = "danger" }: { titulo: string; texto: string; tipo?: "danger" | "" }) {
  return (
    <div className={`notice ${tipo}`} role="status" style={{ marginTop: 12 }}>
      <b>{titulo}</b>
      <p className="small muted" style={{ margin: "4px 0 0" }}>{texto}</p>
    </div>
  );
}

/** Aviso honesto quando a fonte não respondeu (nunca mostra zero no lugar do dado). */
export function FonteAviso({ f }: { f: Fonte<unknown> }) {
  if (f.estado === "ok") return null;
  return <Aviso titulo={f.estado === "nao-configurado" ? "Financeiro não configurado" : "Vendedor IA indisponível"} texto={`${f.motivo} Os dados do Financeiro voltam quando a conexão normalizar.`} />;
}

export function Cabecalho({ escopo, aba, mes, podePessoal, seletorMes = true }: { escopo: EscopoFin; aba: AbaId; mes: string; podePessoal: boolean; seletorMes?: boolean }) {
  const ehAtual = mes === mesDe(hojeBrasilia());
  return (
    <>
      <PageHeader eyebrow={escopo === "pessoal" ? "Financeiro · só você vê" : "Financeiro"} title={escopo === "pessoal" ? <>Finanças <span className="accent">pessoais</span></> : <>Financeiro da <span className="accent">Avanteza</span></>}>
        <p className="muted small" style={{ marginTop: 6 }}>
          {escopo === "pessoal" ? "Separado da empresa: revisores e membros nunca veem esta área." : "Escopo: empresa Avanteza (o pessoal fica em outra área). Mesma base do Max, no WhatsApp."}
        </p>
      </PageHeader>
      {podePessoal && (
        <nav className="tabs escopo" aria-label="Área">
          <Link href="/financeiro" aria-current={escopo === "empresa" ? "page" : undefined}>Empresa</Link>
          <Link href="/financeiro/pessoal" aria-current={escopo === "pessoal" ? "page" : undefined}>Pessoal</Link>
        </nav>
      )}
      <nav className="tabs" aria-label="Seções do Financeiro">
        {ABAS.map((a) => (
          <Link key={a.id} href={hrefAba(escopo, a.id, mes === mesDe(hojeBrasilia()) ? undefined : mes)} aria-current={a.id === aba ? "page" : undefined}>{a.rotulo}</Link>
        ))}
      </nav>
      {seletorMes && (
        <div className="mes-nav" role="group" aria-label="Mês">
          <Link className="btn btn-ghost btn-sm" href={hrefAba(escopo, aba, somarMeses(mes, -1))} aria-label="Mês anterior">‹</Link>
          <strong>{rotuloMes(mes)}</strong>
          <Link className="btn btn-ghost btn-sm" href={hrefAba(escopo, aba, somarMeses(mes, 1))} aria-label="Próximo mês">›</Link>
          {!ehAtual && <Link className="btn btn-ghost btn-sm" href={hrefAba(escopo, aba)}>Mês atual</Link>}
        </div>
      )}
    </>
  );
}

/** Campos ocultos que toda ação do Financeiro leva: operação, área, id e para onde voltar. */
export function Ocultos({ op, escopo, id, voltar, para }: { op: string; escopo: EscopoFin; id?: string; voltar: string; para?: string }) {
  return (
    <>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="escopo" value={escopo} />
      <input type="hidden" name="voltar" value={voltar} />
      {id && <input type="hidden" name="id" value={id} />}
      {para && <input type="hidden" name="para" value={para} />}
    </>
  );
}

export const destinoReclassificar = (escopo: EscopoFin) => (escopo === "empresa" ? "pessoal" : "empresa");
export const rotuloArea = (e: EscopoFin) => (e === "empresa" ? "Empresa" : "Pessoal");

/** Data ISO (com ou sem hora) → AAAA-MM-DD para <input type=date>. */
export const soData = (iso: string) => iso.slice(0, 10);
