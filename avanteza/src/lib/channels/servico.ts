// Serviço dos canais (servidor): escolhe a credencial de CADA fonte e expõe as operações usadas pelo administrador (testar, atualizar agora)
// e pela rotina diária. As duas fontes são independentes:
//   • anúncios  → Meta (token do cliente > token da plataforma, se autorizado) ou fixture de desenvolvimento;
//   • Instagram → Windsor.ai (chave do canal > WINDSOR_API_KEY da plataforma), Meta Graph (mesmo token da Meta) ou fixture.
import { spDate } from "@/lib/dates";
import { criarApiGraph, criarGraph, esconderToken } from "./graph";
import { canaisFixtureAtiva, criarApiFixture, criarWindsorFixture } from "./fixture";
import { coletarCanal, coletarTodos, mensagemSegura, type FabricaApi, type FabricaWindsor, type FabricaWindsorAds, type ResultadoColeta, type ResultadoFonte } from "./collect";
import { verificarAlertasGasto } from "./alerta-gasto";
import { listarCanaisParaColeta, obterCanal, resolverChaveWindsor, resolverToken, salvarInfo, tokenDaPlataforma, type CanalRow } from "./store";
import { criarWindsorAds, type ResultadoTesteWindsorAds } from "./windsor-ads";
import { chaveWindsorAdsDaPlataforma, chaveWindsorDaPlataforma, criarWindsor, esconderChave, type FonteWindsor, type ResultadoTesteWindsor } from "./windsor";
import { coletarGoogle, coletarGoogleTodos, type FabricaGoogle } from "./gbp";
import { criarWindsorGbp, type FonteGoogleApi, type ResultadoTesteGoogle } from "./windsor-gbp";
import { criarGoogleFixture } from "./fixture-gbp";
import { DIAS_BACKFILL, PERMISSOES_ANUNCIOS, PERMISSOES_INSTAGRAM_META, type CanaisApi, type CanalConfig, type FonteInstagram, type ResultadoTeste } from "./types";

/** Fábrica padrão da Meta (anúncios e Instagram-Meta): fixture (só desenvolvimento) ou Graph real com o token resolvido. Sem credencial: null. */
export const apiPadrao: FabricaApi = async (canal: CanalRow) => {
  if (canaisFixtureAtiva()) return { api: criarApiFixture(spDate()), token: null };
  const t = await resolverToken(canal.clientId);
  if (!t) return null;
  return { api: criarApiGraph(criarGraph({ token: t.token })), token: t.token };
};

/** Fábrica padrão do Windsor (Instagram): fixture (só desenvolvimento) ou Windsor real com a chave do canal ou WINDSOR_API_KEY. Sem chave: null. */
export const windsorPadrao: FabricaWindsor = async (canal: CanalRow) => {
  if (canaisFixtureAtiva()) return { fonte: criarWindsorFixture(spDate()), chave: null };
  const k = await resolverChaveWindsor(canal.clientId);
  if (!k) return null;
  return { fonte: criarWindsor({ chave: k.chave, accountName: canal.windsorAccountName }), chave: k.chave };
};

/**
 * Chave dos ANÚNCIOS pelo Windsor: WINDSOR_ADS_API_KEY (conta Windsor da agência) e, só se ela não existir, a chave atual
 * (do canal > WINDSOR_API_KEY). O Instagram nunca usa WINDSOR_ADS_API_KEY. Só para uso interno do servidor.
 */
export async function resolverChaveWindsorAds(clientId: string, env: NodeJS.ProcessEnv = process.env): Promise<{ chave: string; origem: "anuncios" | "canal" | "plataforma" } | null> {
  const ads = chaveWindsorAdsDaPlataforma(env);
  if (ads) return { chave: ads, origem: "anuncios" };
  return resolverChaveWindsor(clientId, env);
}

/** Fábrica padrão do Windsor (anúncios, conector facebook): fixture (só desenvolvimento) ou Windsor real com a chave dos anúncios. Sem chave: null. */
export const windsorAdsPadrao: FabricaWindsorAds = async (canal: CanalRow) => {
  if (canaisFixtureAtiva()) return { api: criarApiFixture(spDate()), chave: null };
  const k = await resolverChaveWindsorAds(canal.clientId);
  if (!k) return null;
  return { api: criarWindsorAds({ chave: k.chave, contaId: canal.adAccountId, campaignIds: canal.campaignIds, campaignNameFilter: canal.campaignNameFilter, resultActionType: canal.resultActionType }), chave: k.chave };
};

/** Fábrica padrão do Google (Perfil da Empresa): fixture (só desenvolvimento) ou Windsor real com a MESMA chave do Instagram (canal > WINDSOR_API_KEY). */
export const googlePadrao: FabricaGoogle = async (canal: CanalRow) => {
  if (canaisFixtureAtiva()) return { fonte: criarGoogleFixture(spDate(), canal.gbpLocationName), chave: null };
  const k = await resolverChaveWindsor(canal.clientId);
  if (!k) return null;
  return { fonte: criarWindsorGbp({ chave: k.chave, local: canal.gbpLocationName }), chave: k.chave };
};

/** Rotina diária completa (anúncios + Instagram, depois o Google com tempo próprio), seguida da checagem do alerta de recarga. */
export async function rotinaCanais(maxMs = 240_000, o: { google?: FabricaGoogle } = {}) {
  const inicio = Date.now();
  const coleta = await coletarTodos({ maxMs: Math.floor(maxMs * 0.8), apiPara: apiPadrao, windsorPara: windsorPadrao, windsorAdsPara: windsorAdsPadrao, incluirSemToken: canaisFixtureAtiva() });
  // Google: fonte independente; sempre tem ao menos 30 s, mesmo que anúncios/Instagram tenham usado todo o tempo deles.
  const google = await coletarGoogleTodos({ maxMs: Math.max(30_000, maxMs - (Date.now() - inicio)), fontePara: o.google ?? googlePadrao })
    .catch((e) => ({ erro: mensagemSegura(e) }));
  const alertas = await verificarAlertasGasto(spDate()).catch((e) => ({ erro: e instanceof Error ? e.message.slice(0, 200) : "falha" }));
  return { ...coleta, google, alertas };
}

/** “Atualizar Google agora”: backfill de 90 dias (visualizações, avaliações e buscas) só do Google, com a própria credencial e resultado. */
export async function atualizarGoogleAgora(clientId: string, o: { fonte?: FabricaGoogle; maxMs?: number; hoje?: string } = {}): Promise<{ ok: boolean; mensagem: string; linhas?: Record<string, number> }> {
  const canal = await obterCanal(clientId);
  if (!canal || canal.gbpSource !== "windsor") return { ok: false, mensagem: "O Google (Perfil da Empresa) não está configurado para este cliente." };
  if (canal.status === "desconectado") return { ok: false, mensagem: "O canal está desconectado." };
  const f = await (o.fonte ?? googlePadrao)(canal).catch(() => null);
  if (!f) return { ok: false, mensagem: "Sem chave do Windsor.ai: configure WINDSOR_API_KEY (a mesma conta Windsor do Instagram e do Perfil da Empresa) ou a chave do canal." };
  const r = await coletarGoogle(canal, f.fonte, f.chave, { hoje: o.hoje, dias: DIAS_BACKFILL, diasAvaliacoes: DIAS_BACKFILL, maxMs: o.maxMs ?? 90_000 });
  const n = Object.values(r.linhas).reduce((a, b) => a + b, 0);
  if (!r.ok) return { ok: false, mensagem: r.erro ?? "A coleta do Google não trouxe dados.", linhas: r.linhas };
  const partes = [`${r.linhas.gbp_daily ?? 0} dia(s)`, `${r.linhas.gbp_review ?? 0} avaliação(ões)`, `${r.linhas.gbp_keyword ?? 0} termo(s) de busca`].join(", ");
  return { ok: true, mensagem: `Google atualizado: ${n} registros (${partes})${r.avisos.length ? `; ${r.avisos.length} aviso(s): ${r.avisos.join(" · ").slice(0, 200)}` : ""}.`, linhas: r.linhas };
}

/** Testa o Perfil da Empresa no Windsor.ai (só GET): locais encontrados, dias, avaliações, nota e buscas. Nunca devolve a chave. */
export async function testarConexaoGoogle(e: { clientId: string; local: string | null; fonte?: FonteGoogleApi; hoje?: string }): Promise<ResultadoTesteGoogle> {
  let chave: string | null = null;
  let origem: ResultadoTesteGoogle["origemChave"] = "nenhuma";
  let fonte: FonteGoogleApi;
  if (e.fonte) fonte = e.fonte;
  else if (canaisFixtureAtiva()) fonte = criarGoogleFixture(spDate(), e.local);
  else {
    const k = await resolverChaveWindsor(e.clientId);
    if (!k) return { ok: false, origemChave: "nenhuma", info: { locais: [], local: null, dias: 0, visualizacoes: null, avaliacoes: 0, nota: null, totalAvaliacoes: null, palavras: 0 }, verificacoes: [{ id: "chave", rotulo: "Chave do Windsor.ai", ok: false, detalhe: "Nenhuma chave disponível: configure WINDSOR_API_KEY na plataforma (a mesma conta Windsor do Instagram) ou salve a chave do canal na seção do Instagram." }] };
    chave = k.chave; origem = k.origem;
    fonte = criarWindsorGbp({ chave, local: e.local, baseDelayMs: 300 });
  }
  const r = await fonte.testar(e.hoje);
  if (r.ok && r.info.local) await salvarInfo(e.clientId, { gbp_local: r.info.local }).catch(() => undefined);
  return { ...r, origemChave: origem, verificacoes: r.verificacoes.map((v) => ({ ...v, detalhe: esconderChave(v.detalhe, chave) })) };
}

export const DIAS_COLETA_LEVE = 3;
/**
 * Coleta LEVE (a cada 2 h): só o nível de campanha dos anúncios dos últimos 3 dias, só nos canais com alerta de recarga ligado
 * e que já tiveram a primeira coleta completa (o backfill continua com a rotina diária/“Atualizar agora”). Depois checa os alertas.
 */
export async function rotinaAnunciosLeve(o: { maxMs?: number; hoje?: string; meta?: FabricaApi; windsorAds?: FabricaWindsorAds; deps?: Parameters<typeof verificarAlertasGasto>[1] } = {}) {
  const hoje = o.hoje ?? spDate();
  const maxMs = o.maxMs ?? 120_000;
  const inicio = Date.now();
  const canais = (await listarCanaisParaColeta(canaisFixtureAtiva())).filter((c) => c.alertaGasto && (c.adsSource === "meta" || c.adsSource === "windsor") && c.adAccountId);
  const coleta: Array<{ clientId: string; ok?: boolean; linhas?: number; pulado?: string }> = [];
  for (const c of canais) {
    const sobra = maxMs - (Date.now() - inicio);
    if (sobra < 10_000) { coleta.push({ clientId: c.clientId, pulado: "tempo total esgotado" }); continue; }
    if (!c.lastSyncAt) { coleta.push({ clientId: c.clientId, pulado: "aguardando a primeira coleta completa" }); continue; }
    const doWindsor = c.adsSource === "windsor";
    const meta = doWindsor ? null : await (o.meta ?? apiPadrao)(c).catch(() => null);
    const winAds = doWindsor ? await (o.windsorAds ?? windsorAdsPadrao)(c).catch(() => null) : null;
    if (!meta && !winAds) { coleta.push({ clientId: c.clientId, pulado: "sem credencial" }); continue; }
    try {
      const r = await coletarCanal(c, meta?.api ?? null, { hoje, dias: DIAS_COLETA_LEVE, maxMs: Math.min(sobra, 45_000), fontes: ["ads"], soCampanhas: true }, meta?.token ?? null, null, winAds);
      coleta.push({ clientId: c.clientId, ok: r.ok, linhas: r.linhas.campaign_daily ?? 0 });
    } catch (e) {
      coleta.push({ clientId: c.clientId, pulado: `erro: ${mensagemSegura(e, meta?.token ?? winAds?.chave)}` });
    }
  }
  const alertas = await verificarAlertasGasto(hoje, o.deps ?? {});
  return { canais: canais.length, coleta, alertas };
}

/**
 * Coleta LEVE de UM cliente (depois de criar/alterar anúncios pelo conector): nível de campanha dos últimos 3 dias,
 * para o painel refletir a mudança. NÃO checa o alerta de recarga (sem e-mail).
 */
export async function coletaLeveDoCliente(clientId: string, o: { hoje?: string; meta?: FabricaApi; windsorAds?: FabricaWindsorAds } = {}): Promise<{ ok: boolean; motivo?: string }> {
  const c = await obterCanal(clientId);
  if (!c || !c.adAccountId || (c.adsSource !== "meta" && c.adsSource !== "windsor") || c.status === "desconectado") return { ok: false, motivo: "anúncios não configurados" };
  const doWindsor = c.adsSource === "windsor";
  const meta = doWindsor ? null : await (o.meta ?? apiPadrao)(c).catch(() => null);
  const winAds = doWindsor ? await (o.windsorAds ?? windsorAdsPadrao)(c).catch(() => null) : null;
  if (!meta && !winAds) return { ok: false, motivo: "sem credencial de leitura" };
  try {
    const r = await coletarCanal(c, meta?.api ?? null, { hoje: o.hoje ?? spDate(), dias: DIAS_COLETA_LEVE, maxMs: 30_000, fontes: ["ads"], soCampanhas: true }, meta?.token ?? null, null, winAds);
    return { ok: r.ok };
  } catch (e) {
    return { ok: false, motivo: mensagemSegura(e, meta?.token ?? winAds?.chave) };
  }
}

export type FonteAtualizar = "ads" | "instagram" | "todas";
export interface OpcoesAtualizar { fonte?: FonteAtualizar; meta?: FabricaApi; windsor?: FabricaWindsor; windsorAds?: FabricaWindsorAds; maxMs?: number }

/** “Atualizar agora”: coleta + backfill de 90 dias, por fonte (anúncios, Instagram ou as duas), cada uma com a própria credencial e o próprio resultado. */
export async function atualizarAgora(clientId: string, o: OpcoesAtualizar = {}): Promise<{ ok: boolean; mensagem: string; resultado?: ResultadoColeta }> {
  const fonte = o.fonte ?? "todas";
  const canal = await obterCanal(clientId);
  if (!canal) return { ok: false, mensagem: "Configure o canal antes de atualizar." };
  if (canal.status === "desconectado") return { ok: false, mensagem: "O canal está desconectado." };
  const querAds = fonte !== "instagram", querIg = fonte !== "ads";
  const rotulo = fonte === "ads" ? "anúncios" : fonte === "instagram" ? "Instagram" : "canal";
  if (fonte === "ads" && !((canal.adsSource === "meta" || canal.adsSource === "windsor") && canal.adAccountId)) return { ok: false, mensagem: "A fonte de anúncios (Meta Ads) não está configurada." };
  const adsWindsor = canal.adsSource === "windsor" && Boolean(canal.adAccountId);
  if (fonte === "instagram" && canal.igSource === "none") return { ok: false, mensagem: "A fonte do Instagram não está configurada." };

  const precisaMeta = (querAds && canal.adsSource === "meta" && canal.adAccountId) || (querIg && canal.igSource === "meta" && canal.igUserId);
  const meta = precisaMeta ? await (o.meta ?? apiPadrao)(canal).catch(() => null) : null;
  const win = querIg && canal.igSource === "windsor" ? await (o.windsor ?? windsorPadrao)(canal).catch(() => null) : null;
  const winAds = querAds && adsWindsor ? await (o.windsorAds ?? windsorAdsPadrao)(canal).catch(() => null) : null;
  if (fonte === "ads" && adsWindsor && !winAds) return { ok: false, mensagem: "Sem chave do Windsor.ai para anúncios: configure WINDSOR_ADS_API_KEY (conta Windsor da agência) na plataforma." };
  if (precisaMeta && !meta && !(querIg && win)) return { ok: false, mensagem: "Sem token da Meta: informe o token do cliente ou autorize o token da plataforma." };
  if (fonte === "instagram" && canal.igSource === "windsor" && !win) return { ok: false, mensagem: "Sem chave do Windsor.ai: informe a chave do canal ou configure WINDSOR_API_KEY na plataforma." };

  try {
    const r = await coletarCanal(canal, meta?.api ?? null, { dias: DIAS_BACKFILL, maxMs: o.maxMs ?? 100_000, fontes: fonte === "todas" ? undefined : [fonte] }, meta?.token ?? null, win, winAds);
    const n = Object.values(r.linhas).reduce((a, b) => a + b, 0);
    const detalhe = (f: ResultadoFonte | null, nome: string) => (f?.executada ? `${nome}: ${f.ok ? "ok" : "falhou"}` : f ? `${nome}: pulado (${f.motivoPulo})` : null);
    const partes = [detalhe(r.ads, "Anúncios"), detalhe(r.instagram, "Instagram")].filter(Boolean).join(" · ");
    if (!r.ok) return { ok: false, mensagem: `${r.erro ?? "A coleta não trouxe dados."}${partes ? ` (${partes})` : ""}`, resultado: r };
    return { ok: true, mensagem: `Coleta de ${rotulo} concluída: ${n} registros gravados (${partes})${r.avisos.length ? `; ${r.avisos.length} aviso(s): ${r.avisos.join(" · ").slice(0, 200)}` : ""}.`, resultado: r };
  } catch (e) {
    return { ok: false, mensagem: mensagemSegura(e, meta?.token ?? win?.chave ?? winAds?.chave) };
  }
}

// ─── Teste de conexão: Meta (anúncios ou Instagram-Meta) ─────────────────────

export interface EntradaTeste {
  clientId: string;
  cfg: Pick<CanalConfig, "adAccountId" | "campaignIds" | "igUserId" | "pageId">;
  /** Token digitado no formulário (não salvo). Tem prioridade. */
  tokenDigitado?: string | null;
  usarTokenPlataforma: boolean;
  /** Qual seção está testando: só aparecem as verificações e permissões dela. */
  escopo?: "ads" | "instagram";
}

/** Testa a conexão com a Meta só com GET. Devolve apenas o diagnóstico (nunca o token). */
export async function testarConexaoCanal(e: EntradaTeste): Promise<ResultadoTeste> {
  const escopo = e.escopo ?? "ads";
  let api: CanaisApi, origem: ResultadoTeste["origemToken"], token: string | null = null;
  if (canaisFixtureAtiva()) {
    api = criarApiFixture(spDate()); origem = "nenhum";
  } else {
    const digitado = e.tokenDigitado?.trim() || null;
    if (digitado) { token = digitado; origem = "cliente"; }
    else {
      const salvo = await resolverToken(e.clientId);
      if (salvo && (salvo.origem === "cliente" || e.usarTokenPlataforma)) { token = salvo.token; origem = salvo.origem; }
      else if (e.usarTokenPlataforma && tokenDaPlataforma()) { token = tokenDaPlataforma(); origem = "plataforma"; }
      else origem = "nenhum";
    }
    if (!token) {
      return { origemToken: "nenhum", ok: false, concedidas: [], faltando: [], info: {}, verificacoes: [{ id: "token", rotulo: "Token", ok: false, detalhe: "Nenhum token disponível: cole o token do cliente ou marque o uso do token da plataforma (META_ACCESS_TOKEN)." }] };
    }
    api = criarApiGraph(criarGraph({ token, pausaMs: 0 }));
  }
  const r = await api.testar(e.cfg);
  const ids = escopo === "ads" ? new Set(["token", "permissoes", "conta", "insights", "campanhas"]) : new Set(["token", "permissoes", "pagina", "instagram", "ig_insights"]);
  const relevantes = escopo === "ads" ? PERMISSOES_ANUNCIOS : PERMISSOES_INSTAGRAM_META;
  const faltando = r.faltando.filter((p) => (relevantes as readonly string[]).includes(p));
  const verificacoes = r.verificacoes.filter((v) => ids.has(v.id)).map((v) => ({ ...v, detalhe: esconderToken(v.detalhe, token) }));
  const perm = verificacoes.find((v) => v.id === "permissoes");
  if (perm && perm.ok === false) perm.ok = faltando.length === 0 ? true : false;
  if (perm && perm.ok) perm.detalhe = "Todas as permissões necessárias foram concedidas.";
  else if (perm && faltando.length) perm.detalhe = `Faltam: ${faltando.join(", ")}.`;
  const seguro: ResultadoTeste = { ...r, origemToken: origem, verificacoes, faltando, ok: verificacoes.every((v) => v.ok !== false) };
  if (origem === "plataforma") {
    const c = seguro.verificacoes.find((v) => v.id === "conta");
    if (c) c.detalhe = c.ok ? `O token da plataforma (META_ACCESS_TOKEN) enxerga a conta. ${c.detalhe}` : `O token da plataforma (META_ACCESS_TOKEN) NÃO enxerga esta conta. ${c.detalhe}`;
  }
  if (seguro.ok && Object.keys(seguro.info).length) await salvarInfo(e.clientId, seguro.info).catch(() => undefined);
  return seguro;
}

// ─── Teste de conexão: Windsor.ai (Instagram) ────────────────────────────────

export interface EntradaTesteWindsor {
  clientId: string;
  accountName: string | null;
  /** Chave digitada no formulário (não salva). Tem prioridade. */
  chaveDigitada?: string | null;
  /** Provider injetado (testes): ignora chave e rede. */
  fonte?: FonteWindsor;
}

/** Chama o Windsor.ai (só GET) e mostra contas, campos, dias e mídias lidas. Nunca devolve a chave. */
export async function testarConexaoWindsor(e: EntradaTesteWindsor): Promise<ResultadoTesteWindsor> {
  let chave: string | null = null;
  let origem: ResultadoTesteWindsor["origemChave"] = "nenhuma";
  let fonte: FonteWindsor;
  if (e.fonte) {
    fonte = e.fonte;
  } else if (canaisFixtureAtiva()) {
    fonte = criarWindsorFixture(spDate());
  } else {
    const digitada = e.chaveDigitada?.trim() || null;
    if (digitada) { chave = digitada; origem = "canal"; }
    else {
      const k = await resolverChaveWindsor(e.clientId);
      if (k) { chave = k.chave; origem = k.origem; }
      else if (chaveWindsorDaPlataforma()) { chave = chaveWindsorDaPlataforma(); origem = "plataforma"; }
    }
    if (!chave) return semChave();
    fonte = criarWindsor({ chave, accountName: e.accountName, baseDelayMs: 300 });
  }
  const r = await fonte.testar();
  if (r.ok && r.info.ig_username) await salvarInfo(e.clientId, { ig_username: r.info.ig_username }).catch(() => undefined);
  return {
    ...r, origemChave: origem,
    verificacoes: r.verificacoes.map((v) => ({ ...v, detalhe: esconderChave(v.detalhe, chave) })),
  };
}
// ─── Teste de conexão: Windsor.ai (anúncios, conector facebook) ──────────────

export interface EntradaTesteWindsorAds {
  clientId: string;
  contaId: string | null;
  campaignIds: string[];
  campaignNameFilter?: string | null;
  resultActionType?: string;
  chaveDigitada?: string | null;
  /** Provider injetado (testes): ignora chave e rede. */
  fonte?: { testar(): Promise<ResultadoTesteWindsorAds> };
}

/** Chama o Windsor.ai (só GET, conector facebook) e mostra conta, campanhas, gasto e resultados lidos. Nunca devolve a chave. */
export async function testarConexaoWindsorAds(e: EntradaTesteWindsorAds): Promise<ResultadoTesteWindsorAds> {
  let chave: string | null = null;
  let origem: ResultadoTesteWindsorAds["origemChave"] = "nenhuma";
  let fonte: { testar(): Promise<ResultadoTesteWindsorAds> };
  if (e.fonte) fonte = e.fonte;
  else if (canaisFixtureAtiva()) {
    fonte = { testar: async () => ({ ok: true, origemChave: "nenhuma", semConector: false, verificacoes: [{ id: "chave", rotulo: "Chave aceita pelo Windsor.ai", ok: true, detalhe: "Dados simulados (CHANNELS_FIXTURE): nenhuma chamada real ao Windsor.ai." }, { id: "contas", rotulo: "Contas de anúncios no Windsor.ai", ok: true, detalhe: "1 conta(s): Showman Barbearia · 605261696580859." }, { id: "campanhas", rotulo: "Campanhas", ok: true, detalhe: "1 campanha(s): SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km (120252388371430661)." }], info: { contas: [{ id: "605261696580859", nome: "Showman Barbearia" }], campanhas: [{ id: "120252388371430661", nome: "SHOW MAN | Assinatura R$69,90 | WhatsApp | Floresta 3km" }], anuncios: 6, gasto: null, resultados: null, comMiniatura: 0 } }) };
  } else {
    const digitada = e.chaveDigitada?.trim() || null;
    if (digitada) { chave = digitada; origem = "canal"; }
    else {
      const k = await resolverChaveWindsorAds(e.clientId);
      if (k) { chave = k.chave; origem = k.origem; }
      else if (chaveWindsorDaPlataforma()) { chave = chaveWindsorDaPlataforma(); origem = "plataforma"; }
    }
    if (!chave) return { ...semChaveAds(), origemChave: "nenhuma" };
    fonte = criarWindsorAds({ chave, contaId: e.contaId, campaignIds: e.campaignIds, campaignNameFilter: e.campaignNameFilter, resultActionType: e.resultActionType, baseDelayMs: 300 });
  }
  const r = await fonte.testar();
  return { ...r, origemChave: origem, verificacoes: r.verificacoes.map((v) => ({ ...v, detalhe: esconderChave(v.detalhe, chave) })) };
}
function semChaveAds(): ResultadoTesteWindsorAds {
  return { ok: false, origemChave: "nenhuma", semConector: false, info: { contas: [], campanhas: [], anuncios: 0, gasto: null, resultados: null, comMiniatura: 0 }, verificacoes: [{ id: "chave", rotulo: "Chave do Windsor.ai", ok: false, detalhe: "Nenhuma chave disponível: configure WINDSOR_ADS_API_KEY (conta Windsor da agência) na plataforma (Vercel). Sem ela, valem a chave do canal ou WINDSOR_API_KEY." }] };
}

function semChave(): ResultadoTesteWindsor {
  return { ok: false, origemChave: "nenhuma", info: { contas: [], campos: [], dias: 0, midias: 0, seguidores: null }, verificacoes: [{ id: "chave", rotulo: "Chave do Windsor.ai", ok: false, detalhe: "Nenhuma chave disponível: cole a chave do Windsor.ai deste canal ou configure WINDSOR_API_KEY na plataforma (Vercel)." }] };
}

/** Estado seguro (sem segredo) da chave dos ANÚNCIOS pelo Windsor, para a tela do administrador. */
export function origemChaveWindsorAds(canal: CanalRow | null, env: NodeJS.ProcessEnv = process.env): "anuncios" | "canal" | "plataforma" | "ausente" {
  return chaveWindsorAdsDaPlataforma(env) ? "anuncios" : origemChaveWindsor(canal, env);
}

/** Estado seguro (sem segredo) da chave do Windsor, para a tela do administrador. */
export function origemChaveWindsor(canal: CanalRow | null, env: NodeJS.ProcessEnv = process.env): "canal" | "plataforma" | "ausente" {
  if (canal?.temChaveWindsor) return "canal";
  return chaveWindsorDaPlataforma(env) ? "plataforma" : "ausente";
}
export type { FonteInstagram };
