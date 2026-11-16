// Aprovações — lado da EQUIPE (Operações → Aprovações e ficha do cliente). Quem chama confere o papel antes (motor/acesso.ts).
// O cliente do Mapa NUNCA passa por aqui: o lado dele está em src/lib/mapa/aprovacoes.ts (escopo da sessão).
import { rawQuery } from "../db/client";
import { isUuid } from "../motor/repo";
import { isDateStr } from "../mapa/plan";
import { isTipoPeca, linkValido, type TipoPeca } from "./tipos";

async function audit(actor: string, event: string, clientId: string | null, details: Record<string, unknown> = {}) {
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ($1,$2,$3,$4)", [event, actor, clientId, JSON.stringify(details)]);
}

export interface NovaAprovacao {
  clientId: string; tipo: TipoPeca | string; titulo: string; descricao?: string | null; prazo?: string | null;
  link?: string | null; arquivoId?: string | null; actionId?: string | null; nota?: string | null;
}

/** Link da versão: o link informado ou o do arquivo do cliente escolhido (que precisa ser do mesmo cliente). */
async function resolverLink(clientId: string, link: string | null | undefined, arquivoId: string | null | undefined): Promise<{ link: string; arquivoId: string | null } | { erro: string }> {
  if (arquivoId) {
    if (!isUuid(arquivoId)) return { erro: "Arquivo inválido." };
    const [f] = await rawQuery<{ url: string }>("select url from avanteza.client_files where id = $1 and client_id = $2 and visible", [arquivoId, clientId]);
    if (!f || !linkValido(f.url)) return { erro: "Arquivo não encontrado neste cliente." };
    return { link: f.url, arquivoId };
  }
  const l = (link ?? "").trim();
  if (!linkValido(l)) return { erro: "Informe o link da peça (https://…) ou escolha um arquivo do cliente." };
  return { link: l, arquivoId: null };
}

export async function criarAprovacao(actor: string, d: NovaAprovacao): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  if (!isUuid(d.clientId)) return { ok: false, erro: "Cliente inválido." };
  if (!isTipoPeca(d.tipo)) return { ok: false, erro: "Tipo de peça inválido." };
  const titulo = d.titulo.trim();
  if (titulo.length < 3) return { ok: false, erro: "Dê um título à peça." };
  if (d.prazo && !isDateStr(d.prazo)) return { ok: false, erro: "Prazo inválido." };
  const [cli] = await rawQuery<{ id: string }>("select id from avanteza.clients where id = $1", [d.clientId]);
  if (!cli) return { ok: false, erro: "Cliente não encontrado." };
  if (d.actionId) {
    if (!isUuid(d.actionId) || !(await rawQuery("select 1 from avanteza.plan_actions where id = $1 and client_id = $2", [d.actionId, d.clientId])).length) {
      return { ok: false, erro: "A tarefa ligada precisa ser deste cliente." };
    }
  }
  const v = await resolverLink(d.clientId, d.link, d.arquivoId);
  if ("erro" in v) return { ok: false, erro: v.erro };
  const [a] = await rawQuery<{ id: string }>(
    `insert into avanteza.aprovacoes (client_id, tipo, titulo, descricao, prazo, action_id, criado_por) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [d.clientId, d.tipo, titulo.slice(0, 200), d.descricao?.trim().slice(0, 2000) || null, d.prazo || null, d.actionId || null, actor],
  );
  await rawQuery("insert into avanteza.aprovacao_versoes (aprovacao_id, numero, link, arquivo_id, nota, criado_por) values ($1,1,$2,$3,$4,$5)", [a.id, v.link, v.arquivoId, d.nota?.trim().slice(0, 1000) || null, actor]);
  await rawQuery("insert into avanteza.aprovacao_eventos (aprovacao_id, versao, tipo, autor, autor_tipo, texto) values ($1,1,'enviada',$2,'equipe',$3)", [a.id, actor, d.nota?.trim().slice(0, 1000) || null]);
  await audit(actor, "aprovacao_criada", d.clientId, { id: a.id, tipo: d.tipo });
  return { ok: true, id: a.id };
}

/** Nova versão (depois de um ajuste ou para trocar a peça pendente): volta a "aguardando" e conclui a ação de ajuste. */
export async function novaVersao(actor: string, id: string, d: { link?: string | null; arquivoId?: string | null; nota?: string | null }): Promise<{ ok: boolean; erro?: string }> {
  if (!isUuid(id)) return { ok: false, erro: "Aprovação não encontrada." };
  const [ap] = await rawQuery<{ client_id: string; status: string; ajuste_action_id: string | null }>("select client_id, status, ajuste_action_id from avanteza.aprovacoes where id = $1", [id]);
  if (!ap) return { ok: false, erro: "Aprovação não encontrada." };
  if (ap.status !== "pendente" && ap.status !== "ajuste") return { ok: false, erro: "Esta peça já foi aprovada ou cancelada." };
  const v = await resolverLink(ap.client_id, d.link, d.arquivoId);
  if ("erro" in v) return { ok: false, erro: v.erro };
  const r = await rawQuery<{ versao_atual: number }>(
    "update avanteza.aprovacoes set versao_atual = versao_atual + 1, status = 'pendente', atualizado_em = now() where id = $1 and status in ('pendente','ajuste') returning versao_atual",
    [id],
  );
  if (!r.length) return { ok: false, erro: "Esta peça já foi aprovada ou cancelada." };
  const n = r[0].versao_atual;
  const nota = d.nota?.trim().slice(0, 1000) || null;
  await rawQuery("insert into avanteza.aprovacao_versoes (aprovacao_id, numero, link, arquivo_id, nota, criado_por) values ($1,$2,$3,$4,$5,$6)", [id, n, v.link, v.arquivoId, nota, actor]);
  await rawQuery("insert into avanteza.aprovacao_eventos (aprovacao_id, versao, tipo, autor, autor_tipo, texto) values ($1,$2,'nova_versao',$3,'equipe',$4)", [id, n, actor, nota]);
  if (ap.ajuste_action_id) {
    await rawQuery(
      "update avanteza.plan_actions set status = 'concluida', completed_at = now(), evidence_url = $2, updated_at = now() where id = $1 and status <> 'concluida'",
      [ap.ajuste_action_id, v.link],
    );
  }
  await audit(actor, "aprovacao_nova_versao", ap.client_id, { id, versao: n });
  return { ok: true };
}

export async function cancelarAprovacao(actor: string, id: string, motivo?: string | null): Promise<{ ok: boolean; erro?: string }> {
  if (!isUuid(id)) return { ok: false, erro: "Aprovação não encontrada." };
  const r = await rawQuery<{ client_id: string; versao_atual: number }>(
    "update avanteza.aprovacoes set status = 'cancelada', atualizado_em = now() where id = $1 and status in ('pendente','ajuste') returning client_id, versao_atual",
    [id],
  );
  if (!r.length) return { ok: false, erro: "Só peças pendentes ou em ajuste podem ser canceladas." };
  await rawQuery("insert into avanteza.aprovacao_eventos (aprovacao_id, versao, tipo, autor, autor_tipo, texto) values ($1,$2,'cancelada',$3,'equipe',$4)", [id, r[0].versao_atual, actor, motivo?.trim().slice(0, 500) || null]);
  await audit(actor, "aprovacao_cancelada", r[0].client_id, { id });
  return { ok: true };
}

export async function comentarEquipe(actor: string, id: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const t = texto.trim();
  if (!isUuid(id) || t.length < 2) return { ok: false, erro: "Escreva o comentário." };
  const [ap] = await rawQuery<{ versao_atual: number; client_id: string }>("select versao_atual, client_id from avanteza.aprovacoes where id = $1", [id]);
  if (!ap) return { ok: false, erro: "Aprovação não encontrada." };
  await rawQuery("insert into avanteza.aprovacao_eventos (aprovacao_id, versao, tipo, autor, autor_tipo, texto) values ($1,$2,'comentario',$3,'equipe',$4)", [id, ap.versao_atual, actor, t.slice(0, 2000)]);
  return { ok: true };
}

// ───────────────────────── Leitura ─────────────────────────

export interface AprovacaoLinha {
  id: string; client_id: string; client_name: string; tipo: string; titulo: string; descricao: string | null; prazo: string | null; status: string;
  versao_atual: number; link: string | null; criado_por: string; criado_em: string; atualizado_em: string; decidido_por: string | null; decidido_em: string | null;
  action_id: string | null; ajuste_action_id: string | null; ajuste_responsavel: string | null; ultimo_comentario: string | null;
}

const COLS = `a.id, a.client_id, c.name as client_name, a.tipo, a.titulo, a.descricao, a.prazo, a.status, a.versao_atual, v.link, a.criado_por, a.criado_em, a.atualizado_em,
  a.decidido_por, a.decidido_em, a.action_id, a.ajuste_action_id, coalesce(u.name, u.email) as ajuste_responsavel,
  (select e.texto from avanteza.aprovacao_eventos e where e.aprovacao_id = a.id and e.autor_tipo = 'cliente' and e.texto is not null order by e.criado_em desc limit 1) as ultimo_comentario`;
const FROM = `from avanteza.aprovacoes a join avanteza.clients c on c.id = a.client_id
  left join avanteza.aprovacao_versoes v on v.aprovacao_id = a.id and v.numero = a.versao_atual
  left join avanteza.plan_actions aj on aj.id = a.ajuste_action_id left join avanteza.admins u on u.id = aj.assignee_id`;

/** Fila da equipe: aguardando o cliente (com atraso), ajustes pedidos (a equipe precisa agir) e decisões recentes. */
export async function filaEquipe(o: { clientId?: string | null } = {}) {
  const cli = o.clientId && isUuid(o.clientId) ? o.clientId : null;
  const filtro = cli ? "and a.client_id = $1" : "";
  const p = cli ? [cli] : [];
  const [abertas, recentes] = await Promise.all([
    rawQuery<AprovacaoLinha>(`select ${COLS} ${FROM} where c.active and a.status in ('pendente','ajuste') ${filtro} order by a.prazo nulls last, a.criado_em`, p),
    rawQuery<AprovacaoLinha>(`select ${COLS} ${FROM} where a.status in ('aprovada','cancelada') and a.atualizado_em > now() - interval '30 days' ${filtro} order by a.atualizado_em desc limit 30`, p),
  ]);
  return { pendentes: abertas.filter((a) => a.status === "pendente"), ajustes: abertas.filter((a) => a.status === "ajuste"), recentes };
}

export async function contarPendentes(): Promise<{ pendentes: number; ajustes: number }> {
  const [r] = await rawQuery<{ p: number; a: number }>(
    "select count(*) filter (where a.status = 'pendente')::int p, count(*) filter (where a.status = 'ajuste')::int a from avanteza.aprovacoes a join avanteza.clients c on c.id = a.client_id where c.active",
  );
  return { pendentes: r?.p ?? 0, ajustes: r?.a ?? 0 };
}

export interface VersaoLinha { numero: number; link: string; nota: string | null; criado_por: string; criado_em: string }
export interface EventoLinha { versao: number; tipo: string; autor: string; autor_tipo: string; texto: string | null; criado_em: string }

export async function detalheEquipe(id: string) {
  if (!isUuid(id)) return null;
  const [a] = await rawQuery<AprovacaoLinha>(`select ${COLS} ${FROM} where a.id = $1`, [id]);
  if (!a) return null;
  const [versoes, eventos, acao] = await Promise.all([
    rawQuery<VersaoLinha>("select numero, link, nota, criado_por, criado_em from avanteza.aprovacao_versoes where aprovacao_id = $1 order by numero desc", [id]),
    rawQuery<EventoLinha>("select versao, tipo, autor, autor_tipo, texto, criado_em from avanteza.aprovacao_eventos where aprovacao_id = $1 order by criado_em", [id]),
    a.action_id ? rawQuery<{ title: string; status: string }>("select title, status from avanteza.plan_actions where id = $1", [a.action_id]) : Promise.resolve([]),
  ]);
  return { aprovacao: a, versoes, eventos, acao: acao[0] ?? null };
}

/** Tarefas abertas do cliente que podem ser ligadas a uma peça (aprovar conclui a tarefa). */
export async function tarefasLigaveis(clientId: string) {
  if (!isUuid(clientId)) return [];
  return rawQuery<{ id: string; title: string; due_date: string | null }>(
    "select id, title, due_date from avanteza.plan_actions where client_id = $1 and archived_at is null and status <> 'concluida' and owner = 'avanteza' order by due_date nulls last limit 200",
    [clientId],
  );
}

export async function arquivosDoCliente(clientId: string) {
  if (!isUuid(clientId)) return [];
  return rawQuery<{ id: string; title: string }>("select id, title from avanteza.client_files where client_id = $1 and visible order by created_at desc limit 100", [clientId]);
}
