// Dados simulados do Financeiro SÓ para desenvolvimento e capturas de tela. Ativados por FINANCEIRO_FIXTURE=1 e
// ignorados em produção (NODE_ENV=production ou VERCEL_ENV=production: Vercel produção e previews). Não há nada real aqui.
// O provedor simulado é com estado (em memória): criar, editar, confirmar e excluir funcionam, para testar a tela inteira.
import { estenderFixture, semente2 } from "./fixture-etapa2";
import { hojeBrasilia, rotuloMes, mesDe, somarMeses, ultimoDia, ddmm } from "./periodo";
import {
  FinanceiroErro, type Conta, type Contrato, type Dre, type DreValores, type EscopoFin, type FinanceiroProvider, type FiltroTransacoes,
  type Meta, type PeriodoFin, type Receita, type Resumo, type Transacao,
} from "./vendedoria";

export type ModoFixtureFin = "1" | "vazio" | "erro";

export function fixtureFinanceiroAtiva(env: NodeJS.ProcessEnv = process.env): ModoFixtureFin | null {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return null;
  const v = env.FINANCEIRO_FIXTURE?.trim();
  return v === "1" || v === "vazio" || v === "erro" ? v : null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const NEG = { empresa: "nexo", pessoal: "pessoal" } as const;
const dia = (mes: string, d: number) => `${mes}-${String(Math.min(d, Number(ultimoDia(mes).slice(8)))).padStart(2, "0")}`;

interface Estado { tx: Transacao[]; contas: Conta[]; rec: Receita[]; ct: Contrato[]; metas: Meta[]; seq: number }

function semente(hoje: string, vazio: boolean): Estado {
  const e: Estado = { tx: [], contas: [], rec: [], ct: [], metas: [], seq: 0 };
  if (vazio) return e;
  const id = (p: string) => `fx-${p}-${++e.seq}`;
  const mAtual = mesDe(hoje);
  const tx = (mes: string, d: number, tipo: "receita" | "despesa", valor: number, descricao: string, categoria: string, neg: "nexo" | "pessoal", confirmado = true) => {
    const data = dia(mes, d);
    if (data > hoje) return;
    e.tx.push({ id: id("t"), tipo, valor, descricao, categoria, tipo_negocio: neg, empresa: null, data_transacao: `${data}T00:00:00.000Z`, mes, confirmado });
  };
  [-3, -2, -1, 0].forEach((k, i) => {
    const m = somarMeses(mAtual, k);
    const f = 1 + i * 0.06;
    tx(m, 5, "receita", r2(4800 * f), "Mensalidade Nicoletti Professional", "Mensalidade", "nexo");
    tx(m, 8, "receita", r2(3200 * f), "Mensalidade Showman", "Mensalidade", "nexo");
    tx(m, 10, "receita", 2100, "Mensalidade Vulk Jeans", "Mensalidade", "nexo");
    tx(m, 12, "receita", 1900, "Implantação Casa Ambos", "Receita Prevista", "nexo");
    tx(m, 3, "despesa", r2(1480 * f), "Meta Ads — conta da agência", "Anúncios", "nexo");
    tx(m, 6, "despesa", 390, "Ferramentas e assinaturas", "Assinaturas", "nexo");
    tx(m, 11, "despesa", 650, "Contabilidade", "Negócios", "nexo");
    tx(m, 14, "despesa", 1200, "Freelancer de design", "Equipe e freelancers", "nexo");
    tx(m, 15, "despesa", 480, "Impostos (DAS)", "Impostos e taxas", "nexo");
    tx(m, 5, "receita", 6000, "Pró-labore", "Salário", "pessoal");
    tx(m, 4, "despesa", 2800, "Aluguel e condomínio", "Moradia", "pessoal");
    tx(m, 9, "despesa", r2(1150 * f), "Mercado", "Alimentação", "pessoal");
    tx(m, 13, "despesa", 420, "Restaurantes e lazer", "Lazer", "pessoal");
    tx(m, 16, "despesa", 380, "Plano de saúde", "Saúde", "pessoal");
  });
  // Um lançamento da empresa que na verdade é pessoal (para testar a reclassificação)
  tx(mAtual, 2, "despesa", 349.9, "Notebook (compra no cartão)", "Negócios", "nexo");
  const em = (mes: string, d: number, valor: number, descricao: string, categoria: string, neg: "nexo" | "pessoal", status: Conta["status"] = "pendente", rec = false) =>
    e.contas.push({ id: id("c"), descricao, valor, data_vencimento: `${dia(mes, d)}T00:00:00.000Z`, categoria, tipo_negocio: neg, recorrente: rec, frequencia: rec ? "mensal" : null, status, transacao_id: null, estimada: false });
  em(mAtual, Math.max(1, Number(hoje.slice(8)) - 5), 390, "Ferramentas e assinaturas", "Assinaturas", "nexo", "pendente", true);
  em(mAtual, Math.min(28, Number(hoje.slice(8)) + 3), 1480, "Meta Ads — próxima fatura", "Anúncios", "nexo", "pendente", true);
  em(mAtual, 28, 650, "Contabilidade", "Negócios", "nexo");
  em(somarMeses(mAtual, 1), 5, 1200, "Freelancer de design", "Equipe e freelancers", "nexo");
  em(mAtual, 2, 480, "Impostos (DAS)", "Impostos e taxas", "nexo", "paga");
  em(mAtual, Math.min(28, Number(hoje.slice(8)) + 6), 2800, "Aluguel e condomínio", "Moradia", "pessoal", "pendente", true);
  em(mAtual, Math.min(28, Number(hoje.slice(8)) + 9), 380, "Plano de saúde", "Saúde", "pessoal", "pendente", true);
  const ctA = { id: id("k"), descricao: "Gestão de marketplaces — Nicoletti", cliente: "Nicoletti Professional", tipo_negocio: "nexo", modo: "recorrente", valor_parcela: 5100, valor_total: null, duracao_meses: null, dia_vencimento: 5, data_inicio: `${somarMeses(mAtual, -6)}-05`, status: "ativo", parcelas: { recebidas: { quantidade: 6, total: 28200 }, abertas: { quantidade: 12, total: 61200 }, perdidas: { quantidade: 0, total: 0 } } };
  const ctB = { id: id("k"), descricao: "Mídia e conteúdo — Showman", cliente: "Showman", tipo_negocio: "nexo", modo: "recorrente", valor_parcela: 3400, valor_total: null, duracao_meses: 12, dia_vencimento: 8, data_inicio: `${somarMeses(mAtual, -3)}-08`, status: "ativo", parcelas: { recebidas: { quantidade: 3, total: 9600 }, abertas: { quantidade: 9, total: 30600 }, perdidas: { quantidade: 0, total: 0 } } };
  const ctC = { id: id("k"), descricao: "Implantação Casa Ambos (4x)", cliente: "Casa Ambos", tipo_negocio: "nexo", modo: "parcelada", valor_parcela: 1900, valor_total: 7600, duracao_meses: 4, dia_vencimento: 12, data_inicio: `${somarMeses(mAtual, -1)}-12`, status: "ativo", parcelas: { recebidas: { quantidade: 2, total: 3800 }, abertas: { quantidade: 2, total: 3800 }, perdidas: { quantidade: 0, total: 0 } } };
  e.ct.push(ctA, ctB, ctC);
  const rc = (mes: string, d: number, valor: number, descricao: string, cliente: string, neg: string | null, status: string, ct?: Contrato, parcela?: number) =>
    e.rec.push({ id: id("r"), descricao, valor, data_prevista: `${dia(mes, d)}T00:00:00.000Z`, tipo_negocio: neg, cliente, status, data_recebimento: status === "recebida" ? `${dia(mes, d)}T00:00:00.000Z` : null, observacao: null, motivo_perda: status === "perdida" ? "Cliente cancelou antes da entrega" : null, contrato_id: ct?.id ?? null, parcela_numero: parcela ?? null, parcelas_total: ct?.duracao_meses ?? null, atrasada: status === "pendente" && dia(mes, d) < hoje });
  rc(mAtual, 5, 5100, "Gestão de marketplaces — Nicoletti (parcela)", "Nicoletti Professional", "nexo", "recebida", ctA, 7);
  rc(mAtual, 8, 3400, "Mídia e conteúdo — Showman (parcela)", "Showman", "nexo", "recebida", ctB, 4);
  rc(mAtual, 12, 1900, "Implantação Casa Ambos (parcela)", "Casa Ambos", "nexo", "recebida", ctC, 3);
  rc(mAtual, Math.min(28, Number(hoje.slice(8)) + 4), 2300, "Consultoria pontual — Lumiere", "Lumiere", "nexo", "pendente");
  rc(mAtual, Math.max(1, Number(hoje.slice(8)) - 3), 950, "Ajuste de campanha — Plenitude", "Plenitude", "nexo", "atrasada");
  rc(mAtual, 20, 800, "Treinamento — Vulk Jeans", "Vulk Jeans", "nexo", "perdida");
  rc(somarMeses(mAtual, 1), 5, 5100, "Gestão de marketplaces — Nicoletti (parcela)", "Nicoletti Professional", "nexo", "pendente", ctA, 8);
  rc(somarMeses(mAtual, 1), 8, 3400, "Mídia e conteúdo — Showman (parcela)", "Showman", "nexo", "pendente", ctB, 5);
  rc(somarMeses(mAtual, 1), 12, 1900, "Implantação Casa Ambos (parcela)", "Casa Ambos", "nexo", "pendente", ctC, 4);
  rc(mAtual, 25, 1500, "Aula particular", "Aluno", null, "pendente");
  e.metas.push({
    id: id("m"), descricao: "Reserva de emergência", alvo: 30000, atual: 12400, aporteDiario: 50, cobrarDiariamente: true, dataInicio: `${somarMeses(mAtual, -4)}-01`, dataFim: `${somarMeses(mAtual, 8)}-28`, status: "ativa",
    projecao: { falta: 17600, pct: 41.3, diasRestantes: 255, pendenteHoje: 50, atraso: 150, projetadoNoPrazo: 25150, necessarioPorDia: 69, vaiBater: false, concluida: false },
    ultimosAportes: [{ id: id("a"), valor: 50, data: `${hoje.slice(0, 8)}${String(Math.max(1, Number(hoje.slice(8)) - 1)).padStart(2, "0")}`, origem: "max", observacao: null }, { id: id("a"), valor: 200, data: `${mAtual}-01`, origem: "tela", observacao: "Bônus" }],
  });
  return e;
}

const alvo = (e: EscopoFin) => NEG[e];
const doEscopo = <T extends { tipo_negocio?: string | null }>(xs: T[], e: EscopoFin) => xs.filter((x) => (x.tipo_negocio ?? "pessoal") === alvo(e));
const nf = (): never => { throw new FinanceiroErro("Registro não encontrado (já foi alterado ou está em outra área).", "nao-encontrado", 404); };

function intervalo(p: PeriodoFin, hoje: string): { de: string; ate: string; mes: string | null; label: string } {
  if (p.dia) return { de: p.dia, ate: p.dia, mes: null, label: ddmm(p.dia) };
  if (p.de || p.ate) return { de: p.de ?? "0000-01-01", ate: p.ate ?? "9999-12-31", mes: null, label: "período" };
  const mes = p.mes ?? mesDe(hoje);
  return { de: `${mes}-01`, ate: ultimoDia(mes), mes, label: mes };
}

export function criarProvedorFixture(modo: ModoFixtureFin, hoje = hojeBrasilia()): FinanceiroProvider {
  if (modo === "erro") {
    const falha = async (): Promise<never> => { throw new FinanceiroErro("Não foi possível falar com o Vendedor IA.", "rede"); };
    return new Proxy({}, { get: () => falha }) as FinanceiroProvider;
  }
  const s = semente(hoje, modo === "vazio");
  const s2 = semente2(s, hoje, modo === "vazio");
  const id = (p: string) => `fx-${p}-${++s.seq}`;
  const somaTx = (e: EscopoFin, tipo: "receita" | "despesa", de: string, ate: string) =>
    r2(doEscopo(s.tx, e).filter((t) => t.confirmado && t.tipo === tipo && t.data_transacao.slice(0, 10) >= de && t.data_transacao.slice(0, 10) <= ate).reduce((a, t) => a + t.valor, 0));
  const dreDe = (e: EscopoFin, de: string, ate: string): DreValores => {
    const rec = somaTx(e, "receita", de, ate), desp = somaTx(e, "despesa", de, ate);
    const imp = r2(doEscopo(s.tx, e).filter((t) => t.confirmado && t.categoria === "Impostos e taxas" && t.data_transacao.slice(0, 10) >= de && t.data_transacao.slice(0, 10) <= ate).reduce((a, t) => a + t.valor, 0));
    const custos = r2(doEscopo(s.tx, e).filter((t) => t.confirmado && t.tipo === "despesa" && ["Equipe e freelancers", "Anúncios"].includes(t.categoria) && t.data_transacao.slice(0, 10) >= de && t.data_transacao.slice(0, 10) <= ate).reduce((a, t) => a + t.valor, 0));
    const op = r2(desp - imp - custos);
    const liq = r2(rec - imp - custos - op);
    return { receitaBruta: rec, deducoes: imp, receitaLiquida: r2(rec - imp), custos, lucroBruto: r2(rec - imp - custos), despesasOperacionais: op, resultadoOperacional: liq, receitasFinanceiras: 0, despesasFinanceiras: 0, resultadoAntesImpostos: liq, impostos: 0, resultadoLiquido: liq, dividas: 0, investimentos: 0, entradasNaoOperacionais: 0, sobraCaixa: liq, margemLiquida: rec > 0 ? Math.round((liq / rec) * 1000) / 10 : null };
  };
  const tx = (e: EscopoFin, t: string) => { const x = s.tx.find((y) => y.id === t && doEscopo([y], e).length); return x ?? nf(); };

  const base: Omit<FinanceiroProvider, "projecao" | "orcamentos" | "salvarOrcamento" | "excluirOrcamento" | "dividas" | "acaoDivida" | "contratosDespesa" | "criarContratoDespesa" | "acaoContratoDespesa" | "historico" | "restaurar"> = {
    async resumo(e, p) {
      const { de, ate, mes, label } = intervalo(p, hoje);
      const m = mes ?? mesDe(ate);
      const ant = somarMeses(m, -1);
      const receitas = somaTx(e, "receita", de, ate), despesas = somaTx(e, "despesa", de, ate);
      const recAnt = somaTx(e, "receita", `${ant}-01`, ultimoDia(ant)), despAnt = somaTx(e, "despesa", `${ant}-01`, ultimoDia(ant));
      const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : null) : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
      const cats = new Map<string, number>();
      for (const t of doEscopo(s.tx, e)) if (t.confirmado && t.tipo === "despesa" && t.data_transacao.slice(0, 10) >= de && t.data_transacao.slice(0, 10) <= ate) cats.set(t.categoria, r2((cats.get(t.categoria) ?? 0) + t.valor));
      const prev = doEscopo(s.rec, e).filter((r) => (r.status === "pendente" || r.status === "atrasada") && r.data_prevista.slice(0, 10) >= de && r.data_prevista.slice(0, 10) <= ate);
      const atras = doEscopo(s.rec, e).filter((r) => (r.status === "pendente" || r.status === "atrasada") && r.data_prevista.slice(0, 10) < de);
      const rcv = doEscopo(s.rec, e).filter((r) => r.status === "recebida" && r.data_prevista.slice(0, 10) >= de && r.data_prevista.slice(0, 10) <= ate);
      const per = doEscopo(s.rec, e).filter((r) => r.status === "perdida" && r.data_prevista.slice(0, 10) >= de && r.data_prevista.slice(0, 10) <= ate);
      const resumo = (r: Receita) => ({ id: r.id, descricao: r.descricao, valor: r.valor, data_prevista: r.data_prevista, cliente: r.cliente ?? null, status: r.status, atrasada: r.data_prevista.slice(0, 10) < hoje && r.status !== "recebida" });
      const out: Resumo = {
        periodo: { tipo: mes ? "mes" : "intervalo", mes, de, ate, label },
        competencia: { mesAtual: mesDe(hoje), hoje, ehMesAtual: m === mesDe(hoje) },
        receitas, despesas, saldo: r2(receitas - despesas),
        meta: e === "empresa" && mes ? { alvo: 15000, atual: receitas } : null,
        categorias: [...cats.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total),
        mensal: [-5, -4, -3, -2, -1, 0].map((k) => { const mm = somarMeses(m, k); return { mes: mm, receitas: somaTx(e, "receita", `${mm}-01`, ultimoDia(mm)), despesas: somaTx(e, "despesa", `${mm}-01`, ultimoDia(mm)) }; }),
        comparativo: { periodoAnterior: { label: ant }, receitas: { atual: receitas, anterior: recAnt, variacaoPct: pct(receitas, recAnt) }, despesas: { atual: despesas, anterior: despAnt, variacaoPct: pct(despesas, despAnt) }, saldo: { atual: r2(receitas - despesas), anterior: r2(recAnt - despAnt), variacaoPct: pct(receitas - despesas, recAnt - despAnt) } },
        receitasPrevistas: {
          total: r2(prev.reduce((a, r) => a + r.valor, 0)), quantidade: prev.length, recebido: r2(rcv.reduce((a, r) => a + r.valor, 0)), recebidoQuantidade: rcv.length, itens: prev.map(resumo),
          atrasadasAnteriores: { total: r2(atras.reduce((a, r) => a + r.valor, 0)), quantidade: atras.length }, perdidas: { total: r2(per.reduce((a, r) => a + r.valor, 0)), quantidade: per.length },
        },
      };
      return out;
    },
    async dre(e, p) {
      const { de, ate, mes, label } = intervalo(p, hoje);
      const m = mes ?? mesDe(ate);
      const ant = somarMeses(m, -1);
      const prevR = r2(doEscopo(s.rec, e).filter((r) => r.status !== "recebida" && r.status !== "perdida" && r.data_prevista.slice(0, 10) >= de && r.data_prevista.slice(0, 10) <= ate).reduce((a, r) => a + r.valor, 0));
      const prevD = r2(doEscopo(s.contas, e).filter((c) => c.status === "pendente" && c.data_vencimento.slice(0, 10) >= de && c.data_vencimento.slice(0, 10) <= ate).reduce((a, c) => a + c.valor, 0));
      const atual = dreDe(e, de, ate);
      const proj = { ...atual, receitaBruta: r2(atual.receitaBruta + prevR), receitaLiquida: r2(atual.receitaLiquida + prevR), lucroBruto: r2(atual.lucroBruto + prevR), resultadoOperacional: r2(atual.resultadoOperacional + prevR - prevD), resultadoAntesImpostos: r2(atual.resultadoAntesImpostos + prevR - prevD), resultadoLiquido: r2(atual.resultadoLiquido + prevR - prevD), sobraCaixa: r2(atual.sobraCaixa + prevR - prevD) };
      const out: Dre = {
        periodo: { mes, de, ate, label: mes ? rotuloMes(mes) : label },
        anterior: { label: rotuloMes(ant) },
        realizado: { atual, anterior: dreDe(e, `${ant}-01`, ultimoDia(ant)) },
        projetado: { atual: proj, previsto: { receitas: prevR, receitasQtd: 0, despesas: prevD, despesasQtd: 0 } },
        serie: [-5, -4, -3, -2, -1, 0].map((k) => { const mm = somarMeses(m, k); const d = dreDe(e, `${mm}-01`, ultimoDia(mm)); return { mes: mm, label: mm, receitaLiquida: d.receitaLiquida, saidas: r2(d.receitaLiquida - d.resultadoLiquido), resultadoLiquido: d.resultadoLiquido }; }),
        insights: atual.receitaBruta > 0 ? ["As despesas de anúncios são a maior saída do período.", "O resultado do mês acompanha a recorrência dos contratos ativos."] : [],
      };
      return out;
    },
    async transacoes(e, f: FiltroTransacoes) {
      let xs = doEscopo(s.tx, e);
      if (f.tipo) xs = xs.filter((t) => t.tipo === f.tipo);
      if (f.categoria) xs = xs.filter((t) => t.categoria === f.categoria);
      if (f.texto) xs = xs.filter((t) => t.descricao.toLowerCase().includes(f.texto!.toLowerCase()));
      if (f.confirmado !== undefined) xs = xs.filter((t) => t.confirmado === f.confirmado);
      if (f.de) xs = xs.filter((t) => t.data_transacao.slice(0, 10) >= f.de!);
      if (f.ate) xs = xs.filter((t) => t.data_transacao.slice(0, 10) <= f.ate!);
      xs = [...xs].sort((a, b) => b.data_transacao.localeCompare(a.data_transacao));
      const size = f.pageSize ?? 30, page = f.page ?? 1;
      return { transacoes: xs.slice((page - 1) * size, page * size), total: xs.length, pagina: page, paginas: Math.max(1, Math.ceil(xs.length / size)), categorias: [...new Set(doEscopo(s.tx, e).map((t) => t.categoria))].sort() };
    },
    async criarTransacao(e, t) {
      const data = t.data_transacao ?? hoje;
      const novo: Transacao = { id: id("t"), tipo: t.tipo, valor: t.valor, descricao: t.descricao, categoria: t.categoria, tipo_negocio: alvo(e), empresa: t.empresa ?? null, data_transacao: `${data}T00:00:00.000Z`, mes: mesDe(data), confirmado: true };
      s.tx.push(novo);
      return novo;
    },
    async editarTransacao(e, tid, t) {
      const x = tx(e, tid);
      const { data_transacao, ...resto } = t;
      Object.assign(x, resto);
      if (data_transacao) { x.data_transacao = `${data_transacao}T00:00:00.000Z`; x.mes = mesDe(data_transacao); }
      return x;
    },
    async confirmarTransacao(e, tid) { const x = tx(e, tid); x.confirmado = true; return x; },
    async excluirTransacao(e, tid) { const x = tx(e, tid); s.tx.splice(s.tx.indexOf(x), 1); },
    async contas(e, status) { return doEscopo(s.contas, e).filter((c) => !status || c.status === status).sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)); },
    async criarConta(e, c) {
      const novo: Conta = { id: id("c"), descricao: c.descricao, valor: c.valor, data_vencimento: `${c.data_vencimento}T00:00:00.000Z`, categoria: c.categoria ?? "Outros", tipo_negocio: alvo(e), recorrente: c.recorrente ?? false, frequencia: c.frequencia ?? null, status: "pendente", transacao_id: null, estimada: false };
      s.contas.push(novo);
      return novo;
    },
    async acaoConta(e, cid, a) {
      const c = doEscopo(s.contas, e).find((x) => x.id === cid) ?? nf();
      if (a.acao === "pagar") {
        if (c.status !== "pendente") throw new FinanceiroErro("Esta conta já foi paga ou cancelada.", "rejeitado", 409);
        c.status = "paga";
        const t: Transacao = { id: id("t"), tipo: "despesa", valor: c.valor, descricao: `Conta: ${c.descricao}`, categoria: c.categoria, tipo_negocio: c.tipo_negocio, empresa: null, data_transacao: `${hoje}T00:00:00.000Z`, mes: mesDe(hoje), confirmado: true };
        s.tx.push(t); c.transacao_id = t.id;
      } else if (a.acao === "cancelar") c.status = "cancelada";
      else { const { acao: _a, data_vencimento, ...resto } = a; Object.assign(c, resto); if (data_vencimento) c.data_vencimento = `${data_vencimento}T00:00:00.000Z`; }
      return c;
    },
    async excluirConta(e, cid) { const c = doEscopo(s.contas, e).find((x) => x.id === cid) ?? nf(); s.contas.splice(s.contas.indexOf(c), 1); },
    async receitas(e, p) {
      const { de, ate } = p.mes || p.dia || p.de || p.ate ? intervalo(p, hoje) : { de: "0000-01-01", ate: "9999-12-31" };
      let xs = doEscopo(s.rec, e).filter((r) => r.data_prevista.slice(0, 10) >= de && r.data_prevista.slice(0, 10) <= ate);
      const aberta = (r: Receita) => r.status === "pendente" || r.status === "atrasada";
      if (p.status === "abertas") xs = xs.filter(aberta);
      else if (p.status === "recebida" || p.status === "perdida") xs = xs.filter((r) => r.status === p.status);
      else if (p.status === "atrasada") xs = xs.filter((r) => aberta(r) && r.data_prevista.slice(0, 10) < hoje);
      if (p.contrato_id) xs = xs.filter((r) => r.contrato_id === p.contrato_id);
      xs = [...xs].sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)).map((r) => ({ ...r, atrasada: aberta(r) && r.data_prevista.slice(0, 10) < hoje }));
      const q = (f: (r: Receita) => boolean) => { const l = xs.filter(f); return { quantidade: l.length, total: r2(l.reduce((a, r) => a + r.valor, 0)) }; };
      return { receitas: xs, totais: { abertas: q(aberta), atrasadas: q((r) => Boolean(r.atrasada)), recebidas: q((r) => r.status === "recebida"), perdidas: q((r) => r.status === "perdida") } };
    },
    async criarReceita(e, r) {
      const valor = r.modo === "avulsa" ? r.valor : r.modo === "recorrente" ? r.valor_parcela : (r.valor_parcela ?? r2((r.valor_total ?? 0) / r.meses));
      s.rec.push({ id: id("r"), descricao: r.descricao, valor, data_prevista: `${r.data_prevista}T00:00:00.000Z`, tipo_negocio: alvo(e), cliente: r.cliente ?? null, status: "pendente", data_recebimento: null, observacao: r.observacao ?? null, motivo_perda: null, contrato_id: null, parcela_numero: null, parcelas_total: null, atrasada: r.data_prevista < hoje });
    },
    async acaoReceita(e, rid, a) {
      const r = doEscopo(s.rec, e).find((x) => x.id === rid) ?? nf();
      const aberta = r.status === "pendente" || r.status === "atrasada";
      if (a.acao === "confirmar") {
        if (!aberta) throw new FinanceiroErro("Esta receita não está em aberto.", "rejeitado", 409);
        r.status = "recebida"; r.data_recebimento = `${hoje}T00:00:00.000Z`;
        s.tx.push({ id: id("t"), tipo: "receita", valor: r.valor, descricao: `Receita: ${r.descricao}`, categoria: "Receita Prevista", tipo_negocio: r.tipo_negocio ?? "pessoal", empresa: null, data_transacao: `${hoje}T00:00:00.000Z`, mes: mesDe(hoje), confirmado: true });
      } else if (a.acao === "perder") { r.status = "perdida"; r.motivo_perda = a.motivo ?? null; }
      else if (a.acao === "reverter_perda") { r.status = "pendente"; r.motivo_perda = null; }
      else { const { acao: _a, data_prevista, ...resto } = a; Object.assign(r, resto); if (data_prevista) r.data_prevista = `${data_prevista}T00:00:00.000Z`; }
      return r;
    },
    async contratos(e) { return doEscopo(s.ct, e); },
    async acaoContrato(e, cid, a) {
      const c = doEscopo(s.ct, e).find((x) => x.id === cid) ?? nf();
      if (a.acao === "encerrar") c.status = "encerrado";
      else { const { acao: _a, a_partir_de: _b, ...resto } = a; Object.assign(c, resto); }
    },
    async metas() { return s.metas; },
    async aporte(a) { const m = s.metas.find((x) => x.id === a.meta_id) ?? nf(); m.atual = r2(m.atual + a.valor); m.ultimosAportes.unshift({ id: id("a"), valor: a.valor, data: a.data ?? hoje, origem: "tela", observacao: a.observacao ?? null }); },
    async excluirAporte(aid) { for (const m of s.metas) { const i = m.ultimosAportes.findIndex((x) => x.id === aid); if (i >= 0) { m.atual = r2(m.atual - m.ultimosAportes[i].valor); m.ultimosAportes.splice(i, 1); return; } } nf(); },
    async categorias(e) {
      const xs = doEscopo(s.tx, e);
      const ord = (l: string[]) => [...new Set(l)].sort();
      return { escopo: e, receitas: ord(xs.filter((t) => t.tipo === "receita").map((t) => t.categoria)), despesas: ord([...xs.filter((t) => t.tipo === "despesa").map((t) => t.categoria), ...doEscopo(s.contas, e).map((c) => c.categoria)]) };
    },
  };
  return estenderFixture(base, s, s2, hoje);
}
