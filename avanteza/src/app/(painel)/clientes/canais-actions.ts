"use server";
// Ações administrativas dos Canais (somente leitura nas plataformas). Escrita só para administradores (requireOwner); revisor só lê.
// DUAS FONTES, cada uma com as próprias ações: anúncios (Meta Ads) e Instagram (Windsor.ai ou Meta). Token e chave chegam por formulário,
// são cifrados em src/lib/channels/store.ts e NUNCA voltam para a tela, para logs ou para a auditoria (a auditoria registra só
// "trocado: sim/não" e o hint de 4 caracteres do que já está salvo).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import { desconectarFonte, desconectarGoogle, obterCanal, salvarAnuncios, salvarGoogle, salvarInstagram } from "@/lib/channels/store";
import { atualizarAgora, atualizarGoogleAgora, testarConexaoGoogle, testarConexaoCanal, testarConexaoWindsor, testarConexaoWindsorAds } from "@/lib/channels/servico";
import type { ResultadoTeste } from "@/lib/channels/types";
import type { ResultadoTesteWindsor } from "@/lib/channels/windsor";
import type { ResultadoTesteWindsorAds } from "@/lib/channels/windsor-ads";
import { lerCamposAnuncios, lerCamposGoogle, lerCamposInstagram } from "@/lib/channels/form";
import type { ResultadoTesteGoogle } from "@/lib/channels/windsor-gbp";
import { lerCamposAlerta, reiniciarContagem, salvarAlertaGasto, verificarAlertasGasto } from "@/lib/channels/alerta-gasto";
import { spDate } from "@/lib/dates";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function voltar(clientId: string, msg: string, tipo: "ok" | "erro" = "ok"): never {
  revalidatePath(`/clientes/${clientId}`);
  redirect(`/clientes/${clientId}?aba=canais&${tipo}=${encodeURIComponent(msg)}`);
}
function idDoForm(fd: FormData): string {
  const id = str(fd, "client_id");
  if (!UUID.test(id)) redirect("/clientes?erro=Cliente inválido");
  return id;
}
async function auditar(actor: string, event: string, clientId: string, details: Record<string, unknown> = {}) {
  await adminDb().from("audit_log").insert({ event, actor, client_id: clientId, details });
}
const erroDeSalvar = (e: unknown, o: string) => (e instanceof Error && /ENCRYPTION_KEY/.test(e.message) ? `ENCRYPTION_KEY não configurada: não é possível guardar ${o}.` : "Não foi possível salvar o canal.");

// ─── Fonte 1: anúncios (Meta Ads) ────────────────────────────────────────────

export async function salvarAnunciosMeta(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = lerCamposAnuncios(fd);
  if ("erro" in r) voltar(clientId, r.erro, "erro");
  const c = r.campos;
  try {
    const canal = await salvarAnuncios(clientId, c);
    await auditar(actor, "channel_ads_saved", clientId, { token_trocado: Boolean(c.token), token_hint: canal.tokenHint, fonte: c.adsSource, conta: Boolean(c.adAccountId), plataforma: c.usarTokenPlataforma, campanhas: c.campaignIds.length, filtro_nome: c.campaignNameFilter });
  } catch (e) {
    voltar(clientId, erroDeSalvar(e, "o token"), "erro"); // nunca ecoar o token
  }
  voltar(clientId, c.token ? "Anúncios salvos. O token foi guardado criptografado e não será mostrado de novo." : "Anúncios salvos.");
}

export type EstadoTeste = { resultado?: ResultadoTeste; erro?: string } | null;

/** Testa a conexão com a Meta (só GET) com o que está no formulário: token digitado > token salvo > token da plataforma (se marcado). `escopo` = anúncios ou Instagram-Meta. */
export async function testarConexaoMeta(_prev: EstadoTeste, fd: FormData): Promise<EstadoTeste> {
  await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const escopo = str(fd, "escopo") === "instagram" ? "instagram" : "ads";
  try {
    if (escopo === "ads") {
      const r = lerCamposAnuncios(fd);
      if ("erro" in r) return { erro: r.erro };
      return { resultado: await testarConexaoCanal({ clientId, escopo, tokenDigitado: r.campos.token, usarTokenPlataforma: r.campos.usarTokenPlataforma, cfg: { adAccountId: r.campos.adAccountId, campaignIds: r.campos.campaignIds, igUserId: null, pageId: null } }) };
    }
    const r = lerCamposInstagram(fd);
    if ("erro" in r) return { erro: r.erro };
    const canal = await obterCanal(clientId);
    // O Instagram pela Meta usa o MESMO token da Meta (do cliente ou da plataforma) já configurado em “Tráfego (anúncios)”.
    return { resultado: await testarConexaoCanal({ clientId, escopo, tokenDigitado: null, usarTokenPlataforma: canal?.usarTokenPlataforma ?? false, cfg: { adAccountId: null, campaignIds: [], igUserId: r.campos.igUserId, pageId: r.campos.pageId } }) };
  } catch {
    return { erro: "Não foi possível testar agora. Tente novamente." };
  }
}

export type EstadoTesteWindsorAds = { resultado?: ResultadoTesteWindsorAds; erro?: string } | null;

/** Testa os anúncios pelo Windsor.ai (só GET, conector facebook): conta, campanhas, gasto e resultados lidos. Sem o conector ligado, explica como conectar. */
export async function testarConexaoWindsorAdsAcao(_prev: EstadoTesteWindsorAds, fd: FormData): Promise<EstadoTesteWindsorAds> {
  await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const r = lerCamposAnuncios(fd);
  if ("erro" in r) return { erro: r.erro };
  try {
    return { resultado: await testarConexaoWindsorAds({ clientId, contaId: r.campos.adAccountId, campaignIds: r.campos.campaignIds, campaignNameFilter: r.campos.campaignNameFilter, resultActionType: r.campos.resultActionType }) };
  } catch {
    return { erro: "Não foi possível testar agora. Tente novamente." };
  }
}

export async function atualizarAnunciosAgora(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = await atualizarAgora(clientId, { fonte: "ads" });
  await auditar(actor, "channel_sync_now", clientId, { fonte: "ads", ok: r.ok, linhas: r.resultado?.linhas ?? null });
  // Com dados novos, o alerta de recarga é checado na hora (idempotente: cada nível sai uma vez por ciclo).
  const chk = r.ok ? await verificarAlertasGasto(spDate(), { clientId }).catch(() => null) : null;
  const enviados = chk?.detalhes[0]?.enviados ?? [];
  voltar(clientId, `${r.mensagem}${enviados.length ? ` Alerta de recarga disparado (${enviados.includes("limite") ? "100%" : "aviso"}).` : ""}`, r.ok ? "ok" : "erro");
}

export async function desconectarAnuncios(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const antes = await obterCanal(clientId);
  await desconectarFonte(clientId, "ads");
  await auditar(actor, "channel_ads_disconnected", clientId, { token_hint: antes?.tokenHint ?? null });
  voltar(clientId, "Anúncios desconectados: o token da Meta foi apagado. O histórico já coletado continua guardado. O Instagram não foi alterado.");
}

// ─── Fonte 2: mídias/Instagram (Windsor.ai ou Meta) ──────────────────────────

export async function salvarInstagramCanal(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = lerCamposInstagram(fd);
  if ("erro" in r) voltar(clientId, r.erro, "erro");
  const c = r.campos;
  try {
    const canal = await salvarInstagram(clientId, c);
    await auditar(actor, "channel_instagram_saved", clientId, { fonte: c.igSource, chave_trocada: Boolean(c.windsorKey), chave_hint: canal.chaveWindsorHint, conta_filtrada: Boolean(c.windsorAccountName) });
  } catch (e) {
    voltar(clientId, erroDeSalvar(e, "a chave"), "erro"); // nunca ecoar a chave
  }
  voltar(clientId, c.windsorKey ? "Instagram salvo. A chave do Windsor.ai foi guardada criptografada e não será mostrada de novo." : "Instagram salvo.");
}

export type EstadoTesteWindsor = { resultado?: ResultadoTesteWindsor; erro?: string } | null;

/** Testa o Windsor.ai (só GET): contas/@ encontrados, campos com dados, dias e mídias lidas. Chave digitada > chave do canal > WINDSOR_API_KEY. */
export async function testarConexaoWindsorAcao(_prev: EstadoTesteWindsor, fd: FormData): Promise<EstadoTesteWindsor> {
  await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const r = lerCamposInstagram(fd);
  if ("erro" in r) return { erro: r.erro };
  try {
    return { resultado: await testarConexaoWindsor({ clientId, accountName: r.campos.windsorAccountName, chaveDigitada: r.campos.windsorKey }) };
  } catch {
    return { erro: "Não foi possível testar agora. Tente novamente." };
  }
}

export async function atualizarInstagramAgora(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = await atualizarAgora(clientId, { fonte: "instagram" });
  await auditar(actor, "channel_sync_now", clientId, { fonte: "instagram", ok: r.ok, linhas: r.resultado?.linhas ?? null });
  voltar(clientId, r.mensagem, r.ok ? "ok" : "erro");
}

export async function desconectarInstagram(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const antes = await obterCanal(clientId);
  await desconectarFonte(clientId, "instagram");
  await auditar(actor, "channel_instagram_disconnected", clientId, { chave_hint: antes?.chaveWindsorHint ?? null });
  voltar(clientId, "Instagram desconectado: a chave do canal foi apagada. O histórico já coletado continua guardado. Os anúncios não foram alterados.");
}

// ─── Fonte 3: Google · Perfil da Empresa (Windsor.ai) ───────────────────────

export async function salvarGoogleCanal(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = lerCamposGoogle(fd);
  if ("erro" in r) voltar(clientId, r.erro, "erro");
  try {
    await salvarGoogle(clientId, r.campos);
    await auditar(actor, "channel_google_saved", clientId, { fonte: r.campos.gbpSource, local: r.campos.gbpLocationName });
  } catch {
    voltar(clientId, "Não foi possível salvar o Google.", "erro");
  }
  voltar(clientId, r.campos.gbpSource === "none" ? "Google desligado." : "Google (Perfil da Empresa) salvo. Use “Atualizar Google agora” para trazer os últimos 90 dias.");
}

export type EstadoTesteGoogle = { resultado?: ResultadoTesteGoogle; erro?: string } | null;

/** Testa o Perfil da Empresa no Windsor.ai (só GET) com o nome do local do formulário. Usa a mesma chave do Instagram (canal > WINDSOR_API_KEY). */
export async function testarConexaoGoogleAcao(_prev: EstadoTesteGoogle, fd: FormData): Promise<EstadoTesteGoogle> {
  await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const r = lerCamposGoogle(fd);
  if ("erro" in r) return { erro: r.erro };
  try {
    return { resultado: await testarConexaoGoogle({ clientId, local: r.campos.gbpLocationName }) };
  } catch {
    return { erro: "Não foi possível testar agora. Tente novamente." };
  }
}

export async function atualizarGoogleAgoraAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = await atualizarGoogleAgora(clientId);
  await auditar(actor, "channel_sync_now", clientId, { fonte: "google", ok: r.ok, linhas: r.linhas ?? null });
  voltar(clientId, r.mensagem, r.ok ? "ok" : "erro");
}

export async function desconectarGoogleAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  await desconectarGoogle(clientId);
  await auditar(actor, "channel_google_disconnected", clientId, {});
  voltar(clientId, "Google desconectado. O histórico já coletado (inclusive as avaliações) continua guardado. Anúncios e Instagram não foram alterados.");
}

// ─── Alerta de recarga (gasto acumulado das campanhas filtradas) ─────────────

export async function salvarAlertaGastoAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = lerCamposAlerta(fd);
  if ("erro" in r) voltar(clientId, r.erro, "erro");
  const antes = await obterCanal(clientId);
  if (!antes) voltar(clientId, "Configure os anúncios do canal antes do alerta.", "erro");
  await salvarAlertaGasto(clientId, r.campos);
  await auditar(actor, "spend_alert_config", clientId, { antes: antes.alertaGasto, depois: r.campos });
  // Checa já (idempotente): se o ciclo já passou de um nível, o aviso sai agora em vez de esperar a próxima rotina.
  const chk = r.campos ? await verificarAlertasGasto(spDate(), { clientId }).catch(() => null) : null;
  const enviados = chk?.detalhes[0]?.enviados ?? [];
  voltar(clientId, !r.campos ? "Alerta de recarga desligado." : `Alerta de recarga salvo.${enviados.length ? ` Aviso disparado agora (${enviados.includes("limite") ? "100%" : `${r.campos.avisoPct}%`}).` : ""}`);
}

export async function reiniciarContagemAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const hoje = spDate();
  const r = await reiniciarContagem(clientId, hoje);
  if (!r) voltar(clientId, "O alerta de recarga não está ligado para este cliente.", "erro");
  await auditar(actor, "spend_alert_reset", clientId, { antes: r.antes, depois: hoje });
  voltar(clientId, `Recarga registrada: a contagem recomeçou hoje (${hoje.split("-").reverse().join("/")}) e os avisos de 80% e 100% voltaram a valer.`);
}
