"use server";
// Server Actions do cliente no Mapa. O client_id NUNCA vem do formulário: sempre do escopo da sessão.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { VIEW_COOKIE } from "@/lib/session";
import { requireMapa, COMPANY_COOKIE } from "@/lib/mapa/auth";
import { changeOwnPassword, updateOwnActionStatus } from "@/lib/mapa/repo";
import type { ActionStatus } from "@/lib/mapa/progress";

export async function selectCompany(fd: FormData) {
  const { scope } = await requireMapa();
  const wanted = String(fd.get("company") ?? "");
  // Valor cru do navegador: só vale se estiver na lista de empresas da sessão.
  if (scope.allowedClientIds.includes(wanted)) {
    (await cookies()).set(COMPANY_COOKIE, wanted, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/mapa", maxAge: 30 * 24 * 3600 });
  }
  redirect("/mapa");
}

export async function updateMyAction(fd: FormData) {
  const { scope } = await requireMapa();
  const ok = await updateOwnActionStatus(scope, String(fd.get("action_id") ?? ""), String(fd.get("status") ?? "") as ActionStatus).catch(() => false);
  revalidatePath("/mapa", "layout");
  redirect(`/mapa/plano?${ok ? "ok=Andamento atualizado." : "erro=Não foi possível atualizar esta ação."}`);
}

export async function changeMyPassword(_prev: { ok?: string; erro?: string } | null, fd: FormData): Promise<{ ok?: string; erro?: string }> {
  const { scope } = await requireMapa();
  if (scope.readOnly) return { erro: "Visualização somente leitura." };
  const next = String(fd.get("new_password") ?? "");
  if (next !== String(fd.get("confirm_password") ?? "")) return { erro: "A confirmação não confere com a nova senha." };
  const r = await changeOwnPassword(scope, String(fd.get("current_password") ?? ""), next);
  return r.ok ? { ok: "Senha alterada." } : { erro: r.error };
}

/** Sai da visualização "Ver como cliente" e volta à ficha do cliente. */
export async function exitPreview(fd: FormData) {
  const { scope } = await requireMapa();
  if (!scope.previewBy) redirect("/mapa");
  (await cookies()).delete(VIEW_COOKIE);
  redirect(`/clientes/${scope.clientId}`);
}
