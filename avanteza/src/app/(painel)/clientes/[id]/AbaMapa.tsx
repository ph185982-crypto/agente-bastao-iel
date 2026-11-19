import { adminDb } from "@/lib/db";
import { spDate } from "@/lib/dates";
import { dt } from "@/lib/format";
import { Submit } from "@/components/Submit";
import { CreateAccess, ResetAccess, WelcomeEmail } from "@/components/mapa/AccessForms";
import { listClientUsers } from "@/lib/mapa/admin";
import { OWNER_LABEL, STATUS_LABEL, fmtDate, isOverdue, planSummary } from "@/lib/mapa/progress";
import {
  alternarAcesso, alternarArquivo, excluirAcao, excluirArquivo, excluirReuniao, gerarPlano, preencherReuniao,
  registrarReuniao, salvarAcao, salvarArquivo, salvarFase, saveClientMapa, vincularEmpresa,
} from "../mapa-actions";

type Client = Record<string, any>;
const KIND_LABEL: Record<string, string> = { marketplace: "Marketplaces", midia: "Tráfego e mídias", ambos: "Marketplaces e mídias" };

function ActionForm({ a, clientId, phases }: { a?: any; clientId: string; phases: any[] }) {
  return (
    <form action={salvarAcao} className="stack">
      <input type="hidden" name="client_id" value={clientId} />
      {a && <input type="hidden" name="action_id" value={a.id} />}
      <div className="field"><label>Título</label><input name="title" defaultValue={a?.title ?? ""} required /></div>
      <div className="field"><label>Descrição</label><textarea name="description" defaultValue={a?.description ?? ""} style={{ minHeight: 60 }} /></div>
      <div className="grid two">
        <div className="field"><label>Situação</label><select name="status" defaultValue={a?.status ?? "planejada"}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label>Responsável</label><select name="owner" defaultValue={a?.owner ?? "avanteza"}><option value="avanteza">Avanteza</option><option value="cliente">Cliente</option></select></div>
        <div className="field"><label>Prazo</label><input name="due_date" type="date" defaultValue={a?.due_date ?? ""} /></div>
        <div className="field"><label>Fase</label><select name="phase_id" defaultValue={a?.phase_id ?? ""}><option value="">Sem fase</option>{phases.map((p) => <option key={p.id} value={p.id}>Fase {p.position} · {p.name}</option>)}</select></div>
      </div>
      <Submit className="btn btn-sm">{a ? "Salvar ação" : "Criar ação"}</Submit>
    </form>
  );
}

export async function AbaMapa({ client, aba, owner }: { client: Client; aba: string; owner: boolean }) {
  const db = adminDb();
  const id = client.id as string;
  const today = spDate();

  if (aba === "plano") {
    const [{ data: phases }, { data: actions }] = await Promise.all([
      db.from("plan_phases").select("*").eq("client_id", id).order("position"),
      db.from("plan_actions").select("*").eq("client_id", id).order("due_date", { ascending: true, nullsFirst: false }).order("position"),
    ]);
    const P = phases ?? [], A = actions ?? [];
    const s = planSummary(A, today);
    return (
      <>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row"><strong>{P.length ? `${s.pct}% concluído · ${s.done}/${s.total} ações` : "Sem plano gerado"}</strong>{s.overdue > 0 && <span className="pill pill-danger">{s.overdue} atrasada(s)</span>}</div>
          {owner && (
            <form action={gerarPlano} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="client_id" value={id} />
              <div className="grid two">
                <div className="field"><label>Início do plano</label><input name="start_date" type="date" defaultValue={client.start_date ?? today} required /></div>
                <div className="field"><label>Tipo</label><input value={KIND_LABEL[client.kind]} disabled readOnly /></div>
              </div>
              {P.length > 0 && <label className="check small"><input type="checkbox" name="regenerate" /> Regenerar (apaga fases e ações de origem “plano”; reuniões e manuais ficam)</label>}
              <Submit className="btn btn-orange" confirm={P.length ? "Regenerar o plano deste cliente?" : undefined}>{P.length ? "Regenerar plano" : "Gerar plano de 12 meses"}</Submit>
            </form>
          )}
        </div>
        {P.map((p: any) => (
          <section key={p.id} className="phase" style={{ marginTop: 12 }}>
            <div className="row"><h3>Fase {p.position} · {p.name}</h3><span className="small muted">{fmtDate(p.starts_on)} a {fmtDate(p.ends_on)}</span></div>
            {owner && (
              <details style={{ margin: "6px 0" }}><summary className="small">Editar fase</summary>
                <form action={salvarFase} className="stack" style={{ marginTop: 8 }}>
                  <input type="hidden" name="client_id" value={id} /><input type="hidden" name="phase_id" value={p.id} />
                  <div className="field"><label>Nome</label><input name="name" defaultValue={p.name} required /></div>
                  <div className="field"><label>Descrição</label><textarea name="description" defaultValue={p.description ?? ""} style={{ minHeight: 60 }} /></div>
                  <Submit className="btn btn-sm">Salvar fase</Submit>
                </form>
              </details>
            )}
            {A.filter((a: any) => a.phase_id === p.id).map((a: any) => <Row key={a.id} a={a} id={id} P={P} owner={owner} today={today} />)}
          </section>
        ))}
        {A.some((a: any) => !a.phase_id) && (
          <section className="phase" style={{ marginTop: 12 }}><h3>Sem fase</h3>{A.filter((a: any) => !a.phase_id).map((a: any) => <Row key={a.id} a={a} id={id} P={P} owner={owner} today={today} />)}</section>
        )}
        {owner && <><h2 id="nova-acao">Nova ação</h2><div className="card"><ActionForm clientId={id} phases={P} /></div></>}
      </>
    );
  }

  if (aba === "arquivos") {
    const { data: files } = await db.from("client_files").select("*").eq("client_id", id).order("file_date", { ascending: false, nullsFirst: false });
    return (
      <>
        <div className="card" style={{ marginTop: 12 }}>
          {(files ?? []).length === 0 && <div className="empty">Nenhum arquivo.</div>}
          <ul className="list">
            {(files ?? []).map((f: any) => (
              <li key={f.id}>
                <div className="row">
                  <div><a href={f.url} target="_blank" rel="noreferrer"><strong>{f.title}</strong></a> {!f.visible && <span className="pill pill-sand">oculto</span>}<div className="small muted">{f.kind ?? "arquivo"} · {fmtDate(f.file_date)}</div></div>
                  {owner && (
                    <div className="btn-row">
                      <form action={alternarArquivo}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="visible" value={f.visible ? "0" : "1"} /><Submit className="btn btn-sm btn-ghost">{f.visible ? "Ocultar" : "Mostrar"}</Submit></form>
                      <form action={excluirArquivo}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="file_id" value={f.id} /><Submit className="btn btn-sm btn-danger" confirm="Remover este arquivo?">Remover</Submit></form>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {owner && (
          <>
            <h2>Adicionar arquivo</h2>
            <form action={salvarArquivo} className="card stack">
              <input type="hidden" name="client_id" value={id} />
              <div className="field"><label>Título</label><input name="title" required /></div>
              <div className="field"><label>Link (Drive ou outro)</label><input name="url" type="url" required /></div>
              <div className="grid two">
                <div className="field"><label>Tipo</label><select name="kind"><option value="relatorio">Relatório</option><option value="contrato">Contrato</option><option value="plano">Plano</option><option value="apresentacao">Apresentação</option><option value="planilha">Planilha</option><option value="outro">Outro</option></select></div>
                <div className="field"><label>Data</label><input name="file_date" type="date" defaultValue={today} /></div>
              </div>
              <div className="field"><label>ID do arquivo no Drive (opcional)</label><input name="drive_file_id" /></div>
              <Submit className="btn btn-orange">Adicionar</Submit>
            </form>
          </>
        )}
      </>
    );
  }

  if (aba === "reunioes") {
    const [{ data: meetings }, { data: macts }] = await Promise.all([
      db.from("meetings").select("id, title, held_at, recording_url, transcript_url, summary, decisions, status, analysis_error").eq("client_id", id).order("held_at", { ascending: false }),
      db.from("plan_actions").select("id, meeting_id, title, owner, due_date, status").eq("client_id", id).eq("origin", "reuniao"),
    ]);
    const STATUS_M: Record<string, string> = { aguardando_analise: "Aguardando análise", analisada: "Analisada pela IA", manual: "Preenchida à mão", erro: "Erro na análise" };
    return (
      <>
        <div className="card" style={{ marginTop: 12 }}>
          {(meetings ?? []).length === 0 && <div className="empty">Nenhuma reunião.</div>}
          <ul className="list">
            {(meetings ?? []).map((m: any) => (
              <li key={m.id}>
                <div className="row"><div><strong>{m.title}</strong><div className="small muted">{dt(m.held_at)} · {(macts ?? []).filter((a: any) => a.meeting_id === m.id).length} ação(ões)</div></div>
                  <span className={`pill ${m.status === "erro" ? "pill-danger" : m.status === "aguardando_analise" ? "pill-sand" : "pill-ok"}`}>{STATUS_M[m.status]}</span></div>
                {m.analysis_error && <div className="small down">{m.analysis_error}</div>}
                {owner && (
                  <details style={{ marginTop: 6 }}><summary className="small">Preencher resumo, decisões e ações</summary>
                    <form action={preencherReuniao} className="stack" style={{ marginTop: 8 }}>
                      <input type="hidden" name="client_id" value={id} /><input type="hidden" name="meeting_id" value={m.id} />
                      <div className="field"><label>Resumo</label><textarea name="summary" defaultValue={m.summary ?? ""} required /></div>
                      <div className="field"><label>Decisões (uma por linha)</label><textarea name="decisions" defaultValue={(m.decisions ?? []).join("\n")} /></div>
                      <div className="field"><label>Novas ações (uma por linha: título | avanteza ou cliente | AAAA-MM-DD)</label><textarea name="actions" placeholder="Enviar planilha de custos | cliente | 2026-12-05" /></div>
                      <Submit className="btn btn-sm">Salvar</Submit>
                    </form>
                    <form action={excluirReuniao} style={{ marginTop: 8 }}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="meeting_id" value={m.id} /><Submit className="btn btn-sm btn-danger" confirm="Remover a reunião? As ações criadas por ela permanecem no plano.">Remover reunião</Submit></form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
        {owner && (
          <>
            <h2>Registrar reunião</h2>
            <form action={registrarReuniao} className="card stack">
              <input type="hidden" name="client_id" value={id} />
              <div className="grid two">
                <div className="field"><label>Título</label><input name="title" required /></div>
                <div className="field"><label>Data</label><input name="held_at" type="date" defaultValue={today} required /></div>
              </div>
              <div className="field"><label>Link da gravação</label><input name="recording_url" type="url" /></div>
              <div className="field"><label>Link da transcrição</label><input name="transcript_url" type="url" /></div>
              <div className="field"><label>Transcrição (cole o texto para a IA extrair resumo, decisões e ações)</label><textarea name="transcript" style={{ minHeight: 140 }} /></div>
              <Submit className="btn btn-orange">Registrar e analisar</Submit>
              <p className="small muted" style={{ margin: 0 }}>Sem chave da IA configurada, a reunião fica “aguardando análise” e você preenche à mão.</p>
            </form>
          </>
        )}
      </>
    );
  }

  if (aba === "acesso") {
    const [users, { data: group }] = await Promise.all([
      listClientUsers(id),
      client.group_slug ? db.from("clients").select("id, name").eq("group_slug", client.group_slug).order("name") : Promise.resolve({ data: [] as any[] }),
    ]);
    return (
      <>
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Quem acessa o Mapa</h3>
          {users.length === 0 && <p className="muted">Nenhum acesso criado.</p>}
          <ul className="list">
            {users.map((u: any) => (
              <li key={u.email}>
                <div className="row"><div><strong>{u.email}</strong> {!u.active && <span className="pill pill-danger">desativado</span>}<div className="small muted">{u.name ?? "sem nome"} · {u.companyIds.length} empresa(s)</div></div></div>
                {owner && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <ResetAccess clientId={id} email={u.email} />
                    {u.active && <WelcomeEmail clientId={id} email={u.email} />}
                    <form action={alternarAcesso}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="email" value={u.email} /><input type="hidden" name="active" value={u.active ? "0" : "1"} /><Submit className="btn btn-sm btn-ghost">{u.active ? "Desativar acesso" : "Reativar acesso"}</Submit></form>
                    {(group ?? []).length > 1 && (
                      <div className="small"><div className="muted">Empresas do grupo:</div>
                        {(group ?? []).map((g: any) => (
                          <form key={g.id} action={vincularEmpresa} className="row" style={{ padding: "2px 0" }}>
                            <input type="hidden" name="client_id" value={id} /><input type="hidden" name="email" value={u.email} /><input type="hidden" name="company_id" value={g.id} />
                            <input type="hidden" name="on" value={u.companyIds.includes(g.id) ? "0" : "1"} />
                            <span>{g.name} {u.companyIds.includes(g.id) ? "(com acesso)" : ""}</span>
                            <Submit className="btn btn-sm btn-ghost">{u.companyIds.includes(g.id) ? "Retirar" : "Liberar"}</Submit>
                          </form>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        {owner && <div style={{ marginTop: 12 }}><CreateAccess clientId={id} hasGroup={(group ?? []).length > 1} defaultEmail={client.contact_email ?? ""} /></div>}
        {!owner && <p className="small muted">Somente administradores criam ou redefinem acessos.</p>}
      </>
    );
  }

  // contato / dados
  return (
    <form action={saveClientMapa} className="card stack" style={{ marginTop: 12 }}>
      <input type="hidden" name="client_id" value={id} />
      <fieldset disabled={!owner} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="field"><label>Nome</label><input name="name" defaultValue={client.name} required /></div>
        <div className="grid two">
          <div className="field"><label>Tipo de cliente</label><select name="kind" defaultValue={client.kind}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label>Início do plano</label><input name="start_date" type="date" defaultValue={client.start_date ?? ""} /></div>
          <div className="field"><label>Slug</label><input name="slug" defaultValue={client.slug ?? ""} /></div>
          <div className="field"><label>Pasta no Drive (ID)</label><input name="drive_folder_id" defaultValue={client.drive_folder_id ?? ""} /></div>
          <div className="field"><label>Grupo (mesmo titular)</label><input name="group_slug" defaultValue={client.group_slug ?? ""} placeholder="ex.: rodrigo" /></div>
          <div className="field"><label>Titular</label><input name="owner_name" defaultValue={client.owner_name ?? ""} /></div>
          <div className="field"><label>Contato</label><input name="contact_name" defaultValue={client.contact_name ?? ""} /></div>
          <div className="field"><label>WhatsApp</label><input name="contact_phone" defaultValue={client.contact_phone ?? ""} /></div>
        </div>
        <div className="field"><label>E-mail</label><input name="contact_email" type="email" defaultValue={client.contact_email ?? ""} /></div>
        <label className="check"><input type="checkbox" name="active" defaultChecked={client.active} /> Cliente ativo (desativar bloqueia o acesso ao Mapa)</label>
      </fieldset>
      {owner ? <Submit className="btn btn-orange">Salvar</Submit> : <p className="small muted" style={{ margin: 0 }}>Somente leitura.</p>}
    </form>
  );
}

function Row({ a, id, P, owner, today }: { a: any; id: string; P: any[]; owner: boolean; today: string }) {
  return (
    <div className="act">
      <div className="row"><strong>{a.title}</strong><span className={`pill ${a.status === "concluida" ? "pill-ok" : a.status === "bloqueada" ? "pill-danger" : a.status === "em_execucao" ? "pill-orange" : "pill-sand"}`}>{STATUS_LABEL[a.status as keyof typeof STATUS_LABEL]}</span></div>
      <div className="small"><span className="muted">{OWNER_LABEL[a.owner as "cliente"]} · {a.origin}</span>{a.due_date && <span className={isOverdue(a, today) ? "late" : "muted"}> · prazo {fmtDate(a.due_date)}</span>}</div>
      {owner && (
        <details style={{ marginTop: 6 }}><summary className="small">Editar</summary>
          <div style={{ marginTop: 8 }}>
            <ActionForm a={a} clientId={id} phases={P} />
            <form action={excluirAcao} style={{ marginTop: 6 }}><input type="hidden" name="client_id" value={id} /><input type="hidden" name="action_id" value={a.id} /><Submit className="btn btn-sm btn-danger" confirm="Excluir esta ação?">Excluir</Submit></form>
          </div>
        </details>
      )}
    </div>
  );
}
