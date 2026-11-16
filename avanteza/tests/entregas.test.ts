// Funil de Entrega da Central: cliente HTTP (zod, timeout, retry só em leitura), acesso por papel, menu, fixture
// (ignorada em produção), vínculo com o Mapa e formulários. Sem rede: fetch simulado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarProvedorEntregas, provedorEntregasDoAmbiente, EntregasErro, mensagemDoErro } from "../src/lib/entregas/crm";
import { criarProvedorFixture, fixtureEntregasAtiva } from "../src/lib/entregas/fixture";
import { clientesDoMapa, obterProvedor, tentar } from "../src/lib/entregas";
import { podeEscreverEntregas, podeVerEntregas, recusaDeEscrita } from "../src/lib/entregas/acesso";
import { casarClienteMapa, normalizarNome } from "../src/lib/entregas/mapa";
import { checklistParaTexto, diaParaIso, isoParaDia, parseChecklist } from "../src/lib/entregas/forms";
import { departamentosVisiveis } from "../src/lib/shell/departamentos";
import { menuEquipe } from "../src/lib/shell/menu";
import type { Session } from "../src/lib/session";

process.env.ADMIN_EMAILS = "dono@avanteza.com.br";
const CHAVE = "chave-crm-falsa-de-teste";
const sem = async () => undefined;
const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
const dono: Session = { email: "dono@avanteza.com.br", role: "admin", apps: [], name: "Dono" };
const revisor: Session = { email: "rev@avanteza.com.br", role: "reviewer", apps: [], name: "Rev" };
const membroEnt: Session = { email: "e@avanteza.com.br", role: "member", apps: ["entregas"], name: "E" };
const membroVendas: Session = { email: "v@avanteza.com.br", role: "member", apps: ["vendas"], name: "V" };
const cliente: Session = { email: "c@c.com", role: "client", apps: [], name: "C", clientId: "x", clientIds: ["x"] };

const quadroOk = { colunas: [{ id: "BACKLOG", rotulo: "Backlog" }], pilares: [{ id: "COMERCIAL", rotulo: "Comercial" }], indicadores: { entregas: 0, mrr: 0, cartoesAbertos: 0, atrasados: 0, aguardandoCliente: 0, emRisco: 0, renovacoesProximas: 0 }, entregas: [], cartoes: [] };

test("cliente HTTP: URL, Bearer, query, corpo e validação zod", async () => {
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const p = criarProvedorEntregas({ baseUrl: "https://crm.teste/", chave: CHAVE, sleep: sem, fetchImpl: (async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return json(quadroOk); }) as typeof fetch });
  await p.quadro({ status: "EM_ANDAMENTO", q: "Ni c", responsavelId: "sem", pilar: "MARKETING", atrasados: true });
  assert.equal(chamadas[0].url, "https://crm.teste/api/integracoes/avanteza/entregas/quadro?status=EM_ANDAMENTO&q=Ni+c&responsavelId=sem&pilar=MARKETING&atrasados=1");
  assert.equal((chamadas[0].init.headers as Record<string, string>).Authorization, `Bearer ${CHAVE}`);
  const p2 = criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return json({ ok: true }); }) as typeof fetch });
  await p2.editarCartao("e/1", "c 2", { coluna: "CONCLUIDO", posicao: 0 });
  const c = chamadas.at(-1)!;
  assert.equal(c.url, "https://nexo-crm-tawny.vercel.app/api/integracoes/avanteza/entregas/e%2F1/cartoes/c%202");
  assert.equal(c.init.method, "PATCH");
  assert.deepEqual(JSON.parse(String(c.init.body)), { coluna: "CONCLUIDO", posicao: 0 });
  const ruim = criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async () => json({ qualquer: 1 })) as typeof fetch });
  await assert.rejects(ruim.quadro(), (e: EntregasErro) => e.codigo === "formato");
});

test("erros: 401, 503, 404, 400 com mensagem do CRM; chave nunca na mensagem", async () => {
  const com = (status: number, corpo: unknown = {}) => criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async () => json(corpo, status)) as typeof fetch });
  await assert.rejects(com(401).quadro(), (e: EntregasErro) => e.codigo === "nao-autorizado" && !e.message.includes(CHAVE));
  await assert.rejects(com(503).quadro(), (e: EntregasErro) => e.codigo === "nao-configurado");
  await assert.rejects(com(404).entrega("x"), (e: EntregasErro) => e.codigo === "nao-encontrado");
  await assert.rejects(com(400, { erro: "coluna inválida" }).editarCartao("a", "b", {}), (e: EntregasErro) => e.codigo === "rejeitado" && e.message === "coluna inválida");
  assert.equal(mensagemDoErro(new Error("x")), "O CRM está indisponível no momento.");
  assert.throws(() => provedorEntregasDoAmbiente({} as NodeJS.ProcessEnv), (e: EntregasErro) => e.codigo === "nao-configurado");
});

test("retry: leitura repete em 5xx e rede; escrita nunca repete; timeout vira erro", async () => {
  let n = 0;
  const leitura = criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async () => { n++; return n === 1 ? json({}, 502) : json(quadroOk); }) as typeof fetch });
  await leitura.quadro();
  assert.equal(n, 2);
  n = 0;
  const escrita = criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async () => { n++; return json({}, 502); }) as typeof fetch });
  await assert.rejects(escrita.concluirEntrega("e1"), (e: EntregasErro) => e.codigo === "http");
  assert.equal(n, 1, "escrita não repete");
  n = 0;
  const rede = criarProvedorEntregas({ chave: CHAVE, sleep: sem, fetchImpl: (async () => { n++; throw new Error("ECONNRESET"); }) as typeof fetch });
  await assert.rejects(rede.criarCartao("e1", { titulo: "x" }), (e: EntregasErro) => e.codigo === "rede");
  assert.equal(n, 1);
  const lento = criarProvedorEntregas({ chave: CHAVE, sleep: sem, timeoutMs: 5, tentativas: 0, fetchImpl: ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch });
  await assert.rejects(lento.quadro(), (e: EntregasErro) => e.codigo === "timeout");
});

test("fixture: ignorada em produção; mover aplica as regras do ciclo; modo erro", async () => {
  assert.equal(fixtureEntregasAtiva({ ENTREGAS_FIXTURE: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv), null);
  assert.equal(fixtureEntregasAtiva({ ENTREGAS_FIXTURE: "1", VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv), null);
  assert.equal(fixtureEntregasAtiva({ ENTREGAS_FIXTURE: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv), "1");
  assert.throws(() => obterProvedor({ ENTREGAS_FIXTURE: "1", NODE_ENV: "production" } as NodeJS.ProcessEnv), (e: EntregasErro) => e.codigo === "nao-configurado");
  const p = criarProvedorFixture("1");
  const q = await p.quadro();
  assert.ok(q.cartoes.length > 5 && q.indicadores.atrasados > 0);
  const c = q.cartoes.find((x) => x.coluna === "BACKLOG")!;
  await p.editarCartao(c.entregaId, c.id, { coluna: "CONCLUIDO" });
  assert.equal((await p.cartao(c.entregaId, c.id)).coluna, "CONCLUIDO");
  await assert.rejects(p.editarCartao(c.entregaId, c.id, { coluna: "XX" as never }), (e: EntregasErro) => e.codigo === "rejeitado");
  assert.equal((await p.quadro({ responsavelId: "sem" })).cartoes.every((x) => x.responsavel === null), true);
  assert.equal((await criarProvedorFixture("vazio").quadro()).cartoes.length, 0);
  const f = await tentar((x) => x.quadro(), { ENTREGAS_FIXTURE: "erro", NODE_ENV: "development" } as NodeJS.ProcessEnv);
  assert.equal(f.estado, "indisponivel");
  const nc = await tentar((x) => x.quadro(), {} as NodeJS.ProcessEnv);
  assert.equal(nc.estado, "nao-configurado");
});

test("acesso: admin escreve; revisor lê; membro só com o app; cliente nunca", () => {
  assert.equal(podeVerEntregas(dono), true); assert.equal(podeEscreverEntregas(dono), true);
  assert.equal(podeVerEntregas(revisor), true); assert.equal(podeEscreverEntregas(revisor), false);
  assert.equal(podeVerEntregas(membroEnt), true); assert.equal(podeEscreverEntregas(membroEnt), false);
  assert.equal(podeVerEntregas(membroVendas), false);
  assert.equal(podeVerEntregas(cliente), false);
  assert.equal(podeVerEntregas(null), false);
  assert.equal(podeVerEntregas({ ...dono, email: "outro@x.com" }), false, "admin fora de ADMIN_EMAILS");
  assert.equal(recusaDeEscrita(dono), null);
  assert.match(recusaDeEscrita(revisor)!, /somente leitura/);
  assert.match(recusaDeEscrita(membroVendas)!, /não tem acesso/);
});

test("menu: Motor de Entregas (Hoje, Carteira, Calendário, Playbooks) e o Funil de Entrega distintos", () => {
  const itens = (s: Session) => menuEquipe(s).find((g) => g.label === "Operações")?.items.map((i) => `${i.label}=${i.href}`);
  const motor = ["Hoje=/operacoes", "Carteira=/operacoes/carteira", "Calendário=/operacoes/calendario", "Playbooks=/operacoes/playbooks"];
  assert.deepEqual(itens(dono), [...motor, "Funil de Entrega=/operacoes/entregas", "Clientes e Mapa=/clientes", "Marketplaces=/"]);
  assert.deepEqual(itens(membroEnt), [...motor, "Funil de Entrega=/operacoes/entregas"]);
  assert.deepEqual(departamentosVisiveis(membroVendas).map((d) => d.id), ["operacoes", "comercial"]);
  assert.equal(menuEquipe(dono).find((g) => g.label === "Operações")!.items[0].exact, true, "Hoje (/operacoes) não acende nas subpáginas");
});

test("vínculo com o Mapa: nome/slug, sem acento nem sufixo; em dúvida não vincula; falha = vazio", async () => {
  const mapa = [{ id: "1", name: "Casa Ambos Ltda." }, { id: "2", name: "Showman" }, { id: "3", name: "Vulk Jeans Brasil" }, { id: "4", name: "Vulk Jeans Kids" }];
  assert.equal(normalizarNome("Casa Ambos Ltda."), "casa ambos");
  assert.equal(casarClienteMapa("CASA ÁMBOS", mapa)?.id, "1");
  assert.equal(casarClienteMapa("Showman Ltda.", mapa)?.id, "2");
  assert.equal(casarClienteMapa("casa-ambos", mapa)?.id, "1");
  assert.equal(casarClienteMapa("Vulk Jeans", mapa), null, "ambíguo");
  assert.equal(casarClienteMapa("Outra Empresa", mapa), null);
  assert.equal(casarClienteMapa("ab", mapa), null);
  const v = await clientesDoMapa([{ id: "c1", nome: "Showman" }], {} as NodeJS.ProcessEnv, async () => mapa);
  assert.equal(v.get("c1")?.id, "2");
  assert.equal((await clientesDoMapa([{ id: "c1", nome: "Showman" }], {} as NodeJS.ProcessEnv, async () => { throw new Error("banco fora"); })).size, 0);
});

test("formulários: datas no fuso de São Paulo e checklist", () => {
  assert.equal(isoParaDia(diaParaIso("2026-11-20")), "2026-11-20");
  assert.equal(isoParaDia(null), "");
  const l = parseChecklist("[x] Um\n[ ] Dois\nTrês\n\n  \n[X] Quatro");
  assert.deepEqual(l, [{ texto: "Um", feito: true }, { texto: "Dois", feito: false }, { texto: "Três", feito: false }, { texto: "Quatro", feito: true }]);
  assert.deepEqual(parseChecklist(checklistParaTexto(l)), l);
  assert.equal(parseChecklist(Array(80).fill("a").join("\n")).length, 50);
});
