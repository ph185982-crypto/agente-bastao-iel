// Financeiro da Central, Etapa 2: projeção de caixa, orçamentos, dívidas, contratos de despesa e histórico/restauração.
// Cliente HTTP com fetch simulado, fixture com estado, regras puras e telas renderizadas no servidor (sem rede, sem banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { criarProvedorFinanceiro, FinanceiroErro, projecaoSchema, orcamentoSchema, dividaSchema, contratoDespesaSchema, historicoSchema } from "../src/lib/financeiro/vendedoria";
import { criarProvedorFixture } from "../src/lib/financeiro/fixture";
import { tentar } from "../src/lib/financeiro";
import { recusaDeEscrita } from "../src/lib/financeiro/acesso";
import { dataHoraBr } from "../src/lib/financeiro/periodo";
import { abasDoEscopo } from "../src/components/financeiro/Comum";
import { Projecao, lerEvento, resumoProjecao } from "../src/components/financeiro/Projecao";
import { Orcamentos, nivelOrcamento } from "../src/components/financeiro/Orcamentos";
import { Dividas } from "../src/components/financeiro/Dividas";
import { ContratosDespesa } from "../src/components/financeiro/ContratosDespesa";
import { Historico, queryHistorico } from "../src/components/financeiro/Historico";
import type { Session } from "../src/lib/session";

// tsx compila o JSX das telas no modo clássico (o Next usa o automático): publica o React para o render de teste.
(globalThis as unknown as { React: typeof React }).React = React;
const CHAVE = "chave-financeiro-falsa-de-teste";
const sem = async () => undefined;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
process.env.ADMIN_EMAILS = "dono@avanteza.com.br";
const dono: Session = { email: "dono@avanteza.com.br", role: "admin", apps: [], name: "Dono" };
const revisor: Session = { email: "rev@avanteza.com.br", role: "reviewer", apps: [], name: "Rev" };
const outroAdmin: Session = { email: "outro@avanteza.com.br", role: "admin", apps: [], name: "Outro" };
const HOJE = "2026-11-16";
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const ok = <T,>(dados: T) => ({ estado: "ok", dados }) as const;

test("cliente HTTP (Etapa 2): URLs, escopo, corpo e validação zod de cada recurso novo", async () => {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const resp = (url: string): unknown => {
    if (url.includes("/projecao?")) return { escopo: "nexo", saldo_atual: 10, burn_rate: 1.5, primeiro_negativo: null, dias: [{ data: "2026-11-16", saldo: 8.5, eventos: [] }] };
    if (url.includes("/orcamentos?")) return [{ id: "o1", categoria: "Lazer", limite_mensal: 150, gasto_atual: 40, criado_em: "x" }];
    if (url.includes("/dividas?")) return [{ id: "d1", descricao: "Empréstimo", valor_total: 100, valor_pago: 10, parcela_mensal: null, dia_vencimento: null, credor: null, status: "ativa", observacao: null, restante: 90, progresso: 10, criado_em: "x" }];
    if (url.includes("/contratos-despesa?")) return { contratos: [{ id: "k1", descricao: "Internet", credor: null, categoria: "Moradia", tipo_negocio: "pessoal", valor_parcela: 120, parcelas_total: null, dia_vencimento: 8, data_inicio: "2026-01-08", estimada: false, status: "ativo", observacao: null, pagas: 3, pendentes: 2, restantes: null, valor_restante: null, proxima: null }] };
    if (url.includes("/historico?")) return { itens: [{ id: "h1", entidade: "Transacao", entidade_id: "t1", acao: "excluido", criado_em: "2026-11-16T14:00:00.000Z", descricao: "X", valor: 5, restauravel: true, antes: { segredo: 1 } }], total: 1, pagina: 1, paginas: 1, entidades: ["Transacao"] };
    return { ok: true };
  };
  const f = (async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return json(resp(url)); }) as unknown as typeof fetch;
  const p = criarProvedorFinanceiro({ baseUrl: "https://vend.test", chave: CHAVE, fetchImpl: f, sleep: sem });
  const R = "https://vend.test/api/integracoes/avanteza/financeiro";

  assert.equal((await p.projecao("empresa", 45)).dias.length, 1);
  assert.equal(chamadas[0].url, `${R}/projecao?escopo=empresa&dias=45`);
  assert.equal((await p.orcamentos())[0].gasto_atual, 40);
  assert.equal(chamadas[1].url, `${R}/orcamentos?escopo=pessoal`, "orçamentos sempre no escopo pessoal");
  await p.salvarOrcamento({ categoria: "Lazer", limite_mensal: 200 });
  assert.deepEqual([chamadas[2].init.method, JSON.parse(String(chamadas[2].init.body))], ["POST", { categoria: "Lazer", limite_mensal: 200 }]);
  await p.excluirOrcamento("Cartão de crédito");
  assert.equal(chamadas[3].init.method, "DELETE");
  assert.equal(chamadas[3].url, `${R}/orcamentos?escopo=pessoal&categoria=Cart%C3%A3o+de+cr%C3%A9dito`);
  assert.equal((await p.dividas())[0].restante, 90);
  await p.acaoDivida("d/1", { acao: "pagar_parcela", valor: 25 });
  assert.equal(chamadas[5].url, `${R}/dividas/d%2F1?escopo=pessoal`);
  assert.deepEqual(JSON.parse(String(chamadas[5].init.body)), { acao: "pagar_parcela", valor: 25 });
  assert.equal((await p.contratosDespesa("pessoal"))[0].descricao, "Internet");
  await p.criarContratoDespesa("empresa", { descricao: "Aluguel", valor_parcela: 1800, primeiro_vencimento: "2026-12-10" });
  assert.equal(chamadas[7].url, `${R}/contratos-despesa?escopo=empresa`);
  await p.acaoContratoDespesa("pessoal", "k1", { acao: "encerrar" });
  assert.equal(chamadas[8].init.method, "PATCH");
  const h = await p.historico("pessoal", { q: "ab c", acao: "excluido", page: 2, pageSize: 30 });
  assert.match(chamadas[9].url, /historico\?escopo=pessoal&acao=excluido&q=ab\+c&page=2&pageSize=30$/);
  assert.equal(h.itens[0].restauravel, true);
  assert.ok(!("antes" in h.itens[0]), "o cliente descarta os retratos brutos (antes/depois) do livro-razão");
  await p.restaurar("empresa", "h1");
  assert.equal(chamadas[10].url, `${R}/historico/h1/restaurar?escopo=empresa`);
  assert.equal(chamadas[10].init.method, "POST");

  const ruim = criarProvedorFinanceiro({ chave: CHAVE, sleep: sem, fetchImpl: (async () => json({ dias: "x" })) as unknown as typeof fetch });
  await assert.rejects(() => ruim.projecao("empresa"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "formato");
});

test("cliente HTTP (Etapa 2): empresa em orçamentos/dívidas = 404 honesto; escritas nunca repetem; mensagens de regra voltam", async () => {
  const mk = (status: number, corpo: unknown = {}) => criarProvedorFinanceiro({ chave: CHAVE, fetchImpl: (async () => json(corpo, status)) as unknown as typeof fetch, sleep: sem });
  await assert.rejects(() => mk(404).dividas(), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado");
  await assert.rejects(() => mk(400, { error: "Valor da parcela (900) maior que o restante da divida (400)" }).acaoDivida("d", { acao: "pagar_parcela", valor: 900 }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado" && /maior que o restante/.test(e.message));
  await assert.rejects(() => mk(409, { error: "Este lançamento já existe — nada a restaurar." }).restaurar("empresa", "h"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado");
  let n = 0;
  const falha = criarProvedorFinanceiro({ chave: CHAVE, sleep: sem, fetchImpl: (async () => { n++; return json({}, 502); }) as unknown as typeof fetch });
  await assert.rejects(() => falha.restaurar("empresa", "h"));
  await assert.rejects(() => falha.criarContratoDespesa("empresa", { descricao: "x", valor_parcela: 1, primeiro_vencimento: "2026-12-01" }));
  assert.equal(n, 2, "restaurar e criar não são repetidos (evita restaurar/criar em dobro)");
});

test("fixture: projeção SEMPRE por escopo e com a regra do Vendedor IA; o pessoal não aparece na empresa", async () => {
  const p = criarProvedorFixture("1", HOJE);
  const emp = await p.projecao("empresa", 30);
  const pes = await p.projecao("pessoal", 30);
  assert.ok(projecaoSchema.safeParse(emp).success && projecaoSchema.safeParse(pes).success, "a fixture obedece ao contrato do cliente");
  assert.deepEqual([emp.escopo, pes.escopo], ["nexo", "pessoal"]);
  assert.equal(emp.dias.length, 30);
  assert.equal(emp.dias[0].data, HOJE);
  const textos = (j: typeof emp) => j.dias.flatMap((d) => d.eventos).join("|");
  assert.match(textos(emp), /Meta Ads|Contabilidade/);
  assert.doesNotMatch(textos(emp), /Aluguel e condomínio|Plano de saúde|Aula particular/, "nada pessoal na empresa");
  assert.match(textos(pes), /Aluguel e condomínio|Aula particular/);
  assert.doesNotMatch(textos(pes), /Meta Ads|Contabilidade/);
  assert.notEqual(emp.saldo_atual, pes.saldo_atual);
  assert.equal((await p.projecao("empresa", 7)).dias.length, 7);
  assert.equal((await p.projecao("empresa", 999)).dias.length, 60, "limite de 60 dias, como a API");
  // mesmo cálculo do dia a dia: saldo(d) = saldo(d-1) - burn + eventos
  const d1 = emp.dias[1], d0 = emp.dias[0];
  const delta = d1.eventos.map(lerEvento).reduce((a, e) => a + (e.tipo === "receita" ? e.valor! : -e.valor!), 0);
  assert.ok(Math.abs(d1.saldo - (d0.saldo - emp.burn_rate + delta)) < 0.011);
});

test("fixture: orçamentos e dívidas (pessoal), contratos de despesa e histórico com restauração", async () => {
  const p = criarProvedorFixture("1", HOJE);
  const orc = await p.orcamentos();
  assert.ok(orc.every((o) => orcamentoSchema.safeParse(o).success));
  const alim = orc.find((o) => o.categoria === "Alimentação")!;
  assert.ok(alim.gasto_atual > 0, "gasto do mês vem dos lançamentos pessoais");
  await p.salvarOrcamento({ categoria: "Alimentação", limite_mensal: 900 });
  assert.equal((await p.orcamentos()).find((o) => o.categoria === "Alimentação")!.limite_mensal, 900);
  await p.excluirOrcamento("Lazer");
  assert.equal((await p.orcamentos()).some((o) => o.categoria === "Lazer"), false);
  await assert.rejects(() => p.excluirOrcamento("Lazer"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado");

  const [d] = await p.dividas();
  assert.ok(dividaSchema.safeParse(d).success);
  const antes = (await p.transacoes("pessoal", { pageSize: 500 })).total;
  const restanteAntes = d.restante;
  await p.acaoDivida(d.id, { acao: "pagar_parcela", valor: 300 });
  assert.equal((await p.dividas()).find((x) => x.id === d.id)!.restante, restanteAntes - 300);
  assert.equal((await p.transacoes("pessoal", { pageSize: 500 })).total, antes + 1, "a parcela vira despesa pessoal no extrato");
  await assert.rejects(() => p.acaoDivida(d.id, { acao: "pagar_parcela", valor: 999999 }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado");
  await p.acaoDivida(d.id, { acao: "quitar" });
  assert.equal((await p.dividas()).some((x) => x.id === d.id), false);

  const emp = await p.contratosDespesa("empresa");
  const pes = await p.contratosDespesa("pessoal");
  assert.ok([...emp, ...pes].every((c) => contratoDespesaSchema.safeParse(c).success));
  assert.ok(emp.every((c) => c.tipo_negocio === "nexo") && pes.every((c) => c.tipo_negocio === "pessoal"));
  await assert.rejects(() => p.acaoContratoDespesa("pessoal", emp[0].id, { acao: "encerrar" }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado", "contrato de outro escopo = 404");
  await p.criarContratoDespesa("empresa", { descricao: "Domínio novo", valor_parcela: 40, primeiro_vencimento: "2026-12-05", parcelas_total: 12 });
  await assert.rejects(() => p.criarContratoDespesa("empresa", { descricao: "domínio NOVO", valor_parcela: 1, primeiro_vencimento: "2026-12-05" }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado");
  const novo = (await p.contratosDespesa("empresa")).find((c) => c.descricao === "Domínio novo")!;
  await p.acaoContratoDespesa("empresa", novo.id, { acao: "editar", valor_parcela: 45 });
  await p.acaoContratoDespesa("empresa", novo.id, { acao: "encerrar" });
  assert.equal((await p.contratosDespesa("empresa")).find((c) => c.id === novo.id)!.status, "encerrado");
  await p.acaoContratoDespesa("empresa", novo.id, { acao: "reativar" });
  await p.acaoContratoDespesa("empresa", novo.id, { acao: "editar", tipo_negocio: "pessoal" });
  assert.equal((await p.contratosDespesa("empresa")).some((c) => c.id === novo.id), false, "reclassificado sai da empresa");
  assert.equal((await p.contratosDespesa("pessoal")).some((c) => c.id === novo.id), true);

  const he = await p.historico("empresa", { pageSize: 100 });
  const hp = await p.historico("pessoal", { pageSize: 100 });
  assert.ok(historicoSchema.safeParse(he).success);
  assert.ok(!he.entidades.includes("DividaMax") && hp.entidades.includes("DividaMax"));
  assert.ok(!he.itens.some((i) => /Fernando|Seguro do celular/.test(i.descricao ?? "")), "nada pessoal no histórico da empresa");
  const excl = he.itens.find((i) => i.restauravel)!;
  await assert.rejects(() => p.restaurar("pessoal", excl.id), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado", "outro escopo");
  await p.restaurar("empresa", excl.id);
  assert.equal((await p.transacoes("empresa", { texto: "plugin" })).total, 1, "a cópia voltou ao extrato da empresa");
  assert.equal((await p.historico("empresa", { pageSize: 100 })).itens.find((i) => i.id === excl.id)!.restauravel, false);
  await assert.rejects(() => p.restaurar("empresa", excl.id), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado");
  // excluir um lançamento gera um item restaurável no histórico
  const alvo = (await p.transacoes("empresa", { texto: "Notebook" })).transacoes[0];
  await p.excluirTransacao("empresa", alvo.id);
  const hx = (await p.historico("empresa", { q: "Notebook", acao: "excluido" })).itens;
  assert.equal(hx.length, 1);
  assert.equal(hx[0].restauravel, true);
  assert.equal((await p.historico("empresa", { acao: "excluido", de: "2099-01-01" })).total, 0);
});

test("fixture vazio e erro: estados honestos nas novas telas", async () => {
  const v = criarProvedorFixture("vazio", HOJE);
  const proj = await v.projecao("empresa");
  assert.deepEqual([proj.saldo_atual, proj.burn_rate, proj.primeiro_negativo], [0, 0, null]);
  assert.deepEqual([(await v.orcamentos()).length, (await v.dividas()).length, (await v.contratosDespesa("empresa")).length, (await v.historico("empresa", {})).total], [0, 0, 0, 0]);
  const e = await tentar((p) => p.projecao("empresa"), {} as NodeJS.ProcessEnv, criarProvedorFixture("erro"));
  assert.equal(e.estado, "indisponivel");
  assert.equal(e.estado === "indisponivel" && e.motivo, "Não foi possível falar com o Vendedor IA.");
});

test("regras puras: evento da projeção, nível do orçamento, resumo, filtros do histórico e datas", () => {
  assert.deepEqual(lerEvento("Receita: Aula particular R$1500.00"), { tipo: "receita", descricao: "Aula particular", valor: 1500 });
  assert.deepEqual(lerEvento("Conta: Aluguel R$ 2.800 R$2800.50"), { tipo: "conta", descricao: "Aluguel R$ 2.800", valor: 2800.5 });
  assert.equal(lerEvento("algo estranho").tipo, "outro");
  assert.deepEqual([nivelOrcamento(0, 100), nivelOrcamento(79.99, 100), nivelOrcamento(80, 100), nivelOrcamento(99.99, 100), nivelOrcamento(100, 100), nivelOrcamento(50, 0)], ["ok", "ok", "alerta", "alerta", "estourado", "ok"]);
  const r = resumoProjecao({ escopo: "nexo", saldo_atual: 100, burn_rate: 10, primeiro_negativo: "2026-11-18", dias: [
    { data: "2026-11-16", saldo: 90, eventos: [] }, { data: "2026-11-17", saldo: 40, eventos: ["Conta: A R$60.00"] }, { data: "2026-11-18", saldo: -20, eventos: ["Conta: B R$50.00", "Receita: C R$10.00"] },
  ] });
  assert.deepEqual([r.final, r.menor.data, r.entradas, r.saidas], [-20, "2026-11-18", 10, 110]);
  assert.equal(queryHistorico({ q: "ab c", entidade: "", acao: "excluido", de: "", ate: "", page: 1 }), "?q=ab+c&acao=excluido");
  assert.equal(queryHistorico({ q: "", entidade: "Transacao", acao: "", de: "", ate: "", page: 3 }), "?entidade=Transacao&page=3");
  assert.equal(queryHistorico({ q: "", entidade: "", acao: "", de: "", ate: "", page: 1 }), "");
  assert.equal(dataHoraBr("2026-11-16T02:30:00.000Z"), "15/11/26 23:30", "horário de Brasília");
  assert.equal(dataHoraBr("lixo"), "—");
});

test("acesso e abas: Orçamentos e Dívidas só no Pessoal; revisor só lê; escritas novas só do dono/admin", () => {
  const ids = (e: "empresa" | "pessoal") => abasDoEscopo(e).map((a) => a.id);
  assert.ok(!ids("empresa").includes("orcamentos") && !ids("empresa").includes("dividas"));
  assert.ok(ids("pessoal").includes("orcamentos") && ids("pessoal").includes("dividas"));
  for (const e of ["empresa", "pessoal"] as const) for (const a of ["projecao", "contratos-despesa", "historico"]) assert.ok(ids(e).includes(a), `${a} existe em ${e}`);
  for (const op of ["historico.restaurar", "contrato_despesa.criar", "contrato_despesa.encerrar"]) {
    assert.match(recusaDeEscrita(revisor, "empresa", op)!, /somente leitura/);
    assert.equal(recusaDeEscrita(dono, "empresa", op), null);
  }
  for (const op of ["orcamento.salvar", "orcamento.excluir", "divida.pagar", "divida.quitar"]) {
    assert.equal(recusaDeEscrita(dono, "pessoal", op, true), null);
    assert.match(recusaDeEscrita(revisor, "pessoal", op, true)!, /somente leitura/);
    assert.match(recusaDeEscrita(outroAdmin, "pessoal", op, true)!, /somente leitura/, "admin fora de ADMIN_EMAILS não escreve");
  }
  assert.equal(recusaDeEscrita(dono, "empresa", "contrato_despesa.reclassificar"), null);
  const page = readFileSync(new URL("../src/app/(equipe)/financeiro/[[...caminho]]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /abasDoEscopo\(escopo\)\.find/);
  assert.match(page, /if \(pessoal && !podeVerPessoal\(sess\)\) notFound\(\)/);
});

test("ações: toda operação nova é auditada sem valores e orçamentos/dívidas são só do Pessoal", () => {
  const src = readFileSync(new URL("../src/app/(equipe)/financeiro/actions.ts", import.meta.url), "utf8");
  for (const op of ["orcamento.salvar", "orcamento.excluir", "divida.pagar", "divida.quitar", "contrato_despesa.criar", "contrato_despesa.editar", "contrato_despesa.encerrar", "contrato_despesa.reativar", "contrato_despesa.reclassificar", "historico.restaurar"]) {
    assert.match(src, new RegExp(`"${op.replace(".", "\\.")}": \\{`), `${op} existe`);
  }
  for (const op of ["orcamento.salvar", "orcamento.excluir", "divida.pagar", "divida.quitar"]) {
    assert.match(src, new RegExp(`"${op.replace(".", "\\.")}": \\{[^\\n]*soPessoal: true`), `${op} é só do Pessoal`);
  }
  assert.ok(!/details:\s*\{[^}]*(valor|descricao|categoria|limite)/.test(src), "a auditoria não grava valores, descrições nem categorias");
  assert.match(src, /\\\?\[\\w=&%\.\+-\]/, "voltar aceita + (busca com espaço)");
});

test("telas (render no servidor): projeção, orçamentos, dívidas, contratos de despesa e histórico mostram dados e estados", async () => {
  const p = criarProvedorFixture("1", HOJE);
  const voltar = "/financeiro/pessoal/projecao";
  // Projeção
  const proj = html(createElement(Projecao, { f: ok(await p.projecao("pessoal", 30)), escopo: "pessoal", dias: 30 }));
  assert.match(proj, /Saldo projetado, dia a dia/);
  assert.match(proj, /<svg[^>]*role="img"[^>]*aria-label="Saldo projetado\./);
  assert.match(proj, /Estimativa, não é o saldo do banco/);
  assert.match(proj, /href="\/financeiro\/pessoal\/projecao\?dias=60"/);
  assert.match(proj, /aria-current="page"[^>]*>30 dias/);
  assert.doesNotMatch(proj, /Meta Ads/, "a projeção pessoal não traz nada da empresa");
  const fora = html(createElement(Projecao, { f: { estado: "indisponivel", codigo: "rede", motivo: "Não foi possível falar com o Vendedor IA." }, escopo: "empresa", dias: 30 }));
  assert.match(fora, /Vendedor IA indisponível/);
  assert.doesNotMatch(fora, /<svg/, "nunca mostra gráfico zerado no lugar do dado");
  const vazioProj = html(createElement(Projecao, { f: ok(await criarProvedorFixture("vazio", HOJE).projecao("empresa")), escopo: "empresa", dias: 30 }));
  assert.match(vazioProj, /Sem movimento neste período|Nenhuma conta ou receita prevista/);
  // Orçamentos
  const orc = html(createElement(Orcamentos, { f: ok(await p.orcamentos()), cats: ok({ escopo: "pessoal", receitas: [], despesas: ["Mercado"] }), podeEscrever: true, voltar }));
  assert.match(orc, /Definir limite de uma categoria/);
  assert.match(orc, /Alimentação/);
  assert.match(orc, /role="progressbar"/);
  assert.match(orc, /<option value="Mercado"/);
  const orcLeitura = html(createElement(Orcamentos, { f: ok(await p.orcamentos()), cats: null, podeEscrever: false, voltar }));
  assert.doesNotMatch(orcLeitura, /<form|Remover|Alterar limite/, "somente leitura: sem formulários");
  assert.match(html(createElement(Orcamentos, { f: ok([]), cats: null, podeEscrever: false, voltar })), /Nenhum orçamento definido/);
  // Dívidas
  const div = html(createElement(Dividas, { f: ok(await p.dividas()), podeEscrever: true, voltar }));
  assert.match(div, /Empréstimo com o Fernando/);
  assert.match(div, /Pagar parcela/);
  assert.match(html(createElement(Dividas, { f: ok([]), podeEscrever: true, voltar })), /Nenhuma dívida ativa/);
  assert.doesNotMatch(html(createElement(Dividas, { f: ok(await p.dividas()), podeEscrever: false, voltar })), /<form/);
  // Contratos de despesa
  const cd = html(createElement(ContratosDespesa, { f: ok(await p.contratosDespesa("pessoal")), escopo: "pessoal", podeEscrever: true, podeReclassificar: true, voltar, mes: "2026-11" }));
  assert.match(cd, /Financiamento do carro/);
  assert.match(cd, /14 de 48 pagas/);
  assert.match(cd, /Encerrados/);
  assert.match(cd, /Mover p\/ Empresa/);
  const cdRev = html(createElement(ContratosDespesa, { f: ok(await p.contratosDespesa("empresa")), escopo: "empresa", podeEscrever: false, podeReclassificar: false, voltar: "/financeiro/contratos-despesa", mes: "2026-11" }));
  assert.match(cdRev, /Aluguel da sala comercial/);
  assert.doesNotMatch(cdRev, /<form|Mover p\//);
  // Histórico
  const hist = html(createElement(Historico, { f: ok(await p.historico("empresa", { pageSize: 30 })), escopo: "empresa", filtros: { q: "", entidade: "", acao: "", de: "", ate: "", page: 1 }, podeEscrever: true, voltar: "/financeiro/historico" }));
  assert.match(hist, /Restaurar/);
  assert.match(hist, /action="\/financeiro\/historico"/);
  assert.doesNotMatch(hist, /Fernando|Seguro do celular/);
  const histRev = html(createElement(Historico, { f: ok(await p.historico("empresa", { pageSize: 30 })), escopo: "empresa", filtros: { q: "", entidade: "", acao: "", de: "", ate: "", page: 1 }, podeEscrever: false, voltar: "/financeiro/historico" }));
  assert.doesNotMatch(histRev, /Restaurar/, "revisor só lê");
  assert.match(html(createElement(Historico, { f: ok({ itens: [], total: 0, pagina: 1, paginas: 1, entidades: [] }), escopo: "empresa", filtros: { q: "zzz", entidade: "", acao: "", de: "", ate: "", page: 1 }, podeEscrever: true, voltar: "/financeiro/historico" })), /Nenhum registro com esses filtros/);
});
