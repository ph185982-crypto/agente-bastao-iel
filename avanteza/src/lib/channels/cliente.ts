// Leitura dos canais para o Mapa (lado do cliente). REGRA DE OURO (como em src/lib/mapa/repo.ts): o client_id vem só do escopo
// emitido pela sessão (assertScope). O que sai daqui NUNCA contém token, hint do token, ID da conta de anúncios, da Página
// ou do Instagram: só números, nomes de campanhas/anúncios (que são do próprio cliente) e a data da última atualização.
import { addDays, spDate } from "@/lib/dates";
import { resolverPeriodo, type PeriodoId } from "@/lib/dashboards/periodo";
import { assertScope, type ClientScope } from "@/lib/mapa/scope";
import { canaisFixtureAtiva } from "./fixture";
import { evolucao, relAnuncios, relInstagram, type Agrupamento, type Marco, type RelAnuncios, type RelInstagram } from "./report";
import { lerSnapshots, obterCanal } from "./store";
import { RESULTADO_PADRAO } from "./types";

export interface EstadoCanalCliente {
  /** Existe canal e já houve ao menos uma coleta. */
  conectado: boolean;
  /** Há canal cadastrado (mesmo que ainda sem coleta). */
  cadastrado: boolean;
  anuncios: boolean;
  instagram: boolean;
  ultimaAtualizacao: string | null;
  /** A última atualização teve problema (o detalhe técnico é só do administrador). */
  comProblema: boolean;
  simulado: boolean;
  /** Como chamar o resultado da campanha na tela (conversas no WhatsApp ou, para outro objetivo, “resultados”). */
  resultado: "conversas" | "resultados";
}
export interface CanaisCliente {
  estado: EstadoCanalCliente;
  periodo: ReturnType<typeof resolverPeriodo>;
  anuncios: RelAnuncios | null;
  instagram: RelInstagram | null;
  evolucao: { mes: Marco[]; semana: Marco[] } | null;
}

export async function carregarCanaisDoCliente(scope: ClientScope, periodoId: PeriodoId, hoje: string = spDate()): Promise<CanaisCliente> {
  assertScope(scope);
  const periodo = resolverPeriodo(periodoId, hoje);
  const canal = await obterCanal(scope.clientId);
  const vazio: CanaisCliente = {
    estado: { conectado: false, cadastrado: Boolean(canal), anuncios: Boolean(canal?.adAccountId), instagram: Boolean(canal?.igUserId), ultimaAtualizacao: null, comProblema: false, simulado: canaisFixtureAtiva(), resultado: canal?.resultActionType === RESULTADO_PADRAO || !canal ? "conversas" : "resultados" },
    periodo, anuncios: null, instagram: null, evolucao: null,
  };
  if (!canal || !canal.lastSyncAt) return { ...vazio, estado: { ...vazio.estado, comProblema: canal?.status === "erro" } };

  const historico = addDays(hoje, -420);
  const [camp, ig, ads, midias] = await Promise.all([
    lerSnapshots(scope.clientId, ["campaign_daily"], historico, hoje),
    lerSnapshots(scope.clientId, ["ig_daily"], historico, hoje),
    lerSnapshots(scope.clientId, ["ad_daily"], periodo.anterior.de, hoje),
    lerSnapshots(scope.clientId, ["ig_media"], addDays(hoje, -120), hoje),
  ]);
  const todas = [...camp, ...ig, ...ads, ...midias];
  const filtro = canal.campaignIds;
  const anuncios = canal.adAccountId ? relAnuncios(todas, periodo, filtro) : null;
  const instagram = canal.igUserId ? relInstagram(todas, periodo) : null;
  // IDs externos (campanha, anúncio, mídia) não saem daqui: a tela só precisa de uma chave estável para listar.
  if (anuncios) {
    anuncios.campanhas.forEach((c, i) => { c.id = `c${i}`; });
    anuncios.criativos.ranking.forEach((c, i) => { c.id = `a${i}`; });
  }
  instagram?.midias.forEach((m, i) => { m.id = `m${i}`; });
  return {
    estado: { ...vazio.estado, conectado: true, ultimaAtualizacao: canal.lastSyncAt, comProblema: canal.status === "erro" || Boolean(canal.lastError) },
    periodo,
    anuncios,
    instagram,
    evolucao: { mes: evolucao(todas, "mes" as Agrupamento, hoje, filtro), semana: evolucao(todas, "semana" as Agrupamento, hoje, filtro) },
  };
}
