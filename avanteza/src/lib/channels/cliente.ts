// Leitura dos canais para o Mapa (lado do cliente). REGRA DE OURO (como em src/lib/mapa/repo.ts): o client_id vem só do escopo
// emitido pela sessão (assertScope). O que sai daqui NUNCA contém token, hint do token, ID da conta de anúncios, da Página
// ou do Instagram: só números, nomes de campanhas/anúncios (que são do próprio cliente) e a data da última atualização.
import { addDays, spDate } from "@/lib/dates";
import { resolverPeriodo, type PeriodoId } from "@/lib/dashboards/periodo";
import { assertScope, type ClientScope } from "@/lib/mapa/scope";
import { canaisFixtureAtiva } from "./fixture";
import { evolucao, relAnuncios, relInstagram, type Agrupamento, type Marco, type RelAnuncios, type RelInstagram } from "./report";
import { lerSnapshots, obterCanal } from "./store";
import { RESULTADO_PADRAO, type OrigemDado } from "./types";

export interface EstadoCanalCliente {
  /** Alguma fonte já coletou ao menos uma vez. */
  conectado: boolean;
  /** Há canal cadastrado (mesmo que ainda sem coleta). */
  cadastrado: boolean;
  /** Fonte de anúncios configurada / já com coleta. Independente do Instagram. */
  anuncios: boolean;
  anunciosConectado: boolean;
  anunciosAtualizadoEm: string | null;
  anunciosComProblema: boolean;
  /** De onde vêm os anúncios (Meta com token ou Windsor). */
  fonteAnuncios: OrigemDado | null;
  /** Fonte do Instagram configurada / já com coleta / de onde vêm os dados. Independente dos anúncios. */
  instagram: boolean;
  instagramConectado: boolean;
  instagramAtualizadoEm: string | null;
  instagramComProblema: boolean;
  fonteInstagram: OrigemDado | null;
  ultimaAtualizacao: string | null;
  /** Alguma atualização teve problema (o detalhe técnico é só do administrador). */
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

/**
 * Lê os snapshots de cada fonte SEPARADAMENTE: anúncios só da Meta Ads; Instagram só da fonte configurada no canal (Windsor ou Meta).
 * Nada é misturado nem somado entre fontes e uma fonte sem coleta nunca esconde a outra.
 */
export async function carregarCanaisDoCliente(scope: ClientScope, periodoId: PeriodoId, hoje: string = spDate()): Promise<CanaisCliente> {
  assertScope(scope);
  const periodo = resolverPeriodo(periodoId, hoje);
  const canal = await obterCanal(scope.clientId);
  const adsConfigurado = Boolean(canal && (canal.adsSource === "meta" || canal.adsSource === "windsor") && canal.adAccountId);
  const fonteAds: OrigemDado | null = adsConfigurado ? (canal!.adsSource as OrigemDado) : null;
  const igConfigurado = Boolean(canal && (canal.igSource === "windsor" || (canal.igSource === "meta" && canal.igUserId)));
  const adsOk = adsConfigurado && Boolean(canal!.lastSyncAt), igOk = igConfigurado && Boolean(canal!.igLastSyncAt);
  const fonteIg: OrigemDado | null = igConfigurado ? (canal!.igSource as OrigemDado) : null;
  const estado: EstadoCanalCliente = {
    conectado: adsOk || igOk, cadastrado: Boolean(canal),
    anuncios: adsConfigurado, anunciosConectado: adsOk, anunciosAtualizadoEm: adsOk ? canal!.lastSyncAt : null, anunciosComProblema: adsConfigurado && Boolean(canal!.lastError), fonteAnuncios: fonteAds,
    instagram: igConfigurado, instagramConectado: igOk, instagramAtualizadoEm: igOk ? canal!.igLastSyncAt : null, instagramComProblema: igConfigurado && Boolean(canal!.igLastError),
    fonteInstagram: fonteIg, ultimaAtualizacao: [adsOk ? canal!.lastSyncAt : null, igOk ? canal!.igLastSyncAt : null].filter((x): x is string => Boolean(x)).sort().pop() ?? null,
    comProblema: false, simulado: canaisFixtureAtiva(), resultado: canal?.resultActionType === RESULTADO_PADRAO || !canal ? "conversas" : "resultados",
  };
  estado.comProblema = estado.anunciosComProblema || estado.instagramComProblema;
  const vazio: CanaisCliente = { estado, periodo, anuncios: null, instagram: null, evolucao: null };
  if (!canal || (!adsOk && !igOk)) return vazio;

  const historico = addDays(hoje, -420);
  const [camp, ig, ads, midias, aud] = await Promise.all([
    adsOk ? lerSnapshots(scope.clientId, ["campaign_daily"], historico, hoje, fonteAds!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_daily"], historico, hoje, fonteIg!) : [],
    adsOk ? lerSnapshots(scope.clientId, ["ad_daily"], periodo.anterior.de, hoje, fonteAds!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_media"], addDays(hoje, -120), hoje, fonteIg!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_audience"], addDays(hoje, -60), hoje, fonteIg!) : [],
  ]);
  const todas = [...camp, ...ig, ...ads, ...midias, ...aud];
  const filtro = canal.campaignIds;
  const anuncios = adsOk ? relAnuncios(todas, periodo, filtro) : null;
  const instagram = igOk ? relInstagram(todas, periodo) : null;
  // IDs externos (campanha, anúncio, mídia) não saem daqui: a tela só precisa de uma chave estável para listar.
  if (anuncios) {
    anuncios.campanhas.forEach((c, i) => { c.id = `c${i}`; });
    anuncios.criativos.ranking.forEach((c, i) => { c.id = `a${i}`; });
  }
  instagram?.midias.forEach((m, i) => { m.id = `m${i}`; });
  return {
    estado, periodo, anuncios, instagram,
    evolucao: { mes: evolucao(todas, "mes" as Agrupamento, hoje, filtro), semana: evolucao(todas, "semana" as Agrupamento, hoje, filtro) },
  };
}
