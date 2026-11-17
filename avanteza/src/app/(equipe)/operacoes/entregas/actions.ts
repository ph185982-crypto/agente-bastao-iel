"use server";
// Ações de escrita do Funil de Entrega (formulários e arrastar no quadro). Só administrador escreve (revisor e membro leem);
// cada escrita bem-sucedida vai para a auditoria (audit_log) com ator, operação e ids — NUNCA títulos, textos nem valores.
// Mensagens de erro não carregam dados do funil.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { recusaDeEscrita } from "@/lib/entregas/acesso";
import { obterProvedor } from "@/lib/entregas";
import { COLUNAS, EntregasErro, PILARES, STATUS_ENTREGA, mensagemDoErro, type EntregasProvider, type ItemChecklist, type PatchCartao } from "@/lib/entregas/crm";
import { diaParaIso, parseChecklist } from "@/lib/entregas/forms";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const id = z.string().trim().min(1).max(64);
const texto = (max = 200) => z.string().trim().min(1).max(max);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida");
const diaOpt = z.string().transform((v) => v.trim()).refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "data inválida");
const coluna = z.enum(COLUNAS);
const pilar = z.enum(PILARES);

type Ctx = { prov: EntregasProvider; fd: FormData };
interface Op { msg: string; entidade: string; ids: (fd: FormData) => Record<string, string | null>; run: (c: Ctx) => Promise<void> }

const EID = (fd: FormData) => id.parse(s(fd, "entregaId"));
const CID = (fd: FormData) => id.parse(s(fd, "cartaoId"));

const OPS: Record<string, Op> = {
  "cartao.mover": { msg: "Cartão movido.", entidade: "cartao", ids: (fd) => ({ entregaId: s(fd, "entregaId"), cartaoId: s(fd, "cartaoId"), coluna: s(fd, "coluna") }),
    run: ({ prov, fd }) => prov.editarCartao(EID(fd), CID(fd), { coluna: coluna.parse(s(fd, "coluna")) }) },
  "cartao.editar": { msg: "Cartão atualizado.", entidade: "cartao", ids: (fd) => ({ entregaId: s(fd, "entregaId"), cartaoId: s(fd, "cartaoId") }),
    run: async ({ prov, fd }) => {
      const c = z.object({ titulo: texto(200), descricao: z.string().trim().max(5000), pilar, coluna, alvo: diaOpt, resp: z.string().trim().max(64) })
        .parse({ titulo: s(fd, "titulo"), descricao: s(fd, "descricao"), pilar: s(fd, "pilar"), coluna: s(fd, "coluna"), alvo: s(fd, "dataAlvo"), resp: s(fd, "responsavelId") });
      const checklist: ItemChecklist[] = parseChecklist(s(fd, "checklist"));
      await prov.editarCartao(EID(fd), CID(fd), {
        titulo: c.titulo, descricao: c.descricao || null, pilar: c.pilar, coluna: c.coluna, dataAlvo: c.alvo ? diaParaIso(c.alvo) : null,
        cliente: s(fd, "cliente") === "on", responsavelId: c.resp || null, checklist,
      });
    } },
  "cartao.criar": { msg: "Cartão criado.", entidade: "cartao", ids: (fd) => ({ entregaId: s(fd, "entregaId") }),
    run: async ({ prov, fd }) => {
      const c = z.object({ titulo: texto(200), pilar, coluna, alvo: diaOpt, resp: z.string().trim().max(64) })
        .parse({ titulo: s(fd, "titulo"), pilar: s(fd, "pilar") || "COMERCIAL", coluna: s(fd, "coluna") || "BACKLOG", alvo: s(fd, "dataAlvo"), resp: s(fd, "responsavelId") });
      await prov.criarCartao(EID(fd), { titulo: c.titulo, pilar: c.pilar, coluna: c.coluna, dataAlvo: c.alvo ? diaParaIso(c.alvo) : undefined, responsavelId: c.resp || null, cliente: s(fd, "cliente") === "on" });
    } },
  "cartao.excluir": { msg: "Cartão excluído.", entidade: "cartao", ids: (fd) => ({ entregaId: s(fd, "entregaId"), cartaoId: s(fd, "cartaoId") }),
    run: ({ prov, fd }) => prov.excluirCartao(EID(fd), CID(fd)) },
  "entrega.editar": { msg: "Entrega atualizada.", entidade: "entrega", ids: (fd) => ({ entregaId: s(fd, "entregaId") }),
    run: async ({ prov, fd }) => {
      const c = z.object({ status: z.enum(STATUS_ENTREGA), renova: diaOpt, fim: diaOpt }).parse({ status: s(fd, "status"), renova: s(fd, "renovacaoEm"), fim: s(fd, "fimPrevistoEm") });
      const diagnostico: Partial<Record<(typeof PILARES)[number], string>> = {};
      for (const p of PILARES) if (fd.has(`diag_${p}`)) diagnostico[p] = z.string().trim().max(5000).parse(s(fd, `diag_${p}`));
      await prov.editarEntrega(EID(fd), { status: c.status, renovacaoEm: c.renova ? diaParaIso(c.renova) : null, fimPrevistoEm: c.fim ? diaParaIso(c.fim) : null, diagnostico });
    } },
  "entrega.concluir": { msg: "Entrega concluída.", entidade: "entrega", ids: (fd) => ({ entregaId: s(fd, "entregaId") }), run: ({ prov, fd }) => prov.concluirEntrega(EID(fd)) },
  "entrega.upsell": { msg: "Oportunidade de upsell aberta no CRM.", entidade: "entrega", ids: (fd) => ({ entregaId: s(fd, "entregaId") }), run: ({ prov, fd }) => prov.criarUpsell(EID(fd)).then(() => undefined) },
  "modelo.padrao": { msg: "Modelo padrão atualizado: vale para as próximas entregas.", entidade: "modelo", ids: (fd) => ({ modeloId: s(fd, "modeloId") }), run: ({ prov, fd }) => prov.definirModeloPadrao(id.parse(s(fd, "modeloId"))) },
  "modelo.desativar": { msg: "Modelo desativado.", entidade: "modelo", ids: (fd) => ({ modeloId: s(fd, "modeloId") }), run: ({ prov, fd }) => prov.desativarModelo(id.parse(s(fd, "modeloId"))) },
  "rotina.executar": { msg: "Rotina diária executada no CRM.", entidade: "rotina", ids: () => ({}), run: async ({ prov }) => { await prov.rodarRotina(); } },
};

function voltarSeguro(fd: FormData): string {
  const v = s(fd, "voltar");
  return /^\/operacoes\/entregas(\/[\w-]+){0,2}(\?[\w=&%.+-]*)?$/.test(v) ? v : "/operacoes/entregas";
}
function ir(voltar: string, tipo: "ok" | "erro", msg: string): never {
  const [path, qs = ""] = voltar.split("?");
  const sp = new URLSearchParams(qs);
  sp.delete("ok"); sp.delete("erro");
  sp.set(tipo, msg);
  redirect(`${path}?${sp}`);
}

/** Auditoria: quem, o quê, em quais ids — sem títulos nem textos. Falha de auditoria não desfaz a escrita, mas é registrada. */
async function auditar(sess: Session, op: string, entidade: string, ids: Record<string, string | null>) {
  try {
    const r = await adminDb().from("audit_log").insert({ event: `entregas_${op.replace(".", "_")}`, actor: sess.email, details: { entidade, ...ids } });
    if (r?.error) throw new Error("auditoria");
  } catch {
    console.error("[entregas] a escrita foi feita, mas o registro de auditoria falhou");
  }
}

function erroDe(e: unknown): string {
  if (e instanceof z.ZodError) return "Confira os campos do formulário (título, datas e opções válidas).";
  return e instanceof EntregasErro ? e.message : mensagemDoErro(e);
}

/** Formulário: executa a operação `op` e volta para a tela com o aviso. */
export async function entregasForm(fd: FormData): Promise<void> {
  const voltar = voltarSeguro(fd);
  const sess = await requireUser();
  const nome = s(fd, "op");
  const op = OPS[nome];
  if (!op) ir(voltar, "erro", "Operação desconhecida.");
  const recusa = recusaDeEscrita(sess);
  if (recusa) ir(voltar, "erro", recusa);
  try {
    await op.run({ prov: obterProvedor(), fd });
  } catch (e) {
    ir(voltar, "erro", erroDe(e));
  }
  await auditar(sess, nome, op.entidade, op.ids(fd));
  revalidatePath("/operacoes/entregas", "layout");
  // Apagar o cartão tira o usuário da ficha que não existe mais.
  ir(nome === "cartao.excluir" ? `/operacoes/entregas/${encodeURIComponent(s(fd, "entregaId")).slice(0, 64)}` : voltar, "ok", op.msg);
}

/** Arrastar (ou usar as setas) no quadro: muda a etapa ou o pilar do cartão. Sem redirecionar: devolve o resultado para a tela. */
export async function moverNoQuadro(entregaId: string, cartaoId: string, alvo: { coluna: string } | { pilar: string }): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sess = await requireUser();
  const recusa = recusaDeEscrita(sess);
  if (recusa) return { ok: false, erro: recusa };
  try {
    const e = id.parse(entregaId), c = id.parse(cartaoId);
    const patch: PatchCartao = "coluna" in alvo ? { coluna: coluna.parse(alvo.coluna) } : { pilar: pilar.parse(alvo.pilar) };
    await obterProvedor().editarCartao(e, c, patch);
  } catch (e) {
    return { ok: false, erro: erroDe(e) };
  }
  await auditar(sess, "cartao.mover", "cartao", { entregaId, cartaoId, ...("coluna" in alvo ? { coluna: alvo.coluna } : { pilar: alvo.pilar }) });
  revalidatePath("/operacoes/entregas", "layout");
  return { ok: true };
}
