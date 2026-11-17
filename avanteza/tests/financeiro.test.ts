// Financeiro da Central: cliente HTTP (zod, timeout, retry curto, sem retry em escrita), acesso por papel, menu por
// departamentos, formulários, fixture (ignorada em produção) e regras de escrita. Sem rede: fetch simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { criarProvedorFinanceiro, provedorFinanceiroDoAmbiente, FinanceiroErro, mensagemDoErro, resumoSchema } from "../src/lib/financeiro/vendedoria";
import { fixtureFinanceiroAtiva, criarProvedorFixture } from "../src/lib/financeiro/fixture";
import { carregarVisaoGeral, serieDiaria, tentar, obterProvedor } from "../src/lib/financeiro";
import { podeVerFinanceiro, podeEscreverFinanceiro, podeVerPessoal, recusaDeEscrita } from "../src/lib/financeiro/acesso";
import { parseValor } from "../src/lib/financeiro/forms";
import { somarMeses, rotuloMes, hojeBrasilia, mesDaUrl, ultimoDia } from "../src/lib/financeiro/periodo";
import { departamentosVisiveis } from "../src/lib/shell/departamentos";
import { menuEquipe } from "../src/lib/shell/menu";
import { totaisPorCategoria } from "../src/components/financeiro/Categorias";
import type { Session } from "../src/lib/session";

const CHAVE = "chave-financeiro-falsa-de-teste";
const sem = async () => undefined;
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
process.env.ADMIN_EMAILS = "dono@avanteza.com.br";

const dono: Session = { email: "dono@avanteza.com.br", role: "admin", apps: [], name: "Dono" };
const outroAdmin: Session = { email: "outro@avanteza.com.br", role: "admin", apps: [], name: "Outro" }; // admin fora de ADMIN_EMAILS: sessão inválida
const revisor: Session = { email: "rev@avanteza.com.br", role: "reviewer", apps: [], name: "Rev" };
const membroFin: Session = { email: "fin@avanteza.com.br", role: "member", apps: ["financeiro"], name: "Fin" };
const membroVendas: Session = { email: "v@avanteza.com.br", role: "member", apps: ["vendas"], name: "V" };
const cliente: Session = { email: "c@cliente.com", role: "client", apps: [], name: "C", clientId: "x", clientIds: ["x"] };

test("cliente HTTP: URL, escopo, Bearer, query, corpo e validação zod da resposta", async () => {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes("/transacoes?")) return json({ transacoes: [{ id: "t1", tipo: "despesa", valor: 10.5, descricao: "x", categoria: "y", tipo_negocio: "nexo", data_transacao: "2026-11-02T00:00:00.000Z", mes: "2026-11", confirmado: true }], total: 1, pagina: 1, paginas: 1 });
    return json({ lixo: true });
  }) as unknown as typeof fetch;
  const p = criarProvedorFinanceiro({ baseUrl: "https://vend.test/", chave: CHAVE, fetchImpl: f, sleep: sem });
  const r = await p.transacoes("empresa", { de: "2026-11-01", ate: "2026-11-30", texto: "ads", page: 2 });
  assert.equal(r.total, 1);
  assert.match(chamadas[0].url, /^https:\/\/vend\.test\/api\/integracoes\/avanteza\/financeiro\/transacoes\?escopo=empresa&/);
  assert.match(chamadas[0].url, /data_inicio=2026-11-01/);
  assert.match(chamadas[0].url, /texto=ads/);
  assert.equal((chamadas[0].init.headers as Record<string, string>).Authorization, `Bearer ${CHAVE}`);
  await assert.rejects(() => p.resumo("pessoal", { mes: "2026-11" }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "formato");
  assert.match(chamadas[1].url, /resumo\?escopo=pessoal&mes=2026-11/);
});

test("cliente HTTP: 401, 503, 404, 409 e 5xx viram erros honestos, sem vazar chave nem valores", async () => {
  const mk = (status: number, corpo: unknown = {}) => criarProvedorFinanceiro({ chave: CHAVE, fetchImpl: (async () => json(corpo, status)) as unknown as typeof fetch, sleep: sem });
  await assert.rejects(() => mk(401).categorias("empresa"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-autorizado" && !String(e.message).includes(CHAVE));
  await assert.rejects(() => mk(503).categorias("empresa"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-configurado");
  await assert.rejects(() => mk(404).excluirTransacao("empresa", "abc"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado");
  await assert.rejects(() => mk(409, { error: "Esta receita já foi recebida." }).acaoReceita("empresa", "r", { acao: "confirmar" }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado" && e.message === "Esta receita já foi recebida.");
  await assert.rejects(() => mk(500).categorias("empresa"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "http");
  assert.equal(mensagemDoErro(new Error("conexão com segredo xyz")), "Vendedor IA indisponível no momento.");
});

test("cliente HTTP: GET repete uma vez em falha transitória; escrita nunca repete; timeout vira erro de timeout", async () => {
  let n = 0;
  const ok = { escopo: "empresa", receitas: ["a"], despesas: ["b"] };
  const get = criarProvedorFinanceiro({ chave: CHAVE, sleep: sem, fetchImpl: (async () => (++n === 1 ? json({}, 502) : json(ok))) as unknown as typeof fetch });
  assert.deepEqual((await get.categorias("empresa")).despesas, ["b"]);
  assert.equal(n, 2);
  let m = 0;
  const post = criarProvedorFinanceiro({ chave: CHAVE, sleep: sem, fetchImpl: (async () => { m++; return json({}, 502); }) as unknown as typeof fetch });
  await assert.rejects(() => post.criarTransacao("empresa", { tipo: "despesa", valor: 1, descricao: "d", categoria: "c" }));
  assert.equal(m, 1, "escrita não é repetida (evita lançar em dobro)");
  const lento = criarProvedorFinanceiro({ chave: CHAVE, timeoutMs: 20, tentativas: 0, sleep: sem, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "TimeoutError" }))))) as unknown as typeof fetch });
  await assert.rejects(() => lento.categorias("empresa"), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "timeout");
});

test("ambiente: sem AVANTEZA_FINANCE_KEY é 'não configurado'; a chave das métricas não vale", () => {
  assert.throws(() => provedorFinanceiroDoAmbiente({ AVANTEZA_METRICS_KEY: "outra" } as unknown as NodeJS.ProcessEnv), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-configurado");
  assert.ok(provedorFinanceiroDoAmbiente({ AVANTEZA_FINANCE_KEY: CHAVE } as unknown as NodeJS.ProcessEnv));
});

test("acesso: empresa para admin/revisor/membro com app; escrita só admin; Pessoal só o dono; cliente nunca", () => {
  assert.deepEqual([dono, revisor, membroFin, membroVendas, cliente, null].map((s) => podeVerFinanceiro(s)), [true, true, true, false, false, false]);
  assert.deepEqual([dono, revisor, membroFin, outroAdmin, cliente, null].map((s) => podeEscreverFinanceiro(s)), [true, false, false, false, false, false]);
  assert.deepEqual([dono, revisor, membroFin, outroAdmin, cliente, null].map((s) => podeVerPessoal(s)), [true, false, false, false, false, false]);
  assert.equal(recusaDeEscrita(dono, "empresa", "lancamento.criar"), null);
  assert.equal(recusaDeEscrita(dono, "pessoal", "lancamento.criar"), null);
  assert.match(recusaDeEscrita(revisor, "empresa", "lancamento.criar")!, /somente leitura/);
  assert.match(recusaDeEscrita(membroFin, "empresa", "conta.pagar")!, /somente leitura/);
  assert.match(recusaDeEscrita(revisor, "pessoal", "lancamento.criar")!, /somente leitura/);
  assert.match(recusaDeEscrita(outroAdmin, "empresa", "lancamento.criar")!, /somente leitura/, "admin fora de ADMIN_EMAILS tem sessão inválida");
  assert.equal(recusaDeEscrita(dono, "pessoal", "aporte.criar", true), null);
  assert.equal(recusaDeEscrita(dono, "empresa", "lancamento.reclassificar"), null, "o dono reclassifica");
});

test("menu por departamentos: cada papel vê só o que pode; Pessoal só o dono; SSO nos atalhos do Comercial", () => {
  process.env.SSO_APPS = "vendas,crm";
  const rotulos = (s: Session) => menuEquipe(s).map((g) => g.label ?? "(topo)");
  assert.deepEqual(rotulos(dono), ["(topo)", "Operações", "Comercial", "Marketing", "Financeiro", "Sistema"]);
  const g = menuEquipe(dono);
  const itens = (l: string) => g.find((x) => x.label === l)!.items.map((i) => i.label);
  assert.deepEqual(itens("Operações"), ["Hoje", "Carteira", "Calendário", "Capturas", "Onboarding", "Aprovações", "Relatórios de clientes", "Playbooks", "Funil de Entrega", "Clientes e Mapa", "Marketplaces"]);
  assert.deepEqual(itens("Comercial"), ["Oportunidades", "Contatos", "Tarefas e agenda", "Contratos", "Conversas", "Leads (SDR)"]);
  // CRM antigo desligado em 17/11/2026 (corte C13): some do menu
  assert.deepEqual(itens("Marketing"), ["Conteúdo", "Anúncios", "Canais"]);
  assert.deepEqual(itens("Financeiro"), ["Financeiro da empresa", "Pessoal"]);
  assert.ok(g[0].items[0].label === "Visão geral" && g[0].items[0].href === "/dashboards", "Visão geral é o primeiro item");
  // Comercial sob /comercial (Vendedor IA reescrito): link direto, navegação dura; o login único acontece lá se faltar sessão
  const op = g.find((x) => x.label === "Comercial")!.items.find((i) => i.label === "Oportunidades")!;
  assert.equal(op.href, "/comercial/oportunidades");
  assert.equal(op.ext, true);
  assert.equal(g.find((x) => x.label === "Comercial")!.items.find((i) => i.label === "CRM antigo"), undefined);
  // Interruptor: COMERCIAL_ZONA=0 volta aos atalhos antigos (Vendedor IA por SSO no domínio dele; Contratos sem SSO)
  process.env.COMERCIAL_ZONA = "0";
  try {
    const g0 = menuEquipe(dono);
    assert.deepEqual(g0.find((x) => x.label === "Comercial")!.items.map((i) => i.label), ["Vendedor IA", "Contratos"]);
    const vend = g0.find((x) => x.label === "Comercial")!.items.find((i) => i.label === "Vendedor IA")!;
    assert.equal(vend.href, "/sso/authorize?app=vendas");
    assert.equal(vend.ext, true);
    assert.equal(g0.find((x) => x.label === "Comercial")!.items.find((i) => i.label === "Contratos")!.href, "https://nexo-presenter.vercel.app", "sem SSO liberado abre o endereço do app");
  } finally { delete process.env.COMERCIAL_ZONA; }
  // Revisor: Operações (marketplaces), Marketing (anúncios/canais via Dashboards) e Financeiro SEM Pessoal; sem Comercial
  const gr = menuEquipe(revisor);
  assert.deepEqual(gr.map((x) => x.label ?? "(topo)"), ["(topo)", "Operações", "Marketing", "Financeiro", "Sistema"]);
  assert.deepEqual(gr.find((x) => x.label === "Financeiro")!.items.map((i) => i.label), ["Financeiro da empresa"]);
  assert.ok(!JSON.stringify(gr).includes("/financeiro/pessoal"));
  // Membro só com o app financeiro: o Motor de Entregas (Hoje…) e o Financeiro (sem Pessoal), sem Dashboards
  const gm = menuEquipe(membroFin);
  assert.deepEqual(gm.map((x) => x.label ?? "(topo)"), ["(topo)", "Operações", "Financeiro"]);
  assert.deepEqual(gm.find((x) => x.label === "Operações")!.items.map((i) => i.label), ["Hoje", "Carteira", "Calendário", "Capturas", "Onboarding", "Aprovações", "Relatórios de clientes", "Playbooks"]);
  assert.ok(!JSON.stringify(gm).includes("/dashboards"));
  // Membro com Vendedor IA e Conteúdo
  assert.deepEqual(departamentosVisiveis(membroVendas).map((d) => d.id), ["operacoes", "comercial"], "Hoje é de toda a equipe");
  assert.deepEqual(departamentosVisiveis({ ...membroVendas, apps: ["vendas", "conteudo"] }).map((d) => d.id), ["operacoes", "comercial", "marketing"]);
  // Cliente do Mapa nunca vê departamentos
  assert.deepEqual(departamentosVisiveis(cliente), []);
});

test("middleware e telas: cliente continua preso ao Mapa; telas de equipe exigem sessão", () => {
  const mw = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  assert.match(mw, /role === "client" && !isMapaPath/);
  const layout = readFileSync(new URL("../src/app/(equipe)/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /requireUser\(\)/);
  const page = readFileSync(new URL("../src/app/(equipe)/financeiro/[[...caminho]]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(pessoal && !podeVerPessoal\(sess\)\) notFound\(\)/);
});

test("formulários: valores em pt-BR, períodos e meses", () => {
  assert.equal(parseValor("1.234,56"), 1234.56);
  assert.equal(parseValor("R$ 99,9"), 99.9);
  assert.equal(parseValor("1.234"), 1234);
  assert.equal(parseValor("12.5"), 12.5);
  assert.equal(parseValor("0,00"), 0);
  assert.ok(Number.isNaN(parseValor("abc")));
  assert.ok(Number.isNaN(parseValor("")));
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(somarMeses("2026-11", 2), "2027-01");
  assert.equal(rotuloMes("2026-11"), "Novembro de 2026");
  assert.equal(ultimoDia("2028-02"), "2028-02-29");
  assert.equal(hojeBrasilia(new Date("2026-11-17T02:30:00Z")), "2026-11-16", "23h30 em Brasília ainda é dia 16");
  assert.equal(mesDaUrl("lixo", "2026-11-16"), "2026-11");
  assert.equal(mesDaUrl("2026-09", "2026-11-16"), "2026-09");
});

test("fixture: só fora de produção; estado em memória (criar, reclassificar, baixar, pagar, excluir) e isolamento Empresa × Pessoal", async () => {
  assert.equal(fixtureFinanceiroAtiva({ FINANCEIRO_FIXTURE: "1", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(fixtureFinanceiroAtiva({ FINANCEIRO_FIXTURE: "1", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(fixtureFinanceiroAtiva({ FINANCEIRO_FIXTURE: "1", VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv), "1", "só NODE_ENV/VERCEL_ENV=production desligam");
  assert.equal(fixtureFinanceiroAtiva({} as unknown as NodeJS.ProcessEnv), null);
  assert.throws(() => obterProvedor({ NODE_ENV: "production", FINANCEIRO_FIXTURE: "1" } as unknown as NodeJS.ProcessEnv), FinanceiroErro, "em produção a fixture é ignorada e falta a chave");

  const p = criarProvedorFixture("1", "2026-11-16");
  const emp = await p.transacoes("empresa", { pageSize: 100 });
  const pes = await p.transacoes("pessoal", { pageSize: 100 });
  assert.ok(emp.total > 0 && pes.total > 0);
  assert.ok(emp.transacoes.every((t) => t.tipo_negocio === "nexo") && pes.transacoes.every((t) => t.tipo_negocio === "pessoal"));
  const alvo = emp.transacoes.find((t) => t.descricao.startsWith("Notebook"))!;
  await assert.rejects(() => p.editarTransacao("pessoal", alvo.id, { valor: 1 }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "nao-encontrado");
  await p.editarTransacao("empresa", alvo.id, { tipo_negocio: "pessoal" });
  assert.equal((await p.transacoes("empresa", { texto: "Notebook" })).total, 0);
  assert.equal((await p.transacoes("pessoal", { texto: "Notebook" })).total, 1);
  const antes = (await p.resumo("empresa", { mes: "2026-11" })).receitas;
  const pend = (await p.receitas("empresa", { mes: "2026-11", status: "abertas" })).receitas[0];
  await p.acaoReceita("empresa", pend.id, { acao: "confirmar" });
  assert.equal((await p.resumo("empresa", { mes: "2026-11" })).receitas, Math.round((antes + pend.valor) * 100) / 100, "a baixa vira receita no extrato");
  await assert.rejects(() => p.acaoReceita("empresa", pend.id, { acao: "confirmar" }), (e: unknown) => e instanceof FinanceiroErro && e.codigo === "rejeitado");
  const conta = (await p.contas("empresa", "pendente"))[0];
  await p.acaoConta("empresa", conta.id, { acao: "pagar" });
  assert.equal((await p.contas("empresa", "paga")).some((c) => c.id === conta.id), true);
  await p.excluirTransacao("pessoal", alvo.id);
  assert.equal((await p.transacoes("pessoal", { texto: "Notebook" })).total, 0);
  assert.equal((await p.metas()).length, 1);
  const v = await carregarVisaoGeral("empresa", "2026-11", {} as NodeJS.ProcessEnv, p);
  assert.equal(v.resumo.estado, "ok");
  assert.equal(v.diario.estado === "ok" && v.diario.dados.pontos.length, 30);
  assert.ok(resumoSchema.safeParse(v.resumo.estado === "ok" ? v.resumo.dados : null).success, "a fixture obedece ao mesmo contrato do cliente");
});

test("estados honestos: fonte fora do ar vira aviso, nunca zero; modos vazio e erro da fixture", async () => {
  const erro = criarProvedorFixture("erro");
  const f = await tentar((p) => p.resumo("empresa", {}), {} as NodeJS.ProcessEnv, erro);
  assert.equal(f.estado, "indisponivel");
  assert.equal(f.estado === "indisponivel" && f.motivo, "Não foi possível falar com o Vendedor IA.");
  const nc = await tentar((p) => p.resumo("empresa", {}), { NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv);
  assert.equal(nc.estado, "nao-configurado");
  const vazio = criarProvedorFixture("vazio", "2026-11-16");
  const r = await vazio.resumo("empresa", { mes: "2026-11" });
  assert.deepEqual([r.receitas, r.despesas, r.categorias.length], [0, 0, 0]);
  assert.equal((await vazio.transacoes("empresa", {})).total, 0);
});

test("agregações: série diária só com confirmados e totais por categoria", () => {
  const t = (tipo: "receita" | "despesa", valor: number, d: string, confirmado = true, categoria = "A") => ({ id: d + valor, tipo, valor, descricao: "x", categoria, tipo_negocio: "nexo", empresa: null, data_transacao: `${d}T00:00:00.000Z`, mes: d.slice(0, 7), confirmado });
  const itens = [t("receita", 100, "2026-11-02"), t("despesa", 30, "2026-11-02"), t("despesa", 99, "2026-11-03", false), t("despesa", 10.1, "2026-11-02"), t("despesa", 5, "2026-10-30")];
  const s = serieDiaria("2026-11", itens);
  assert.equal(s.length, 30);
  assert.deepEqual([s[1].receitas, s[1].despesas, s[2].despesas], [100, 40.1, 0]);
  assert.deepEqual(totaisPorCategoria(itens, "despesa").map((i) => [i.rotulo, i.valor]), [["A", 45.1]]);
});

test("segurança: a chave e o provedor não aparecem em páginas nem em logs do cliente", () => {
  for (const arq of ["../src/lib/financeiro/vendedoria.ts", "../src/lib/financeiro/index.ts", "../src/app/(equipe)/financeiro/actions.ts"]) {
    const src = readFileSync(new URL(arq, import.meta.url), "utf8");
    assert.ok(!/console\.(log|info|warn|debug)\(/.test(src), `${arq}: sem console.log`);
    assert.ok(!/console\.error\([^)]*(valor|descricao|chave|AVANTEZA_FINANCE_KEY)/i.test(src), `${arq}: log de erro sem valores`);
  }
  const acoes = readFileSync(new URL("../src/app/(equipe)/financeiro/actions.ts", import.meta.url), "utf8");
  assert.match(acoes, /audit_log/);
  assert.ok(!/details:\s*\{[^}]*(valor|descricao)/.test(acoes), "a auditoria não grava valores nem descrições");
});
