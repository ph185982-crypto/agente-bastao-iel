// Busca no banco da Central (Neon, schema avanteza): clientes, ações/entregas do Motor e aprovações. Somente leitura.
// O texto do usuário vai só como parâmetro (padrão LIKE escapado); comparação sem acento e sem caixa nos dois lados.
// Nunca devolve token, chave, contato ou texto interno: só título, cliente, situação e prazo.
import { rawQuery } from "@/lib/db/client";
import { padraoLike } from "./texto";
import type { ItemBusca } from "./tipos";

const COM_ACENTO = "ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO = "AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn";
/** Expressão SQL da coluna normalizada (sem acento, minúscula) — não depende de extensão (unaccent) nem do locale. */
const norm = (col: string) => `lower(translate(coalesce(${col}, ''), '${COM_ACENTO}', '${SEM_ACENTO}'))`;

const STATUS_ACAO: Record<string, string> = { planejada: "Planejada", em_execucao: "Em execução", concluida: "Concluída", bloqueada: "Bloqueada" };
const STATUS_APROVACAO: Record<string, string> = { pendente: "Aguardando o cliente", aprovada: "Aprovada", ajuste: "Pediu ajuste" };
const TIPO_CLIENTE: Record<string, string> = { marketplace: "Marketplace", midia: "Mídia", ambos: "Marketplace e mídia" };

const juntar = (...p: Array<string | null | undefined | false>) => p.filter(Boolean).join(" · ");

export async function buscarClientes(q: string, limite: number): Promise<ItemBusca[]> {
  const rows = await rawQuery<{ id: string; name: string; kind: string | null; active: boolean; inicio: boolean }>(
    `select id, name, kind, active, (${norm("name")} like $2 escape '\\') as inicio
       from avanteza.clients
      where ${norm("name")} like $1 escape '\\' or ${norm("slug")} like $1 escape '\\'
      order by active desc, inicio desc, name
      limit $3`,
    [padraoLike(q), padraoLike(q).slice(1), limite],
  );
  return rows.map((r) => ({ id: r.id, titulo: r.name, detalhe: juntar(TIPO_CLIENTE[r.kind ?? ""] ?? "Cliente", !r.active && "inativo"), href: `/clientes/${r.id}`, icon: "users" }));
}

/** Ações do Motor (plan_actions) de clientes ativos, sem as dispensadas; abertas primeiro, por prazo. */
export async function buscarAcoes(q: string, limite: number, abreFicha: boolean): Promise<ItemBusca[]> {
  const rows = await rawQuery<{ id: string; title: string; status: string; prazo: string | null; client_id: string; cliente: string; atrasada: boolean }>(
    `select a.id, a.title, a.status, to_char(a.due_date, 'DD/MM') as prazo, a.client_id, c.name as cliente,
            (a.status <> 'concluida' and a.due_date < (now() at time zone 'America/Sao_Paulo')::date) as atrasada
       from avanteza.plan_actions a join avanteza.clients c on c.id = a.client_id
      where a.archived_at is null and c.active and ${norm("a.title")} like $1 escape '\\'
      order by (a.status = 'concluida'), a.due_date nulls last, a.title
      limit $2`,
    [padraoLike(q), limite],
  );
  return rows.map((r) => ({
    id: r.id, titulo: r.title, icon: "check",
    detalhe: juntar(r.cliente, STATUS_ACAO[r.status] ?? r.status, r.prazo && `${r.atrasada ? "atrasada desde" : "prazo"} ${r.prazo}`),
    href: abreFicha ? `/clientes/${r.client_id}?aba=entregas` : "/operacoes",
  }));
}

export async function buscarAprovacoes(q: string, limite: number): Promise<ItemBusca[]> {
  const rows = await rawQuery<{ id: string; titulo: string; status: string; prazo: string | null; cliente: string }>(
    `select p.id, p.titulo, p.status, to_char(p.prazo, 'DD/MM') as prazo, c.name as cliente
       from avanteza.aprovacoes p join avanteza.clients c on c.id = p.client_id
      where p.status <> 'cancelada' and c.active and (${norm("p.titulo")} like $1 escape '\\' or ${norm("c.name")} like $1 escape '\\')
      order by (p.status <> 'pendente'), p.prazo nulls last, p.criado_em desc
      limit $2`,
    [padraoLike(q), limite],
  );
  return rows.map((r) => ({ id: r.id, titulo: r.titulo, icon: "check", detalhe: juntar(r.cliente, STATUS_APROVACAO[r.status] ?? r.status, r.prazo && `prazo ${r.prazo}`), href: `/operacoes/aprovacoes/${r.id}` }));
}
