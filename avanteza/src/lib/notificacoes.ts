// Notificações da equipe (sino do AppShell): "contrato assinado", "cliente novo criado", "acesso ao Mapa criado",
// "captura registrada", "evento com falha". para = admin (só administradores) | equipe (admin, membro e revisor).
// Leitura por pessoa (lidas_por). O segredo (senha inicial do cliente) fica cifrado e é revelado UMA vez, só a administrador.
import { rawQuery } from "./db/client";
import { decrypt, encrypt } from "./crypto";
import type { Session } from "./session";

export type DestinoNotificacao = "admin" | "equipe";

export interface NovaNotificacao {
  tipo: string;
  titulo: string;
  corpo?: string | null;
  link?: string | null;
  para?: DestinoNotificacao;
  clientId?: string | null;
  /** Texto sensível exibido uma única vez (ex.: senha inicial). Gravado cifrado; sem ENCRYPTION_KEY não é gravado. */
  segredo?: string | null;
  /** Mesma chave = mesma notificação (reprocessar um evento não notifica de novo). */
  dedupKey?: string | null;
}

export async function notificar(n: NovaNotificacao): Promise<{ id: string | null; segredoGuardado: boolean }> {
  let segredoEnc: string | null = null;
  if (n.segredo) {
    try { segredoEnc = encrypt(n.segredo); } catch { segredoEnc = null; }
  }
  const r = await rawQuery<{ id: string }>(
    `insert into avanteza.notificacoes (tipo, titulo, corpo, link, para, client_id, segredo_enc, dedup_key) values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (dedup_key) do nothing returning id`,
    [n.tipo, n.titulo.slice(0, 200), n.corpo?.slice(0, 1000) ?? null, n.link ?? null, n.para ?? "admin", n.clientId ?? null, segredoEnc, n.dedupKey ?? null],
  );
  return { id: r[0]?.id ?? null, segredoGuardado: Boolean(r[0] && segredoEnc) };
}

export interface Notificacao {
  id: string; tipo: string; titulo: string; corpo: string | null; link: string | null; criado_em: string; lida: boolean; temSegredo: boolean;
}

const destinos = (s: Session) => (s.role === "admin" ? ["admin", "equipe"] : ["equipe"]);
export const podeVerNotificacoes = (s: Session | null): s is Session => Boolean(s && s.role !== "client");

export async function listarNotificacoes(s: Session, limite = 30): Promise<{ itens: Notificacao[]; naoLidas: number }> {
  const itens = await rawQuery<Notificacao>(
    `select id, tipo, titulo, corpo, link, to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as criado_em, ($2 = any(lidas_por)) as lida,
            (segredo_enc is not null and segredo_revelado_em is null) as "temSegredo"
       from avanteza.notificacoes where para = any($1::text[]) order by criado_em desc limit $3`,
    [destinos(s), s.email, limite],
  );
  const [c] = await rawQuery<{ n: number }>("select count(*)::int n from avanteza.notificacoes where para = any($1::text[]) and not ($2 = any(lidas_por))", [destinos(s), s.email]);
  return { itens: itens.map((i) => ({ ...i, temSegredo: s.role === "admin" && i.temSegredo })), naoLidas: c.n };
}

export async function marcarLida(s: Session, id: string | "todas") {
  if (id === "todas") {
    await rawQuery("update avanteza.notificacoes set lidas_por = array_append(lidas_por, $2) where para = any($1::text[]) and not ($2 = any(lidas_por))", [destinos(s), s.email]);
    return;
  }
  await rawQuery("update avanteza.notificacoes set lidas_por = array_append(lidas_por, $3) where id = $1 and para = any($2::text[]) and not ($3 = any(lidas_por))", [id, destinos(s), s.email]);
}

/** Revela o segredo UMA vez (só administrador): devolve o texto e apaga a cifra. Segunda chamada → null. */
export async function revelarSegredo(s: Session, id: string, actor = s.email): Promise<string | null> {
  if (s.role !== "admin") return null;
  const r = await rawQuery<{ segredo_enc: string; client_id: string | null }>(
    `update avanteza.notificacoes n set segredo_enc = null, segredo_revelado_em = now(), lidas_por = case when $2 = any(lidas_por) then lidas_por else array_append(lidas_por, $2) end
       from (select id, segredo_enc as antigo from avanteza.notificacoes where id = $1 and para = 'admin' and segredo_enc is not null for update) o
      where n.id = o.id returning o.antigo as segredo_enc, n.client_id`,
    [id, s.email],
  );
  if (!r.length) return null;
  await rawQuery("insert into avanteza.audit_log (event, actor, client_id, details) values ('notificacao_segredo_revelado', $1, $2, $3)", [actor, r[0].client_id, JSON.stringify({ notificacao: id })]);
  try { return decrypt(r[0].segredo_enc); } catch { return null; }
}
