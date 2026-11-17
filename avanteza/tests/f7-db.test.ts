// F7 (Mapa) com Postgres local descartável (TEST_DATABASE_URL): aprovações (ajuste → ação no Motor, aprovar conclui, nova versão,
// isolamento/IDOR e "Ver como cliente" somente leitura), relatório semanal (geração idempotente por semana, só dados visíveis,
// IA opcional, revisão/publicação automática, e-mail uma vez, PDF) e lembretes (máx. 1 por dia por cliente, agrupados, desligáveis).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ZodType } from "zod";
import { HAS_DB, resetSchema, closeDb, mkClient, mkUser } from "./_mapa-fixtures";
import { rawQuery } from "../src/lib/db/client";
import { signSession, verifySessionFull } from "../src/lib/session";
import { scopeFromSession, type ClientScope } from "../src/lib/mapa/scope";
import * as mapa from "../src/lib/mapa/repo";
import * as apCli from "../src/lib/mapa/aprovacoes";
import * as relCli from "../src/lib/mapa/relatorios";
import * as apEq from "../src/lib/aprovacoes/equipe";
import * as rel from "../src/lib/relatorios/gerar";
import { rotinaLembretes, pendenciasParaLembrete } from "../src/lib/relatorios/lembretes";
import { semanaAnterior, destaquesDe, aberturaModelo, kpisDoRelatorio } from "../src/lib/relatorios/semana";
import { gerarPdfRelatorio, nomeArquivoPdf } from "../src/lib/relatorios/pdf";
import type { AiProvider } from "../src/lib/ai/provider";

const skip = !HAS_DB && "defina TEST_DATABASE_URL (Postgres local de teste)";
const SECRET = "s".repeat(40);
process.env.SESSION_SECRET = SECRET;
process.env.ADMIN_EMAILS = "admin@avanteza.com.br";
const HOJE = "2026-11-16"; // segunda-feira
const EQUIPE = "ana@avanteza.com.br";

class FakeAi implements AiProvider {
  readonly name = "falso";
  calls = 0;
  ctx = "";
  constructor(private out: unknown, private falhar = false) {}
  enabled() { return true; }
  async analyze(): Promise<any> { throw new Error("não usado"); }
  async extract<T>(_s: string, ctx: string, _schema: ZodType<T>) {
    this.calls++; this.ctx = ctx;
    if (this.falhar) throw new Error("fora do ar");
    return { output: this.out as T, provider: "falso", model: "falso-1", usage: {} };
  }
}
const correio = () => {
  const enviados: { to: string; subject: string; html: string }[] = [];
  return { enviados, enviar: async (to: string, subject: string, html: string) => { enviados.push({ to, subject, html }); return true; } };
};

let A = "", B = "", anaId = "", pedroId = "", tarefaA = "", tarefaB = "";
const count = async (sql: string, p: unknown[] = []) => Number((await rawQuery<{ n: number }>(sql, p))[0].n);
async function scopeOf(email: string, ids: string[]): Promise<ClientScope> {
  const sess = await verifySessionFull(await signSession(email, SECRET, 3600, "client", { clientIds: ids }), SECRET);
  return scopeFromSession(sess, null, null, await mapa.liveAllowedCompanies(email))!;
}
async function previewOf(clientId: string): Promise<ClientScope> {
  const staff = await verifySessionFull(await signSession("admin@avanteza.com.br", SECRET, 3600, "admin"), SECRET);
  return scopeFromSession(staff, clientId)!;
}

before(async () => {
  if (skip) return;
  await resetSchema();
  A = await mkClient("Loja A", { slug: "loja-a", kind: "midia" });
  B = await mkClient("Loja B", { slug: "loja-b", kind: "marketplace" });
  await rawQuery("update avanteza.clients set contact_email = 'contato@loja-a.test' where id = $1", [A]);
  await rawQuery("insert into avanteza.admins (email, role, name) values ('admin@avanteza.com.br','admin','Pedro'), ($1,'member','Ana')", [EQUIPE]);
  anaId = (await rawQuery<{ id: string }>("select id from avanteza.admins where email = $1", [EQUIPE]))[0].id;
  pedroId = (await rawQuery<{ id: string }>("select id from avanteza.admins where email = 'admin@avanteza.com.br'"))[0].id;
  await rawQuery("update avanteza.clients set manager_id = $1 where id = $2", [pedroId, B]);
  await mkUser("a@cliente.test", A);
  await mkUser("b@cliente.test", B);
  tarefaA = (await rawQuery<{ id: string }>("insert into avanteza.plan_actions (client_id, title, owner, assignee_id, role, due_date) values ($1,'Criar post Black Friday','avanteza',$2,'design','2026-11-18') returning id", [A, anaId]))[0].id;
  tarefaB = (await rawQuery<{ id: string }>("insert into avanteza.plan_actions (client_id, title, owner, due_date) values ($1,'Tarefa da B','avanteza','2026-11-18') returning id", [B]))[0].id;
});
after(async () => { if (!skip) await closeDb(); });

test("schema F7: tabelas novas, idempotente, origem 'aprovacao' aceita e preferências com padrão", { skip }, async () => {
  const { readFileSync } = await import("node:fs");
  await rawQuery(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  for (const t of ["aprovacoes", "aprovacao_versoes", "aprovacao_eventos", "relatorios_semanais", "lembretes_cliente"]) {
    assert.equal(await count("select count(*)::int n from information_schema.tables where table_schema = 'avanteza' and table_name = $1", [t]), 1, t);
  }
  const [c] = await rawQuery<any>("select relatorio_modo, relatorio_horas, lembretes_ativos from avanteza.clients where id = $1", [A]);
  assert.deepEqual(c, { relatorio_modo: "auto", relatorio_horas: 12, lembretes_ativos: true });
  await rawQuery("insert into avanteza.plan_actions (client_id, title, origin) values ($1,'x','aprovacao')", [B]);
  await rawQuery("delete from avanteza.plan_actions where client_id = $1 and title = 'x'", [B]);
  await assert.rejects(rawQuery("update avanteza.clients set relatorio_modo = 'nunca' where id = $1", [A]));
});

test("equipe: validações ao enviar peça (link http(s), tarefa e arquivo do MESMO cliente)", { skip }, async () => {
  const base = { clientId: A, tipo: "post", titulo: "Post Black Friday" };
  assert.deepEqual(await apEq.criarAprovacao(EQUIPE, { ...base, link: "javascript:alert(1)" }), { ok: false, erro: "Informe o link da peça (https://…) ou escolha um arquivo do cliente." });
  assert.equal((await apEq.criarAprovacao(EQUIPE, { ...base, link: "https://x.test/a", actionId: tarefaB })).ok, false, "tarefa de outro cliente");
  const [fB] = await rawQuery<{ id: string }>("insert into avanteza.client_files (client_id, title, url) values ($1,'Arquivo B','https://x.test/b') returning id", [B]);
  assert.equal((await apEq.criarAprovacao(EQUIPE, { ...base, arquivoId: fB.id })).ok, false, "arquivo de outro cliente");
  assert.equal((await apEq.criarAprovacao(EQUIPE, { ...base, tipo: "qualquer", link: "https://x.test/a" })).ok, false);
  assert.equal(await count("select count(*)::int n from avanteza.aprovacoes"), 0);
});

let apId = "";
test("fluxo: enviar → cliente pede ajuste (ação no Motor com o responsável da tarefa) → nova versão conclui o ajuste → aprovar conclui a tarefa", { skip }, async () => {
  const r = await apEq.criarAprovacao(EQUIPE, { clientId: A, tipo: "post", titulo: "Post Black Friday", prazo: "2026-11-18", link: "https://drive.test/v1", actionId: tarefaA, nota: "Primeira versão" });
  assert.ok(r.ok); apId = (r as any).id;
  const sA = await scopeOf("a@cliente.test", [A]);
  assert.equal(await apCli.contarParaAprovar(sA), 1);
  const lista = await apCli.listarAprovacoes(sA);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].link, "https://drive.test/v1");
  assert.ok(!JSON.stringify(lista).includes(EQUIPE), "e-mail da equipe não vai para o cliente");

  assert.deepEqual(await apCli.decidirAprovacao(sA, apId, "ajuste", "  "), { ok: false, erro: "Conte o que precisa mudar para a equipe ajustar." });
  const aj = await apCli.decidirAprovacao(sA, apId, "ajuste", "Trocar a foto de capa", { hoje: HOJE });
  assert.equal(aj.ok, true);
  const [acao] = await rawQuery<any>("select * from avanteza.plan_actions where id = $1", [aj.acaoId]);
  assert.equal(acao.client_id, A);
  assert.equal(acao.assignee_id, anaId, "responsável da tarefa original");
  assert.equal(acao.role, "design");
  assert.equal(acao.origin, "aprovacao");
  assert.equal(acao.owner, "avanteza");
  assert.equal(acao.due_date, "2026-11-18", "prazo de 2 dias");
  assert.match(acao.title, /^Ajustar post: Post Black Friday/);
  assert.match(acao.description, /Trocar a foto de capa/);
  // decisão repetida não cria outra ação
  assert.equal((await apCli.decidirAprovacao(sA, apId, "ajuste", "de novo", { hoje: HOJE })).ok, false);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where origin = 'aprovacao'"), 1);
  // notificação para a equipe (uma só)
  const notif = await rawQuery<any>("select tipo, para, client_id, link from avanteza.notificacoes where tipo = 'aprovacao_ajuste'");
  assert.equal(notif.length, 1);
  assert.equal(notif[0].para, "equipe");
  assert.equal(notif[0].link, `/operacoes/aprovacoes/${apId}`);

  const fila = await apEq.filaEquipe();
  assert.equal(fila.ajustes.length, 1);
  assert.equal(fila.ajustes[0].ajuste_responsavel, "Ana");
  assert.equal(fila.ajustes[0].ultimo_comentario, "Trocar a foto de capa");

  assert.equal((await apEq.novaVersao(EQUIPE, apId, { link: "ftp://x" })).ok, false);
  assert.equal((await apEq.novaVersao(EQUIPE, apId, { link: "https://drive.test/v2", nota: "Capa trocada" })).ok, true);
  const [aposV2] = await rawQuery<any>("select status, versao_atual from avanteza.aprovacoes where id = $1", [apId]);
  assert.deepEqual(aposV2, { status: "pendente", versao_atual: 2 });
  const [ajusteFeito] = await rawQuery<any>("select status, evidence_url from avanteza.plan_actions where id = $1", [aj.acaoId]);
  assert.deepEqual(ajusteFeito, { status: "concluida", evidence_url: "https://drive.test/v2" });

  const ok = await apCli.decidirAprovacao(sA, apId, "aprovar", "Perfeito!");
  assert.equal(ok.ok, true);
  const [t] = await rawQuery<any>("select status, evidence_url from avanteza.plan_actions where id = $1", [tarefaA]);
  assert.equal(t.status, "concluida", "aprovar conclui a tarefa ligada");
  assert.equal(t.evidence_url, "https://drive.test/v2");
  assert.equal(await count("select count(*)::int n from avanteza.notificacoes where tipo = 'aprovacao_aprovada' and para = 'equipe'"), 1);

  const det = await apCli.obterAprovacao(sA, apId);
  assert.equal(det!.versoes.length, 2);
  assert.deepEqual(det!.historico.map((h) => `${h.quem}:${h.tipo}:${h.versao}`), ["Avanteza:enviada:1", "Você:ajuste:1", "Avanteza:nova_versao:2", "Você:aprovada:2"]);
  assert.ok(!JSON.stringify(det).includes(EQUIPE) && !JSON.stringify(det).includes("a@cliente.test"), "histórico do cliente sem e-mails");
  assert.equal(await count("select count(*)::int n from avanteza.audit_log where event in ('mapa_aprovacao_ajuste','mapa_aprovacao_aprovada') and client_id = $1", [A]), 2);
  assert.equal((await apEq.novaVersao(EQUIPE, apId, { link: "https://drive.test/v3" })).ok, false, "aprovada não recebe versão");
});

test("isolamento (IDOR): outro cliente não lista, não abre e não decide; 'Ver como cliente' é somente leitura; escopo forjado é recusado", { skip }, async () => {
  const r = await apEq.criarAprovacao(EQUIPE, { clientId: A, tipo: "criativo", titulo: "Criativo carrossel", link: "https://drive.test/c1" });
  const id = (r as any).id as string;
  const sB = await scopeOf("b@cliente.test", [B]);
  assert.equal((await apCli.listarAprovacoes(sB)).length, 0);
  assert.equal(await apCli.obterAprovacao(sB, id), null);
  assert.equal(await apCli.obterAprovacao(sB, apId), null);
  assert.deepEqual(await apCli.decidirAprovacao(sB, id, "aprovar", null), { ok: false, erro: "Esta peça não está mais aguardando aprovação." });
  assert.equal((await apCli.decidirAprovacao(sB, id, "ajuste", "quero mudar", { hoje: HOJE })).ok, false);
  assert.equal(await count("select count(*)::int n from avanteza.plan_actions where client_id = $1", [B]), 1, "nenhuma ação criada na B");
  const [st] = await rawQuery<{ status: string }>("select status from avanteza.aprovacoes where id = $1", [id]);
  assert.equal(st.status, "pendente");

  const prev = await previewOf(A);
  assert.equal((await apCli.listarAprovacoes(prev)).length, 2, "a equipe vê como o cliente");
  await assert.rejects(apCli.decidirAprovacao(prev, id, "aprovar", null), /somente leitura/);
  const forjado = Object.freeze({ clientId: A, allowedClientIds: [A], readOnly: false, userEmail: "b@cliente.test" }) as ClientScope;
  await assert.rejects(apCli.listarAprovacoes(forjado), /Escopo de cliente inválido/);
  await assert.rejects(apCli.decidirAprovacao(forjado, id, "aprovar", null), /Escopo de cliente inválido/);
  assert.equal(await apCli.obterAprovacao(await scopeOf("a@cliente.test", [A]), "' or 1=1 --"), null);

  // cancelada some do Mapa
  assert.equal((await apEq.cancelarAprovacao(EQUIPE, id, "duplicada")).ok, true);
  const sA = await scopeOf("a@cliente.test", [A]);
  assert.equal(await apCli.obterAprovacao(sA, id), null);
  assert.equal((await apCli.listarAprovacoes(sA)).length, 1);
});

// ───────────────────────── Relatório semanal ─────────────────────────

test("semana relatada: segunda a domingo da semana anterior, em qualquer dia", () => {
  assert.deepEqual(semanaAnterior("2026-11-16"), { de: "2026-11-09", ate: "2026-11-15" });
  assert.deepEqual(semanaAnterior("2026-11-18"), { de: "2026-11-09", ate: "2026-11-15" });
  assert.deepEqual(semanaAnterior("2026-11-22"), { de: "2026-11-09", ate: "2026-11-15" });
  assert.deepEqual(semanaAnterior("2026-11-23"), { de: "2026-11-16", ate: "2026-11-22" });
  assert.deepEqual(semanaAnterior("2027-01-01"), { de: "2026-12-21", ate: "2026-12-27" });
});

test("relatório: só dados visíveis ao cliente, marketplaces e Meta quando houver, modelo fixo sem IA", { skip }, async () => {
  // entregas da semana (visível e interna), pendência do cliente, conta de marketplace e anúncios
  await rawQuery("insert into avanteza.plan_actions (client_id, title, status, owner, completed_at, visible_to_client) values ($1,'Otimização das campanhas','concluida','avanteza','2026-11-12T15:00:00Z',true), ($1,'ROTINA-INTERNA','concluida','avanteza','2026-11-12T15:00:00Z',false)", [A]);
  await rawQuery("insert into avanteza.plan_actions (client_id, title, status, owner, due_date) values ($1,'Enviar fotos da coleção','planejada','cliente','2026-11-17'), ($1,'Subir campanha de Natal','planejada','avanteza','2026-11-19')", [A]);
  await rawQuery(`insert into avanteza.client_channels (client_id, provider, ad_account_id, ads_source, ig_source, status, last_sync_at) values ($1,'meta','act_1','meta','none','ativo', now())`, [A]);
  for (const [d, spend, res] of [["2026-11-03", 100, 10], ["2026-11-10", 150, 20], ["2026-11-11", 50, 4]] as const) {
    await rawQuery("insert into avanteza.channel_snapshots (client_id, kind, date, key, metrics, source) values ($1,'campaign_daily',$2,'c1',$3,'meta')", [A, d, JSON.stringify({ spend, results: res, impressions: 1000, clicks: 30 })]);
  }
  const [acc] = await rawQuery<{ id: string }>("insert into avanteza.marketplace_accounts (client_id, marketplace, external_user_id, access_token_enc, refresh_token_enc) values ($1,'mercadolivre','u-a','T','R') returning id", [A]);
  await rawQuery("insert into avanteza.daily_snapshots (account_id, snapshot_date, revenue, orders_count, ads_cost, ads_revenue) values ($1,'2026-11-10',2000,20,100,500), ($1,'2026-11-03',1000,10,0,0)", [acc.id]);

  const r = await rel.gerarRelatorio(A, HOJE, { provider: null });
  assert.equal(r.criado, true);
  assert.equal(r.origem, "modelo");
  const linha = await rel.relatorioEquipe(r.id!);
  const d = linha!.dados;
  assert.deepEqual(d.periodo, { de: "2026-11-09", ate: "2026-11-15" });
  assert.deepEqual(d.entregas.map((e) => e.titulo), ["Otimização das campanhas"]);
  assert.ok(!JSON.stringify(d).includes("ROTINA-INTERNA"), "rotina interna não entra");
  assert.deepEqual(d.dependeDoCliente.map((e) => e.titulo), ["Enviar fotos da coleção"]);
  assert.deepEqual(d.proximas.map((e) => e.titulo), ["Subir campanha de Natal"]);
  assert.equal(d.marketplaces!.faturamento, 2000);
  assert.equal(d.marketplaces!.variacaoFaturamento, 100);
  assert.equal(d.anuncios!.gasto, 200);
  assert.equal(d.anuncios!.resultados, 24);
  assert.equal(d.anuncios!.variacaoResultados, 140);
  assert.equal(d.instagram, null);
  assert.equal(linha!.abertura, aberturaModelo(d));
  assert.deepEqual(linha!.destaques, destaquesDe(d));
  assert.ok(kpisDoRelatorio(d).some((k) => k.rotulo === "Faturamento" && k.valor.includes("2.000")));
  assert.ok(!JSON.stringify(d).includes("act_1"), "ID da conta de anúncios não vai para o relatório");
  assert.ok(linha!.publicar_apos, "modo automático: tem prazo de publicação");
});

test("relatório: geração idempotente por semana (2ª execução não cria nem reescreve), desligado não gera", { skip }, async () => {
  await rawQuery("update avanteza.clients set relatorio_modo = 'desligado' where id = $1", [B]);
  const antes = await rawQuery<{ id: string; abertura: string }>("select id, abertura from avanteza.relatorios_semanais where client_id = $1", [A]);
  const ia = new FakeAi({ abertura: "Texto da IA que não deveria entrar porque já existe.", destaques: [] });
  const r1 = await rel.gerarRelatoriosDaSemana(HOJE, { provider: ia, enviar: async () => true });
  assert.equal(r1.criados, 0);
  assert.equal(r1.existentes, 1);
  assert.equal(r1.clientes, 1, "B desligado fica de fora");
  assert.equal(ia.calls, 0);
  const r2 = await rel.gerarRelatoriosDaSemana("2026-11-18", { provider: ia });
  assert.equal(r2.criados, 0, "mesma semana em outro dia");
  const depois = await rawQuery<{ id: string; abertura: string }>("select id, abertura from avanteza.relatorios_semanais where client_id = $1", [A]);
  assert.deepEqual(depois, antes);
  assert.equal(await count("select count(*)::int n from avanteza.relatorios_semanais where client_id = $1", [B]), 0);
  // semana seguinte: novo relatório, com a IA
  const iaOk = new FakeAi({ abertura: "Semana boa: as conversas no WhatsApp cresceram e as entregas seguiram no prazo.", destaques: ["Conversas em alta."] });
  const r3 = await rel.gerarRelatoriosDaSemana("2026-11-23", { provider: iaOk });
  assert.equal(r3.criados, 1);
  assert.equal(r3.ia, 1);
  assert.ok(!iaOk.ctx.includes("act_1") && !iaOk.ctx.includes("ROTINA-INTERNA"), "contexto da IA só com dados do cliente");
  const [novo] = await rawQuery<any>("select abertura, abertura_origem, destaques from avanteza.relatorios_semanais where client_id = $1 and semana = '2026-11-16'", [A]);
  assert.equal(novo.abertura_origem, "ia");
  assert.deepEqual(novo.destaques, ["Conversas em alta."]);
  // IA fora do ar → modelo fixo (nunca derruba)
  await rawQuery("update avanteza.clients set relatorio_modo = 'revisao' where id = $1", [B]);
  const r4 = await rel.gerarRelatoriosDaSemana(HOJE, { provider: new FakeAi(null, true) });
  assert.equal(r4.criados, 1);
  const [b] = await rawQuery<any>("select abertura_origem, publicar_apos from avanteza.relatorios_semanais where client_id = $1", [B]);
  assert.equal(b.abertura_origem, "modelo");
  assert.equal(b.publicar_apos, null, "modo revisão: sem publicação automática");
});

test("relatório: cliente só vê publicado; publicação automática no prazo; e-mail uma vez; revisão e descarte; IDOR", { skip }, async () => {
  const sA = await scopeOf("a@cliente.test", [A]);
  const sB = await scopeOf("b@cliente.test", [B]);
  const [ra] = await rawQuery<{ id: string }>("select id from avanteza.relatorios_semanais where client_id = $1 and semana = '2026-11-09'", [A]);
  const [rb] = await rawQuery<{ id: string }>("select id from avanteza.relatorios_semanais where client_id = $1", [B]);
  assert.equal((await relCli.listarRelatorios(sA)).length, 0, "rascunho não aparece");
  assert.equal(await relCli.obterRelatorio(sA, ra.id), null);

  const mail = correio();
  assert.deepEqual(await rel.publicarVencidos({ enviar: mail.enviar }), { publicados: 0, emails: 0 }, "ainda dentro do prazo de revisão");
  assert.equal((await rel.salvarRevisao(EQUIPE, ra.id, { abertura: "Semana revisada pela equipe com carinho.", destaques: ["Um", "", "Dois"] })).ok, true);
  await rawQuery("update avanteza.relatorios_semanais set publicar_apos = now() - interval '1 minute' where status = 'rascunho'");
  const pub = await rel.publicarVencidos({ enviar: mail.enviar });
  assert.equal(pub.publicados, 2, "A (semanas 09 e 16); B está em modo revisão");
  assert.equal(mail.enviados.length, 2);
  assert.equal(mail.enviados[0].to, "contato@loja-a.test");
  assert.match(mail.enviados[0].html, /\/mapa\/relatorios\//);
  assert.deepEqual(await rel.publicarVencidos({ enviar: mail.enviar }), { publicados: 0, emails: 0 });
  assert.equal((await rel.publicarRelatorio(ra.id, EQUIPE, { enviar: mail.enviar })).ok, false, "publicar 2× não reenvia");
  assert.equal(mail.enviados.length, 2);
  const [st] = await rawQuery<any>("select status, publicado_por, email_status, abertura, destaques from avanteza.relatorios_semanais where id = $1", [ra.id]);
  assert.deepEqual(st, { status: "publicado", publicado_por: "automatico", email_status: "enviado", abertura: "Semana revisada pela equipe com carinho.", destaques: ["Um", "Dois"] });
  assert.equal((await rel.salvarRevisao(EQUIPE, ra.id, { abertura: "Mudar depois de publicado", destaques: [] })).ok, false);

  const lista = await relCli.listarRelatorios(sA);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].semana, "2026-11-16", "mais recente primeiro");
  assert.ok(await relCli.obterRelatorio(sA, ra.id));
  // IDOR
  assert.equal(await relCli.obterRelatorio(sB, ra.id), null);
  assert.equal((await relCli.listarRelatorios(sB)).length, 0);
  assert.ok(await relCli.obterRelatorio(await previewOf(A), ra.id), "Ver como cliente lê");
  // B: sem e-mail de contato → publica, e-mail "sem_contato"; descartar só rascunho
  const pb = await rel.publicarRelatorio(rb.id, EQUIPE, { enviar: mail.enviar });
  assert.deepEqual(pb, { ok: true, email: "sem_contato" });
  assert.equal((await rel.descartarRelatorio(EQUIPE, rb.id)).ok, false);
  // sem configuração de e-mail: publica e registra
  const r = await rel.gerarRelatorio(A, "2026-11-30", { provider: null });
  assert.deepEqual(await rel.publicarRelatorio(r.id!, EQUIPE, { enviar: async () => false }), { ok: true, email: "sem_configuracao" });
});

test("PDF: gerado no servidor, com a Manrope embutida, sem quebrar com emoji, várias páginas", { skip }, async () => {
  const [r] = await rawQuery<{ id: string }>("select id from avanteza.relatorios_semanais where client_id = $1 and semana = '2026-11-09'", [A]);
  const rr = await relCli.obterRelatorio(await scopeOf("a@cliente.test", [A]), r.id);
  const muitos = Array.from({ length: 60 }, (_, i) => ({ titulo: `Entrega número ${i + 1} 🚀 com um título razoavelmente longo para quebrar a linha`, data: "2026-11-10" }));
  const pdf = await gerarPdfRelatorio({ dados: { ...rr!.dados, entregas: muitos }, abertura: rr!.abertura + " 😀", destaques: rr!.destaques });
  assert.ok(Buffer.from(pdf).toString("latin1").startsWith("%PDF-"));
  const { PDFDocument, PDFName } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.getPageCount() >= 2, "quebra de página");
  const fontes = doc.context.enumerateIndirectObjects().map(([, o]) => String((o as any).get?.(PDFName.of("BaseFont")) ?? "")).filter(Boolean);
  assert.ok(fontes.some((f) => /Manrope/.test(f)), `fonte da marca: ${fontes.join(", ")}`);
  assert.equal(doc.getTitle(), "Relatório semanal — Loja A — 09/11 a 15/11/2026");
  assert.equal(nomeArquivoPdf("Loja Ação & Cia", "2026-11-09"), "relatorio-loja-acao-cia-2026-11-09.pdf");
});

// ───────────────────────── Lembretes ─────────────────────────

test("lembretes: agrupados (ações e peças), só atrasadas ou vencendo em 2 dias, máx. 1 por dia, desligável, log e Mapa", { skip }, async () => {
  await rawQuery("delete from avanteza.plan_actions where client_id = $1 and owner = 'cliente'", [A]);
  await rawQuery(`insert into avanteza.plan_actions (client_id, title, owner, status, due_date, blocked_reason, visible_to_client) values
    ($1,'Enviar acesso ao Gerenciador','cliente','planejada','2026-11-10',null,true),
    ($1,'Subir fotos','avanteza','bloqueada','2026-11-18','Fotos da coleção',true),
    ($1,'Daqui a 5 dias','cliente','planejada','2026-11-21',null,true),
    ($1,'Interna parada','avanteza','bloqueada','2026-11-15','x',false)`, [A]);
  const p = await apEq.criarAprovacao(EQUIPE, { clientId: A, tipo: "legenda", titulo: "Legendas de dezembro", prazo: "2026-11-17", link: "https://drive.test/l" });
  assert.ok(p.ok);
  await rawQuery("insert into avanteza.plan_actions (client_id, title, owner, due_date) values ($1,'Pendência da B','cliente','2026-11-15')", [B]);
  await rawQuery("update avanteza.clients set lembretes_ativos = false where id = $1", [B]);

  const itens = await pendenciasParaLembrete(A, HOJE);
  assert.deepEqual(itens.map((i) => i.titulo), ["Enviar acesso ao Gerenciador", "Aprovar: Legendas de dezembro", "Subir fotos"]);
  assert.equal(itens[0].atrasada, true);
  assert.equal(itens[2].detalhe, "Fotos da coleção");

  const mail = correio();
  const r1 = await rotinaLembretes(HOJE, { enviar: mail.enviar });
  assert.equal(r1.clientes, 1, "B desligado");
  assert.equal(r1.criados, 1);
  assert.equal(mail.enviados.length, 1, "um e-mail agrupado");
  assert.match(mail.enviados[0].subject, /3 itens precisam de você/);
  assert.ok(mail.enviados[0].html.includes("Legendas de dezembro") && !mail.enviados[0].html.includes("Interna parada") && !mail.enviados[0].html.includes("Daqui a 5 dias"));
  const r2 = await rotinaLembretes(HOJE, { enviar: mail.enviar });
  assert.equal(r2.criados, 0);
  assert.equal(r2.jaEnviadosHoje, 1);
  assert.equal(mail.enviados.length, 1, "no máximo 1 por dia");
  assert.equal(await count("select count(*)::int n from avanteza.lembretes_cliente where client_id = $1", [A]), 1);
  assert.equal(await count("select count(*)::int n from avanteza.lembretes_cliente where client_id = $1", [B]), 0);
  assert.equal(await count("select count(*)::int n from avanteza.audit_log where event = 'lembrete_cliente' and client_id = $1", [A]), 1);

  // no Mapa: só os que continuam pendentes; outro cliente não vê
  const sA = await scopeOf("a@cliente.test", [A]);
  await mapa.resolverPendencia(sA, (await rawQuery<{ id: string }>("select id from avanteza.plan_actions where title = 'Enviar acesso ao Gerenciador'"))[0].id, null);
  const hoje = await relCli.lembreteDeHoje(sA, HOJE);
  assert.deepEqual(hoje!.map((i) => i.titulo), ["Aprovar: Legendas de dezembro", "Subir fotos"]);
  assert.equal(await relCli.lembreteDeHoje(await scopeOf("b@cliente.test", [B]), HOJE), null);
  assert.equal(await relCli.lembreteDeHoje(sA, "2026-11-17"), null);

  // dia seguinte: novo lembrete; sem e-mail configurado não derruba
  const r3 = await rotinaLembretes("2026-11-17", { enviar: async () => false });
  assert.equal(r3.criados, 1);
  assert.equal(r3.semConfiguracao, 1);
  const [l] = await rawQuery<{ email_status: string }>("select email_status from avanteza.lembretes_cliente where client_id = $1 and dia = '2026-11-17'", [A]);
  assert.equal(l.email_status, "sem_configuracao");
});
