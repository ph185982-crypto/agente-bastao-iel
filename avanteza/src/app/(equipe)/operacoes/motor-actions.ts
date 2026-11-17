"use server";
// Server Actions do Motor de Entregas. Toda escrita confere o papel (acesso.ts) e vai para a auditoria (repo.ts).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { podeEditarPlaybooks, podeTrabalharMotor } from "@/lib/motor/acesso";
import * as motor from "@/lib/motor/repo";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
};
/** Volta só para telas internas conhecidas (nunca para um endereço vindo de fora). */
function voltar(fd: FormData, padrao: string, kind: "ok" | "erro", msg: string): never {
  const b = str(fd, "back");
  const alvo = /^\/(operacoes|clientes\/[0-9a-f-]{36})(\/[a-z]*)?(\?[\w=&%.-]*)?$/i.test(b) ? b : padrao;
  const [path, q] = alvo.split("?");
  const params = new URLSearchParams(q ?? "");
  params.delete("ok"); params.delete("erro"); params.delete("previa");
  params.set(kind, msg);
  revalidatePath(path);
  redirect(`${path}?${params}${str(fd, "anchor") ? `#${str(fd, "anchor").replace(/[^\w-]/g, "")}` : ""}`);
}

async function trabalhador() {
  const sess = await requireUser();
  if (!podeTrabalharMotor(sess)) redirect(`/operacoes?erro=${encodeURIComponent("Acesso somente leitura.")}`);
  return sess;
}
async function admin() {
  const sess = await requireUser();
  if (!podeEditarPlaybooks(sess)) redirect(`/operacoes/playbooks?erro=${encodeURIComponent("Só administradores editam playbooks e serviços.")}`);
  return sess;
}

export async function acaoRapidaForm(fd: FormData) {
  const sess = await trabalhador();
  const id = str(fd, "id");
  const tipo = str(fd, "tipo");
  let a: motor.AcaoRapida;
  switch (tipo) {
    case "concluir": a = { tipo, evidencia: str(fd, "evidencia") || null }; break;
    case "bloquear": a = { tipo, motivo: str(fd, "motivo") }; break;
    case "adiar": a = { tipo, para: str(fd, "para") }; break;
    case "reatribuir": a = { tipo, para: str(fd, "para") || null }; break;
    case "evidencia": a = { tipo, url: str(fd, "url") }; break;
    case "checklist": a = { tipo, indice: Number(str(fd, "indice")), ok: str(fd, "ok") === "1" }; break;
    case "reabrir": case "iniciar": case "desbloquear": case "dispensar": case "desfazer_ia": a = { tipo }; break;
    default: voltar(fd, "/operacoes", "erro", "Ação desconhecida.");
  }
  const r = await motor.acaoRapida(sess.email, id, a);
  const MSG: Record<string, string> = {
    concluir: "Concluída.", bloquear: "Marcada como dependente do cliente.", adiar: "Prazo alterado.", reatribuir: "Responsável alterado.", evidencia: "Evidência anexada.",
    checklist: "Checklist atualizado.", reabrir: "Reaberta.", iniciar: "Em execução.", desbloquear: "Voltou para a fila.", dispensar: "Dispensada.", desfazer_ia: "Ação da IA desfeita.",
  };
  voltar(fd, "/operacoes", r.ok ? "ok" : "erro", r.ok ? MSG[tipo] : r.erro ?? "Não foi possível.");
}

export async function editarAcaoForm(fd: FormData) {
  const sess = await trabalhador();
  try {
    await motor.editarAcao(sess.email, str(fd, "id"), {
      title: str(fd, "title"), description: str(fd, "description"), due_date: str(fd, "due_date") || null, priority: Number(str(fd, "priority")) || 2,
      visible_to_client: fd.get("visible_to_client") === "on", owner: str(fd, "owner") === "cliente" ? "cliente" : "avanteza", phase_id: str(fd, "phase_id") || null,
    });
  } catch (e) {
    voltar(fd, "/operacoes", "erro", e instanceof Error ? e.message : "Falha ao salvar.");
  }
  voltar(fd, "/operacoes", "ok", "Ação salva.");
}

// ───── Playbooks (admin) ─────
export async function salvarTarefaForm(fd: FormData) {
  const sess = await admin();
  try {
    await motor.salvarTarefa(sess.email, str(fd, "playbook_id"), str(fd, "tarefa_id") || null, {
      title: str(fd, "title"), description: str(fd, "description"), phase_position: Number(str(fd, "phase_position")), role: str(fd, "role"),
      offset_days: Number(str(fd, "offset_days")), recurrence: str(fd, "recurrence"), recurrence_day: num(fd, "recurrence_day"),
      checklist: str(fd, "checklist").split("\n"), done_criteria: str(fd, "done_criteria"), client_dependent: fd.get("client_dependent") === "on",
      client_visible: fd.get("client_visible") === "on", estimated_min: num(fd, "estimated_min"), priority: Number(str(fd, "priority")), active: fd.get("active") === "on",
    });
  } catch (e) {
    voltar(fd, "/operacoes/playbooks", "erro", e instanceof Error ? e.message : "Falha ao salvar.");
  }
  voltar(fd, "/operacoes/playbooks", "ok", "Tarefa salva. Clientes recebem a mudança na próxima geração (ações intocadas acompanham o modelo).");
}

export async function salvarServicoCatalogoForm(fd: FormData) {
  const sess = await admin();
  try {
    await motor.salvarServicoCatalogo(sess.email, str(fd, "service_id") || null, {
      name: str(fd, "name"), description: str(fd, "description"), kind: str(fd, "kind"), active: fd.get("active") === "on", default_monthly_value: num(fd, "default_monthly_value"),
    });
  } catch (e) {
    voltar(fd, "/operacoes/playbooks", "erro", e instanceof Error ? e.message : "Falha ao salvar.");
  }
  voltar(fd, "/operacoes/playbooks", "ok", "Serviço salvo.");
}

/** "Aplicar a clientes existentes": aplica os playbooks nos clientes da prévia (os que contrataram o serviço ou que o tipo indica). */
export async function aplicarServicoForm(fd: FormData) {
  const sess = await admin();
  const hoje = spDate();
  const ids = fd.getAll("client_id").map(String).filter(motor.isUuid);
  if (!ids.length) voltar(fd, "/operacoes/playbooks", "erro", "Escolha ao menos um cliente.");
  let criadas = 0;
  const erros: string[] = [];
  for (const id of ids) {
    try {
      const r = await motor.aplicarPlaybooks(id, { hoje, actor: sess.email });
      criadas += (r.gravado?.criadas ?? 0) + (r.gravado?.vinculadas ?? 0);
    } catch (e) {
      erros.push(e instanceof Error ? e.message : "falha");
    }
  }
  voltar(fd, "/operacoes/playbooks", erros.length ? "erro" : "ok", erros.length ? `Aplicado com ${erros.length} erro(s): ${erros[0]}` : `Aplicado a ${ids.length} cliente(s): ${criadas} ação(ões) nova(s).`);
}

export async function salvarPapeisForm(fd: FormData) {
  const sess = await admin();
  await motor.salvarPapeisDaPessoa(sess.email, str(fd, "pessoa_id"), fd.getAll("papel").map(String));
  voltar(fd, "/operacoes/playbooks", "ok", "Papéis salvos. Novas ações desses papéis vão para essa pessoa.");
}

// ───── Serviços do cliente (admin) ─────
export async function salvarServicoClienteForm(fd: FormData) {
  const sess = await admin();
  const clientId = str(fd, "client_id");
  const back = `/clientes/${clientId}?aba=entregas`;
  try {
    await motor.salvarServicoCliente(sess.email, {
      clientId, serviceId: str(fd, "service_id"), startDate: str(fd, "start_date"), endDate: str(fd, "end_date") || null, monthlyValue: num(fd, "monthly_value"),
      contractRef: str(fd, "contract_ref") || null, assigneeId: str(fd, "assignee_id") || null, status: (str(fd, "status") || "ativo") as "ativo",
    });
  } catch (e) {
    voltar(fd, back, "erro", e instanceof Error ? e.message : "Falha ao salvar.");
  }
  voltar(fd, back, "ok", "Serviço salvo. Use “Aplicar playbooks” para gerar as ações.");
}

export async function removerServicoClienteForm(fd: FormData) {
  const sess = await admin();
  const clientId = str(fd, "client_id");
  await motor.removerServicoCliente(sess.email, clientId, str(fd, "id"));
  voltar(fd, `/clientes/${clientId}?aba=entregas`, "ok", "Serviço removido. Ações já criadas continuam no plano.");
}

export async function aplicarPlaybooksClienteForm(fd: FormData) {
  const sess = await admin();
  const clientId = str(fd, "client_id");
  const back = `/clientes/${clientId}?aba=entregas`;
  let msg = "";
  try {
    const r = await motor.aplicarPlaybooks(clientId, { hoje: spDate(), actor: sess.email });
    const g = r.gravado!;
    msg = `Playbooks aplicados: ${g.criadas} nova(s), ${g.vinculadas} ligada(s) ao plano, ${g.atualizadas} atualizada(s), ${g.arquivadas} arquivada(s)` +
      `${r.servicosCriados ? ` · ${r.servicosCriados} serviço(s) pelo tipo do cliente` : ""}${r.planoCriado ? " · plano de 12 meses criado" : ""}.`;
  } catch (e) {
    voltar(fd, back, "erro", e instanceof Error ? e.message : "Falha ao aplicar.");
  }
  voltar(fd, back, "ok", msg);
}

export async function definirGerenteForm(fd: FormData) {
  const sess = await admin();
  const clientId = str(fd, "client_id");
  try {
    await motor.definirGerente(sess.email, clientId, str(fd, "manager_id") || null);
  } catch (e) {
    voltar(fd, `/clientes/${clientId}?aba=entregas`, "erro", e instanceof Error ? e.message : "Falha.");
  }
  voltar(fd, `/clientes/${clientId}?aba=entregas`, "ok", "Responsável pela conta salvo.");
}
