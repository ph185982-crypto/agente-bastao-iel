// Motor de Entregas — acesso ao banco (lado da EQUIPE). Quem chama (server actions, rotina, script) confere a permissão
// antes (ver acesso.ts). O cliente do Mapa NUNCA passa por aqui: o lado dele está em src/lib/mapa/repo.ts (escopo da sessão).
// SQL parametrizado ($1, $2…) via rawQuery; jsonb sempre serializado com JSON.stringify.
import { rawQuery } from "../db/client";
import { addDaysStr, isDateStr } from "../mapa/plan";
import { generatePlanFor } from "../mapa/admin";
import { planejarGeracao, type AcaoDesejada, type EntradaGerador, type PlanoGeracao, type TarefaModelo } from "./gerador";
import { calcularSaude, type Saude } from "./saude";
import { PLAYBOOKS_PADRAO, servicosPadraoDoTipo } from "./playbooks-padrao";
import { isPapel, type Papel } from "./tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

async function audit(actor: string, event: string, clientId: string | null, details: Record<string, unknown> = {}) {
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ($1,$2,$3,$4)", [event, actor, clientId, JSON.stringify(details)]);
}

// ───────────────────────── Catálogo e playbooks ─────────────────────────

/** Cria o catálogo e os playbooks padrão que faltarem. Nunca sobrescreve o que já existe (o admin pode ter editado). */
export async function semearCatalogo(): Promise<{ servicos: number; playbooks: number; tarefas: number }> {
  const out = { servicos: 0, playbooks: 0, tarefas: 0 };
  for (const p of PLAYBOOKS_PADRAO) {
    const s = await rawQuery<{ id: string; novo: boolean }>(
      `insert into avanteza.service_catalog (slug, name, description, kind, position) values ($1,$2,$3,$4,$5)
       on conflict (slug) do update set slug = excluded.slug returning id, (xmax = 0) as novo`,
      [p.servico.slug, p.servico.name, p.servico.description, p.servico.kind, p.servico.position],
    );
    if (s[0].novo) out.servicos++;
    const pb = await rawQuery<{ id: string; novo: boolean }>(
      `insert into avanteza.playbooks (service_id, slug, name, description) values ($1,$2,$3,$4)
       on conflict (slug) do update set slug = excluded.slug returning id, (xmax = 0) as novo`,
      [s[0].id, p.playbook.slug, p.playbook.name, p.playbook.description],
    );
    if (pb[0].novo) out.playbooks++;
    let pos = 0;
    for (const t of p.tarefas) {
      pos++;
      const r = await rawQuery(
        `insert into avanteza.playbook_tasks (playbook_id, slug, title, description, phase_position, role, offset_days, recurrence, recurrence_day,
           checklist, done_criteria, client_dependent, client_visible, estimated_min, priority, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (playbook_id, slug) do nothing returning id`,
        [pb[0].id, t.slug, t.title, t.description, t.fase, t.papel, t.d, t.rec ?? "none", t.dia ?? null, JSON.stringify(t.checklist ?? []),
          t.pronto ?? null, Boolean(t.cliente), t.visivel ?? true, t.min ?? null, t.prio ?? 2, pos],
      );
      out.tarefas += r.length;
    }
  }
  return out;
}

export interface ServicoCatalogo { id: string; slug: string; name: string; description: string | null; kind: string; active: boolean; default_monthly_value: number | null }
export interface PlaybookRow { id: string; service_id: string; slug: string; name: string; description: string | null; active: boolean }
export type TarefaRow = TarefaModelo & { playbook_id: string; position: number };

export async function listarCatalogo() {
  const [servicos, playbooks, tarefas] = await Promise.all([
    rawQuery<ServicoCatalogo>("select id, slug, name, description, kind, active, default_monthly_value from avanteza.service_catalog order by position, name"),
    rawQuery<PlaybookRow>("select id, service_id, slug, name, description, active from avanteza.playbooks order by name"),
    rawQuery<TarefaRow>(
      `select id, playbook_id, slug, title, description, phase_position, role, offset_days, recurrence, recurrence_day, checklist, done_criteria,
              client_dependent, client_visible, estimated_min, priority, position, active
         from avanteza.playbook_tasks order by position, offset_days, title`,
    ),
  ]);
  return { servicos, playbooks, tarefas };
}

async function tarefasDosServicos(serviceIds: string[]): Promise<Map<string, TarefaModelo[]>> {
  const out = new Map<string, TarefaModelo[]>();
  if (!serviceIds.length) return out;
  const rows = await rawQuery<TarefaRow & { service_id: string }>(
    `select t.id, t.playbook_id, p.service_id, t.slug, t.title, t.description, t.phase_position, t.role, t.offset_days, t.recurrence, t.recurrence_day,
            t.checklist, t.done_criteria, t.client_dependent, t.client_visible, t.estimated_min, t.priority, t.position, (t.active and p.active) as active
       from avanteza.playbook_tasks t join avanteza.playbooks p on p.id = t.playbook_id
      where p.service_id = any($1::uuid[]) order by t.position`,
    [serviceIds],
  );
  for (const r of rows) {
    const list = out.get(r.service_id) ?? [];
    list.push({ ...r, checklist: Array.isArray(r.checklist) ? r.checklist.map(String) : [], role: isPapel(r.role) ? r.role : "gestor_conta" });
    out.set(r.service_id, list);
  }
  return out;
}

// ───────────────────────── Equipe ─────────────────────────

export interface Pessoa { id: string; email: string; name: string | null; role: string; delivery_roles: string[] }

export async function listarEquipe(): Promise<Pessoa[]> {
  return rawQuery<Pessoa>("select id, email, name, role, delivery_roles from avanteza.admins where role <> 'client' and active order by coalesce(name, email)");
}

export async function idDoUsuario(email: string): Promise<string | null> {
  const r = await rawQuery<{ id: string }>("select id from avanteza.admins where email = $1 and role <> 'client'", [email.toLowerCase()]);
  return r[0]?.id ?? null;
}

export async function salvarPapeisDaPessoa(actor: string, id: string, papeis: string[]) {
  if (!isUuid(id)) throw new Error("Pessoa inválida.");
  const ok = papeis.filter(isPapel);
  await rawQuery("update avanteza.admins set delivery_roles = $2 where id = $1 and role <> 'client'", [id, ok]);
  await audit(actor, "motor_papeis", null, { pessoa: id, papeis: ok });
}

function responsaveis(equipe: Pessoa[], gerente: string | null) {
  const porPapel: Partial<Record<Papel, string>> = {};
  for (const p of equipe) for (const r of p.delivery_roles ?? []) if (isPapel(r) && !porPapel[r]) porPapel[r] = p.id;
  return { porPapel, gerente };
}

// ───────────────────────── Serviços do cliente ─────────────────────────

export interface ServicoCliente {
  id: string; client_id: string; service_id: string; service_slug: string; service_name: string; start_date: string; end_date: string | null;
  monthly_value: number | null; contract_ref: string | null; assignee_id: string | null; status: "ativo" | "pausado" | "encerrado"; notes: string | null;
}

export async function servicosDoCliente(clientId: string): Promise<ServicoCliente[]> {
  return rawQuery<ServicoCliente>(
    `select cs.id, cs.client_id, cs.service_id, sc.slug as service_slug, sc.name as service_name, cs.start_date, cs.end_date, cs.monthly_value,
            cs.contract_ref, cs.assignee_id, cs.status, cs.notes
       from avanteza.client_services cs join avanteza.service_catalog sc on sc.id = cs.service_id
      where cs.client_id = $1 order by sc.position, sc.name`,
    [clientId],
  );
}

export interface DadosServico {
  clientId: string; serviceId: string; startDate: string; endDate?: string | null; monthlyValue?: number | null; contractRef?: string | null;
  assigneeId?: string | null; status?: "ativo" | "pausado" | "encerrado"; notes?: string | null;
}

export async function salvarServicoCliente(actor: string, d: DadosServico) {
  if (!isUuid(d.clientId) || !isUuid(d.serviceId)) throw new Error("Cliente ou serviço inválido.");
  if (!isDateStr(d.startDate)) throw new Error("Data de início inválida.");
  if (d.endDate && (!isDateStr(d.endDate) || d.endDate < d.startDate)) throw new Error("Data de fim inválida.");
  if (d.assigneeId && !isUuid(d.assigneeId)) throw new Error("Responsável inválido.");
  const status = d.status ?? "ativo";
  if (!["ativo", "pausado", "encerrado"].includes(status)) throw new Error("Situação inválida.");
  await rawQuery(
    `insert into avanteza.client_services (client_id, service_id, start_date, end_date, monthly_value, contract_ref, assignee_id, status, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (client_id, service_id) do update set start_date = excluded.start_date, end_date = excluded.end_date, monthly_value = excluded.monthly_value,
       contract_ref = excluded.contract_ref, assignee_id = excluded.assignee_id, status = excluded.status, notes = excluded.notes, updated_at = now()`,
    [d.clientId, d.serviceId, d.startDate, d.endDate || null, d.monthlyValue ?? null, d.contractRef || null, d.assigneeId || null, status, d.notes || null],
  );
  await audit(actor, "motor_servico_salvo", d.clientId, { serviceId: d.serviceId, status, start: d.startDate });
}

export async function removerServicoCliente(actor: string, clientId: string, id: string) {
  if (!isUuid(clientId) || !isUuid(id)) return;
  await rawQuery("delete from avanteza.client_services where id = $1 and client_id = $2", [id, clientId]);
  await audit(actor, "motor_servico_removido", clientId, { id });
}

/** Sem nenhum serviço cadastrado, cria os serviços padrão pelo tipo do cliente. Devolve quantos criou. */
export async function garantirServicosPorTipo(clientId: string, inicio: string): Promise<number> {
  const [c] = await rawQuery<{ kind: string }>("select kind from avanteza.clients where id = $1", [clientId]);
  if (!c) throw new Error("Cliente não encontrado.");
  const ja = await rawQuery("select 1 from avanteza.client_services where client_id = $1 limit 1", [clientId]);
  if (ja.length) return 0;
  const slugs = servicosPadraoDoTipo(c.kind);
  const r = await rawQuery(
    `insert into avanteza.client_services (client_id, service_id, start_date)
     select $1, id, $2 from avanteza.service_catalog where slug = any($3::text[]) and active
     on conflict (client_id, service_id) do nothing returning id`,
    [clientId, inicio, slugs],
  );
  return r.length;
}

// ───────────────────────── Geração ─────────────────────────

const COLS_EXISTENTE = "id, title, status, origin, recurrence_key, due_date, edited_at::text as edited_at, archived_at::text as archived_at, assignee_id";

export async function entradaDoGerador(clientId: string, hoje: string, equipe?: Pessoa[]): Promise<EntradaGerador> {
  const [cli] = await rawQuery<{ manager_id: string | null }>("select manager_id from avanteza.clients where id = $1", [clientId]);
  if (!cli) throw new Error("Cliente não encontrado.");
  const [servicos, fases, existentes, time] = await Promise.all([
    servicosDoCliente(clientId),
    rawQuery<{ id: string; position: number; starts_on: string | null; ends_on: string | null }>("select id, position, starts_on, ends_on from avanteza.plan_phases where client_id = $1 order by position", [clientId]),
    rawQuery<any>(`select ${COLS_EXISTENTE} from avanteza.plan_actions where client_id = $1`, [clientId]),
    equipe ? Promise.resolve(equipe) : listarEquipe(),
  ]);
  const tarefas = await tarefasDosServicos(servicos.map((s) => s.service_id));
  return {
    hoje,
    servicos: servicos.map((s) => ({ servico: s, tarefas: tarefas.get(s.service_id) ?? [] })),
    fases,
    existentes,
    responsaveis: responsaveis(time, cli.manager_id),
  };
}

const linhaNova = (clientId: string, d: AcaoDesejada) => [
  clientId, d.phaseId, d.title, d.description, d.owner, d.dueDate, d.playbookTaskId, d.clientServiceId, d.assigneeId, d.role, d.key,
  JSON.stringify(d.checklist), d.doneCriteria, d.dueDate, d.priority, d.estimatedMin, d.clientDependent, d.visibleToClient,
];

/** Grava um plano de geração (já calculado). Concorrência: o índice único de recurrence_key descarta duplicatas. */
async function gravarPlano(clientId: string, p: PlanoGeracao): Promise<{ criadas: number; atualizadas: number; vinculadas: number; arquivadas: number }> {
  let criadas = 0;
  for (const d of p.criar) {
    const r = await rawQuery(
      `insert into avanteza.plan_actions (client_id, phase_id, title, description, owner, due_date, origin, playbook_task_id, client_service_id, assignee_id, role,
         recurrence_key, checklist, done_criteria, sla_due, priority, estimated_min, client_dependent, visible_to_client, position)
       values ($1,$2,$3,$4,$5,$6,'playbook',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, 100)
       on conflict (client_id, recurrence_key) where recurrence_key is not null do nothing returning id`,
      linhaNova(clientId, d),
    );
    criadas += r.length;
  }
  for (const { id, desejada: d } of p.atualizar) {
    await rawQuery(
      `update avanteza.plan_actions set title = $3, description = $4, due_date = $5, sla_due = $5, phase_id = $6, checklist = $7, done_criteria = $8,
         priority = $9, estimated_min = $10, client_dependent = $11, visible_to_client = $12, owner = $13, role = $14,
         assignee_id = coalesce(assignee_id, $15), updated_at = now()
       where id = $1 and client_id = $2 and status = 'planejada' and edited_at is null and archived_at is null`,
      [id, clientId, d.title, d.description, d.dueDate, d.phaseId, JSON.stringify(d.checklist), d.doneCriteria, d.priority, d.estimatedMin, d.clientDependent, d.visibleToClient, d.owner, d.role, d.assigneeId],
    );
  }
  for (const { id, desejada: d } of p.vincular) {
    // a ação do plano/manual passa a ser desta tarefa: título, prazo e situação ficam como estão
    await rawQuery(
      `update avanteza.plan_actions set recurrence_key = $3, playbook_task_id = $4, client_service_id = $5, role = $6, assignee_id = coalesce(assignee_id, $7),
         checklist = case when checklist = '[]'::jsonb then $8::jsonb else checklist end, done_criteria = coalesce(done_criteria, $9),
         priority = $10, estimated_min = coalesce(estimated_min, $11), client_dependent = $12, sla_due = coalesce(sla_due, due_date), updated_at = now()
       where id = $1 and client_id = $2 and recurrence_key is null`,
      [id, clientId, d.key, d.playbookTaskId, d.clientServiceId, d.role, d.assigneeId, JSON.stringify(d.checklist), d.doneCriteria, d.priority, d.estimatedMin, d.clientDependent],
    ).catch(() => undefined); // chave já usada por outra ação (corrida): ignora
  }
  if (p.arquivar.length) {
    await rawQuery(
      "update avanteza.plan_actions set archived_at = now(), updated_at = now() where client_id = $1 and id = any($2::uuid[]) and status = 'planejada' and edited_at is null",
      [clientId, p.arquivar],
    );
  }
  return { criadas, atualizadas: p.atualizar.length, vinculadas: p.vincular.length, arquivadas: p.arquivar.length };
}

export interface ResultadoAplicacao {
  clientId: string;
  previa: boolean;
  servicosCriados: number;
  planoCriado: boolean;
  plano: PlanoGeracao;
  gravado?: { criadas: number; atualizadas: number; vinculadas: number; arquivadas: number };
}

/**
 * Aplica os playbooks dos serviços do cliente. Com `previa`, só calcula (nada é gravado).
 * Sem serviços: usa o tipo do cliente (marketplace → Marketplace + Onboarding; mídia → Tráfego + Mídias + Onboarding).
 * Sem plano de 12 meses: gera o plano padrão (as fases continuam sendo as do plano; as ações do playbook entram nelas).
 */
export async function aplicarPlaybooks(clientId: string, o: { hoje: string; actor: string; previa?: boolean; inicio?: string; equipe?: Pessoa[] }): Promise<ResultadoAplicacao> {
  if (!isUuid(clientId)) throw new Error("Cliente inválido.");
  const [c] = await rawQuery<{ start_date: string | null; active: boolean }>("select start_date, active from avanteza.clients where id = $1", [clientId]);
  if (!c) throw new Error("Cliente não encontrado.");
  const inicio = o.inicio ?? c.start_date ?? o.hoje;
  let servicosCriados = 0, planoCriado = false;
  if (!o.previa) {
    servicosCriados = await garantirServicosPorTipo(clientId, inicio);
    const fases = await rawQuery("select 1 from avanteza.plan_phases where client_id = $1 limit 1", [clientId]);
    if (!fases.length) {
      await generatePlanFor(clientId, { startDate: c.start_date ?? inicio });
      planoCriado = true;
    }
  }
  const entrada = await entradaDoGerador(clientId, o.hoje, o.equipe);
  if (o.previa && entrada.servicos.length === 0) {
    // prévia de cliente sem serviços: simula os serviços padrão do tipo
    const [k] = await rawQuery<{ kind: string }>("select kind from avanteza.clients where id = $1", [clientId]);
    const cat = await rawQuery<{ id: string }>("select id from avanteza.service_catalog where slug = any($1::text[]) and active", [servicosPadraoDoTipo(k.kind)]);
    const tarefas = await tarefasDosServicos(cat.map((x) => x.id));
    entrada.servicos = cat.map((x) => ({ servico: { id: `previa-${x.id}`, service_id: x.id, start_date: inicio, end_date: null, status: "ativo" as const, assignee_id: null }, tarefas: tarefas.get(x.id) ?? [] }));
  }
  const plano = planejarGeracao(entrada);
  if (o.previa) return { clientId, previa: true, servicosCriados, planoCriado, plano };
  const gravado = await gravarPlano(clientId, plano);
  await rawQuery(
    `insert into avanteza.delivery_runs (client_id, period_start, period_end, created_count, updated_count, archived_count, actor) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (client_id, period_start) do update set period_end = excluded.period_end, created_count = avanteza.delivery_runs.created_count + excluded.created_count,
       updated_count = avanteza.delivery_runs.updated_count + excluded.updated_count, archived_count = avanteza.delivery_runs.archived_count + excluded.archived_count, actor = excluded.actor`,
    [clientId, o.hoje, plano.janela.ate, gravado.criadas + gravado.vinculadas, gravado.atualizadas, gravado.arquivadas, o.actor],
  );
  if (gravado.criadas || gravado.vinculadas || gravado.atualizadas || gravado.arquivadas || servicosCriados || planoCriado) {
    await audit(o.actor, "motor_playbooks_aplicados", clientId, { ...gravado, servicosCriados, planoCriado });
  }
  return { clientId, previa: false, servicosCriados, planoCriado, plano, gravado };
}

/** Rotina: gera as recorrências dos próximos 30 dias para todo cliente ativo que tem serviço ativo. */
export async function gerarParaTodos(hoje: string, actor = "rotina"): Promise<{ clientes: number; criadas: number; atualizadas: number; arquivadas: number; erros: string[] }> {
  const clientes = await rawQuery<{ id: string; name: string }>(
    "select distinct c.id, c.name from avanteza.clients c join avanteza.client_services s on s.client_id = c.id where c.active and s.status = 'ativo' order by c.name",
  );
  const equipe = await listarEquipe();
  const out = { clientes: 0, criadas: 0, atualizadas: 0, arquivadas: 0, erros: [] as string[] };
  for (const c of clientes) {
    try {
      const r = await aplicarPlaybooks(c.id, { hoje, actor, equipe });
      out.clientes++;
      out.criadas += (r.gravado?.criadas ?? 0) + (r.gravado?.vinculadas ?? 0);
      out.atualizadas += r.gravado?.atualizadas ?? 0;
      out.arquivadas += r.gravado?.arquivadas ?? 0;
    } catch (e) {
      out.erros.push(`${c.name}: ${e instanceof Error ? e.message.slice(0, 160) : "falha"}`);
    }
  }
  return out;
}

/** Prévia de "aplicar a clientes existentes" para um serviço: o que seria criado em cada cliente que o contratou (ou que o tipo indica). */
export async function previaDoServico(serviceId: string, hoje: string) {
  if (!isUuid(serviceId)) throw new Error("Serviço inválido.");
  const [svc] = await rawQuery<{ slug: string }>("select slug from avanteza.service_catalog where id = $1", [serviceId]);
  if (!svc) throw new Error("Serviço não encontrado.");
  const clientes = await rawQuery<{ id: string; name: string; kind: string; tem: boolean; algum: boolean }>(
    `select c.id, c.name, c.kind,
            exists (select 1 from avanteza.client_services s where s.client_id = c.id and s.service_id = $1) as tem,
            exists (select 1 from avanteza.client_services s where s.client_id = c.id) as algum
       from avanteza.clients c where c.active order by c.name`,
    [serviceId],
  );
  const alvo = clientes.filter((c) => c.tem || (!c.algum && servicosPadraoDoTipo(c.kind).includes(svc.slug)));
  const equipe = await listarEquipe();
  const out: { id: string; name: string; criar: AcaoDesejada[]; atualizar: number; vincular: number; arquivar: number }[] = [];
  for (const c of alvo) {
    const r = await aplicarPlaybooks(c.id, { hoje, actor: "previa", previa: true, equipe });
    out.push({ id: c.id, name: c.name, criar: r.plano.criar.filter((d) => d.serviceId === serviceId), atualizar: r.plano.atualizar.length, vincular: r.plano.vincular.length, arquivar: r.plano.arquivar.length });
  }
  return out;
}

// ───────────────────────── Leitura para as telas ─────────────────────────

export interface AcaoMotor {
  id: string; client_id: string; client_name: string; phase_id: string | null; title: string; description: string | null; status: string; owner: string;
  due_date: string | null; sla_due: string | null; origin: string; priority: number; assignee_id: string | null; assignee_name: string | null; role: string | null;
  checklist: { t: string; ok: boolean }[]; done_criteria: string | null; blocked_reason: string | null; evidence_url: string | null; estimated_min: number | null;
  client_dependent: boolean; visible_to_client: boolean; ai_generated: boolean; completed_at: string | null; recurrence_key: string | null; meeting_id: string | null;
}

const COLS_ACAO = `a.id, a.client_id, c.name as client_name, a.phase_id, a.title, a.description, a.status, a.owner, a.due_date, a.sla_due, a.origin, a.priority,
  a.assignee_id, coalesce(u.name, u.email) as assignee_name, a.role, a.checklist, a.done_criteria, a.blocked_reason, a.evidence_url, a.estimated_min,
  a.client_dependent, a.visible_to_client, a.ai_generated, a.completed_at, a.recurrence_key, a.meeting_id`;
const FROM_ACAO = `from avanteza.plan_actions a join avanteza.clients c on c.id = a.client_id left join avanteza.admins u on u.id = a.assignee_id`;

/** Ações abertas até hoje+7 (e todas as bloqueadas/do cliente), mais quantas foram concluídas hoje. Só clientes ativos. */
export async function acoesDaFila(hoje: string): Promise<{ acoes: AcaoMotor[]; concluidasHoje: AcaoMotor[] }> {
  const ate = addDaysStr(hoje, 7);
  const [acoes, concluidasHoje] = await Promise.all([
    rawQuery<AcaoMotor>(
      `select ${COLS_ACAO} ${FROM_ACAO}
        where c.active and a.archived_at is null and a.status <> 'concluida' and (a.due_date <= $1 or a.status = 'bloqueada')
        order by a.due_date nulls last, a.priority`,
      [ate],
    ),
    rawQuery<AcaoMotor>(
      `select ${COLS_ACAO} ${FROM_ACAO} where c.active and a.archived_at is null and a.status = 'concluida' and (a.completed_at at time zone 'America/Sao_Paulo')::date = $1
        order by a.completed_at desc limit 50`,
      [hoje],
    ),
  ]);
  return { acoes, concluidasHoje };
}

export async function acoesDoPeriodo(de: string, ate: string): Promise<AcaoMotor[]> {
  return rawQuery<AcaoMotor>(
    `select ${COLS_ACAO} ${FROM_ACAO} where c.active and a.archived_at is null and a.due_date between $1 and $2 order by a.due_date, a.priority, c.name`,
    [de, ate],
  );
}

export async function acoesDoCliente(clientId: string): Promise<AcaoMotor[]> {
  if (!isUuid(clientId)) return [];
  return rawQuery<AcaoMotor>(`select ${COLS_ACAO} ${FROM_ACAO} where a.client_id = $1 and a.archived_at is null order by a.due_date nulls last, a.priority, a.position`, [clientId]);
}

export async function clientesAtivos() {
  return rawQuery<{ id: string; name: string; kind: string; manager_id: string | null }>("select id, name, kind, manager_id from avanteza.clients where active order by name");
}

export interface CartaoCarteira {
  id: string; nome: string; kind: string; gerente: string | null; servicos: string[]; saude: Saude;
  proximos: { title: string; due_date: string; atrasada: boolean }[];
}

/** Carteira: saúde de cada cliente ativo com os dados existentes (ações, reuniões, canais e contas de marketplace). */
export async function carteira(hoje: string): Promise<CartaoCarteira[]> {
  const [clientes, acoes, reunioes, canais, contas, servicos] = await Promise.all([
    rawQuery<{ id: string; name: string; kind: string; start_date: string | null; gerente: string | null }>(
      "select c.id, c.name, c.kind, c.start_date, coalesce(u.name, u.email) as gerente from avanteza.clients c left join avanteza.admins u on u.id = c.manager_id where c.active order by c.name",
    ),
    rawQuery<{ client_id: string; title: string; status: string; due_date: string | null; completed_at: string | null; owner: string; client_dependent: boolean; blocked_reason: string | null }>(
      "select a.client_id, a.title, a.status, a.due_date, a.completed_at, a.owner, a.client_dependent, a.blocked_reason from avanteza.plan_actions a join avanteza.clients c on c.id = a.client_id where c.active and a.archived_at is null",
    ),
    rawQuery<{ client_id: string; held_at: string }>("select client_id, held_at from avanteza.meetings"),
    rawQuery<{ client_id: string; status: string; last_error: string | null; ig_last_error: string | null }>("select client_id, status, last_error, ig_last_error from avanteza.client_channels"),
    rawQuery<{ client_id: string; marketplace: string; nickname: string | null; status: string; last_error: string | null }>("select client_id, marketplace, nickname, status, last_error from avanteza.marketplace_accounts"),
    rawQuery<{ client_id: string; name: string; start_date: string; status: string }>(
      "select s.client_id, sc.name, s.start_date, s.status from avanteza.client_services s join avanteza.service_catalog sc on sc.id = s.service_id order by sc.position",
    ),
  ]);
  const by = <T extends { client_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.client_id) ?? m.set(r.client_id, []).get(r.client_id)!).push(r);
    return m;
  };
  const A = by(acoes), R = by(reunioes), C = by(canais), M = by(contas), S = by(servicos);
  return clientes.map((c) => {
    const svc = (S.get(c.id) ?? []).filter((s) => s.status === "ativo");
    const inicio = [c.start_date, ...svc.map((s) => s.start_date)].filter(Boolean).sort()[0] ?? null;
    const minhas = A.get(c.id) ?? [];
    const saude = calcularSaude({
      hoje, inicio, acoes: minhas, reunioes: (R.get(c.id) ?? []).map((r) => r.held_at),
      canais: C.get(c.id) ?? [], contas: M.get(c.id) ?? [],
    });
    const proximos = minhas
      .filter((a) => a.status !== "concluida" && a.due_date)
      .sort((x, y) => (x.due_date! < y.due_date! ? -1 : 1))
      .slice(0, 3)
      .map((a) => ({ title: a.title, due_date: a.due_date!, atrasada: a.due_date! < hoje }));
    return { id: c.id, nome: c.name, kind: c.kind, gerente: c.gerente, servicos: svc.map((s) => s.name), saude, proximos };
  });
}

export async function gravarSaude(hoje: string, cartoes: CartaoCarteira[]) {
  for (const c of cartoes) {
    await rawQuery(
      `insert into avanteza.client_health (client_id, day, level, reasons, metrics) values ($1,$2,$3,$4,$5)
       on conflict (client_id, day) do update set level = excluded.level, reasons = excluded.reasons, metrics = excluded.metrics, computed_at = now()`,
      [c.id, hoje, c.saude.nivel, JSON.stringify(c.saude.motivos), JSON.stringify(c.saude.metricas)],
    );
  }
}

export async function definirGerente(actor: string, clientId: string, managerId: string | null) {
  if (!isUuid(clientId) || (managerId && !isUuid(managerId))) throw new Error("Dados inválidos.");
  await rawQuery("update avanteza.clients set manager_id = $2 where id = $1", [clientId, managerId]);
  await audit(actor, "motor_gerente", clientId, { managerId });
}

// ───────────────────────── Ações rápidas (equipe) ─────────────────────────

async function clienteDaAcao(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const r = await rawQuery<{ client_id: string }>("select client_id from avanteza.plan_actions where id = $1", [id]);
  return r[0]?.client_id ?? null;
}

const httpUrl = (u: string) => /^https?:\/\/[^\s]+$/i.test(u) && u.length <= 2000;

export type AcaoRapida =
  | { tipo: "concluir"; evidencia?: string | null }
  | { tipo: "reabrir" }
  | { tipo: "iniciar" }
  | { tipo: "bloquear"; motivo: string }
  | { tipo: "desbloquear" }
  | { tipo: "reatribuir"; para: string | null }
  | { tipo: "adiar"; para: string }
  | { tipo: "evidencia"; url: string }
  | { tipo: "checklist"; indice: number; ok: boolean }
  | { tipo: "dispensar" }
  | { tipo: "desfazer_ia" };

/** Aplica uma ação rápida. Toda mudança feita por gente marca edited_at (o gerador não sobrescreve mais) e vai para a auditoria. */
export async function acaoRapida(actor: string, id: string, a: AcaoRapida): Promise<{ ok: boolean; erro?: string }> {
  const clientId = await clienteDaAcao(id);
  if (!clientId) return { ok: false, erro: "Ação não encontrada." };
  let sql = "", params: unknown[] = [id];
  switch (a.tipo) {
    case "concluir":
      if (a.evidencia && !httpUrl(a.evidencia)) return { ok: false, erro: "Evidência: use um link http(s)." };
      sql = "update avanteza.plan_actions set status = 'concluida', completed_at = now(), blocked_reason = null, evidence_url = coalesce($2, evidence_url), edited_at = now(), updated_at = now() where id = $1";
      params.push(a.evidencia || null);
      break;
    case "reabrir":
      sql = "update avanteza.plan_actions set status = 'planejada', completed_at = null, edited_at = now(), updated_at = now() where id = $1";
      break;
    case "iniciar":
      sql = "update avanteza.plan_actions set status = 'em_execucao', edited_at = now(), updated_at = now() where id = $1 and status <> 'concluida'";
      break;
    case "bloquear": {
      const m = a.motivo.trim();
      if (m.length < 3) return { ok: false, erro: "Diga o que o cliente precisa enviar ou fazer." };
      sql = "update avanteza.plan_actions set status = 'bloqueada', blocked_reason = $2, blocked_at = now(), client_dependent = true, edited_at = now(), updated_at = now() where id = $1 and status <> 'concluida'";
      params.push(m.slice(0, 500));
      break;
    }
    case "desbloquear":
      sql = "update avanteza.plan_actions set status = 'planejada', blocked_reason = null, blocked_at = null, edited_at = now(), updated_at = now() where id = $1 and status = 'bloqueada'";
      break;
    case "reatribuir":
      if (a.para && !isUuid(a.para)) return { ok: false, erro: "Responsável inválido." };
      if (a.para && !(await rawQuery("select 1 from avanteza.admins where id = $1 and role <> 'client' and active", [a.para])).length) return { ok: false, erro: "Responsável inválido." };
      sql = "update avanteza.plan_actions set assignee_id = $2, edited_at = now(), updated_at = now() where id = $1";
      params.push(a.para);
      break;
    case "adiar":
      if (!isDateStr(a.para)) return { ok: false, erro: "Data inválida." };
      sql = "update avanteza.plan_actions set sla_due = coalesce(sla_due, due_date), due_date = $2, edited_at = now(), updated_at = now() where id = $1 and status <> 'concluida'";
      params.push(a.para);
      break;
    case "evidencia":
      if (!httpUrl(a.url)) return { ok: false, erro: "Use um link http(s)." };
      sql = "update avanteza.plan_actions set evidence_url = $2, edited_at = now(), updated_at = now() where id = $1";
      params.push(a.url);
      break;
    case "checklist":
      if (!Number.isInteger(a.indice) || a.indice < 0 || a.indice > 50) return { ok: false, erro: "Item inválido." };
      sql = `update avanteza.plan_actions set checklist = jsonb_set(checklist, array[$2::text, 'ok'], to_jsonb($3::boolean)), updated_at = now()
             where id = $1 and jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) > $2::int`;
      params.push(String(a.indice), a.ok);
      break;
    case "dispensar":
      sql = "update avanteza.plan_actions set archived_at = now(), updated_at = now() where id = $1 and status <> 'concluida'";
      break;
    case "desfazer_ia": {
      const r = await rawQuery<{ id: string; captura_id: string | null }>("delete from avanteza.plan_actions where id = $1 and ai_generated returning id, captura_id", [id]);
      if (!r.length) return { ok: false, erro: "Só ações geradas por IA podem ser desfeitas." };
      if (r[0].captura_id) await rawQuery("update avanteza.capturas set acoes_geradas = array_remove(acoes_geradas, $2::uuid) where id = $1", [r[0].captura_id, id]);
      await audit(actor, "motor_ia_desfeita", clientId, { id });
      return { ok: true };
    }
  }
  const r = await rawQuery(sql + " returning id", params);
  if (!r.length) return { ok: false, erro: "Nada mudou (a ação pode já estar concluída)." };
  await audit(actor, `motor_${a.tipo}`, clientId, { id, ...(a.tipo === "bloquear" ? { motivo: a.motivo.slice(0, 120) } : a.tipo === "adiar" ? { para: a.para } : a.tipo === "reatribuir" ? { para: a.para } : {}) });
  return { ok: true };
}

/** Edição completa de uma ação pela equipe (título, prazo, fase, prioridade, visibilidade…). */
export async function editarAcao(actor: string, id: string, d: {
  title: string; description?: string | null; due_date?: string | null; priority?: number; visible_to_client?: boolean; owner?: "avanteza" | "cliente"; phase_id?: string | null;
}) {
  const clientId = await clienteDaAcao(id);
  if (!clientId) throw new Error("Ação não encontrada.");
  if (!d.title.trim()) throw new Error("Informe o título.");
  if (d.due_date && !isDateStr(d.due_date)) throw new Error("Prazo inválido.");
  if (d.phase_id && !(await rawQuery("select 1 from avanteza.plan_phases where id = $1 and client_id = $2", [d.phase_id, clientId])).length) throw new Error("Fase de outro cliente.");
  const pr = d.priority && [1, 2, 3].includes(d.priority) ? d.priority : 2;
  await rawQuery(
    `update avanteza.plan_actions set title = $2, description = $3, due_date = $4, priority = $5, visible_to_client = $6, owner = $7, phase_id = $8,
       ai_generated = false, edited_at = now(), updated_at = now() where id = $1`,
    [id, d.title.trim().slice(0, 200), d.description?.trim() || null, d.due_date || null, pr, d.visible_to_client ?? true, d.owner ?? "avanteza", d.phase_id || null],
  );
  await audit(actor, "motor_editada", clientId, { id });
}

// ───────────────────────── Edição dos playbooks (admin) ─────────────────────────

export interface DadosTarefa {
  title: string; description?: string | null; phase_position: number; role: string; offset_days: number; recurrence: string; recurrence_day?: number | null;
  checklist: string[]; done_criteria?: string | null; client_dependent: boolean; client_visible: boolean; estimated_min?: number | null; priority: number; active: boolean;
}

function validarTarefa(d: DadosTarefa): string | null {
  if (!d.title.trim()) return "Informe o título.";
  if (!isPapel(d.role)) return "Papel inválido.";
  if (!["none", "semanal", "quinzenal", "mensal"].includes(d.recurrence)) return "Recorrência inválida.";
  if (!Number.isInteger(d.offset_days) || d.offset_days < 0 || d.offset_days > 400) return "Prazo (D+n) entre 0 e 400.";
  if (![1, 2, 3, 4].includes(d.phase_position)) return "Fase inválida.";
  if (![1, 2, 3].includes(d.priority)) return "Prioridade inválida.";
  if (d.recurrence_day != null) {
    const max = d.recurrence === "mensal" ? 28 : 7;
    if (!Number.isInteger(d.recurrence_day) || d.recurrence_day < 1 || d.recurrence_day > max) return d.recurrence === "mensal" ? "Dia do mês entre 1 e 28." : "Dia da semana entre 1 (segunda) e 7 (domingo).";
  }
  return null;
}

export async function salvarTarefa(actor: string, playbookId: string, tarefaId: string | null, d: DadosTarefa) {
  if (!isUuid(playbookId) || (tarefaId && !isUuid(tarefaId))) throw new Error("Playbook inválido.");
  const erro = validarTarefa(d);
  if (erro) throw new Error(erro);
  const vals = [d.title.trim().slice(0, 200), d.description?.trim() || null, d.phase_position, d.role, d.offset_days, d.recurrence, d.recurrence === "none" ? null : d.recurrence_day ?? null,
    JSON.stringify(d.checklist.map((x) => x.trim()).filter(Boolean).slice(0, 20)), d.done_criteria?.trim() || null, d.client_dependent, d.client_visible, d.estimated_min ?? null, d.priority, d.active];
  if (tarefaId) {
    await rawQuery(
      `update avanteza.playbook_tasks set title = $3, description = $4, phase_position = $5, role = $6, offset_days = $7, recurrence = $8, recurrence_day = $9, checklist = $10,
         done_criteria = $11, client_dependent = $12, client_visible = $13, estimated_min = $14, priority = $15, active = $16, updated_at = now() where id = $1 and playbook_id = $2`,
      [tarefaId, playbookId, ...vals],
    );
  } else {
    const slug = `t-${Date.now().toString(36)}`;
    await rawQuery(
      `insert into avanteza.playbook_tasks (playbook_id, slug, title, description, phase_position, role, offset_days, recurrence, recurrence_day, checklist, done_criteria,
         client_dependent, client_visible, estimated_min, priority, active, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, (select coalesce(max(position),0)+1 from avanteza.playbook_tasks where playbook_id = $1))`,
      [playbookId, slug, ...vals],
    );
  }
  await audit(actor, tarefaId ? "motor_tarefa_editada" : "motor_tarefa_criada", null, { playbookId, tarefaId, title: d.title.slice(0, 80) });
}

export async function salvarServicoCatalogo(actor: string, id: string | null, d: { name: string; description?: string | null; kind: string; active: boolean; default_monthly_value?: number | null }) {
  if (!d.name.trim()) throw new Error("Informe o nome.");
  if (!["marketplace", "midia", "ambos", "geral"].includes(d.kind)) throw new Error("Tipo inválido.");
  if (id) {
    if (!isUuid(id)) throw new Error("Serviço inválido.");
    await rawQuery("update avanteza.service_catalog set name = $2, description = $3, kind = $4, active = $5, default_monthly_value = $6, updated_at = now() where id = $1",
      [id, d.name.trim(), d.description?.trim() || null, d.kind, d.active, d.default_monthly_value ?? null]);
    await rawQuery("update avanteza.playbooks set name = case when name = '' then $2 else name end, active = $3, updated_at = now() where service_id = $1", [id, d.name.trim(), d.active]);
  } else {
    const slug = d.name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `servico-${Date.now().toString(36)}`;
    const [s] = await rawQuery<{ id: string }>(
      "insert into avanteza.service_catalog (slug, name, description, kind, active, default_monthly_value, position) values ($1,$2,$3,$4,$5,$6,(select coalesce(max(position),0)+1 from avanteza.service_catalog)) returning id",
      [slug, d.name.trim(), d.description?.trim() || null, d.kind, d.active, d.default_monthly_value ?? null],
    );
    await rawQuery("insert into avanteza.playbooks (service_id, slug, name, description) values ($1,$2,$3,$4)", [s.id, slug, d.name.trim(), d.description?.trim() || null]);
  }
  await audit(actor, id ? "motor_servico_catalogo_editado" : "motor_servico_catalogo_criado", null, { id, name: d.name.slice(0, 80) });
}
