"use server";
// Ações de escrita do Financeiro (formulários da tela). Uma única ação, `fin`, despacha pelo campo `op`.
// Regras: só administrador escreve (revisor e membro nunca); a área Pessoal só o dono; toda escrita bem-sucedida vai para a
// auditoria (audit_log) com ator, operação, escopo e id — NUNCA valores nem descrições. Mensagens de erro não carregam valores.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import { recusaDeEscrita } from "@/lib/financeiro/acesso";
import { obterProvedor } from "@/lib/financeiro";
import { FinanceiroErro, mensagemDoErro, type EscopoFin, type FinanceiroProvider } from "@/lib/financeiro/vendedoria";
import { isData } from "@/lib/financeiro/periodo";
import { parseValor } from "@/lib/financeiro/forms";

const valor = z.number().finite().positive().max(1_000_000_000);
const texto = (max = 200) => z.string().trim().min(1).max(max);
const opt = (max = 200) => z.string().trim().max(max).transform((s) => s || undefined).optional();
const dataZ = z.string().refine(isData, "data inválida");
const dataOpt = z.string().transform((s) => s || undefined).refine((s) => s === undefined || isData(s), "data inválida").optional();

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const num = (fd: FormData, k: string) => parseValor(fd.get(k));

type Ctx = { prov: FinanceiroProvider; escopo: EscopoFin; fd: FormData; id: string };
interface Op { msg: string; entidade: string; run: (c: Ctx) => Promise<void>; soPessoal?: boolean }

const negocio = (fd: FormData) => z.enum(["empresa", "pessoal"]).parse(s(fd, "para")) === "empresa" ? "nexo" as const : "pessoal" as const;

const OPS: Record<string, Op> = {
  "lancamento.criar": { msg: "Lançamento criado.", entidade: "lancamento", run: async ({ prov, escopo, fd }) => {
    const t = z.object({ tipo: z.enum(["receita", "despesa"]), valor, descricao: texto(300), categoria: texto(80), data: dataOpt, empresa: opt(120) }).parse({ tipo: s(fd, "tipo"), valor: num(fd, "valor"), descricao: s(fd, "descricao"), categoria: s(fd, "categoria"), data: s(fd, "data"), empresa: s(fd, "cliente") });
    await prov.criarTransacao(escopo, { tipo: t.tipo, valor: t.valor, descricao: t.descricao, categoria: t.categoria, data_transacao: t.data, empresa: t.empresa });
  } },
  "lancamento.editar": { msg: "Lançamento atualizado.", entidade: "lancamento", run: async ({ prov, escopo, fd, id }) => {
    const t = z.object({ tipo: z.enum(["receita", "despesa"]), valor, descricao: texto(300), categoria: texto(80), data: dataZ }).parse({ tipo: s(fd, "tipo"), valor: num(fd, "valor"), descricao: s(fd, "descricao"), categoria: s(fd, "categoria"), data: s(fd, "data") });
    await prov.editarTransacao(escopo, id, { tipo: t.tipo, valor: t.valor, descricao: t.descricao, categoria: t.categoria, data_transacao: t.data });
  } },
  "lancamento.confirmar": { msg: "Lançamento confirmado.", entidade: "lancamento", run: ({ prov, escopo, id }) => prov.confirmarTransacao(escopo, id).then(() => undefined) },
  "lancamento.excluir": { msg: "Lançamento excluído (o Vendedor IA guarda a cópia no histórico).", entidade: "lancamento", run: ({ prov, escopo, id }) => prov.excluirTransacao(escopo, id) },
  "lancamento.reclassificar": { msg: "Lançamento reclassificado.", entidade: "lancamento", run: ({ prov, escopo, fd, id }) => prov.editarTransacao(escopo, id, { tipo_negocio: negocio(fd) }).then(() => undefined) },

  "conta.criar": { msg: "Conta a pagar criada.", entidade: "conta", run: async ({ prov, escopo, fd }) => {
    const c = z.object({ descricao: texto(200), valor, venc: dataZ, categoria: opt(80), freq: z.enum(["", "mensal", "semanal", "anual"]) }).parse({ descricao: s(fd, "descricao"), valor: num(fd, "valor"), venc: s(fd, "vencimento"), categoria: s(fd, "categoria"), freq: s(fd, "frequencia") });
    await prov.criarConta(escopo, { descricao: c.descricao, valor: c.valor, data_vencimento: c.venc, categoria: c.categoria, ...(c.freq ? { recorrente: true, frequencia: c.freq } : {}) });
  } },
  "conta.pagar": { msg: "Conta paga e lançada no extrato.", entidade: "conta", run: ({ prov, escopo, id }) => prov.acaoConta(escopo, id, { acao: "pagar" }).then(() => undefined) },
  "conta.cancelar": { msg: "Conta cancelada.", entidade: "conta", run: ({ prov, escopo, id }) => prov.acaoConta(escopo, id, { acao: "cancelar" }).then(() => undefined) },
  "conta.editar": { msg: "Conta atualizada.", entidade: "conta", run: async ({ prov, escopo, fd, id }) => {
    const c = z.object({ descricao: texto(200), valor, venc: dataZ, categoria: texto(80) }).parse({ descricao: s(fd, "descricao"), valor: num(fd, "valor"), venc: s(fd, "vencimento"), categoria: s(fd, "categoria") });
    await prov.acaoConta(escopo, id, { acao: "editar", descricao: c.descricao, valor: c.valor, data_vencimento: c.venc, categoria: c.categoria });
  } },
  "conta.excluir": { msg: "Conta excluída (o Vendedor IA guarda a cópia no histórico).", entidade: "conta", run: ({ prov, escopo, id }) => prov.excluirConta(escopo, id) },
  "conta.reclassificar": { msg: "Conta reclassificada.", entidade: "conta", run: ({ prov, escopo, fd, id }) => prov.acaoConta(escopo, id, { acao: "editar", tipo_negocio: negocio(fd) }).then(() => undefined) },

  "receita.criar": { msg: "Receita prevista criada.", entidade: "receita", run: async ({ prov, escopo, fd }) => {
    const base = { descricao: texto(200), data: dataZ, cliente: opt(120), obs: opt(500) };
    const modo = z.enum(["avulsa", "parcelada", "recorrente"]).parse(s(fd, "modo"));
    if (modo === "avulsa") {
      const r = z.object({ ...base, valor }).parse({ descricao: s(fd, "descricao"), data: s(fd, "data"), cliente: s(fd, "cliente"), obs: s(fd, "obs"), valor: num(fd, "valor") });
      await prov.criarReceita(escopo, { modo, descricao: r.descricao, valor: r.valor, data_prevista: r.data, cliente: r.cliente, observacao: r.obs });
    } else if (modo === "parcelada") {
      const r = z.object({ ...base, meses: z.number().int().min(1).max(120), total: valor.optional(), parcela: valor.optional() }).refine((x) => x.total || x.parcela, "informe o total ou a parcela")
        .parse({ descricao: s(fd, "descricao"), data: s(fd, "data"), cliente: s(fd, "cliente"), obs: s(fd, "obs"), meses: Number(s(fd, "meses")), total: Number.isNaN(num(fd, "valor_total")) ? undefined : num(fd, "valor_total"), parcela: Number.isNaN(num(fd, "valor")) ? undefined : num(fd, "valor") });
      await prov.criarReceita(escopo, { modo, descricao: r.descricao, data_prevista: r.data, meses: r.meses, valor_total: r.total, valor_parcela: r.parcela, cliente: r.cliente, observacao: r.obs });
    } else {
      const r = z.object({ ...base, valor, meses: z.number().int().min(1).max(120).nullable() }).parse({ descricao: s(fd, "descricao"), data: s(fd, "data"), cliente: s(fd, "cliente"), obs: s(fd, "obs"), valor: num(fd, "valor"), meses: s(fd, "meses").trim() ? Number(s(fd, "meses")) : null });
      await prov.criarReceita(escopo, { modo, descricao: r.descricao, data_prevista: r.data, valor_parcela: r.valor, meses: r.meses, cliente: r.cliente, observacao: r.obs });
    }
  } },
  "receita.baixar": { msg: "Recebimento confirmado e lançado no extrato.", entidade: "receita", run: ({ prov, escopo, id }) => prov.acaoReceita(escopo, id, { acao: "confirmar" }).then(() => undefined) },
  "receita.perder": { msg: "Receita marcada como perdida.", entidade: "receita", run: ({ prov, escopo, fd, id }) => prov.acaoReceita(escopo, id, { acao: "perder", motivo: s(fd, "motivo").trim().slice(0, 300) || undefined }).then(() => undefined) },
  "receita.reverter": { msg: "Perda desfeita.", entidade: "receita", run: ({ prov, escopo, id }) => prov.acaoReceita(escopo, id, { acao: "reverter_perda" }).then(() => undefined) },
  "receita.editar": { msg: "Receita atualizada.", entidade: "receita", run: async ({ prov, escopo, fd, id }) => {
    const r = z.object({ descricao: texto(200), valor, data: dataZ, cliente: opt(120) }).parse({ descricao: s(fd, "descricao"), valor: num(fd, "valor"), data: s(fd, "data"), cliente: s(fd, "cliente") });
    await prov.acaoReceita(escopo, id, { acao: "editar", descricao: r.descricao, valor: r.valor, data_prevista: r.data, cliente: r.cliente ?? null });
  } },
  "receita.reclassificar": { msg: "Receita reclassificada.", entidade: "receita", run: ({ prov, escopo, fd, id }) => prov.acaoReceita(escopo, id, { acao: "editar", tipo_negocio: negocio(fd) }).then(() => undefined) },

  "contrato.encerrar": { msg: "Contrato encerrado: as parcelas futuras em aberto viraram perdidas.", entidade: "contrato", run: ({ prov, escopo, fd, id }) => prov.acaoContrato(escopo, id, { acao: "encerrar", motivo: s(fd, "motivo").trim().slice(0, 300) || undefined }) },

  "aporte.criar": { msg: "Aporte registrado.", entidade: "meta", soPessoal: true, run: async ({ prov, fd, id }) => {
    const a = z.object({ valor: z.number().finite().refine((v) => v !== 0).refine((v) => Math.abs(v) <= 1_000_000_000), data: dataOpt, obs: opt(300) }).parse({ valor: s(fd, "tipo_aporte") === "retirada" ? -Math.abs(num(fd, "valor")) : num(fd, "valor"), data: s(fd, "data"), obs: s(fd, "obs") });
    await prov.aporte({ meta_id: id, valor: a.valor, data: a.data, observacao: a.obs });
  } },
  "aporte.excluir": { msg: "Aporte excluído.", entidade: "meta", soPessoal: true, run: ({ prov, id }) => prov.excluirAporte(id) },
};

function voltarSeguro(fd: FormData): string {
  const v = s(fd, "voltar");
  return /^\/financeiro(\/[a-z-]+)*(\?[\w=&%.-]*)?$/.test(v) ? v : "/financeiro";
}
function ir(voltar: string, tipo: "ok" | "erro", msg: string): never {
  const [path, qs = ""] = voltar.split("?");
  const sp = new URLSearchParams(qs);
  sp.delete("ok"); sp.delete("erro");
  sp.set(tipo, msg);
  redirect(`${path}?${sp}`);
}

export async function fin(fd: FormData): Promise<void> {
  const voltar = voltarSeguro(fd);
  const sess = await requireUser();
  const op = OPS[s(fd, "op")];
  const escopo = s(fd, "escopo") === "pessoal" ? "pessoal" : "empresa";
  if (!op) ir(voltar, "erro", "Operação desconhecida.");
  const recusa = recusaDeEscrita(sess, escopo, s(fd, "op"), op.soPessoal);
  if (recusa) ir(voltar, "erro", recusa);
  const id = s(fd, "id").slice(0, 64);
  let erro: string | null = null;
  try {
    await op.run({ prov: obterProvedor(), escopo, fd, id });
  } catch (e) {
    erro = e instanceof z.ZodError ? "Confira os campos do formulário (valor, data e textos obrigatórios)." : e instanceof FinanceiroErro ? e.message : mensagemDoErro(e);
  }
  if (erro) ir(voltar, "erro", erro);
  // Auditoria: quem, o quê, onde — sem valores nem descrições.
  try {
    const r = await adminDb().from("audit_log").insert({ event: `financeiro_${s(fd, "op").replace(".", "_")}`, actor: sess.email, details: { escopo, entidade: op.entidade, id: id || null, para: s(fd, "para") || null } });
    if (r?.error) throw new Error("auditoria");
  } catch {
    console.error("[financeiro] a escrita foi feita, mas o registro de auditoria falhou");
  }
  revalidatePath("/financeiro", "layout");
  ir(voltar, "ok", op.msg);
}
