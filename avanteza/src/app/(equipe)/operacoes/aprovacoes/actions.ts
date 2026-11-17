"use server";
// Server Actions da equipe: aprovações (enviar peça, nova versão, cancelar, comentar), relatório semanal (revisar, publicar,
// descartar, gerar agora) e preferências do cliente (modo do relatório e lembretes). Toda escrita confere o papel e é auditada.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { spDate } from "@/lib/dates";
import { podeEditarPlaybooks, podeTrabalharMotor } from "@/lib/motor/acesso";
import * as ap from "@/lib/aprovacoes/equipe";
import * as rel from "@/lib/relatorios/gerar";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Volta só para telas internas conhecidas (nunca para um endereço vindo de fora). */
function voltar(fd: FormData, padrao: string, kind: "ok" | "erro", msg: string): never {
  const b = str(fd, "back");
  const alvo = /^\/(operacoes\/(aprovacoes|relatorios)(\/[0-9a-f-]{36})?|clientes\/[0-9a-f-]{36})(\?[\w=&%.-]*)?$/i.test(b) ? b : padrao;
  const [path, q] = alvo.split("?");
  const params = new URLSearchParams(q ?? "");
  params.delete("ok"); params.delete("erro");
  params.set(kind, msg);
  revalidatePath(path);
  redirect(`${path}?${params}`);
}

async function trabalhador(padrao: string) {
  const sess = await requireUser();
  if (!podeTrabalharMotor(sess)) redirect(`${padrao}?erro=${encodeURIComponent("Acesso somente leitura.")}`);
  return sess;
}

export async function criarAprovacaoForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/aprovacoes");
  const r = await ap.criarAprovacao(sess.email, {
    clientId: str(fd, "client_id"), tipo: str(fd, "tipo"), titulo: str(fd, "titulo"), descricao: str(fd, "descricao") || null, prazo: str(fd, "prazo") || null,
    link: str(fd, "link") || null, arquivoId: str(fd, "arquivo_id") || null, actionId: str(fd, "action_id") || null, nota: str(fd, "nota") || null,
  });
  if (r.ok) { revalidatePath("/operacoes/aprovacoes"); voltar(fd, `/operacoes/aprovacoes/${r.id}`, "ok", "Peça enviada para aprovação. O cliente já vê em “Para aprovar”."); }
  voltar(fd, "/operacoes/aprovacoes", "erro", r.erro);
}

export async function novaVersaoForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/aprovacoes");
  const id = str(fd, "id");
  const r = await ap.novaVersao(sess.email, id, { link: str(fd, "link") || null, arquivoId: str(fd, "arquivo_id") || null, nota: str(fd, "nota") || null });
  voltar(fd, `/operacoes/aprovacoes/${id}`, r.ok ? "ok" : "erro", r.ok ? "Nova versão enviada ao cliente." : r.erro ?? "Não foi possível.");
}

export async function cancelarAprovacaoForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/aprovacoes");
  const id = str(fd, "id");
  const r = await ap.cancelarAprovacao(sess.email, id, str(fd, "motivo") || null);
  voltar(fd, `/operacoes/aprovacoes/${id}`, r.ok ? "ok" : "erro", r.ok ? "Cancelada." : r.erro ?? "Não foi possível.");
}

export async function comentarAprovacaoForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/aprovacoes");
  const id = str(fd, "id");
  const r = await ap.comentarEquipe(sess.email, id, str(fd, "texto"));
  voltar(fd, `/operacoes/aprovacoes/${id}`, r.ok ? "ok" : "erro", r.ok ? "Comentário registrado." : r.erro ?? "Não foi possível.");
}

// ───────────────────────── Relatório semanal ─────────────────────────

export async function salvarRevisaoForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/relatorios");
  const id = str(fd, "id");
  const destaques = str(fd, "destaques").split("\n");
  const r = await rel.salvarRevisao(sess.email, id, { abertura: str(fd, "abertura"), destaques });
  if (r.ok && str(fd, "publicar") === "1") {
    const p = await rel.publicarRelatorio(id, sess.email);
    voltar(fd, `/operacoes/relatorios/${id}`, p.ok ? "ok" : "erro", p.ok ? `Publicado no Mapa${p.email === "enviado" ? " e enviado por e-mail" : ""}.` : p.erro ?? "Não foi possível.");
  }
  voltar(fd, `/operacoes/relatorios/${id}`, r.ok ? "ok" : "erro", r.ok ? "Revisão salva." : r.erro ?? "Não foi possível.");
}

export async function publicarRelatorioForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/relatorios");
  const id = str(fd, "id");
  const p = await rel.publicarRelatorio(id, sess.email);
  voltar(fd, `/operacoes/relatorios/${id}`, p.ok ? "ok" : "erro", p.ok ? `Publicado no Mapa${p.email === "enviado" ? " e enviado por e-mail" : ""}.` : p.erro ?? "Não foi possível.");
}

export async function descartarRelatorioForm(fd: FormData) {
  const sess = await trabalhador("/operacoes/relatorios");
  const id = str(fd, "id");
  const r = await rel.descartarRelatorio(sess.email, id);
  voltar(fd, "/operacoes/relatorios", r.ok ? "ok" : "erro", r.ok ? "Relatório descartado (não vai para o cliente)." : r.erro ?? "Não foi possível.");
}

/** Gera agora os relatórios da semana anterior (idempotente: quem já tem não ganha outro). Só administrador. */
export async function gerarRelatoriosAgoraForm(fd: FormData) {
  const sess = await requireUser();
  if (!podeEditarPlaybooks(sess)) voltar(fd, "/operacoes/relatorios", "erro", "Só administradores geram relatórios fora da rotina.");
  const r = await rel.gerarRelatoriosDaSemana(spDate(), {}, 50_000);
  voltar(fd, "/operacoes/relatorios", r.erros.length ? "erro" : "ok", `${r.criados} gerado(s), ${r.existentes} já existia(m)${r.erros.length ? ` · ${r.erros[0]}` : ""}.`);
}

/** Preferências do cliente: modo do relatório, horas de revisão e lembretes. Só administrador. */
export async function preferenciasClienteForm(fd: FormData) {
  const sess = await requireUser();
  const clientId = str(fd, "client_id");
  const back = `/clientes/${clientId}?aba=comunicacao`;
  if (!podeEditarPlaybooks(sess)) voltar(fd, back, "erro", "Só administradores mudam estas preferências.");
  const r = await rel.salvarPreferencias(sess.email, clientId, { modo: str(fd, "modo"), horas: Number(str(fd, "horas")), lembretes: str(fd, "lembretes") === "1" });
  voltar(fd, back, r.ok ? "ok" : "erro", r.ok ? "Preferências salvas." : r.erro ?? "Não foi possível.");
}
