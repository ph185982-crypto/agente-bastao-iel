// Busca global da equipe (Ctrl/Cmd+K). Junta, em paralelo e cada fonte isolada, o banco da Central (clientes, ações do Motor,
// aprovações) e o Comercial (API de serviço do Vendedor IA). Uma fonte fora do ar vira aviso; nunca derruba a paleta.
// Páginas do menu e ações rápidas são filtradas na própria paleta (paginas.ts), sem ida ao servidor.
import type { Session } from "@/lib/session";
import { abreFichaCliente, gruposPermitidos, podeBuscar } from "./acesso";
import { provedorComercialDoAmbiente, TIPOS_COMERCIAL, type ProvedorComercial, type TipoComercial } from "./comercial";
import { buscarAcoes, buscarAprovacoes, buscarClientes } from "./local";
import { limparConsulta } from "./texto";
import { LIMITE_MAXIMO, LIMITE_PADRAO, MIN_CARACTERES, ROTULO_GRUPO, type AvisoBusca, type GrupoBusca, type GrupoId, type ItemBusca, type RespostaBusca } from "./tipos";

export class BuscaNegada extends Error {}

export interface OpcoesBusca {
  limite?: number;
  /** Restringe os grupos (ex.: só "clientes" para escolher o cliente de uma ação rápida). */
  grupos?: GrupoId[];
  comercial?: ProvedorComercial;
}

export const lerLimite = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, LIMITE_MAXIMO) : LIMITE_PADRAO;
};

const MSG_COMERCIAL = "Comercial indisponível no momento: oportunidades, contatos e contratos não entraram nesta busca.";

export async function buscar(sess: Session | null, qBruto: unknown, o: OpcoesBusca = {}): Promise<RespostaBusca> {
  if (!podeBuscar(sess)) throw new BuscaNegada("acesso negado");
  const q = limparConsulta(qBruto);
  const vazio: RespostaBusca = { q, grupos: [], avisos: [] };
  if (q.length < MIN_CARACTERES) return vazio;
  const limite = lerLimite(o.limite ?? LIMITE_PADRAO);
  const pode = gruposPermitidos(sess);
  const quer = (g: GrupoId) => pode.has(g) && (!o.grupos || o.grupos.includes(g));
  const avisos: AvisoBusca[] = [];
  let falhaLocal = false;
  const local = <T,>(p: Promise<T[]>) => p.catch(() => { falhaLocal = true; return [] as T[]; });

  const tiposCom = TIPOS_COMERCIAL.filter((t) => quer(t));
  const comercial = tiposCom.length
    ? (o.comercial ?? provedorComercialDoAmbiente()).buscar(q, limite, tiposCom).catch(() => ({ ok: false as const, motivo: "rede" as const }))
    : Promise.resolve(null);

  const [clientes, acoes, aprovacoes, com] = await Promise.all([
    quer("clientes") ? local(buscarClientes(q, limite)) : [],
    quer("acoes") ? local(buscarAcoes(q, limite, abreFichaCliente(sess))) : [],
    quer("aprovacoes") ? local(buscarAprovacoes(q, limite)) : [],
    comercial,
  ]);
  if (falhaLocal) avisos.push({ grupo: "local", texto: "Parte da busca no banco da Central falhou agora; tente de novo." });
  if (com && !com.ok) avisos.push({ grupo: "comercial", texto: MSG_COMERCIAL });

  const porGrupo: Array<[GrupoId, ItemBusca[]]> = [
    ["clientes", clientes], ["acoes", acoes], ["aprovacoes", aprovacoes],
    ...TIPOS_COMERCIAL.map((t): [TipoComercial, ItemBusca[]] => [t, com?.ok ? com.grupos[t] : []]),
  ];
  const grupos: GrupoBusca[] = porGrupo.filter(([, itens]) => itens.length > 0).map(([id, itens]) => ({ id, rotulo: ROTULO_GRUPO[id], itens: itens.slice(0, limite) }));
  return { q, grupos, avisos };
}
