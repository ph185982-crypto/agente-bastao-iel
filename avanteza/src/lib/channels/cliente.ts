// Leitura dos canais para o Mapa (lado do cliente). REGRA DE OURO (como em src/lib/mapa/repo.ts): o client_id vem só do escopo
// emitido pela sessão (assertScope). O que sai daqui NUNCA contém token, hint do token, ID da conta de anúncios, da Página
// ou do Instagram: só números, nomes de campanhas/anúncios (que são do próprio cliente) e a data da última atualização.
import { addDays, spDate } from "@/lib/dates";
import { resolverPeriodo, type PeriodoId } from "@/lib/dashboards/periodo";
import { assertScope, type ClientScope } from "@/lib/mapa/scope";
import { canaisFixtureAtiva } from "./fixture";
import { evolucao, relAnuncios, relInstagram, type Agrupamento, type Marco, type RelAnuncios, type RelInstagram } from "./report";
import { lerSnapshots, obterCanal } from "./store";
import { filtrarLinhasCampanhas } from "./campanhas";
import { gastoDoCiclo, type GastoCiclo } from "./alerta-gasto";
import { carregarPublico, negocioDoNome, resumosDosConjuntos, type LinhaSnap, type RelPublico } from "./publico";
import { rawQuery } from "../db/client";
import { relGoogle, type RelGoogle } from "./gbp-report";
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
  /** Google · Perfil da Empresa: terceira fonte, independente (Windsor.ai). */
  google: boolean;
  googleConectado: boolean;
  googleAtualizadoEm: string | null;
  googleComProblema: boolean;
  /** Como chamar o resultado da campanha na tela (conversas no WhatsApp ou, para outro objetivo, “resultados”). */
  resultado: "conversas" | "resultados";
}
export interface CanaisCliente {
  estado: EstadoCanalCliente;
  periodo: ReturnType<typeof resolverPeriodo>;
  anuncios: RelAnuncios | null;
  instagram: RelInstagram | null;
  evolucao: { mes: Marco[]; semana: Marco[] } | null;
  /** “Total gasto até agora” do ciclo do alerta de recarga (null = alerta desligado). Só campanhas do filtro do canal. */
  gastoCiclo: GastoCiclo | null;
  /** Público e localização (cortes do período + segmentação dos conjuntos), em linguagem simples. Nunca traz o targeting bruto. */
  publico: RelPublico | null;
  /** Google · Perfil da Empresa (sem ids de avaliação nem nome completo de quem avaliou). */
  google: RelGoogle | null;
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
  const gbpConfigurado = canal?.gbpSource === "windsor";
  const gbpOk = gbpConfigurado && Boolean(canal!.gbpLastSyncAt);
  const estado: EstadoCanalCliente = {
    conectado: adsOk || igOk || gbpOk, cadastrado: Boolean(canal),
    anuncios: adsConfigurado, anunciosConectado: adsOk, anunciosAtualizadoEm: adsOk ? canal!.lastSyncAt : null, anunciosComProblema: adsConfigurado && Boolean(canal!.lastError), fonteAnuncios: fonteAds,
    instagram: igConfigurado, instagramConectado: igOk, instagramAtualizadoEm: igOk ? canal!.igLastSyncAt : null, instagramComProblema: igConfigurado && Boolean(canal!.igLastError),
    google: gbpConfigurado, googleConectado: gbpOk, googleAtualizadoEm: gbpOk ? canal!.gbpLastSyncAt : null, googleComProblema: gbpConfigurado && Boolean(canal!.gbpLastError),
    fonteInstagram: fonteIg, ultimaAtualizacao: [adsOk ? canal!.lastSyncAt : null, igOk ? canal!.igLastSyncAt : null, gbpOk ? canal!.gbpLastSyncAt : null].filter((x): x is string => Boolean(x)).sort().pop() ?? null,
    comProblema: false, simulado: canaisFixtureAtiva(), resultado: canal?.resultActionType === RESULTADO_PADRAO || !canal ? "conversas" : "resultados",
  };
  estado.comProblema = estado.anunciosComProblema || estado.instagramComProblema || estado.googleComProblema;
  const gastoCiclo = adsOk ? await gastoDoCiclo(canal, hoje) : null;
  const vazio: CanaisCliente = { estado, periodo, anuncios: null, instagram: null, evolucao: null, gastoCiclo, publico: null, google: null };
  if (!canal || (!adsOk && !igOk && !gbpOk)) return vazio;

  const historico = addDays(hoje, -420);
  const nome = adsOk ? await nomeDoCliente(scope.clientId) : null;
  const negocio = negocioDoNome(nome);
  const [camp, ig, ads, midias, aud, publico, segs] = await Promise.all([
    adsOk ? lerSnapshots(scope.clientId, ["campaign_daily"], historico, hoje, fonteAds!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_daily"], historico, hoje, fonteIg!) : [],
    adsOk ? lerSnapshots(scope.clientId, ["ad_daily"], periodo.anterior.de, hoje, fonteAds!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_media"], addDays(hoje, -120), hoje, fonteIg!) : [],
    igOk ? lerSnapshots(scope.clientId, ["ig_audience"], addDays(hoje, -60), hoje, fonteIg!) : [],
    adsOk ? carregarPublico(canal, periodo, hoje, { negocio, tecnico: false }) : null,
    adsOk ? lerSnapshots(scope.clientId, ["adset_targeting"], addDays(hoje, -120), hoje, fonteAds!) : [],
  ]);
  // Google: sempre da fonte Windsor; avaliações de todo o histórico guardado (acumulam entre coletas).
  const gbp = gbpOk ? await lerSnapshots(scope.clientId, ["gbp_daily", "gbp_review", "gbp_keyword", "gbp_profile"], historico, hoje, "windsor") : [];
  // Campanhas fora do filtro do canal (ids e nome; ex.: outro projeto na mesma conta) nunca entram nos números do cliente.
  const todas = filtrarLinhasCampanhas([...camp, ...ig, ...ads, ...midias, ...aud], { campaignIds: canal.campaignIds, campaignNameFilter: canal.campaignNameFilter });
  const filtro = canal.campaignIds;
  // Público de cada conjunto em uma linha (para os cartões de anúncio). O mapa fica no servidor: só o texto chega à tela.
  const publicos = resumosDosConjuntos(filtrarLinhasCampanhas([...camp, ...segs], { campaignIds: canal.campaignIds, campaignNameFilter: canal.campaignNameFilter }) as LinhaSnap[], negocio);
  const anuncios = adsOk ? relAnuncios(todas, periodo, filtro, undefined, { publicos, resultado: estado.resultado === "conversas" ? { um: "conversa", plural: "conversas" } : { um: "resultado", plural: "resultados" } }) : null;
  const instagram = igOk ? relInstagram(todas, periodo) : null;
  const google = gbpOk ? relGoogle(gbp, periodo) : null;
  // IDs externos (campanha, anúncio, mídia) não saem daqui: a tela só precisa de uma chave estável para listar.
  if (anuncios) {
    anuncios.campanhas.forEach((c, i) => { c.id = `c${i}`; });
    anuncios.criativos.ranking.forEach((c, i) => { c.id = `a${i}`; });
    anuncios.anuncios.forEach((c, i) => { c.id = `t${i}`; });
  }
  instagram?.midias.forEach((m, i) => { m.id = `m${i}`; });
  // Defesa extra: o cliente nunca recebe o bloco técnico, mesmo que alguém mude o carregador.
  if (publico) delete publico.tecnico;
  return {
    estado, periodo, anuncios, instagram, gastoCiclo, publico, google,
    evolucao: { mes: evolucao([...todas, ...gbp], "mes" as Agrupamento, hoje, filtro), semana: evolucao([...todas, ...gbp], "semana" as Agrupamento, hoje, filtro) },
  };
}

async function nomeDoCliente(clientId: string): Promise<string | null> {
  const [r] = await rawQuery<{ name: string }>("select name from avanteza.clients where id = $1", [clientId]);
  return r?.name ?? null;
}
