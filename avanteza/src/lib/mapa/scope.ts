// Escopo do Mapa: o ÚNICO jeito de obter o client_id nas consultas do cliente.
// O client_id vem da sessão assinada (usuário "client") ou do cookie assinado de visualização da equipe.
// Nenhuma função do repositório aceita client_id de URL, corpo ou formulário.
import type { Session } from "../session";

export interface ClientScope {
  /** Empresa ATIVA (sempre um dos allowedClientIds). Todas as consultas filtram por ela. */
  readonly clientId: string;
  /** Empresas do grupo a que o usuário tem direito (vem da sessão). Só a visão consolidada usa a lista inteira. */
  readonly allowedClientIds: readonly string[];
  /** Visualização da equipe ("Ver como cliente") nunca escreve. */
  readonly readOnly: boolean;
  /** E-mail de quem está logado (o cliente ou a equipe em visualização). */
  readonly userEmail: string;
  /** Preenchido só na visualização da equipe. */
  readonly previewBy?: string;
}

const issued = new WeakSet<object>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve o escopo a partir de dados JÁ verificados.
 * - papel client: a lista de empresas vem da SESSÃO; a empresa ativa é a escolhida (cookie) SE estiver na lista, senão a primeira.
 *   Qualquer visualização é ignorada;
 * - admin/reviewer/member com visualização válida: escopo de uma empresa, somente leitura;
 * - qualquer outro caso: null.
 * `selectedId` é um valor cru do navegador: só vale quando está na lista da sessão.
 */
export function scopeFromSession(sess: Session | null, previewClientId?: string | null, selectedId?: string | null, liveAllowed?: string[] | null): ClientScope | null {
  if (!sess) return null;
  let scope: ClientScope | null = null;
  if (sess.role === "client") {
    // liveAllowed (do banco) só PODE reduzir a lista da sessão, nunca ampliá-la.
    let list = (sess.clientIds ?? []).filter((id) => UUID.test(id));
    if (liveAllowed) list = list.filter((id) => liveAllowed.includes(id));
    if (list.length) {
      const active = selectedId && list.includes(selectedId) ? selectedId : list[0];
      scope = Object.freeze({ clientId: active, allowedClientIds: Object.freeze([...list]), readOnly: false, userEmail: sess.email });
    }
  } else if (previewClientId && UUID.test(previewClientId)) {
    scope = Object.freeze({ clientId: previewClientId, allowedClientIds: Object.freeze([previewClientId]), readOnly: true, userEmail: sess.email, previewBy: sess.email });
  }
  if (scope) issued.add(scope);
  return scope;
}

/** O repositório recusa qualquer escopo que não tenha sido emitido por scopeFromSession. */
export function assertScope(scope: ClientScope): ClientScope {
  if (!scope || typeof scope !== "object" || !issued.has(scope) || !UUID.test(scope.clientId) || !scope.allowedClientIds.includes(scope.clientId)) throw new Error("Escopo de cliente inválido");
  return scope;
}

export function assertWritable(scope: ClientScope): ClientScope {
  assertScope(scope);
  if (scope.readOnly) throw new Error("Visualização somente leitura");
  return scope;
}
