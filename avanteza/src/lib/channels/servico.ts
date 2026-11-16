// Serviço dos canais (servidor): escolhe a credencial (token do cliente > token da plataforma, se autorizado) ou a fixture de
// desenvolvimento, e expõe as operações usadas pelo administrador (testar, atualizar agora) e pela rotina diária.
import { spDate } from "@/lib/dates";
import { criarApiGraph, criarGraph, esconderToken } from "./graph";
import { canaisFixtureAtiva, criarApiFixture } from "./fixture";
import { coletarCanal, coletarTodos, mensagemSegura, type FabricaApi, type ResultadoColeta } from "./collect";
import { obterCanal, resolverToken, salvarInfo, tokenDaPlataforma, type CanalRow } from "./store";
import { DIAS_BACKFILL, type CanaisApi, type CanalConfig, type ResultadoTeste } from "./types";

/** Fábrica padrão: fixture (só desenvolvimento) ou Graph real com o token resolvido. Sem credencial: null. */
export const apiPadrao: FabricaApi = async (canal: CanalRow) => {
  if (canaisFixtureAtiva()) return { api: criarApiFixture(spDate()), token: null };
  const t = await resolverToken(canal.clientId);
  if (!t) return null;
  return { api: criarApiGraph(criarGraph({ token: t.token })), token: t.token };
};

export async function rotinaCanais(maxMs = 240_000) {
  return coletarTodos({ maxMs, apiPara: apiPadrao, incluirSemToken: canaisFixtureAtiva() });
}

/** “Atualizar agora”: coleta + backfill de 90 dias. */
export async function atualizarAgora(clientId: string, apiPara: FabricaApi = apiPadrao, maxMs = 100_000): Promise<{ ok: boolean; mensagem: string; resultado?: ResultadoColeta }> {
  const canal = await obterCanal(clientId);
  if (!canal) return { ok: false, mensagem: "Conecte a Meta antes de atualizar." };
  if (canal.status === "desconectado") return { ok: false, mensagem: "O canal está desconectado." };
  const f = await apiPara(canal).catch(() => null);
  if (!f) return { ok: false, mensagem: "Sem token: informe o token do cliente ou autorize o token da plataforma." };
  try {
    const r = await coletarCanal(canal, f.api, { dias: DIAS_BACKFILL, maxMs }, f.token);
    const n = Object.values(r.linhas).reduce((a, b) => a + b, 0);
    if (!r.ok) return { ok: false, mensagem: r.erro ?? "A coleta não trouxe dados.", resultado: r };
    return { ok: true, mensagem: `Coleta concluída: ${n} registros gravados${r.avisos.length ? ` (${r.avisos.length} aviso(s): ${r.avisos.join(" · ").slice(0, 200)})` : ""}.`, resultado: r };
  } catch (e) {
    return { ok: false, mensagem: mensagemSegura(e, f.token) };
  }
}

export interface EntradaTeste {
  clientId: string;
  cfg: Pick<CanalConfig, "adAccountId" | "campaignIds" | "igUserId" | "pageId">;
  /** Token digitado no formulário (não salvo). Tem prioridade. */
  tokenDigitado?: string | null;
  usarTokenPlataforma: boolean;
}

/** Testa a conexão só com GET. Devolve apenas o diagnóstico (nunca o token). */
export async function testarConexaoCanal(e: EntradaTeste): Promise<ResultadoTeste> {
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
  const seguro: ResultadoTeste = {
    ...r, origemToken: origem,
    verificacoes: r.verificacoes.map((v) => ({ ...v, detalhe: esconderToken(v.detalhe, token) })),
  };
  if (origem === "plataforma") {
    const c = seguro.verificacoes.find((v) => v.id === "conta");
    if (c) c.detalhe = c.ok ? `O token da plataforma (META_ACCESS_TOKEN) enxerga a conta. ${c.detalhe}` : `O token da plataforma (META_ACCESS_TOKEN) NÃO enxerga esta conta. ${c.detalhe}`;
  }
  if (seguro.ok && Object.keys(seguro.info).length) await salvarInfo(e.clientId, seguro.info).catch(() => undefined);
  return seguro;
}
