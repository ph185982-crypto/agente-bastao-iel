"use server";
// Operações → Capturas: prévia e importação de conversa exportada do WhatsApp. Só quem trabalha no Motor (admin e membro).
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { podeTrabalharMotor } from "@/lib/motor/acesso";
import { isUuid } from "@/lib/motor/repo";
import { notificarCaptura } from "@/lib/motor/capturas-api";
import { ImportacaoErro, importarConversa, LIMITE_ARQUIVO, previaConversa, type Previa, type ResultadoImportacao } from "@/lib/capturas/importar";

export type EstadoImportacao =
  | { etapa: "inicio"; erro?: string }
  | { etapa: "previa"; previa: Previa; nome: string; erro?: string }
  | { etapa: "feito"; resultado: ResultadoImportacao; cliente: string };

async function arquivo(fd: FormData): Promise<{ buf: Buffer; nome: string } | string> {
  const f = fd.get("arquivo");
  if (!(f instanceof File) || !f.size) return "Escolha o arquivo .txt ou .zip exportado do WhatsApp.";
  if (f.size > LIMITE_ARQUIVO) return "Arquivo acima de 4 MB: exporte a conversa “sem mídia” e tente de novo.";
  return { buf: Buffer.from(await f.arrayBuffer()), nome: f.name.slice(0, 200) };
}

export async function previaAction(_prev: EstadoImportacao, fd: FormData): Promise<EstadoImportacao> {
  const sess = await requireUser();
  if (!podeTrabalharMotor(sess)) return { etapa: "inicio", erro: "Acesso somente leitura." };
  const a = await arquivo(fd);
  if (typeof a === "string") return { etapa: "inicio", erro: a };
  try {
    const cliente = String(fd.get("cliente") ?? "");
    return { etapa: "previa", previa: await previaConversa(a.buf, a.nome, isUuid(cliente) ? cliente : null), nome: a.nome };
  } catch (e) {
    return { etapa: "inicio", erro: e instanceof ImportacaoErro ? e.message : "Não consegui ler o arquivo." };
  }
}

export async function importarAction(prev: EstadoImportacao, fd: FormData): Promise<EstadoImportacao> {
  const sess = await requireUser();
  if (!podeTrabalharMotor(sess)) return { etapa: "inicio", erro: "Acesso somente leitura." };
  const cliente = String(fd.get("cliente") ?? "");
  const volta = (erro: string): EstadoImportacao => (prev.etapa === "previa" ? { ...prev, erro } : { etapa: "inicio", erro });
  if (!isUuid(cliente)) return volta("Escolha o cliente desta conversa.");
  const a = await arquivo(fd);
  if (typeof a === "string") return volta(a);
  try {
    const r = await importarConversa({ clientId: cliente, buf: a.buf, nome: a.nome, actor: sess.email });
    if (r.novas) await notificarCaptura(cliente, "whatsapp_export", r.acoesCriadas, ` (${r.novas} mensagem(ns) nova(s) de “${r.titulo ?? "conversa"}”)`).catch(() => undefined);
    revalidatePath("/operacoes/capturas");
    return { etapa: "feito", resultado: r, cliente: String(fd.get("cliente_nome") ?? "") };
  } catch (e) {
    return volta(e instanceof ImportacaoErro ? e.message : "Falha ao importar a conversa.");
  }
}

/** Uma ação só (prévia ou importar), chamada pelo componente sem resetar o formulário (o arquivo continua escolhido). */
export async function capturaAction(prev: EstadoImportacao, fd: FormData): Promise<EstadoImportacao> {
  if (String(fd.get("passo")) === "reiniciar") return { etapa: "inicio" };
  return String(fd.get("passo")) === "importar" ? importarAction(prev, fd) : previaAction(prev, fd);
}
