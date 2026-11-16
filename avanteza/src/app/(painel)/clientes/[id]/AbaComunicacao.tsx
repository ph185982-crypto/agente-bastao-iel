// Aba "Aprovações e relatórios" do cliente: preferências (relatório semanal e lembretes), peças para aprovação,
// relatórios semanais e o log dos lembretes enviados ao cliente.
import Link from "next/link";
import { currentSession } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { dt } from "@/lib/format";
import { fmtDate } from "@/lib/mapa/progress";
import { Submit } from "@/components/Submit";
import { FormNovaPeca } from "@/components/aprovacoes/FormNovaPeca";
import { ItemAprovacao } from "@/components/aprovacoes/ItemAprovacao";
import { podeEditarPlaybooks, podeTrabalharMotor } from "@/lib/motor/acesso";
import { arquivosDoCliente, filaEquipe, tarefasLigaveis } from "@/lib/aprovacoes/equipe";
import { relatoriosParaEquipe } from "@/lib/relatorios/gerar";
import { lembretesDoCliente } from "@/lib/relatorios/lembretes";
import { fmtPeriodo } from "@/lib/relatorios/semana";
import { EMAIL, rotuloPublicacao } from "@/lib/relatorios/rotulos";
import { preferenciasClienteForm } from "@/app/(equipe)/operacoes/aprovacoes/actions";
import "@/components/aprovacoes/aprovacoes.css";

export async function AbaComunicacao({ client }: { client: Record<string, any> }) {
  const id = client.id as string;
  const sess = await currentSession();
  const admin = podeEditarPlaybooks(sess);
  const pode = podeTrabalharMotor(sess);
  const hoje = spDate();
  const [fila, rels, lembretes, tarefas, arquivos] = await Promise.all([
    filaEquipe({ clientId: id }), relatoriosParaEquipe({ clientId: id }), lembretesDoCliente(id),
    pode ? tarefasLigaveis(id) : Promise.resolve([]), pode ? arquivosDoCliente(id) : Promise.resolve([]),
  ]);
  const aprovacoes = [...fila.ajustes, ...fila.pendentes, ...fila.recentes];
  const relatorios = [...rels.rascunhos, ...rels.recentes];
  return (
    <>
      <form action={preferenciasClienteForm} className="card" style={{ marginTop: 12 }} aria-label="Preferências">
        <input type="hidden" name="client_id" value={id} />
        <h3 style={{ marginTop: 0 }}>Relatório semanal e lembretes</h3>
        <div className="ap-form">
          <div className="field"><label htmlFor="pf-modo">Relatório semanal</label>
            <select id="pf-modo" name="modo" defaultValue={client.relatorio_modo ?? "auto"} disabled={!admin}>
              <option value="auto">Publica sozinho se ninguém revisar</option>
              <option value="revisao">Só publica depois da revisão</option>
              <option value="desligado">Desligado</option>
            </select>
          </div>
          <div className="field"><label htmlFor="pf-h">Prazo de revisão (horas)</label><input id="pf-h" name="horas" type="number" min={1} max={168} defaultValue={client.relatorio_horas ?? 12} disabled={!admin} /></div>
          <div className="field"><label htmlFor="pf-l">Lembretes ao cliente</label>
            <select id="pf-l" name="lembretes" defaultValue={client.lembretes_ativos === false ? "0" : "1"} disabled={!admin}><option value="1">Ligados (máx. 1 por dia)</option><option value="0">Desligados</option></select>
          </div>
          {admin && <div><Submit className="btn btn-sm">Salvar</Submit></div>}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>E-mails vão para {client.contact_email || "— (sem e-mail de contato: só no Mapa)"} quando o envio de e-mail estiver configurado.</p>
      </form>

      <h2>Aprovações</h2>
      {pode && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>Enviar peça para aprovação</summary>
          <div style={{ marginTop: 12 }}><FormNovaPeca clientId={id} tarefas={tarefas} arquivos={arquivos} back={`/clientes/${id}?aba=comunicacao`} /></div>
        </details>
      )}
      {aprovacoes.length === 0 ? <div className="empty" style={{ marginTop: 10 }}>Nenhuma peça enviada a este cliente.</div> : <div className="ap-lista">{aprovacoes.map((a) => <ItemAprovacao key={a.id} a={a} hoje={hoje} mostrarCliente={false} />)}</div>}

      <h2>Relatórios semanais</h2>
      {relatorios.length === 0 ? <div className="empty">Nenhum relatório gerado ainda (o primeiro sai na segunda-feira).</div> : (
        <div className="ap-lista">
          {relatorios.map((r) => (
            <Link key={r.id} href={`/operacoes/relatorios/${r.id}`} className={`ap-item ${r.status === "rascunho" ? "pendente" : r.status === "publicado" ? "aprovada" : ""}`}>
              <div className="ap-main"><div className="tit">Semana de {fmtPeriodo(r.semana, r.periodo_fim)}</div><div className="meta"><span>{rotuloPublicacao(r)}</span></div></div>
              <div className="lado"><span className={`pill ${r.status === "rascunho" ? "pill-orange" : r.status === "publicado" ? "pill-ok" : "pill-outline"}`}>{r.status === "rascunho" ? "Revisar" : r.status === "publicado" ? "Publicado" : "Descartado"}</span></div>
            </Link>
          ))}
        </div>
      )}

      <h2>Lembretes enviados</h2>
      <div className="card">
        {client.lembretes_ativos === false && <p className="small" style={{ marginTop: 0 }}>Lembretes desligados para este cliente.</p>}
        {lembretes.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nenhum lembrete enviado.</p> : (
          <ul className="list">
            {lembretes.map((l) => (
              <li key={l.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--hairline)" }}>
                <strong>{fmtDate(l.dia)}</strong> · {l.itens.length} item(ns) · {l.email_status ? EMAIL[l.email_status] ?? l.email_status : "—"} <span className="small muted">({dt(l.criado_em)})</span>
                <div className="small muted">{l.itens.slice(0, 4).map((i) => i.titulo).join(" · ")}{l.itens.length > 4 ? " …" : ""}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
