// Dados simulados da Etapa 2 do Financeiro (projeção, orçamentos, dívidas, contratos de despesa, histórico). Só desenvolvimento
// e capturas de tela (FINANCEIRO_FIXTURE); nada é real. Com estado em memória, na mesma regra do Vendedor IA: projeção por escopo,
// orçamentos/dívidas só no Pessoal, nunca apaga contrato, histórico guarda cópia do que foi excluído e deixa restaurar.
import { somarMeses, mesDe, ultimoDia } from "./periodo";
import {
  FinanceiroErro, type Conta, type ContratoDespesa, type Divida, type EscopoFin, type FinanceiroProvider, type ItemHistorico, type Orcamento,
  type Projecao, type Receita, type Transacao,
} from "./vendedoria";

const r2 = (x: number) => Math.round(x * 100) / 100;
const NEG = { empresa: "nexo", pessoal: "pessoal" } as const;
const nf = (): never => { throw new FinanceiroErro("Registro não encontrado (já foi alterado ou está em outra área).", "nao-encontrado", 404); };
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const dia = (mes: string, d: number) => `${mes}-${String(Math.min(d, Number(ultimoDia(mes).slice(8)))).padStart(2, "0")}`;
const somaDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Guardado { escopo: EscopoFin; tipo: "tx" | "conta"; dado: Transacao | Conta }
export interface EstadoBase { tx: Transacao[]; contas: Conta[]; rec: Receita[]; seq: number }
interface HistRegistro extends ItemHistorico { escopo: EscopoFin }
export interface Estado2 { orc: Orcamento[]; div: Divida[]; cd: ContratoDespesa[]; hist: HistRegistro[]; guardados: Map<string, Guardado> }

export function semente2(base: EstadoBase, hoje: string, vazio: boolean): Estado2 {
  const e: Estado2 = { orc: [], div: [], cd: [], hist: [], guardados: new Map() };
  if (vazio) return e;
  const id = (p: string) => `fx2-${p}-${++base.seq}`;
  const mAtual = mesDe(hoje);
  e.orc.push(
    { id: id("o"), categoria: "Alimentação", limite_mensal: 1200, gasto_atual: 0 },
    { id: id("o"), categoria: "Lazer", limite_mensal: 300, gasto_atual: 0 },
    { id: id("o"), categoria: "Saúde", limite_mensal: 350, gasto_atual: 0 },
    { id: id("o"), categoria: "Transporte", limite_mensal: 500, gasto_atual: 0 },
  );
  e.div.push(
    { id: id("d"), descricao: "Empréstimo com o Fernando", valor_total: 6000, valor_pago: 1800, parcela_mensal: 300, dia_vencimento: 10, credor: "Fernando", status: "ativa", observacao: null, restante: 4200, progresso: 30 },
    { id: id("d"), descricao: "Cartão parcelado (notebook)", valor_total: 2400, valor_pago: 2000, parcela_mensal: 200, dia_vencimento: 5, credor: "Banco", status: "ativa", observacao: null, restante: 400, progresso: 83.33 },
  );
  const cd = (o: Partial<ContratoDespesa> & Pick<ContratoDespesa, "descricao" | "tipo_negocio" | "valor_parcela" | "dia_vencimento">): ContratoDespesa => ({
    id: id("k"), credor: null, categoria: "Outros", parcelas_total: null, data_inicio: `${somarMeses(mAtual, -6)}-01`, entrada: null, saldo_devedor: null, estimada: false,
    status: "ativo", observacao: null, pagas: 6, pendentes: 2, restantes: null, valor_restante: null,
    proxima: { vencimento: dia(somarMeses(mAtual, Number(hoje.slice(8)) > o.dia_vencimento ? 1 : 0), o.dia_vencimento), valor: o.valor_parcela, numero: 7 }, ...o,
  });
  e.cd.push(
    cd({ descricao: "Aluguel da sala comercial", tipo_negocio: "nexo", categoria: "Aluguel", credor: "Imobiliária Centro", valor_parcela: 1800, dia_vencimento: 10, pagas: 11, pendentes: 2 }),
    cd({ descricao: "Ferramentas de edição (assinatura)", tipo_negocio: "nexo", categoria: "Assinaturas", valor_parcela: 390, dia_vencimento: 6, pagas: 8 }),
    cd({ descricao: "Hospedagem e domínio (anual em 12x)", tipo_negocio: "nexo", categoria: "Assinaturas", valor_parcela: 89.9, parcelas_total: 12, dia_vencimento: 20, pagas: 4, restantes: 8, valor_restante: 719.2, pendentes: 2 }),
    cd({ descricao: "Financiamento do carro", tipo_negocio: "pessoal", categoria: "Transporte", credor: "Banco do Brasil", valor_parcela: 1450, parcelas_total: 48, dia_vencimento: 15, pagas: 14, restantes: 34, valor_restante: 49300, saldo_devedor: 52800 }),
    cd({ descricao: "Internet residencial", tipo_negocio: "pessoal", categoria: "Moradia", valor_parcela: 129.9, dia_vencimento: 8, pagas: 20 }),
    cd({ descricao: "Energia elétrica", tipo_negocio: "pessoal", categoria: "Moradia", valor_parcela: 280, dia_vencimento: 22, estimada: true, pagas: 9 }),
    cd({ descricao: "Plano antigo de telefonia", tipo_negocio: "pessoal", categoria: "Moradia", valor_parcela: 89, dia_vencimento: 12, status: "encerrado", pagas: 18, pendentes: 0, proxima: null }),
  );
  const h = (escopo: EscopoFin, entidade: string, acao: ItemHistorico["acao"], descricao: string, valor: number, dias: number, extra: Partial<HistRegistro> = {}) =>
    e.hist.push({ id: id("h"), escopo, entidade, entidade_id: id("e"), acao, criado_em: `${somaDias(hoje, -dias)}T14:${String(10 + e.hist.length).padStart(2, "0")}:00.000Z`, descricao, valor, restauravel: false, ...extra });
  // Cópias de lançamentos excluídos (para testar a restauração)
  const txApagada: Transacao = { id: id("t"), tipo: "despesa", valor: 59.9, descricao: "Assinatura de plugin (cancelada)", categoria: "Assinaturas", tipo_negocio: "nexo", empresa: null, data_transacao: `${dia(mAtual, 2)}T00:00:00.000Z`, mes: mAtual, confirmado: true };
  const contaApagada: Conta = { id: id("c"), descricao: "Seguro do celular", valor: 49.9, data_vencimento: `${dia(mAtual, 25)}T00:00:00.000Z`, categoria: "Outros", tipo_negocio: "pessoal", recorrente: false, frequencia: null, status: "pendente", transacao_id: null, estimada: false };
  h("empresa", "Transacao", "excluido", txApagada.descricao, txApagada.valor, 1, { entidade_id: txApagada.id, restauravel: true });
  e.guardados.set(e.hist[e.hist.length - 1].id, { escopo: "empresa", tipo: "tx", dado: txApagada });
  h("pessoal", "ContaPagarMax", "excluido", contaApagada.descricao, contaApagada.valor, 2, { entidade_id: contaApagada.id, restauravel: true });
  e.guardados.set(e.hist[e.hist.length - 1].id, { escopo: "pessoal", tipo: "conta", dado: contaApagada });
  h("empresa", "ReceitaPrevistaMax", "atualizado", "Consultoria pontual — Lumiere", 2300, 1);
  h("empresa", "ContaPagarMax", "criado", "Meta Ads — próxima fatura", 1480, 3);
  h("empresa", "ContratoDespesa", "atualizado", "Aluguel da sala comercial", 1800, 5);
  h("empresa", "Transacao", "criado", "Mensalidade Showman", 3400, 6);
  h("empresa", "Transacao", "atualizado", "Freelancer de design", 1200, 8);
  h("pessoal", "DividaMax", "atualizado", "Empréstimo com o Fernando", 300, 4);
  h("pessoal", "OrcamentoMax", "atualizado", "Lazer", 300, 5);
  h("pessoal", "Transacao", "criado", "Mercado", 410.35, 2);
  h("pessoal", "ContratoDespesa", "criado", "Energia elétrica", 280, 9);
  h("pessoal", "MetaFinanceiraMax", "atualizado", "Reserva de emergência", 30000, 7);
  return e;
}

/** Acrescenta ao provedor base os métodos da Etapa 2 e liga a auditoria às exclusões do base. */
export function estenderFixture(
  b: Omit<FinanceiroProvider, keyof ReturnType<typeof metodos>>, s: EstadoBase, s2: Estado2, hoje: string,
): FinanceiroProvider {
  const m = metodos(s, s2, hoje);
  const id = (p: string) => `fx2-${p}-${++s.seq}`;
  const registrar = (escopo: EscopoFin, entidade: string, acao: ItemHistorico["acao"], descricao: string | null, valor: number | null, extra: Partial<HistRegistro> = {}) =>
    s2.hist.unshift({ id: id("h"), escopo, entidade, entidade_id: id("e"), acao, criado_em: new Date().toISOString(), descricao, valor, restauravel: false, ...extra });
  return {
    ...b,
    ...m,
    async excluirTransacao(e, tid) {
      const x = (await b.transacoes(e, { pageSize: 100000 })).transacoes.find((t) => t.id === tid);
      await b.excluirTransacao(e, tid);
      if (x) { registrar(e, "Transacao", "excluido", x.descricao, x.valor, { entidade_id: x.id, restauravel: true }); s2.guardados.set(s2.hist[0].id, { escopo: e, tipo: "tx", dado: x }); }
    },
    async excluirConta(e, cid) {
      const x = (await b.contas(e)).find((c) => c.id === cid);
      await b.excluirConta(e, cid);
      if (x) { registrar(e, "ContaPagarMax", "excluido", x.descricao, x.valor, { entidade_id: x.id, restauravel: true }); s2.guardados.set(s2.hist[0].id, { escopo: e, tipo: "conta", dado: x }); }
    },
    async salvarOrcamento(o) { await m.salvarOrcamento(o); registrar("pessoal", "OrcamentoMax", "atualizado", o.categoria, o.limite_mensal); },
    async excluirOrcamento(c) { await m.excluirOrcamento(c); registrar("pessoal", "OrcamentoMax", "excluido", c, null); },
    async acaoDivida(did, a) { const d = s2.div.find((x) => x.id === did); await m.acaoDivida(did, a); if (d) registrar("pessoal", "DividaMax", "atualizado", d.descricao, a.acao === "pagar_parcela" ? a.valor : d.valor_total); },
    async criarContratoDespesa(e, c) { await m.criarContratoDespesa(e, c); registrar(e, "ContratoDespesa", "criado", c.descricao, c.valor_parcela); },
    async acaoContratoDespesa(e, cid, a) { const c = s2.cd.find((x) => x.id === cid); await m.acaoContratoDespesa(e, cid, a); if (c) registrar(a.acao === "editar" && a.tipo_negocio ? (a.tipo_negocio === "nexo" ? "empresa" : "pessoal") : e, "ContratoDespesa", "atualizado", c.descricao, c.valor_parcela); },
  };
}

function metodos(s: EstadoBase, s2: Estado2, hoje: string) {
  const doEscopo = <T extends { tipo_negocio?: string | null }>(xs: T[], e: EscopoFin) => xs.filter((x) => (x.tipo_negocio ?? "pessoal") === NEG[e]);
  const mAtual = mesDe(hoje);
  const gasto = (cat: string) => r2(doEscopo(s.tx, "pessoal").filter((t) => t.confirmado && t.tipo === "despesa" && t.mes === mAtual && norm(t.categoria) === norm(cat)).reduce((a, t) => a + t.valor, 0));
  return {
    async projecao(e: EscopoFin, dias = 30): Promise<Projecao> {
      const n = Math.min(60, Math.max(1, dias));
      const tx = doEscopo(s.tx, e).filter((t) => t.confirmado);
      const saldoAtual = r2(tx.filter((t) => t.mes === mAtual && t.tipo === "receita").reduce((a, t) => a + t.valor, 0) - tx.filter((t) => t.mes === mAtual && t.tipo === "despesa").reduce((a, t) => a + t.valor, 0));
      const desp60 = tx.filter((t) => t.tipo === "despesa" && t.data_transacao.slice(0, 10) >= somaDias(hoje, -60));
      const primeira = desp60.map((t) => t.data_transacao.slice(0, 10)).sort()[0];
      const diasComDados = primeira ? Math.min(60, Math.max(1, Math.round((Date.parse(hoje) - Date.parse(primeira)) / 86_400_000) + 1)) : 60;
      const burn = r2(desp60.reduce((a, t) => a + t.valor, 0) / diasComDados);
      const rec = doEscopo(s.rec, e).filter((r) => r.status === "pendente");
      const contas = doEscopo(s.contas, e).filter((c) => c.status === "pendente");
      let saldo = saldoAtual; let negativo: string | null = null;
      const out: Projecao["dias"] = [];
      for (let i = 0; i < n; i++) {
        const d = somaDias(hoje, i);
        const eventos: string[] = [];
        saldo -= burn;
        for (const r of rec.filter((x) => x.data_prevista.slice(0, 10) === d)) { saldo += r.valor; eventos.push(`Receita: ${r.descricao} R$${r.valor.toFixed(2)}`); }
        for (const c of contas.filter((x) => x.data_vencimento.slice(0, 10) === d)) { saldo -= c.valor; eventos.push(`Conta: ${c.descricao} R$${c.valor.toFixed(2)}`); }
        saldo = r2(saldo);
        if (saldo < 0 && !negativo) negativo = d;
        out.push({ data: d, saldo, eventos });
      }
      return { escopo: NEG[e], saldo_atual: saldoAtual, burn_rate: burn, primeiro_negativo: negativo, dias: out };
    },
    async orcamentos(): Promise<Orcamento[]> { return [...s2.orc].sort((a, b) => a.categoria.localeCompare(b.categoria, "pt-BR")).map((o) => ({ ...o, gasto_atual: gasto(o.categoria) })); },
    async salvarOrcamento(o: { categoria: string; limite_mensal: number }) {
      const x = s2.orc.find((y) => y.categoria === o.categoria);
      if (x) x.limite_mensal = r2(o.limite_mensal); else s2.orc.push({ id: `fx2-o-${++s.seq}`, categoria: o.categoria, limite_mensal: r2(o.limite_mensal), gasto_atual: 0 });
    },
    async excluirOrcamento(categoria: string) { const i = s2.orc.findIndex((y) => y.categoria === categoria); if (i < 0) nf(); s2.orc.splice(i, 1); },
    async dividas(): Promise<Divida[]> { return s2.div.filter((d) => d.status === "ativa"); },
    async acaoDivida(did: string, a: { acao: "pagar_parcela"; valor: number } | { acao: "quitar" }) {
      const d = s2.div.find((x) => x.id === did) ?? nf();
      if (a.acao === "quitar") { d.status = "quitada"; d.valor_pago = d.valor_total; }
      else {
        const v = r2(a.valor);
        if (v > d.restante) throw new FinanceiroErro(`Valor da parcela (${v}) maior que o restante da dívida (${d.restante})`, "rejeitado", 400);
        d.valor_pago = r2(d.valor_pago + v);
        if (d.valor_pago >= d.valor_total) d.status = "quitada";
        s.tx.push({ id: `fx2-t-${++s.seq}`, tipo: "despesa", valor: v, descricao: `Parcela: ${d.descricao}`, categoria: "Dividas/Parcelas", tipo_negocio: "pessoal", empresa: null, data_transacao: `${hoje}T00:00:00.000Z`, mes: mAtual, confirmado: true });
      }
      d.restante = r2(d.valor_total - d.valor_pago);
      d.progresso = d.valor_total > 0 ? Math.round((d.valor_pago / d.valor_total) * 10000) / 100 : 0;
    },
    async contratosDespesa(e: EscopoFin): Promise<ContratoDespesa[]> { return doEscopo(s2.cd, e).sort((a, b) => a.status.localeCompare(b.status) || a.descricao.localeCompare(b.descricao, "pt-BR")); },
    async criarContratoDespesa(e: EscopoFin, c: { descricao: string; valor_parcela: number; primeiro_vencimento: string; parcelas_total?: number | null; dia_vencimento?: number; credor?: string | null; categoria?: string; saldo_devedor?: number | null; estimada?: boolean; observacao?: string | null }) {
      if (s2.cd.some((x) => x.status === "ativo" && norm(x.descricao) === norm(c.descricao))) throw new FinanceiroErro(`Já existe um contrato ativo chamado "${c.descricao}".`, "rejeitado", 400);
      const dv = c.dia_vencimento ?? Number(c.primeiro_vencimento.slice(8));
      s2.cd.push({
        id: `fx2-k-${++s.seq}`, descricao: c.descricao, credor: c.credor ?? null, categoria: c.categoria ?? "Outros", tipo_negocio: NEG[e], valor_parcela: c.valor_parcela, parcelas_total: c.parcelas_total ?? null,
        dia_vencimento: dv, data_inicio: c.primeiro_vencimento, entrada: null, saldo_devedor: c.saldo_devedor ?? null, estimada: c.estimada ?? false, status: "ativo", observacao: c.observacao ?? null,
        pagas: 0, pendentes: 2, restantes: c.parcelas_total ?? null, valor_restante: c.parcelas_total ? r2(c.parcelas_total * c.valor_parcela) : null,
        proxima: { vencimento: c.primeiro_vencimento, valor: c.valor_parcela, numero: 1 },
      });
    },
    async acaoContratoDespesa(e: EscopoFin, cid: string, a: { acao: "encerrar" } | { acao: "reativar" } | ({ acao: "editar" } & Partial<ContratoDespesa> & { tipo_negocio?: "nexo" | "pessoal" })) {
      const c = doEscopo(s2.cd, e).find((x) => x.id === cid) ?? nf();
      if (a.acao === "encerrar") { c.status = "encerrado"; c.proxima = null; }
      else if (a.acao === "reativar") c.status = "ativo";
      else { const { acao: _a, ...resto } = a; if (!Object.keys(resto).length) throw new FinanceiroErro("Nada para alterar.", "rejeitado", 400); Object.assign(c, resto); }
    },
    async historico(e: EscopoFin, f: { entidade?: string; acao?: string; de?: string; ate?: string; q?: string; page?: number; pageSize?: number }) {
      let xs = s2.hist.filter((h) => h.escopo === e);
      const entidades = [...new Set(xs.map((h) => h.entidade))].sort();
      if (f.entidade) xs = xs.filter((h) => h.entidade === f.entidade);
      if (f.acao) xs = xs.filter((h) => h.acao === f.acao);
      if (f.de) xs = xs.filter((h) => h.criado_em.slice(0, 10) >= f.de!);
      if (f.ate) xs = xs.filter((h) => h.criado_em.slice(0, 10) <= f.ate!);
      if (f.q) xs = xs.filter((h) => (h.descricao ?? "").toLowerCase().includes(f.q!.toLowerCase()) || h.entidade_id === f.q);
      xs = [...xs].sort((a, b) => b.criado_em.localeCompare(a.criado_em));
      const size = f.pageSize ?? 30, page = f.page ?? 1;
      const itens = xs.slice((page - 1) * size, page * size).map(({ escopo: _e, ...h }) => h);
      return { itens, total: xs.length, pagina: page, paginas: Math.max(1, Math.ceil(xs.length / size)), entidades };
    },
    async restaurar(e: EscopoFin, hid: string) {
      const h = s2.hist.find((x) => x.id === hid && x.escopo === e) ?? nf();
      const g = s2.guardados.get(hid);
      if (h.acao !== "excluido" || !g) throw new FinanceiroErro("Só é possível restaurar lançamentos excluídos.", "rejeitado", 409);
      if (!h.restauravel) throw new FinanceiroErro("Este lançamento já existe — nada a restaurar.", "rejeitado", 409);
      if (g.tipo === "tx") s.tx.push(g.dado as Transacao); else s.contas.push(g.dado as Conta);
      h.restauravel = false;
      s2.hist.unshift({ id: `fx2-h-${++s.seq}`, escopo: e, entidade: h.entidade, entidade_id: h.entidade_id, acao: "criado", criado_em: new Date().toISOString(), descricao: h.descricao, valor: h.valor, restauravel: false });
    },
  };
}
