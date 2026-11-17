"use server";
// Operações → Onboarding: simular contrato assinado (só admin; em produção, com confirmação dupla) e reprocessar evento.
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { processarEvento, receberEvento, reenfileirar, validarEvento } from "@/lib/eventos/barramento";
import { emProducao, FRASE_PRODUCAO } from "@/lib/eventos/simulacao";
import { rawQuery } from "@/lib/db/client";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const numOuNull = (v: string) => (v === "" ? null : Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v));
function voltar(kind: "ok" | "erro", msg: string): never {
  revalidatePath("/operacoes/onboarding");
  redirect(`/operacoes/onboarding?${kind}=${encodeURIComponent(msg)}`);
}
async function admin() {
  const sess = await requireUser();
  if (sess.role !== "admin") voltar("erro", "Só administradores.");
  return sess;
}

export async function simularContratoForm(fd: FormData) {
  const sess = await admin();
  if (emProducao()) {
    if (fd.get("confirma1") !== "on" || str(fd, "confirma2").toUpperCase() !== FRASE_PRODUCAO) {
      voltar("erro", `Em produção, marque a confirmação e digite ${FRASE_PRODUCAO}.`);
    }
  }
  const envelopeId = str(fd, "envelopeId") || `sim-${randomBytes(6).toString("hex")}`;
  const lancar = fd.get("lancar_receita") === "on";
  const opt = (k: string) => str(fd, k) || null;
  const evento = {
    id: `contrato.assinado:${envelopeId}`,
    tipo: "contrato.assinado",
    origem: "simulacao",
    ocorrido_em: new Date().toISOString(),
    payload: {
      contratoId: opt("contratoId") ?? `sim-${envelopeId}`,
      envelopeId,
      razaoSocial: str(fd, "razaoSocial"),
      nomeFantasia: opt("nomeFantasia"),
      cnpj: opt("cnpj"),
      representante: opt("representante"),
      emailCliente: opt("emailCliente"),
      telefoneCliente: opt("telefoneCliente"),
      modelo: str(fd, "modelo") || "Contrato de prestação de serviços",
      plano: opt("plano"),
      servicos: fd.getAll("servicos").map(String),
      valorMensal: numOuNull(str(fd, "valorMensal")),
      duracaoMeses: numOuNull(str(fd, "duracaoMeses")),
      inicioEm: opt("inicioEm"),
      vencimentoDia: numOuNull(str(fd, "vencimentoDia")),
      simulado: !lancar,
    },
  };
  const v = validarEvento(evento);
  if (!v.ok) voltar("erro", `${v.erro}${v.detalhes ? `: ${v.detalhes.slice(0, 3).join("; ")}` : ""}`);
  const r = await receberEvento(v.evento);
  if (r.duplicado) voltar("erro", "Esse envelope já foi recebido (o evento é idempotente). Use outro identificador.");
  const p = await processarEvento(r.id).catch((e) => ({ status: "pendente", erro: e instanceof Error ? e.message : "falha" }) as const);
  await rawQuery("insert into avanteza.audit_log (event, actor, details) values ('contrato_simulado', $1, $2)", [sess.email, JSON.stringify({ envelopeId, lancarReceita: lancar })]);
  if (p?.status === "processado") voltar("ok", "Contrato simulado: cliente, serviços, plano, Kickoff e acesso prontos. Veja o sino para a senha inicial.");
  voltar("erro", `Evento recebido, mas ficou pendente: ${p && "erro" in p && p.erro ? p.erro : (p && "pendencias" in p && p.pendencias?.join("; ")) || "tentará de novo"}.`);
}

export async function reprocessarEventoForm(fd: FormData) {
  const sess = await admin();
  const id = str(fd, "id");
  if (!(await reenfileirar(id, sess.email))) voltar("erro", "Evento não encontrado.");
  const p = await processarEvento(id).catch(() => null);
  voltar(p?.status === "processado" ? "ok" : "erro", p?.status === "processado" ? "Evento reprocessado." : `Ainda pendente: ${p?.erro ?? p?.pendencias?.join("; ") ?? "tentará de novo"}`);
}
