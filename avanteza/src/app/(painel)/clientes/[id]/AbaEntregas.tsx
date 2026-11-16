// Aba "Entregas" do cliente: saúde, serviços contratados (editar e aplicar playbooks), responsável pela conta,
// quadro por fase × situação e a fila do cliente com as ações rápidas.
import { currentSession } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { addDaysStr } from "@/lib/mapa/plan";
import { fmtDate } from "@/lib/mapa/progress";
import { rawQuery } from "@/lib/db/client";
import { Submit } from "@/components/Submit";
import { AcaoCard } from "@/components/motor/AcaoCard";
import { Semaforo } from "@/components/motor/Semaforo";
import { podeEditarPlaybooks, podeTrabalharMotor } from "@/lib/motor/acesso";
import { acoesDoCliente, aplicarPlaybooks, carteira, listarCatalogo, listarEquipe, servicosDoCliente } from "@/lib/motor/repo";
import { aplicarPlaybooksClienteForm, definirGerenteForm, removerServicoClienteForm, salvarServicoClienteForm } from "@/app/(equipe)/operacoes/motor-actions";
import "@/components/motor/motor.css";

const COLUNAS = [
  { k: "planejada", label: "A fazer" }, { k: "em_execucao", label: "Em execução" }, { k: "bloqueada", label: "Depende do cliente" }, { k: "concluida", label: "Concluída" },
] as const;
const STATUS_SVC: Record<string, string> = { ativo: "Ativo", pausado: "Pausado", encerrado: "Encerrado" };

export async function AbaEntregas({ client, previa }: { client: Record<string, any>; previa: boolean }) {
  const id = client.id as string;
  const sess = await currentSession();
  const admin = podeEditarPlaybooks(sess);
  const pode = podeTrabalharMotor(sess);
  const hoje = spDate();
  const back = `/clientes/${id}?aba=entregas`;
  const [servicos, { servicos: catalogo }, equipe, acoes, fases, cart] = await Promise.all([
    servicosDoCliente(id), listarCatalogo(), listarEquipe(), acoesDoCliente(id),
    rawQuery<{ id: string; position: number; name: string }>("select id, position, name from avanteza.plan_phases where client_id = $1 order by position", [id]),
    carteira(hoje),
  ]);
  const saude = cart.find((c) => c.id === id)?.saude;
  const prev = admin && previa ? await aplicarPlaybooks(id, { hoje, actor: "previa", previa: true }) : null;
  const ate = addDaysStr(hoje, 7);
  const fila = acoes.filter((a) => a.status !== "concluida" && a.due_date && a.due_date <= ate).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1) || a.priority - b.priority);
  const grupos = [...fases.map((f) => ({ key: f.id, nome: `Fase ${f.position} · ${f.name}`, itens: acoes.filter((a) => a.phase_id === f.id) })), { key: "sem", nome: "Fora das fases", itens: acoes.filter((a) => !a.phase_id) }].filter((g) => g.itens.length);
  const naoContratados = catalogo.filter((s) => s.active && !servicos.some((x) => x.service_id === s.id));

  return (
    <>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <h3>Saúde das entregas</h3>
          {saude && <Semaforo nivel={saude.nivel} />}
        </div>
        {saude && (saude.motivos.length ? <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{saude.motivos.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="small muted" style={{ margin: "6px 0 0" }}>Tudo em dia.</p>)}
        <form action={definirGerenteForm} className="row" style={{ marginTop: 10 }}>
          <input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={back} />
          <div className="field" style={{ flex: "1 1 220px", margin: 0 }}><label htmlFor="ger">Responsável pela conta</label>
            <select id="ger" name="manager_id" defaultValue={client.manager_id ?? ""} disabled={!admin}><option value="">Ninguém</option>{equipe.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select>
          </div>
          {admin && <Submit className="btn btn-sm btn-ghost">Salvar</Submit>}
        </form>
      </div>

      <h2>Serviços contratados</h2>
      <div className="card">
        {servicos.length === 0 && <p className="muted small" style={{ marginTop: 0 }}>Nenhum serviço cadastrado. Ao aplicar os playbooks, entram os serviços padrão do tipo do cliente ({client.kind === "midia" ? "Onboarding, Tráfego pago e Mídias sociais" : client.kind === "ambos" ? "todos" : "Onboarding e Gestão de marketplaces"}).</p>}
        <ul className="list">
          {servicos.map((s) => (
            <li key={s.id}>
              <div className="row">
                <div><strong>{s.service_name}</strong> <span className={`pill ${s.status === "ativo" ? "pill-ok" : "pill-sand"}`}>{STATUS_SVC[s.status]}</span>
                  <div className="small muted">desde {fmtDate(s.start_date)}{s.end_date ? ` até ${fmtDate(s.end_date)}` : ""}{s.monthly_value ? ` · R$ ${Number(s.monthly_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}/mês` : ""}{s.contract_ref ? ` · contrato ${s.contract_ref}` : ""}{s.assignee_id ? ` · ${equipe.find((u) => u.id === s.assignee_id)?.name ?? "responsável"}` : ""}</div>
                </div>
              </div>
              {admin && (
                <details className="mini" style={{ marginTop: 6 }}><summary>Editar</summary>
                  <ServicoForm clientId={id} back={back} s={s} equipe={equipe} catalogo={[{ id: s.service_id, name: s.service_name }]} />
                  <form action={removerServicoClienteForm} style={{ marginTop: 8 }}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={back} /><Submit className="btn btn-sm btn-danger" confirm="Remover este serviço? As ações já criadas continuam.">Remover serviço</Submit></form>
                </details>
              )}
            </li>
          ))}
        </ul>
        {admin && naoContratados.length > 0 && (
          <details className="mini novo" style={{ marginTop: 10 }}><summary>Adicionar serviço</summary>
            <ServicoForm clientId={id} back={back} equipe={equipe} catalogo={naoContratados} inicio={client.start_date ?? hoje} />
          </details>
        )}
        {admin && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <form action={aplicarPlaybooksClienteForm}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="back" value={back} /><Submit className="btn btn-orange">Aplicar playbooks</Submit></form>
            {!prev && <a className="btn btn-ghost" href={`${back}&previa=1#previa`}>Ver prévia</a>}
          </div>
        )}
        {prev && (
          <div id="previa" className="mt-previa">
            <div className="notice" role="note">
              Prévia: {prev.plano.criar.length} ação(ões) nova(s), {prev.plano.vincular.length} ligada(s) ao plano de 12 meses, {prev.plano.atualizar.length} atualizada(s), {prev.plano.arquivar.length} arquivada(s). Janela das rotinas: {fmtDate(prev.plano.janela.de)} a {fmtDate(prev.plano.janela.ate)}.
              {prev.plano.criar.length > 0 && <ul>{prev.plano.criar.slice(0, 12).map((d) => <li key={d.key}>{fmtDate(d.dueDate)} · {d.title}{d.owner === "cliente" ? " (cliente)" : ""}</li>)}{prev.plano.criar.length > 12 && <li>e mais {prev.plano.criar.length - 12}…</li>}</ul>}
            </div>
          </div>
        )}
      </div>

      <h2>Próximos 7 dias e atrasadas</h2>
      {fila.length === 0 ? <div className="empty">Nada em aberto até {fmtDate(ate)}.</div> : (
        <>
          <div className="mt-lista">{fila.slice(0, 8).map((a) => <AcaoCard key={a.id} a={a} hoje={hoje} equipe={equipe} back={back} pode={pode} linkCliente={null} fases={fases} />)}</div>
          {fila.length > 8 && (
            <details className="mt-mais"><summary>Mostrar mais {fila.length - 8}</summary>
              <div className="mt-lista">{fila.slice(8).map((a) => <AcaoCard key={a.id} a={a} hoje={hoje} equipe={equipe} back={back} pode={pode} linkCliente={null} fases={fases} />)}</div>
            </details>
          )}
        </>
      )}

      <h2>Quadro por fase</h2>
      {grupos.length === 0 && <div className="empty">Sem ações ainda. Aplique os playbooks para montar as entregas.</div>}
      {grupos.map((g) => (
        <section key={g.key} style={{ marginTop: 12 }} aria-label={g.nome}>
          <div className="row"><h3>{g.nome}</h3><span className="small muted">{g.itens.filter((a) => a.status === "concluida").length}/{g.itens.length} concluídas</span></div>
          <div className="mt-quadro" style={{ marginTop: 8 }}>
            {COLUNAS.map((c) => {
              const itens = g.itens.filter((a) => a.status === c.k);
              return (
                <div key={c.k} className="mt-col">
                  <h4><span>{c.label}</span><span>{itens.length}</span></h4>
                  {itens.length === 0 && <div className="vazio">—</div>}
                  {itens.slice(0, 12).map((a) => (
                    <div key={a.id} className={`mt-mini ${a.status !== "concluida" && a.due_date && a.due_date < hoje ? "atrasada" : ""}`}>
                      <div>{a.title}</div>
                      <div className="s">{a.due_date ? fmtDate(a.due_date) : "sem prazo"}{a.owner === "cliente" ? " · cliente" : a.assignee_name ? ` · ${a.assignee_name}` : ""}{a.ai_generated ? " · IA" : ""}</div>
                    </div>
                  ))}
                  {itens.length > 12 && <div className="vazio">e mais {itens.length - 12}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function ServicoForm({ clientId, back, s, equipe, catalogo, inicio }: {
  clientId: string; back: string; s?: Awaited<ReturnType<typeof servicosDoCliente>>[number]; equipe: { id: string; name: string | null; email: string }[]; catalogo: { id: string; name: string }[]; inicio?: string;
}) {
  return (
    <form action={salvarServicoClienteForm} className="mini-form stack">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="back" value={back} />
      <div className="fgrid">
        <div className="field"><label>Serviço</label><select name="service_id" defaultValue={s?.service_id}>{catalogo.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>Início</label><input name="start_date" type="date" required defaultValue={s?.start_date ?? inicio} /></div>
        <div className="field"><label>Fim</label><input name="end_date" type="date" defaultValue={s?.end_date ?? ""} /></div>
        <div className="field"><label>Valor mensal (R$)</label><input name="monthly_value" type="number" step="0.01" min={0} defaultValue={s?.monthly_value ?? ""} /></div>
        <div className="field"><label>Contrato</label><input name="contract_ref" defaultValue={s?.contract_ref ?? ""} placeholder="nº ou link" /></div>
        <div className="field"><label>Responsável</label><select name="assignee_id" defaultValue={s?.assignee_id ?? ""}><option value="">Pelo papel da tarefa</option>{equipe.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></div>
        <div className="field"><label>Situação</label><select name="status" defaultValue={s?.status ?? "ativo"}>{Object.entries(STATUS_SVC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <Submit className="btn btn-sm">{s ? "Salvar serviço" : "Adicionar"}</Submit>
    </form>
  );
}
