// Relatórios semanais e lembretes — lado do CLIENTE (Mapa). Só relatórios PUBLICADOS da empresa ativa do escopo da sessão.
// Rascunhos (em revisão pela equipe) e descartados nunca saem daqui; e-mails da equipe também não.
import { rawQuery } from "../db/client";
import { assertScope, type ClientScope } from "./scope";
import { pendenciasParaLembrete, type ItemLembrete } from "../relatorios/lembretes";
import type { DadosRelatorio } from "../relatorios/semana";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RelatorioCliente {
  id: string; semana: string; periodo_fim: string; dados: DadosRelatorio; abertura: string; destaques: string[]; publicado_em: string;
}
const COLS = "id, to_char(semana, 'YYYY-MM-DD') as semana, to_char(periodo_fim, 'YYYY-MM-DD') as periodo_fim, dados, abertura, destaques, publicado_em";

export async function listarRelatorios(scope: ClientScope): Promise<Omit<RelatorioCliente, "dados">[]> {
  assertScope(scope);
  return rawQuery(
    "select id, to_char(semana, 'YYYY-MM-DD') as semana, to_char(periodo_fim, 'YYYY-MM-DD') as periodo_fim, abertura, destaques, publicado_em from avanteza.relatorios_semanais where client_id = $1 and status = 'publicado' order by semana desc limit 104",
    [scope.clientId],
  );
}

export async function obterRelatorio(scope: ClientScope, id: string): Promise<RelatorioCliente | null> {
  assertScope(scope);
  if (!UUID.test(id)) return null;
  const [r] = await rawQuery<RelatorioCliente>(`select ${COLS} from avanteza.relatorios_semanais where id = $1 and client_id = $2 and status = 'publicado'`, [id, scope.clientId]);
  return r ?? null;
}

/** Lembrete de hoje (se houve), só com os itens que continuam pendentes agora. */
export async function lembreteDeHoje(scope: ClientScope, hoje: string): Promise<ItemLembrete[] | null> {
  assertScope(scope);
  const [l] = await rawQuery<{ itens: ItemLembrete[] }>("select itens from avanteza.lembretes_cliente where client_id = $1 and dia = $2", [scope.clientId, hoje]);
  if (!l) return null;
  const agora = new Set((await pendenciasParaLembrete(scope.clientId, hoje)).map((i) => i.id));
  const itens = (l.itens ?? []).filter((i) => agora.has(i.id));
  return itens.length ? itens : null;
}
