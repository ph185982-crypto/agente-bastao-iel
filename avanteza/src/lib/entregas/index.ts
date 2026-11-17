// Orquestração do Funil de Entrega da Central: escolhe o provedor (CRM, ou a fixture em desenvolvimento), isola cada fonte
// (se uma falhar a tela mostra o aviso daquele bloco e segue) e descobre o vínculo opcional com o cliente do Mapa.
import { EntregasErro, mensagemDoErro, provedorEntregasDoAmbiente, type EntregasProvider } from "./crm";
import { CLIENTES_MAPA_FIXTURE, criarProvedorFixture, fixtureEntregasAtiva } from "./fixture";
import { vincularClientes, type ClienteMapa } from "./mapa";

export type Fonte<T> =
  | { estado: "ok"; dados: T }
  | { estado: "indisponivel"; codigo: string; motivo: string }
  | { estado: "nao-configurado"; motivo: string };

const fixtures = new Map<string, EntregasProvider>();

/** Provedor do ambiente. `injetado` é para teste. A fixture (só fora de produção) guarda o estado em memória por processo. */
export function obterProvedor(env: NodeJS.ProcessEnv = process.env, injetado?: EntregasProvider): EntregasProvider {
  if (injetado) return injetado;
  const modo = fixtureEntregasAtiva(env);
  if (modo) {
    let p = fixtures.get(modo);
    if (!p) { p = criarProvedorFixture(modo); fixtures.set(modo, p); }
    return p;
  }
  return provedorEntregasDoAmbiente(env);
}
export const emFixture = (env: NodeJS.ProcessEnv = process.env) => Boolean(fixtureEntregasAtiva(env));

export async function tentar<T>(fn: (p: EntregasProvider) => Promise<T>, env: NodeJS.ProcessEnv = process.env, injetado?: EntregasProvider): Promise<Fonte<T>> {
  try {
    return { estado: "ok", dados: await fn(obterProvedor(env, injetado)) };
  } catch (e) {
    if (e instanceof EntregasErro && e.codigo === "nao-configurado") return { estado: "nao-configurado", motivo: e.message };
    return { estado: "indisponivel", codigo: e instanceof EntregasErro ? e.codigo : "rede", motivo: mensagemDoErro(e) };
  }
}

/** contatoId → cliente do Mapa, por nome/slug. Só leitura; qualquer falha (banco fora do ar, sem variável) = nenhum vínculo. */
export async function clientesDoMapa(contatos: Array<{ id: string; nome: string }>, env: NodeJS.ProcessEnv = process.env, lerClientes?: () => Promise<ClienteMapa[]>): Promise<Map<string, ClienteMapa>> {
  try {
    const clientes = lerClientes ? await lerClientes() : fixtureEntregasAtiva(env) ? CLIENTES_MAPA_FIXTURE : await lerClientesDoBanco();
    return vincularClientes(contatos, clientes);
  } catch {
    return new Map();
  }
}

async function lerClientesDoBanco(): Promise<ClienteMapa[]> {
  const { userDb } = await import("@/lib/db");
  const { data } = await (await userDb()).from("clients").select("id, name").eq("active", true);
  return (data ?? []) as ClienteMapa[];
}
