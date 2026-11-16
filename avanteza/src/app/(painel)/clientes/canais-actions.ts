"use server";
// Ações administrativas dos Canais (Meta somente leitura). Escrita só para administradores (requireOwner); revisor só lê.
// O token chega por formulário, é cifrado em src/lib/channels/store.ts e NUNCA volta para a tela, para logs ou para a auditoria
// (a auditoria registra só "token trocado: sim/não" e o hint de 4 caracteres do que já está salvo).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import { desconectarCanal, obterCanal, salvarCanal } from "@/lib/channels/store";
import { atualizarAgora, testarConexaoCanal } from "@/lib/channels/servico";
import type { ResultadoTeste } from "@/lib/channels/types";
import { lerCamposCanal } from "@/lib/channels/form";

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

export async function salvarCanalMeta(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = lerCamposCanal(fd);
  if ("erro" in r) voltar(clientId, r.erro, "erro");
  const c = r.campos;
  if (!c.adAccountId && !c.igUserId) voltar(clientId, "Informe a conta de anúncios e/ou o ID do Instagram.", "erro");
  try {
    const canal = await salvarCanal(clientId, c);
    await auditar(actor, "channel_saved", clientId, { token_trocado: Boolean(c.token), token_hint: canal.tokenHint, conta: Boolean(c.adAccountId), instagram: Boolean(c.igUserId), plataforma: c.usarTokenPlataforma });
  } catch (e) {
    // ENCRYPTION_KEY ausente, por exemplo. Nunca ecoar o token.
    voltar(clientId, e instanceof Error && /ENCRYPTION_KEY/.test(e.message) ? "ENCRYPTION_KEY não configurada: não é possível guardar o token." : "Não foi possível salvar o canal.", "erro");
  }
  voltar(clientId, c.token ? "Canal salvo. O token foi guardado criptografado e não será mostrado de novo." : "Canal salvo.");
}

export type EstadoTeste = { resultado?: ResultadoTeste; erro?: string } | null;

/** Testa a conexão (só GET) com o que está no formulário: token digitado > token salvo > token da plataforma (se marcado). */
export async function testarConexaoMeta(_prev: EstadoTeste, fd: FormData): Promise<EstadoTeste> {
  await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const r = lerCamposCanal(fd);
  if ("erro" in r) return { erro: r.erro };
  try {
    const resultado = await testarConexaoCanal({
      clientId, tokenDigitado: r.campos.token, usarTokenPlataforma: r.campos.usarTokenPlataforma,
      cfg: { adAccountId: r.campos.adAccountId, campaignIds: r.campos.campaignIds, igUserId: r.campos.igUserId, pageId: r.campos.pageId },
    });
    return { resultado };
  } catch {
    return { erro: "Não foi possível testar agora. Tente novamente." };
  }
}

export async function atualizarCanalAgora(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const r = await atualizarAgora(clientId);
  await auditar(actor, "channel_sync_now", clientId, { ok: r.ok, linhas: r.resultado?.linhas ?? null });
  voltar(clientId, r.mensagem, r.ok ? "ok" : "erro");
}

export async function desconectarCanalMeta(fd: FormData) {
  const actor = await requireOwner();
  const clientId = idDoForm(fd);
  const antes = await obterCanal(clientId);
  await desconectarCanal(clientId);
  await auditar(actor, "channel_disconnected", clientId, { token_hint: antes?.tokenHint ?? null });
  voltar(clientId, "Canal desconectado: o token foi apagado. O histórico já coletado continua guardado.");
}
