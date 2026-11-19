"use server";
// Ações administrativas do Mapa. Escrita só para administradores (requireOwner); o revisor só lê.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireOwner, requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import { canPreviewClients, canUseApp, VIEW_COOKIE, VIEW_TTL_S, signViewToken } from "@/lib/session";
import { generatePlanFor, createClientUser, resetClientUserPassword, setClientUserActive, setCompanyLink } from "@/lib/mapa/admin";
import { ingestMeeting, saveMeetingManual, type NewAction } from "@/lib/mapa/meetings";
import { isDateStr } from "@/lib/mapa/plan";
import { enviarBoasVindas } from "@/lib/mapa/boas-vindas";
import { obterCanal } from "@/lib/channels/store";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(clientId: string, aba: string, msg: string, kind: "ok" | "erro" = "ok"): never {
  revalidatePath(`/clientes/${clientId}`);
  redirect(`/clientes/${clientId}?aba=${aba}&${kind}=${encodeURIComponent(msg)}`);
}
function needId(fd: FormData): string {
  const id = str(fd, "client_id");
  if (!UUID.test(id)) redirect("/clientes?erro=Cliente inválido");
  return id;
}
async function audit(actor: string, event: string, clientId: string, details: Record<string, unknown> = {}) {
  await adminDb().from("audit_log").insert({ event, actor, client_id: clientId, details });
}

// ───── Dados do cliente / contato ─────
export async function saveClientMapa(fd: FormData) {
  const actor = await requireOwner();
  const id = needId(fd);
  const start = str(fd, "start_date");
  const slug = str(fd, "slug").toLowerCase();
  if (start && !isDateStr(start)) back(id, "contato", "Data de início inválida.", "erro");
  if (slug && !/^[a-z0-9-]{2,60}$/.test(slug)) back(id, "contato", "Slug: só letras minúsculas, números e hífen.", "erro");
  const kind = str(fd, "kind");
  if (!["marketplace", "midia", "ambos"].includes(kind)) back(id, "contato", "Tipo inválido.", "erro");
  const { error } = await adminDb().from("clients").update({
    name: str(fd, "name") || undefined,
    slug: slug || null,
    kind,
    start_date: start || null,
    drive_folder_id: str(fd, "drive_folder_id") || null,
    group_slug: str(fd, "group_slug").toLowerCase() || null,
    owner_name: str(fd, "owner_name") || null,
    contact_name: str(fd, "contact_name") || null,
    contact_email: str(fd, "contact_email") || null,
    contact_phone: str(fd, "contact_phone") || null,
    active: fd.get("active") === "on",
  }).eq("id", id);
  if (error) back(id, "contato", error.message, "erro");
  await audit(actor, "client_updated", id, { kind, start });
  back(id, "contato", "Dados salvos.");
}

// ───── Plano ─────
export async function gerarPlano(fd: FormData) {
  const actor = await requireOwner();
  const id = needId(fd);
  let msg: string, ok = true;
  try {
    const r = await generatePlanFor(id, { regenerate: fd.get("regenerate") === "on", startDate: str(fd, "start_date") || undefined });
    await audit(actor, "plan_generated", id, r);
    msg = `Plano gerado: ${r.phases} fases e ${r.actions} ações.`;
  } catch (e) {
    msg = errMsg(e);
    ok = false;
  }
  back(id, "plano", msg, ok ? "ok" : "erro");
}

const STATUS = ["planejada", "em_execucao", "concluida", "bloqueada"];
export async function salvarAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const actionId = str(fd, "action_id");
  const title = str(fd, "title");
  const status = str(fd, "status") || "planejada";
  const owner = str(fd, "owner") || "avanteza";
  const due = str(fd, "due_date");
  const phase = str(fd, "phase_id");
  if (!title) back(clientId, "plano", "Informe o título da ação.", "erro");
  if (!STATUS.includes(status) || !["avanteza", "cliente"].includes(owner)) back(clientId, "plano", "Valores inválidos.", "erro");
  if (due && !isDateStr(due)) back(clientId, "plano", "Prazo inválido.", "erro");
  const db = adminDb();
  if (phase) {
    const { data: ph } = await db.from("plan_phases").select("id").eq("id", phase).eq("client_id", clientId).maybeSingle();
    if (!ph) back(clientId, "plano", "Fase de outro cliente.", "erro");
  }
  const row = { title, description: str(fd, "description") || null, status, owner, due_date: due || null, phase_id: phase || null, completed_at: status === "concluida" ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
  const { error } = actionId
    ? await db.from("plan_actions").update(row).eq("id", actionId).eq("client_id", clientId)
    : await db.from("plan_actions").insert({ ...row, client_id: clientId, origin: "manual" });
  if (error) back(clientId, "plano", error.message, "erro");
  await audit(actor, actionId ? "plan_action_updated" : "plan_action_created", clientId, { title, status });
  back(clientId, "plano", actionId ? "Ação salva." : "Ação criada.");
}

export async function excluirAcao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  await adminDb().from("plan_actions").delete().eq("id", str(fd, "action_id")).eq("client_id", clientId);
  await audit(actor, "plan_action_deleted", clientId);
  back(clientId, "plano", "Ação excluída.");
}

export async function salvarFase(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const name = str(fd, "name");
  if (!name) back(clientId, "plano", "Informe o nome da fase.", "erro");
  await adminDb().from("plan_phases").update({ name, description: str(fd, "description") || null }).eq("id", str(fd, "phase_id")).eq("client_id", clientId);
  await audit(actor, "plan_phase_updated", clientId, { name });
  back(clientId, "plano", "Fase salva.");
}

// ───── Arquivos ─────
export async function salvarArquivo(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const title = str(fd, "title"), url = str(fd, "url"), date = str(fd, "file_date");
  if (!title || !/^https?:\/\//i.test(url)) back(clientId, "arquivos", "Informe título e um link http(s).", "erro");
  if (date && !isDateStr(date)) back(clientId, "arquivos", "Data inválida.", "erro");
  const { error } = await adminDb().from("client_files").insert({ client_id: clientId, title, url, kind: str(fd, "kind") || "outro", file_date: date || null, drive_file_id: str(fd, "drive_file_id") || null, visible: true });
  if (error) back(clientId, "arquivos", error.message, "erro");
  await audit(actor, "client_file_added", clientId, { title });
  back(clientId, "arquivos", "Arquivo adicionado.");
}
export async function alternarArquivo(fd: FormData) {
  await requireOwner();
  const clientId = needId(fd);
  await adminDb().from("client_files").update({ visible: str(fd, "visible") === "1" }).eq("id", str(fd, "file_id")).eq("client_id", clientId);
  back(clientId, "arquivos", "Visibilidade atualizada.");
}
export async function excluirArquivo(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  await adminDb().from("client_files").delete().eq("id", str(fd, "file_id")).eq("client_id", clientId);
  await audit(actor, "client_file_deleted", clientId);
  back(clientId, "arquivos", "Arquivo removido.");
}

// ───── Reuniões ─────
export async function registrarReuniao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const date = str(fd, "held_at");
  let msg: string, ok = true;
  try {
    const r = await ingestMeeting({
      clientId,
      title: str(fd, "title"),
      heldAt: date ? `${date}T12:00:00-03:00` : "",
      recordingUrl: str(fd, "recording_url") || null,
      transcriptUrl: str(fd, "transcript_url") || null,
      transcript: str(fd, "transcript") || null,
    });
    await audit(actor, "meeting_ingested", clientId, { status: r.status, actions: r.actionsCreated });
    ok = r.status !== "erro";
    msg = r.status === "analisada" ? `Reunião analisada: ${r.actionsCreated} ação(ões) criada(s).` : r.status === "erro" ? `A análise falhou (${r.error}). Preencha à mão.` : "Reunião salva, aguardando análise. Preencha o resumo e as ações à mão ou configure a IA.";
  } catch (e) {
    ok = false;
    msg = "Confira título, data e links: " + errMsg(e).slice(0, 160);
  }
  back(clientId, "reunioes", msg, ok ? "ok" : "erro");
}

export async function preencherReuniao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const meetingId = str(fd, "meeting_id");
  const { data: m } = await adminDb().from("meetings").select("id").eq("id", meetingId).eq("client_id", clientId).maybeSingle();
  if (!m) back(clientId, "reunioes", "Reunião não encontrada.", "erro");
  // ações: uma por linha, "título | avanteza ou cliente | AAAA-MM-DD (opcional)"
  const actions: NewAction[] = str(fd, "actions").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [t, o, d] = l.split("|").map((x) => x.trim());
    return { titulo: t, responsavel: o?.toLowerCase() === "cliente" ? "cliente" : "avanteza", prazo: d && isDateStr(d) ? d : null };
  });
  let msg: string, ok = true;
  try {
    const r = await saveMeetingManual(meetingId, { summary: str(fd, "summary"), decisions: str(fd, "decisions").split("\n").map((l) => l.trim()).filter(Boolean), actions });
    await audit(actor, "meeting_filled", clientId, { actions: r.actionsCreated });
    msg = `Reunião salva (${r.actionsCreated} ação(ões) nova(s)).`;
  } catch {
    ok = false;
    msg = "Confira o resumo (obrigatório) e as linhas das ações.";
  }
  back(clientId, "reunioes", msg, ok ? "ok" : "erro");
}

export async function excluirReuniao(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  await adminDb().from("meetings").delete().eq("id", str(fd, "meeting_id")).eq("client_id", clientId);
  await audit(actor, "meeting_deleted", clientId);
  back(clientId, "reunioes", "Reunião removida.");
}

// ───── Acesso do cliente (senha aparece UMA vez, só na resposta desta chamada) ─────
export type AccessState = { email?: string; password?: string; erro?: string } | null;

export async function criarAcesso(_p: AccessState, fd: FormData): Promise<AccessState> {
  const actor = await requireOwner();
  const clientId = str(fd, "client_id");
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  try {
    const r = await createClientUser(clientId, str(fd, "email"), str(fd, "name") || null, { includeGroup: fd.get("include_group") === "on" });
    await audit(actor, "client_user_created", clientId, { email: r.email });
    revalidatePath(`/clientes/${clientId}`);
    return r;
  } catch (e) {
    return { erro: errMsg(e) };
  }
}

export async function redefinirAcesso(_p: AccessState, fd: FormData): Promise<AccessState> {
  const actor = await requireOwner();
  const clientId = str(fd, "client_id");
  const email = str(fd, "email").toLowerCase();
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  // O usuário precisa estar vinculado a ESTE cliente.
  const { data: link } = await adminDb().from("client_user_clients").select("user_email").eq("user_email", email).eq("client_id", clientId).maybeSingle();
  if (!link) return { erro: "Usuário não pertence a este cliente." };
  try {
    const r = await resetClientUserPassword(email);
    await audit(actor, "client_user_password_reset", clientId, { email });
    return r;
  } catch (e) {
    return { erro: errMsg(e) };
  }
}

export type WelcomeState = { ok?: string; erro?: string } | null;

/** E-mail de boas-vindas (link, login, passo a passo) ao usuário do cliente, com cópia ao dono. Sem senha. */
export async function enviarBoasVindasAcesso(_p: WelcomeState, fd: FormData): Promise<WelcomeState> {
  const actor = await requireOwner();
  const clientId = str(fd, "client_id");
  const email = str(fd, "email").toLowerCase();
  if (!UUID.test(clientId)) return { erro: "Cliente inválido." };
  const db = adminDb();
  const { data: link } = await db.from("client_user_clients").select("user_email").eq("user_email", email).eq("client_id", clientId).maybeSingle();
  if (!link) return { erro: "Usuário não pertence a este cliente." };
  const [{ data: client }, { data: user }, canal] = await Promise.all([
    db.from("clients").select("name").eq("id", clientId).maybeSingle(),
    db.from("admins").select("name, active").eq("email", email).eq("role", "client").maybeSingle(),
    obterCanal(clientId).catch(() => null),
  ]);
  if (!client) return { erro: "Cliente não encontrado." };
  if (user && user.active === false) return { erro: "Acesso desativado: reative antes de enviar." };
  try {
    const ok = await enviarBoasVindas({ cliente: client.name, email, nome: user?.name ?? null, limiteRecarga: canal?.alertaGasto?.limite ?? null });
    await audit(actor, "client_welcome_email", clientId, { email, status: ok ? "enviado" : "sem_email_configurado" });
    return ok ? { ok: `E-mail de boas-vindas enviado para ${email} (cópia para a Avanteza).` } : { erro: "E-mail não configurado (RESEND_API_KEY/ALERT_EMAIL_FROM)." };
  } catch (e) {
    await audit(actor, "client_welcome_email", clientId, { email, status: "falhou" });
    return { erro: `Falha no envio: ${errMsg(e)}` };
  }
}

export async function alternarAcesso(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const email = str(fd, "email").toLowerCase();
  const { data: link } = await adminDb().from("client_user_clients").select("user_email").eq("user_email", email).eq("client_id", clientId).maybeSingle();
  if (!link) back(clientId, "acesso", "Usuário não pertence a este cliente.", "erro");
  const active = str(fd, "active") === "1";
  await setClientUserActive(email, active);
  await audit(actor, active ? "client_user_enabled" : "client_user_disabled", clientId, { email });
  back(clientId, "acesso", active ? "Acesso reativado." : "Acesso desativado.");
}

export async function vincularEmpresa(fd: FormData) {
  const actor = await requireOwner();
  const clientId = needId(fd);
  const email = str(fd, "email").toLowerCase();
  const other = str(fd, "company_id");
  if (!UUID.test(other)) back(clientId, "acesso", "Empresa inválida.", "erro");
  try {
    await setCompanyLink(email, other, str(fd, "on") === "1");
    await audit(actor, "client_user_company_link", clientId, { email, other, on: str(fd, "on") });
  } catch (e) {
    back(clientId, "acesso", errMsg(e), "erro");
  }
  back(clientId, "acesso", "Empresas do acesso atualizadas.");
}

// ───── Ver como cliente (somente leitura) ─────
export async function verComoCliente(fd: FormData) {
  const sess = await requireUser();
  if (!canPreviewClients(sess) || !canUseApp(sess, "marketplaces")) redirect("/central");
  const clientId = needId(fd);
  const { data: c } = await adminDb().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!c) redirect("/clientes?erro=Cliente não encontrado");
  (await cookies()).set(VIEW_COOKIE, await signViewToken(sess.email, clientId), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: VIEW_TTL_S });
  redirect("/mapa");
}
