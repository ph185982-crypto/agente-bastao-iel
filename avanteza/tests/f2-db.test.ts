// F2 com Postgres local descartável (TEST_DATABASE_URL): barramento de eventos (idempotência, retentativa), onboarding
// do contrato assinado (rodar 2× não duplica cliente/serviço/ação/acesso/receita), notificações (senha uma vez),
// APIs do Max (pendências, concluir, importar) e importação de conversa exportada (dedup, áudio, cliente lembrado).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import bcrypt from "bcryptjs";
import { HAS_DB, resetSchema, closeDb, mkClient } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { semearCatalogo } from "../src/lib/motor/repo";
import { handleEvento } from "../src/lib/eventos/api";
import { processarEvento, processarPendentes, reenfileirar, MAX_TENTATIVAS } from "../src/lib/eventos/barramento";
import { listarNotificacoes, marcarLida, revelarSegredo } from "../src/lib/notificacoes";
import { handlePendencias, handleConcluir } from "../src/lib/motor/pendencias-api";
import { handleImportar } from "../src/lib/capturas/importar-api";
import { importarConversa } from "../src/lib/capturas/importar";
import * as mapa from "../src/lib/mapa/repo";
import type { AiProvider } from "../src/lib/ai/provider";
import type { FinanceiroProvider } from "../src/lib/financeiro/vendedoria";
import { FinanceiroErro } from "../src/lib/financeiro/vendedoria";
import type { Session } from "../src/lib/session";
import { ANDROID, IOS, montarZip } from "./_whatsapp-amostras";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const HOJE = "2026-11-16";
const EK = "chave-de-eventos-de-teste-0123456789";
const CK = "chave-de-captura-de-teste-0123456789";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.SESSION_SECRET = "s".repeat(40);

class FakeAi implements AiProvider {
  readonly name = "falso";
  calls = 0;
  contextos: string[] = [];
  constructor(private out: (ctx: string) => unknown) {}
  enabled() { return true; }
  async analyze(): Promise<any> { throw new Error("não usado"); }
  async extract<T>(_s: string, ctx: string, _schema: ZodType<T>) {
    this.calls++; this.contextos.push(ctx);
    return { output: this.out(ctx) as T, provider: "falso", model: "falso-1", usage: {} };
  }
}

/** Financeiro falso (Vendedor IA): só contratos e criarReceita. `fora` simula indisponível; `perdeResposta` grava mas falha. */
function finFalso() {
  const st = { contratos: [] as { id: string; descricao: string }[], criadas: 0, fora: false, perdeResposta: false };
  const fin = {
    contratos: async () => {
      if (st.fora) throw new FinanceiroErro("Não foi possível falar com o Vendedor IA.", "rede");
      return st.contratos.map((c) => ({ ...c, cliente: null, tipo_negocio: "nexo", modo: "recorrente", valor_parcela: 1, dia_vencimento: 10, data_inicio: HOJE, status: "ativo", parcelas: { recebidas: { quantidade: 0, total: 0 }, abertas: { quantidade: 0, total: 0 }, perdidas: { quantidade: 0, total: 0 } } }));
    },
    criarReceita: async (_e: string, r: { descricao: string }) => {
      if (st.fora) throw new FinanceiroErro("Não foi possível falar com o Vendedor IA.", "rede");
      st.criadas++;
      st.contratos.push({ id: `ct-${st.criadas}`, descricao: r.descricao });
      if (st.perdeResposta) { st.perdeResposta = false; throw new FinanceiroErro("O Vendedor IA demorou demais para responder.", "timeout"); }
    },
  };
  return { st, fin: fin as unknown as FinanceiroProvider };
}

const evento = (envelopeId: string, p: Record<string, unknown> = {}) => ({
  id: `contrato.assinado:${envelopeId}`, tipo: "contrato.assinado", origem: "comercial", ocorrido_em: "2026-11-16T13:00:00Z",
  payload: { contratoId: `ct-${envelopeId}`, envelopeId, razaoSocial: "Ladies Moda Comércio Ltda", nomeFantasia: "Ladies", cnpj: "11.222.333/0001-81",
    representante: "Carla Souza", emailCliente: "carla@ladies.com.br", telefoneCliente: "+55 62 99999-0000", modelo: "Prestação de serviços", plano: "Essencial",
    servicos: ["marketplace", "trafego"], valorMensal: 3000, duracaoMeses: 12, inicioEm: "2026-11-17", vencimentoDia: 10, ...p },
});
const reqEvento = (body: unknown, auth?: string, ct = "application/json") =>
  new Request("http://x/api/eventos", { method: "POST", headers: { "content-type": ct, ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) });
const n = async (sql: string, p: unknown[] = []) => Number((await rawQuery<{ n: number }>(sql, p))[0].n);
const admin: Session = { email: "admin@avanteza.com.br", role: "admin", apps: [] } as unknown as Session;
const membro: Session = { email: "ana@avanteza.com.br", role: "member", apps: [] } as unknown as Session;
const contagens = async (clientId: string) => ({
  clientes: await n("select count(*)::int n from avanteza.clients"),
  servicos: await n("select count(*)::int n from avanteza.client_services where client_id = $1", [clientId]),
  acoes: await n("select count(*)::int n from avanteza.plan_actions where client_id = $1 and archived_at is null", [clientId]),
  kickoffs: await n("select count(*)::int n from avanteza.plan_actions where client_id = $1 and title ilike '%kickoff%' and archived_at is null", [clientId]),
  fases: await n("select count(*)::int n from avanteza.plan_phases where client_id = $1", [clientId]),
  usuarios: await n("select count(*)::int n from avanteza.admins where role = 'client'"),
  notificacoes: await n("select count(*)::int n from avanteza.notificacoes"),
});

before(async () => {
  if (skip) return;
  await resetSchema();
  await semearCatalogo();
  await rawQuery("insert into avanteza.admins (email, role, name, delivery_roles) values ('admin@avanteza.com.br','admin','Pedro',$1), ('ana@avanteza.com.br','member','Ana',$2)", [["gestor_conta"], ["marketplace"]]);
});
after(async () => { if (!skip) await closeDb(); });

test("schema F2 idempotente: tabelas novas e CNPJ único", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  for (const t of ["eventos", "onboardings", "notificacoes", "captura_mensagens", "captura_conversas"]) {
    assert.equal(await n("select count(*)::int n from information_schema.tables where table_schema = 'avanteza' and table_name = $1", [t]), 1, t);
  }
  const a = await mkClient("Tmp A", { slug: "tmp-a" });
  await rawQuery("update avanteza.clients set cnpj = '00000000000191' where id = $1", [a]);
  const b = await mkClient("Tmp B", { slug: "tmp-b" });
  await assert.rejects(rawQuery("update avanteza.clients set cnpj = '00000000000191' where id = $1", [b]));
  await rawQuery("delete from avanteza.clients where id = any($1::uuid[])", [[a, b]]);
});

test("POST /api/eventos: 503 sem chave, 401 (inclusive prefixo), 415, 400, 422 tipo desconhecido, 202 processado, 200 duplicado", { skip }, async () => {
  const { fin, st } = finFalso();
  delete process.env.AVANTEZA_EVENTS_KEY;
  assert.equal((await handleEvento(reqEvento(evento("e0"), "x"))).status, 503);
  process.env.AVANTEZA_EVENTS_KEY = EK;
  assert.equal((await handleEvento(reqEvento(evento("e0")))).status, 401);
  assert.equal((await handleEvento(reqEvento(evento("e0"), EK.slice(0, -1)))).status, 401);
  assert.equal((await handleEvento(reqEvento(evento("e0"), EK, "text/plain"))).status, 415);
  assert.equal((await handleEvento(reqEvento("{x", EK))).status, 400);
  assert.equal((await handleEvento(reqEvento({ ...evento("e0"), tipo: "outro.tipo" }, EK))).status, 422);
  assert.equal((await handleEvento(reqEvento({ ...evento("e0"), id: "contrato.assinado:diferente" }, EK))).status, 400);
  assert.equal(await n("select count(*)::int n from avanteza.eventos"), 0, "nada gravado nas recusas");

  const r = await handleEvento(reqEvento(evento("env-ladies"), EK), { financeiro: fin, hoje: HOJE });
  assert.equal(r.status, 202);
  assert.deepEqual(await r.json(), { id: "contrato.assinado:env-ladies", duplicado: false, status: "processado" });
  const dup = await handleEvento(reqEvento(evento("env-ladies"), EK), { financeiro: fin, hoje: HOJE });
  assert.equal(dup.status, 200);
  assert.equal((await dup.json()).duplicado, true);
  assert.equal(st.criadas, 1);
});

test("onboarding: cliente com CNPJ, serviços (+ Onboarding), plano, Kickoff D+2 único, acesso com hash, receita e auditoria", { skip }, async () => {
  const [c] = await rawQuery<{ id: string; name: string; cnpj: string; kind: string; start_date: string; contact_email: string; slug: string }>("select id, name, cnpj, kind, start_date, contact_email, slug from avanteza.clients where name = 'Ladies'");
  assert.ok(c, "cliente criado com o nome fantasia");
  assert.equal(c.cnpj, "11222333000181");
  assert.equal(c.kind, "ambos");
  assert.equal(c.start_date, "2026-11-17");
  assert.equal(c.slug, "ladies");
  const svc = await rawQuery<{ slug: string; monthly_value: string | null; end_date: string | null; contract_ref: string }>(
    "select sc.slug, cs.monthly_value::text, cs.end_date, cs.contract_ref from avanteza.client_services cs join avanteza.service_catalog sc on sc.id = cs.service_id where cs.client_id = $1 order by sc.slug", [c.id]);
  assert.deepEqual(svc.map((s) => s.slug), ["marketplace", "onboarding", "trafego"]);
  assert.equal(svc.find((s) => s.slug === "marketplace")!.monthly_value, "1500");
  assert.equal(svc.find((s) => s.slug === "marketplace")!.end_date, "2027-11-16");
  assert.equal(svc.find((s) => s.slug === "onboarding")!.monthly_value, null);
  const k = await contagens(c.id);
  assert.equal(k.fases, 4, "plano de 12 meses");
  assert.equal(k.kickoffs, 1, "um Kickoff só (o do plano, vinculado ao playbook)");
  const [kick] = await rawQuery<{ due_date: string; recurrence_key: string | null }>("select due_date, recurrence_key from avanteza.plan_actions where client_id = $1 and title ilike '%kickoff%'", [c.id]);
  assert.equal(kick.due_date, "2026-11-18", "D+2 da assinatura");
  assert.ok(kick.recurrence_key, "vinculado à tarefa do playbook de Onboarding");
  assert.ok(await n("select count(*)::int n from avanteza.plan_actions where client_id = $1 and origin = 'playbook'", [c.id]) > 5, "playbooks aplicados");
  const [u] = await rawQuery<{ password_hash: string; client_id: string }>("select password_hash, client_id from avanteza.admins where email = 'carla@ladies.com.br' and role = 'client'");
  assert.equal(u.client_id, c.id);
  assert.match(u.password_hash, /^\$2[aby]\$12\$/, "só o hash bcrypt");
  assert.deepEqual(await mapa.liveAllowedCompanies("carla@ladies.com.br"), [c.id], "isolamento: o cliente novo só vê a própria empresa");
  const eventosAudit = (await rawQuery<{ event: string }>("select event from avanteza.audit_log where client_id = $1", [c.id])).map((x) => x.event);
  for (const e of ["onboarding_cliente_criado", "onboarding_servicos", "onboarding_plano", "onboarding_kickoff", "onboarding_acesso", "onboarding_receita"]) assert.ok(eventosAudit.includes(e), e);
  const details = JSON.stringify(await rawQuery("select details from avanteza.audit_log"));
  assert.doesNotMatch(details, /carla@ladies|senha|password/i, "auditoria sem dados sensíveis");
  const [o] = await rawQuery<{ financeiro_status: string; financeiro_ref: string }>("select financeiro_status, financeiro_ref from avanteza.onboardings where envelope_id = 'env-ladies'");
  assert.equal(o.financeiro_status, "feito");
  assert.equal(o.financeiro_ref, "ct-1");
});

test("rodar o MESMO evento de novo (reprocessar) não duplica nada; senha aparece uma vez só ao admin", { skip }, async () => {
  const { fin, st } = finFalso();
  st.contratos.push({ id: "ct-1", descricao: "Mensalidade Ladies [ref:env-ladies]" });
  const [c] = await rawQuery<{ id: string }>("select id from avanteza.clients where name = 'Ladies'");
  const antes = await contagens(c.id);
  assert.ok(await reenfileirar("contrato.assinado:env-ladies", "teste"));
  // força o onboarding a refazer tudo do zero (estado apagado): continua sem duplicar, casando pelo CNPJ
  await rawQuery("delete from avanteza.onboardings where envelope_id = 'env-ladies'");
  const r = await processarEvento("contrato.assinado:env-ladies", { financeiro: fin, hoje: HOJE });
  assert.equal(r?.status, "processado");
  const depois = await contagens(c.id);
  assert.deepEqual({ ...depois, notificacoes: 0 }, { ...antes, notificacoes: 0 });
  assert.equal(depois.notificacoes - antes.notificacoes, 0, "notificações têm chave de deduplicação");
  assert.equal(st.criadas, 0, "receita já existia no Financeiro (marca [ref:…]) → não lança de novo");

  const lista = await listarNotificacoes(admin);
  const acesso = lista.itens.find((i) => i.tipo === "acesso_cliente")!;
  assert.ok(acesso.temSegredo);
  assert.ok(lista.itens.some((i) => i.tipo === "contrato_assinado") && lista.itens.some((i) => i.tipo === "cliente_novo"));
  const [enc] = await rawQuery<{ segredo_enc: string }>("select segredo_enc from avanteza.notificacoes where id = $1", [acesso.id]);
  assert.match(enc.segredo_enc, /^v1:/, "senha guardada cifrada");
  assert.equal(await revelarSegredo(membro, acesso.id), null, "membro não revela");
  assert.ok(!(await listarNotificacoes(membro)).itens.some((i) => i.tipo === "acesso_cliente"), "membro não vê notificação só de admin");
  const senha = await revelarSegredo(admin, acesso.id);
  assert.ok(senha && senha.length === 16);
  const [u] = await rawQuery<{ password_hash: string }>("select password_hash from avanteza.admins where email = 'carla@ladies.com.br'");
  assert.ok(await bcrypt.compare(senha!, u.password_hash), "a senha revelada é a do acesso");
  assert.equal(await revelarSegredo(admin, acesso.id), null, "segunda vez: nada");
  assert.equal(await n("select count(*)::int n from avanteza.notificacoes where segredo_enc is not null"), 0);
  const { naoLidas } = await listarNotificacoes(admin);
  await marcarLida(admin, "todas");
  assert.ok(naoLidas > 0);
  assert.equal((await listarNotificacoes(admin)).naoLidas, 0);
  assert.ok((await listarNotificacoes(membro)).naoLidas > 0, "leitura é por pessoa");
});

test("Financeiro fora do ar: pendência + backoff; cron retenta; resposta perdida não duplica a receita", { skip }, async () => {
  const { fin, st } = finFalso();
  st.fora = true;
  process.env.AVANTEZA_EVENTS_KEY = EK;
  const r = await handleEvento(reqEvento(evento("env-show", { razaoSocial: "Showman Barbearia ME", nomeFantasia: "Showman", cnpj: null, emailCliente: null, servicos: ["trafego", "midias", "nao-existe"] }), EK), { financeiro: fin, hoje: HOJE });
  assert.equal((await r.json()).status, "pendente");
  const [ev] = await rawQuery<{ status: string; tentativas: number; erro: string; atraso: number }>(
    "select status, tentativas, erro, extract(epoch from proxima_tentativa_em - now())::int as atraso from avanteza.eventos where id = 'contrato.assinado:env-show'");
  assert.equal(ev.status, "pendente");
  assert.equal(ev.tentativas, 1);
  assert.match(ev.erro, /Financeiro/);
  assert.ok(ev.atraso > 30 && ev.atraso <= 60, "backoff de ~1 min");
  const [c] = await rawQuery<{ id: string; kind: string }>("select id, kind from avanteza.clients where name = 'Showman'");
  assert.equal(c.kind, "midia");
  const [o] = await rawQuery<{ acesso_status: string; financeiro_status: string; resultado: any }>(
    "select o.acesso_status, o.financeiro_status, e.resultado from avanteza.onboardings o join avanteza.eventos e on e.id = o.evento_id where o.envelope_id = 'env-show'");
  assert.equal(o.acesso_status, "sem_email");
  assert.equal(o.financeiro_status, "pendente");
  assert.deepEqual(o.resultado.servicosDesconhecidos, ["nao-existe"]);
  // ainda não venceu: o cron não pega
  assert.equal((await processarPendentes({ deps: { financeiro: fin, hoje: HOJE } })).processados, 0);
  const antes = await contagens(c.id);
  await rawQuery("update avanteza.eventos set proxima_tentativa_em = now() where id = 'contrato.assinado:env-show'");
  st.fora = false; st.perdeResposta = true; // grava no Financeiro, mas a resposta se perde
  const p1 = await processarPendentes({ deps: { financeiro: fin, hoje: HOJE } });
  assert.equal(p1.pendentes, 1);
  await rawQuery("update avanteza.eventos set proxima_tentativa_em = now() where id = 'contrato.assinado:env-show'");
  const p2 = await processarPendentes({ deps: { financeiro: fin, hoje: HOJE } });
  assert.equal(p2.processados, 1);
  assert.equal(st.criadas, 1, "a 2ª tentativa achou a receita pela marca e não lançou de novo");
  assert.deepEqual(await contagens(c.id), { ...antes, notificacoes: (await contagens(c.id)).notificacoes });
  // desistência depois do máximo de tentativas: status falhou + notificação ao admin
  st.fora = true;
  await handleEvento(reqEvento(evento("env-falha", { razaoSocial: "Outra Loja", nomeFantasia: null, cnpj: null, emailCliente: null }), EK), { financeiro: fin, hoje: HOJE });
  await rawQuery("update avanteza.eventos set tentativas = $1, proxima_tentativa_em = now() where id = 'contrato.assinado:env-falha'", [MAX_TENTATIVAS - 1]);
  await processarPendentes({ deps: { financeiro: fin, hoje: HOJE } });
  assert.equal((await rawQuery<{ status: string }>("select status from avanteza.eventos where id = 'contrato.assinado:env-falha'"))[0].status, "falhou");
  assert.ok((await listarNotificacoes(admin)).itens.some((i) => i.tipo === "evento_falhou"));
});

test("casamento: CNPJ igual casa (sem duplicar); nome igual sem CNPJ casa; mesmo nome com OUTRO CNPJ cria outro; simulação não lança receita", { skip }, async () => {
  const { fin, st } = finFalso();
  const total = await n("select count(*)::int n from avanteza.clients");
  await handleEvento(reqEvento(evento("env-ladies-2", { nomeFantasia: "Ladies Store", razaoSocial: "Outra razão" }), EK), { financeiro: fin, hoje: HOJE });
  assert.equal(await n("select count(*)::int n from avanteza.clients"), total, "mesmo CNPJ: mesmo cliente");
  const existente = await mkClient("Barbearia do Zé", { slug: "ze" });
  await handleEvento(reqEvento(evento("env-ze", { razaoSocial: "BARBEARIA DO ZÉ LTDA", nomeFantasia: null, cnpj: "11444777000161", simulado: true }), EK), { financeiro: fin, hoje: HOJE });
  const [ze] = await rawQuery<{ cnpj: string }>("select cnpj from avanteza.clients where id = $1", [existente]);
  assert.equal(ze.cnpj, "11444777000161", "casou pelo nome e ganhou o CNPJ");
  assert.equal((await rawQuery<{ financeiro_status: string }>("select financeiro_status from avanteza.onboardings where envelope_id = 'env-ze'"))[0].financeiro_status, "simulacao");
  const antes = await n("select count(*)::int n from avanteza.clients");
  await handleEvento(reqEvento(evento("env-ze-2", { razaoSocial: "Barbearia do Zé", nomeFantasia: null, cnpj: "45723174000110", emailCliente: "ze@x.com" }), EK), { financeiro: fin, hoje: HOJE });
  assert.equal(await n("select count(*)::int n from avanteza.clients"), antes + 1, "outro CNPJ → outra empresa");
  assert.equal(await n("select count(*)::int n from avanteza.clients where slug = 'barbearia-do-ze'"), 1);
  assert.equal(st.criadas, 2, "Ladies 2 e Zé 2 lançam; a simulação não");
});

const reqServ = (url: string, init: RequestInit = {}, auth: string | null = CK) =>
  new Request(`http://x${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });

test("Max: pendências do cliente, concluir por similaridade (clara, ambígua → opções, por id) e cliente ambíguo → 409", { skip }, async () => {
  delete process.env.AVANTEZA_CAPTURE_KEY;
  assert.equal((await handlePendencias(reqServ("/api/capturas/pendencias?cliente=Ladies"))).status, 503);
  process.env.AVANTEZA_CAPTURE_KEY = CK;
  assert.equal((await handlePendencias(reqServ("/api/capturas/pendencias?cliente=Ladies", {}, "errada"))).status, 401);
  const r = await handlePendencias(reqServ("/api/capturas/pendencias?cliente=ladies"), { hoje: HOJE });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.cliente.nome, "Ladies");
  assert.ok(j.total > 5 && j.acoes.length > 0 && j.acoes.length <= 25);
  assert.ok(j.acoes.some((a: any) => /kickoff/i.test(a.titulo)));
  const amb = await handlePendencias(reqServ("/api/capturas/pendencias?cliente=barbearia"));
  assert.equal(amb.status, 409);
  assert.ok((await amb.json()).candidatos.length >= 2);

  const post = (b: unknown) => reqServ("/api/capturas/concluir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const ok = await handleConcluir(post({ cliente: "Ladies", acao: "fiz a reunião de kickoff" }), { hoje: HOJE });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).concluida.titulo, /kickoff/i);
  const [k] = await rawQuery<{ status: string }>("select a.status from avanteza.plan_actions a join avanteza.clients c on c.id = a.client_id where c.name = 'Ladies' and a.title ilike '%kickoff%' and a.archived_at is null");
  assert.equal(k.status, "concluida");
  assert.ok(await n("select count(*)::int n from avanteza.audit_log where event = 'motor_concluir' and actor = 'max:whatsapp'") >= 1);
  const opc = await handleConcluir(post({ cliente: "Ladies", acao: "campanhas de ads" }), { hoje: HOJE });
  assert.equal(opc.status, 409);
  const { opcoes } = await opc.json();
  assert.ok(opcoes.length >= 2);
  const porId = await handleConcluir(post({ cliente: "Ladies", acaoId: opcoes[0].id }), { hoje: HOJE });
  assert.equal(porId.status, 200);
  assert.equal((await handleConcluir(post({ cliente: "Ladies", acaoId: opcoes[0].id }), { hoje: HOJE })).status, 404, "já concluída");
  assert.equal((await handleConcluir(post({ cliente: "Ladies", acao: "comprar pão francês" }), { hoje: HOJE })).status, 404);
  // a ação de outro cliente não pode ser concluída pelo id
  const [outra] = await rawQuery<{ id: string }>("select a.id from avanteza.plan_actions a join avanteza.clients c on c.id = a.client_id where c.name = 'Showman' and a.status <> 'concluida' limit 1");
  assert.equal((await handleConcluir(post({ cliente: "Ladies", acaoId: outra.id }), { hoje: HOJE })).status, 404, "isolamento entre clientes");
});

test("importar conversa: só mensagens novas, ações com selo IA, cliente lembrado, áudio transcrito só com provedor, API do Max", { skip }, async () => {
  const [lad] = await rawQuery<{ id: string }>("select id from avanteza.clients where name = 'Ladies'");
  const ai = new FakeAi((ctx) => ({ resumo: "x", acoes: /planilha/.test(ctx) ? [{ titulo: "Enviar a planilha de custos", descricao: null, responsavel: "cliente", prazo: "2026-11-14" }] : [] }));
  const meio = ANDROID.split("\n").slice(0, 9).join("\n"); // sem as mensagens de 11 e 20/11
  const r1 = await importarConversa({ clientId: lad.id, buf: Buffer.from(meio), nome: "Conversa do WhatsApp com Ladies x Avanteza.txt", actor: "teste" }, { provider: ai, transcrever: null, hoje: HOJE });
  assert.equal(r1.novas, 3);
  assert.equal(r1.acoesCriadas, 1);
  const [acao] = await rawQuery<{ ai_generated: boolean; origin: string; owner: string }>("select ai_generated, origin, owner from avanteza.plan_actions where title = 'Enviar a planilha de custos'");
  assert.deepEqual(acao, { ai_generated: true, origin: "captura", owner: "cliente" });
  // mesma conversa, agora completa (exportada de novo dias depois): só entram as novas
  const r2 = await importarConversa({ clientId: lad.id, buf: Buffer.from(ANDROID), nome: "Conversa do WhatsApp com Ladies x Avanteza.txt", actor: "teste" }, { provider: ai, transcrever: null, hoje: HOJE });
  assert.equal(r2.duplicadas, 3);
  assert.equal(r2.novas, 3);
  assert.equal(r2.audiosNaoTranscritos, 1, "sem provedor: áudio não transcrito");
  assert.equal(r2.blocos, 2);
  assert.ok(ai.contextos.at(-2)!.includes("[áudio não transcrito]"));
  const r3 = await importarConversa({ clientId: lad.id, buf: Buffer.from(ANDROID), nome: "Conversa do WhatsApp com Ladies x Avanteza.txt", actor: "teste" }, { provider: ai, transcrever: null, hoje: HOJE });
  assert.deepEqual([r3.novas, r3.blocos, r3.acoesCriadas], [0, 0, 0], "3ª vez: nada novo");
  assert.equal(await n("select count(*)::int n from avanteza.capturas where client_id = $1 and origem = 'whatsapp_export' and conversa = 'Ladies x Avanteza'", [lad.id]), 3);

  // API do Max: zip do iOS com áudio, cliente pelo nome; depois a mesma conversa sem ?cliente usa o cliente lembrado
  const [show] = await rawQuery<{ id: string }>("select id from avanteza.clients where name = 'Showman'");
  const z = montarZip({ "_chat.txt": IOS, "00000007-AUDIO-2026-11-12-08-06-02.opus": Buffer.from("OggS-falso") });
  const transcritos: string[] = [];
  const transcrever = async (_b: Buffer, nome: string) => { transcritos.push(nome); return "subo a campanha de corte e barba até sexta"; };
  const imp = (q: string, body: Buffer, ct = "application/zip", auth: string | null = CK) =>
    handleImportar(reqServ(`/api/capturas/importar?${q}`, { method: "POST", headers: { "content-type": ct, "content-length": String(body.length) }, body: new Uint8Array(body) }, auth), { provider: ai, transcrever, hoje: HOJE });
  assert.equal((await imp("cliente=Showman&arquivo=x.zip", z, "application/zip", "errada")).status, 401);
  assert.equal((await imp("cliente=Showman&arquivo=x.zip", z, "image/png")).status, 415);
  assert.equal((await imp("arquivo=WhatsApp%20Chat%20-%20Showman%20Barbearia.zip", z)).status, 400, "sem cliente e sem memória: pergunta");
  assert.equal((await imp("cliente=barbearia&arquivo=x.zip", z)).status, 409, "cliente ambíguo");
  const ok = await imp("cliente=Showman&arquivo=WhatsApp%20Chat%20-%20Showman%20Barbearia.zip", z);
  assert.equal(ok.status, 201);
  const jo = await ok.json();
  assert.equal(jo.clientId, show.id);
  assert.equal(jo.audiosTranscritos, 1);
  assert.deepEqual(transcritos, ["00000007-AUDIO-2026-11-12-08-06-02.opus"]);
  assert.ok(ai.contextos.at(-1)!.includes("[áudio transcrito] subo a campanha"));
  const ext = IOS + "\n[14/11/2026, 09:00:00] João Showman: e a planilha?";
  const lembrado = await imp("arquivo=WhatsApp%20Chat%20-%20Showman%20Barbearia.zip", Buffer.from(ext), "text/plain");
  assert.equal(lembrado.status, 201, "sem ?cliente: usa o cliente lembrado da conversa");
  assert.equal((await lembrado.json()).novas, 1);
  assert.equal(transcritos.length, 1, "áudio já importado não é transcrito de novo");
  assert.ok((await listarNotificacoes(membro)).itens.some((i) => i.tipo === "captura"), "captura registrada notifica a equipe");
  assert.equal(await n("select count(*)::int n from avanteza.captura_mensagens where client_id = $1", [lad.id]), 6);
});
