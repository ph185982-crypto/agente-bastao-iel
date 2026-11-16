// Vínculo OPCIONAL entre o cliente do funil de entrega (contato do CRM) e o cliente do Mapa, por nome/slug.
// Nunca cria nem altera dado: só descobre, para mostrar um atalho "Abrir no Mapa". Em dúvida, não vincula.
export interface ClienteMapa { id: string; name: string }

const SUFIXOS = new Set(["ltda", "me", "epp", "eireli", "sa", "mei", "cia", "comercio", "servicos"]);

/** Minúsculas, sem acento, sem pontuação e sem sufixo societário ("Casa Ambos Ltda." → "casa ambos"). */
export function normalizarNome(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((p) => p && !SUFIXOS.has(p)).join(" ");
}
export const slugDoNome = (s: string) => normalizarNome(s).replace(/ /g, "-");

/** Cliente do Mapa que corresponde ao nome: igualdade normalizada (nome ou slug) ou um nome contido no outro, só se único. */
export function casarClienteMapa(nome: string, clientes: ClienteMapa[]): ClienteMapa | null {
  const alvo = normalizarNome(nome);
  if (alvo.length < 3) return null;
  const exatos = clientes.filter((c) => normalizarNome(c.name) === alvo || slugDoNome(c.name) === slugDoNome(nome));
  if (exatos.length === 1) return exatos[0];
  if (exatos.length > 1) return null;
  const palavras = (s: string) => ` ${s} `;
  const contidos = clientes.filter((c) => {
    const n = normalizarNome(c.name);
    const [curto, longo] = n.length <= alvo.length ? [n, alvo] : [alvo, n];
    return curto.length >= 5 && palavras(longo).includes(palavras(curto));
  });
  return contidos.length === 1 ? contidos[0] : null;
}

/** contatoId → cliente do Mapa (só os que casam). */
export function vincularClientes(contatos: Array<{ id: string; nome: string }>, clientes: ClienteMapa[]): Map<string, ClienteMapa> {
  const m = new Map<string, ClienteMapa>();
  for (const c of contatos) {
    const r = casarClienteMapa(c.nome, clientes);
    if (r) m.set(c.id, r);
  }
  return m;
}
