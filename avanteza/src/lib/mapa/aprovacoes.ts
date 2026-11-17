// Aprovações — lado do CLIENTE (Mapa). REGRA DE OURO (como em repo.ts): toda consulta filtra por scope.clientId, que só
// existe se veio da sessão. O id da aprovação vindo do formulário/URL é só um filtro: nunca alcança outro cliente.
// Visualização da equipe ("Ver como cliente") é somente leitura: decidir exige assertWritable.
import { rawQuery } from "../db/client";
import { spDate } from "../dates";
import { notificar } from "../notificacoes";
import { addDaysStr } from "./plan";
import { assertScope, assertWritable, type ClientScope } from "./scope";
import { ROTULO_TIPO_PECA, tituloAjuste, type TipoPeca } from "../aprovacoes/tipos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AprovacaoCliente {
  id: string; tipo: string; titulo: string; descricao: string | null; prazo: string | null; status: string; versao_atual: number;
  link: string | null; nota: string | null; criado_em: string; decidido_em: string | null;
}
// Sem criado_por/decidido_por: e-mails da equipe não saem para o cliente.
const COLS = `a.id, a.tipo, a.titulo, a.descricao, a.prazo, a.status, a.versao_atual, v.link, v.nota, a.criado_em, a.decidido_em`;
const FROM = `from avanteza.aprovacoes a left join avanteza.aprovacao_versoes v on v.aprovacao_id = a.id and v.numero = a.versao_atual`;

/** Peças do cliente (sem as canceladas): pendentes primeiro, por prazo. */
export async function listarAprovacoes(scope: ClientScope): Promise<AprovacaoCliente[]> {
  assertScope(scope);
  return rawQuery<AprovacaoCliente>(
    `select ${COLS} ${FROM} where a.client_id = $1 and a.status <> 'cancelada'
      order by (a.status = 'pendente') desc, a.prazo nulls last, a.atualizado_em desc limit 200`,
    [scope.clientId],
  );
}

export async function contarParaAprovar(scope: ClientScope): Promise<number> {
  assertScope(scope);
  const [r] = await rawQuery<{ n: number }>("select count(*)::int n from avanteza.aprovacoes where client_id = $1 and status = 'pendente'", [scope.clientId]);
  return r?.n ?? 0;
}

export interface HistoricoCliente { versao: number; tipo: string; quem: "Você" | "Avanteza"; texto: string | null; criado_em: string }

export async function obterAprovacao(scope: ClientScope, id: string) {
  assertScope(scope);
  if (!UUID.test(id)) return null;
  const [a] = await rawQuery<AprovacaoCliente>(`select ${COLS} ${FROM} where a.id = $1 and a.client_id = $2 and a.status <> 'cancelada'`, [id, scope.clientId]);
  if (!a) return null;
  const [versoes, eventos] = await Promise.all([
    rawQuery<{ numero: number; link: string; nota: string | null; criado_em: string }>(
      "select v.numero, v.link, v.nota, v.criado_em from avanteza.aprovacao_versoes v join avanteza.aprovacoes a on a.id = v.aprovacao_id where v.aprovacao_id = $1 and a.client_id = $2 order by v.numero desc",
      [id, scope.clientId],
    ),
    rawQuery<{ versao: number; tipo: string; autor_tipo: string; texto: string | null; criado_em: string }>(
      "select e.versao, e.tipo, e.autor_tipo, e.texto, e.criado_em from avanteza.aprovacao_eventos e join avanteza.aprovacoes a on a.id = e.aprovacao_id where e.aprovacao_id = $1 and a.client_id = $2 order by e.criado_em",
      [id, scope.clientId],
    ),
  ]);
  const historico: HistoricoCliente[] = eventos.map((e) => ({ versao: e.versao, tipo: e.tipo, quem: e.autor_tipo === "cliente" ? "Você" : "Avanteza", texto: e.texto, criado_em: e.criado_em }));
  return { aprovacao: a, versoes, historico };
}

export type Decisao = "aprovar" | "ajuste";

/**
 * Decisão do cliente sobre a versão atual (só peça pendente da empresa ativa do escopo):
 *  - aprovar: conclui a tarefa ligada (se houver) e avisa a equipe;
 *  - ajuste (comentário obrigatório): cria uma ação no Motor para a equipe, com o responsável da tarefa original
 *    (ou o responsável pela conta), prazo de 2 dias, e avisa a equipe.
 * A troca de status é condicional (pendente → …): duas decisões ao mesmo tempo não geram duas ações.
 */
export async function decidirAprovacao(scope: ClientScope, id: string, decisao: Decisao, comentario: string | null, o: { hoje?: string } = {}): Promise<{ ok: boolean; erro?: string; acaoId?: string }> {
  assertWritable(scope);
  if (!UUID.test(id)) return { ok: false, erro: "Peça não encontrada." };
  const texto = (comentario ?? "").trim().slice(0, 2000) || null;
  if (decisao === "ajuste" && (!texto || texto.length < 3)) return { ok: false, erro: "Conte o que precisa mudar para a equipe ajustar." };
  if (decisao !== "aprovar" && decisao !== "ajuste") return { ok: false, erro: "Decisão inválida." };
  const novo = decisao === "aprovar" ? "aprovada" : "ajuste";
  const r = await rawQuery<{ id: string; tipo: string; titulo: string; versao_atual: number; action_id: string | null }>(
    `update avanteza.aprovacoes set status = $3, decidido_por = $4, decidido_em = now(), atualizado_em = now()
      where id = $1 and client_id = $2 and status = 'pendente' returning id, tipo, titulo, versao_atual, action_id`,
    [id, scope.clientId, novo, scope.userEmail],
  );
  if (!r.length) return { ok: false, erro: "Esta peça não está mais aguardando aprovação." };
  const ap = r[0];
  await rawQuery("insert into avanteza.aprovacao_eventos (aprovacao_id, versao, tipo, autor, autor_tipo, texto) values ($1,$2,$3,$4,'cliente',$5)", [id, ap.versao_atual, novo, scope.userEmail, texto]);
  const [v] = await rawQuery<{ link: string }>("select link from avanteza.aprovacao_versoes where aprovacao_id = $1 and numero = $2", [id, ap.versao_atual]);
  const rotulo = ROTULO_TIPO_PECA[ap.tipo as TipoPeca] ?? "Peça";
  let acaoId: string | undefined;
  if (decisao === "aprovar") {
    if (ap.action_id) {
      await rawQuery(
        "update avanteza.plan_actions set status = 'concluida', completed_at = now(), blocked_reason = null, evidence_url = coalesce(evidence_url, $3), updated_at = now() where id = $1 and client_id = $2 and status <> 'concluida'",
        [ap.action_id, scope.clientId, v?.link ?? null],
      );
    }
  } else {
    const hoje = o.hoje ?? spDate();
    const [orig] = ap.action_id
      ? await rawQuery<{ assignee_id: string | null; role: string | null; phase_id: string | null }>("select assignee_id, role, phase_id from avanteza.plan_actions where id = $1 and client_id = $2", [ap.action_id, scope.clientId])
      : [];
    const [cli] = await rawQuery<{ manager_id: string | null }>("select manager_id from avanteza.clients where id = $1", [scope.clientId]);
    const [nova] = await rawQuery<{ id: string }>(
      `insert into avanteza.plan_actions (client_id, phase_id, title, description, status, owner, due_date, sla_due, origin, priority, assignee_id, role, visible_to_client, evidence_url)
       values ($1,$2,$3,$4,'planejada','avanteza',$5,$5,'aprovacao',1,$6,$7,true,$8) returning id`,
      [scope.clientId, orig?.phase_id ?? null, tituloAjuste(ap.tipo, ap.titulo), `Pedido do cliente sobre a versão ${ap.versao_atual}: ${texto}`.slice(0, 2000),
        addDaysStr(hoje, 2), orig?.assignee_id ?? cli?.manager_id ?? null, orig?.role ?? null, v?.link ?? null],
    );
    acaoId = nova.id;
    await rawQuery("update avanteza.aprovacoes set ajuste_action_id = $2 where id = $1", [id, nova.id]);
  }
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ($1,$2,$3,$4)", [
    decisao === "aprovar" ? "mapa_aprovacao_aprovada" : "mapa_aprovacao_ajuste", scope.userEmail, scope.clientId, JSON.stringify({ id, versao: ap.versao_atual, acao: acaoId ?? null }),
  ]);
  const [c] = await rawQuery<{ name: string }>("select name from avanteza.clients where id = $1", [scope.clientId]);
  await notificar({
    tipo: decisao === "aprovar" ? "aprovacao_aprovada" : "aprovacao_ajuste",
    titulo: `${c?.name ?? "Cliente"} ${decisao === "aprovar" ? "aprovou" : "pediu ajuste em"}: ${ap.titulo}`,
    corpo: decisao === "aprovar" ? `${rotulo}, versão ${ap.versao_atual}.${texto ? ` Comentário: ${texto}` : ""}` : `${rotulo}, versão ${ap.versao_atual}. ${texto}`,
    link: `/operacoes/aprovacoes/${id}`,
    para: "equipe",
    clientId: scope.clientId,
    dedupKey: `aprovacao:${id}:${ap.versao_atual}:${novo}`,
  });
  return { ok: true, acaoId };
}
