// Serviço dos canais (servidor): escolhe a credencial de CADA fonte e expõe as operações usadas pelo administrador (testar, atualizar agora)
// e pela rotina diária. As duas fontes são independentes:
//   • anúncios  → Meta (token do cliente > token da plataforma, se autorizado) ou fixture de desenvolvimento;
//   • Instagram → Windsor.ai (chave do canal > WINDSOR_API_KEY da plataforma), Meta Graph (mesmo token da Meta) ou fixture.
import { spDate } from "@/lib/dates";
import { criarApiGraph, criarGraph, esconderToken } from "./graph";
import { canaisFixtureAtiva, criarApiFixture, criarWindsorFixture } from "./fixture";
import { coletarCanal, coletarTodos, mensagemSegura, type FabricaApi, type FabricaWindsor, type ResultadoColeta, type ResultadoFonte } from "./collect";
import { obterCanal, resolverChaveWindsor, resolverToken, salvarInfo, tokenDaPlataforma, type CanalRow } from "./store";
import { chaveWindsorDaPlataforma, criarWindsor, esconderChave, type FonteWindsor, type ResultadoTesteWindsor } from "./windsor";
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

export async function rotinaCanais(maxMs = 240_000) {
  return coletarTodos({ maxMs, apiPara: apiPadrao, windsorPara: windsorPadrao, incluirSemToken: canaisFixtureAtiva() });
}

export type FonteAtualizar = "ads" | "instagram" | "todas";
export interface OpcoesAtualizar { fonte?: FonteAtualizar; meta?: FabricaApi; windsor?: FabricaWindsor; maxMs?: number }

/** “Atualizar agora”: coleta + backfill de 90 dias, por fonte (anúncios, Instagram ou as duas), cada uma com a própria credencial e o próprio resultado. */
export async function atualizarAgora(clientId: string, o: OpcoesAtualizar = {}): Promise<{ ok: boolean; mensagem: string; resultado?: ResultadoColeta }> {
  const fonte = o.fonte ?? "todas";
  const canal = await obterCanal(clientId);
  if (!canal) return { ok: false, mensagem: "Configure o canal antes de atualizar." };
  if (canal.status === "desconectado") return { ok: false, mensagem: "O canal está desconectado." };
  const querAds = fonte !== "instagram", querIg = fonte !== "ads";
  const rotulo = fonte === "ads" ? "anúncios" : fonte === "instagram" ? "Instagram" : "canal";
  if (fonte === "ads" && !(canal.adsSource === "meta" && canal.adAccountId)) return { ok: false, mensagem: "A fonte de anúncios (Meta Ads) não está configurada." };
  if (fonte === "instagram" && canal.igSource === "none") return { ok: false, mensagem: "A fonte do Instagram não está configurada." };

  const precisaMeta = (querAds && canal.adsSource === "meta" && canal.adAccountId) || (querIg && canal.igSource === "meta" && canal.igUserId);
  const meta = precisaMeta ? await (o.meta ?? apiPadrao)(canal).catch(() => null) : null;
  const win = querIg && canal.igSource === "windsor" ? await (o.windsor ?? windsorPadrao)(canal).catch(() => null) : null;
  if (precisaMeta && !meta && !(querIg && win)) return { ok: false, mensagem: "Sem token da Meta: informe o token do cliente ou autorize o token da plataforma." };
  if (fonte === "instagram" && canal.igSource === "windsor" && !win) return { ok: false, mensagem: "Sem chave do Windsor.ai: informe a chave do canal ou configure WINDSOR_API_KEY na plataforma." };

  try {
    const r = await coletarCanal(canal, meta?.api ?? null, { dias: DIAS_BACKFILL, maxMs: o.maxMs ?? 100_000, fontes: fonte === "todas" ? undefined : [fonte] }, meta?.token ?? null, win);
    const n = Object.values(r.linhas).reduce((a, b) => a + b, 0);
    const detalhe = (f: ResultadoFonte | null, nome: string) => (f?.executada ? `${nome}: ${f.ok ? "ok" : "falhou"}` : f ? `${nome}: pulado (${f.motivoPulo})` : null);
    const partes = [detalhe(r.ads, "Anúncios"), detalhe(r.instagram, "Instagram")].filter(Boolean).join(" · ");
    if (!r.ok) return { ok: false, mensagem: `${r.erro ?? "A coleta não trouxe dados."}${partes ? ` (${partes})` : ""}`, resultado: r };
    return { ok: true, mensagem: `Coleta de ${rotulo} concluída: ${n} registros gravados (${partes})${r.avisos.length ? `; ${r.avisos.length} aviso(s): ${r.avisos.join(" · ").slice(0, 200)}` : ""}.`, resultado: r };
  } catch (e) {
    return { ok: false, mensagem: mensagemSegura(e, meta?.token ?? win?.chave) };
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
function semChave(): ResultadoTesteWindsor {
  return { ok: false, origemChave: "nenhuma", info: { contas: [], campos: [], dias: 0, midias: 0, seguidores: null }, verificacoes: [{ id: "chave", rotulo: "Chave do Windsor.ai", ok: false, detalhe: "Nenhuma chave disponível: cole a chave do Windsor.ai deste canal ou configure WINDSOR_API_KEY na plataforma (Vercel)." }] };
}

/** Estado seguro (sem segredo) da chave do Windsor, para a tela do administrador. */
export function origemChaveWindsor(canal: CanalRow | null, env: NodeJS.ProcessEnv = process.env): "canal" | "plataforma" | "ausente" {
  if (canal?.temChaveWindsor) return "canal";
  return chaveWindsorDaPlataforma(env) ? "plataforma" : "ausente";
}
export type { FonteInstagram };
