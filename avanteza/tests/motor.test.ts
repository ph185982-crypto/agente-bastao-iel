// Motor de Entregas — funções puras: recorrências, gerador idempotente, saúde e fila do "Hoje".
import { test } from "node:test";
import assert from "node:assert/strict";
import { acoesDesejadas, chaveRecorrencia, diaSemana, faseDaAcao, ocorrencias, planejarGeracao, type AcaoExistente, type EntradaGerador, type TarefaModelo } from "../src/lib/motor/gerador";
import { calcularSaude, ordenarPorRisco } from "../src/lib/motor/saude";
import { diasDoCalendario, filtrar, montarFila } from "../src/lib/motor/fila";
import { PLAYBOOKS_PADRAO, servicosPadraoDoTipo } from "../src/lib/motor/playbooks-padrao";
import { PAPEIS } from "../src/lib/motor/tipos";

const T = (o: Partial<TarefaModelo> & { id: string }): TarefaModelo => ({
  slug: o.id, title: `Tarefa ${o.id}`, description: null, phase_position: 1, role: "marketplace", offset_days: 0, recurrence: "none", recurrence_day: null,
  checklist: [], done_criteria: null, client_dependent: false, client_visible: true, estimated_min: null, priority: 2, active: true, ...o,
});
const SERV = { id: "cs-1", service_id: "svc-1", start_date: "2026-11-16", end_date: null, status: "ativo" as const, assignee_id: null };
const FASES = [
  { id: "f1", position: 1, starts_on: "2026-11-16", ends_on: "2027-01-15" },
  { id: "f2", position: 2, starts_on: "2027-01-16", ends_on: "2027-03-15" },
];
const entrada = (tarefas: TarefaModelo[], existentes: AcaoExistente[] = [], extra: Partial<EntradaGerador> = {}): EntradaGerador => ({
  hoje: "2026-11-16", servicos: [{ servico: SERV, tarefas }], fases: FASES, existentes, responsaveis: { porPapel: { marketplace: "u-ana" }, gerente: "u-pedro" }, ...extra,
});
/** Simula a gravação: o que o plano cria vira "existente" com a chave. */
const gravar = (ex: AcaoExistente[], p: ReturnType<typeof planejarGeracao>): AcaoExistente[] => [
  ...ex,
  ...p.criar.map((d, i) => ({ id: `n${ex.length + i}`, title: d.title, status: "planejada", origin: "playbook", recurrence_key: d.key, due_date: d.dueDate, edited_at: null, archived_at: null, assignee_id: d.assigneeId })),
];

test("recorrência: dia da semana ISO e semanal na segunda a partir da base", () => {
  assert.equal(diaSemana("2026-11-16"), 1); // segunda
  assert.equal(diaSemana("2026-11-22"), 7); // domingo
  assert.deepEqual(ocorrencias("semanal", 1, "2026-11-16", "2026-11-13", "2026-12-16"), ["2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"]);
  assert.deepEqual(ocorrencias("semanal", 5, "2026-11-16", "2026-11-16", "2026-11-30"), ["2026-11-20", "2026-11-27"], "sexta");
});

test("recorrência: quinzenal mantém o alinhamento mesmo com a janela começando depois", () => {
  const base = "2026-09-01"; // terça
  const todas = ocorrencias("quinzenal", 2, base, base, "2026-12-31");
  const janela = ocorrencias("quinzenal", 2, base, "2026-11-13", "2026-12-16");
  assert.ok(janela.length >= 2);
  for (const d of janela) assert.ok(todas.includes(d), `${d} fora do alinhamento`);
});

test("recorrência: mensal com dia que não existe vira o último dia; respeita fim do serviço", () => {
  assert.deepEqual(ocorrencias("mensal", 31, "2027-01-10", "2027-01-01", "2027-03-31"), ["2027-01-31", "2027-02-28", "2027-03-31"]);
  assert.deepEqual(ocorrencias("mensal", 5, "2026-11-16", "2026-11-13", "2027-02-10", "2027-01-10"), ["2026-12-05", "2027-01-05"]);
  assert.deepEqual(ocorrencias("none", null, "2026-12-01", "2027-01-01", "2027-02-01"), ["2026-12-01"], "uma vez ignora a janela");
  assert.deepEqual(ocorrencias("none", null, "2027-05-01", "2026-11-01", "2026-12-01", "2027-01-01"), [], "uma vez depois do fim do serviço: não gera");
});

test("gerador: tarefas uma vez + recorrentes dos próximos 30 dias, com fase, responsável, dono e chave", () => {
  const t = [
    T({ id: "diag", offset_days: 7, priority: 1 }),
    T({ id: "rel", recurrence: "semanal", recurrence_day: 5, offset_days: 7, role: "trafego" }),
    T({ id: "envio", client_dependent: true, offset_days: 3 }),
    T({ id: "off", active: false }),
  ];
  const { acoes, de, ate } = acoesDesejadas(entrada(t));
  assert.equal(de, "2026-11-13");
  assert.equal(ate, "2026-12-16");
  const diag = acoes.find((a) => a.playbookTaskId === "diag")!;
  assert.equal(diag.dueDate, "2026-11-23");
  assert.equal(diag.key, "diag");
  assert.equal(diag.phaseId, "f1");
  assert.equal(diag.assigneeId, "u-ana", "papel marketplace coberto pela Ana");
  const rel = acoes.filter((a) => a.playbookTaskId === "rel").map((a) => a.dueDate);
  assert.deepEqual(rel, ["2026-11-27", "2026-12-04", "2026-12-11"], "sextas a partir de D+7");
  assert.equal(acoes.find((a) => a.playbookTaskId === "rel")!.assigneeId, "u-pedro", "papel sem dono → gerente da conta");
  assert.equal(acoes.find((a) => a.playbookTaskId === "envio")!.owner, "cliente");
  assert.ok(!acoes.some((a) => a.playbookTaskId === "off"), "tarefa desativada não gera");
  assert.equal(chaveRecorrencia("rel", "2026-11-27"), "rel@2026-11-27");
});

test("gerador: IDEMPOTENTE — rodar 2× não duplica; dia seguinte só acrescenta a nova ocorrência", () => {
  const t = [T({ id: "diag", offset_days: 7 }), T({ id: "rel", recurrence: "semanal", recurrence_day: 5, offset_days: 7 })];
  const p1 = planejarGeracao(entrada(t));
  assert.equal(p1.criar.length, 4);
  const ex = gravar([], p1);
  const p2 = planejarGeracao(entrada(t, ex));
  assert.equal(p2.criar.length, 0);
  assert.equal(p2.atualizar.length + p2.vincular.length + p2.arquivar.length, 0);
  assert.equal(p2.mantidas, 4);
  // uma semana depois: entra só a nova sexta da janela
  const p3 = planejarGeracao(entrada(t, ex, { hoje: "2026-11-23" }));
  assert.deepEqual(p3.criar.map((d) => d.key), ["rel@2026-12-18"]);
});

test("gerador: respeita concluídas, editadas à mão, bloqueadas e dispensadas; atualiza só as intocadas", () => {
  const t1 = [T({ id: "a", offset_days: 1 }), T({ id: "b", offset_days: 2 }), T({ id: "c", offset_days: 3 }), T({ id: "d", offset_days: 4 }), T({ id: "e", offset_days: 5 })];
  let ex = gravar([], planejarGeracao(entrada(t1)));
  ex = ex.map((a) =>
    a.recurrence_key === "a" ? { ...a, status: "concluida" } :
    a.recurrence_key === "b" ? { ...a, edited_at: "2026-11-16T10:00:00Z", due_date: "2026-12-30" } :
    a.recurrence_key === "c" ? { ...a, status: "bloqueada" } :
    a.recurrence_key === "d" ? { ...a, archived_at: "2026-11-16T10:00:00Z" } : a);
  // o admin mudou o título e o prazo de todas no playbook
  const t2 = t1.map((t) => ({ ...t, title: `${t.title} v2`, offset_days: t.offset_days + 10 }));
  const p = planejarGeracao(entrada(t2, ex));
  assert.equal(p.criar.length, 0, "nada é recriado (nem a dispensada)");
  assert.deepEqual(p.atualizar.map((u) => ex.find((x) => x.id === u.id)!.recurrence_key), ["e"], "só a intocada acompanha o modelo");
  assert.equal(p.mantidas, 4);
});

test("gerador: serviço encerrado/pausado arquiva as geradas intocadas em aberto; nunca as concluídas ou editadas", () => {
  const t = [T({ id: "x", offset_days: 1 }), T({ id: "y", recurrence: "semanal", recurrence_day: 1, offset_days: 0 })];
  let ex = gravar([], planejarGeracao(entrada(t)));
  ex = ex.map((a) => (a.recurrence_key === "y@2026-11-16" ? { ...a, status: "concluida" } : a));
  const p = planejarGeracao({ ...entrada(t, ex), servicos: [{ servico: { ...SERV, status: "encerrado" }, tarefas: t }] });
  const arquivadas = p.arquivar.map((id) => ex.find((x) => x.id === id)!.recurrence_key);
  assert.ok(arquivadas.includes("x"));
  assert.ok(!arquivadas.includes("y@2026-11-16"), "concluída fica");
  assert.equal(p.criar.length, 0);
});

test("gerador: tarefa uma vez com o mesmo título de uma ação do plano de 12 meses é VINCULADA, não duplicada", () => {
  const ex: AcaoExistente[] = [{ id: "plano-1", title: "Reunião de kickoff e alinhamento de metas", status: "concluida", origin: "plano", recurrence_key: null, due_date: "2026-12-15", edited_at: null, archived_at: null, assignee_id: null }];
  const p = planejarGeracao(entrada([T({ id: "kick", title: "Reunião de Kickoff e alinhamento de metas!", offset_days: 2 })], ex));
  assert.equal(p.criar.length, 0);
  assert.deepEqual(p.vincular.map((v) => v.id), ["plano-1"]);
});

test("gerador: fase — uma vez usa a fase da tarefa; recorrente usa a fase da data", () => {
  assert.equal(faseDaAcao(FASES, "2026-11-20", 2, false), "f2");
  assert.equal(faseDaAcao(FASES, "2027-02-01", 1, true), "f2");
  assert.equal(faseDaAcao([], "2027-02-01", 1, true), null);
  assert.throws(() => acoesDesejadas({ ...entrada([]), hoje: "16/11/2026" }));
});

test("playbooks padrão: coerentes (slugs únicos, papéis válidos, dias de recorrência válidos, prazos realistas)", () => {
  const svc = new Set<string>();
  for (const p of PLAYBOOKS_PADRAO) {
    assert.ok(!svc.has(p.servico.slug));
    svc.add(p.servico.slug);
    const slugs = new Set<string>();
    for (const t of p.tarefas) {
      assert.ok(!slugs.has(t.slug), `${p.servico.slug}/${t.slug} repetido`);
      slugs.add(t.slug);
      assert.ok(PAPEIS.includes(t.papel));
      assert.ok(t.d >= 0 && t.d <= 180, `${t.slug}: D+${t.d}`);
      if (t.rec && t.rec !== "none") assert.ok(t.dia && (t.rec === "mensal" ? t.dia <= 28 : t.dia <= 7), `${t.slug}: dia ${t.dia}`);
    }
  }
  for (const s of ["onboarding", "marketplace", "trafego", "midias-sociais"]) assert.ok(svc.has(s), s);
  const mkt = PLAYBOOKS_PADRAO.find((p) => p.servico.slug === "marketplace")!.tarefas;
  for (const k of ["relatorio-semanal", "reuniao-quinzenal", "otimizacao-mensal", "ads-otimizacao"]) assert.ok(mkt.some((t) => t.slug === k), k);
  const traf = PLAYBOOKS_PADRAO.find((p) => p.servico.slug === "trafego")!.tarefas;
  assert.equal(traf.filter((t) => t.slug.startsWith("otimizacao-")).length, 2, "otimização 2×/semana");
  assert.deepEqual(servicosPadraoDoTipo("marketplace"), ["onboarding", "marketplace"]);
  assert.deepEqual(servicosPadraoDoTipo("midia"), ["onboarding", "trafego", "midias-sociais"]);
});

test("saúde: verde sem pendências; amarelo com 1 atraso; vermelho com atraso longo, canal desconectado ou sem reunião", () => {
  const base = { hoje: "2026-11-16", inicio: "2026-10-01", reunioes: ["2026-11-10"], canais: [], contas: [] };
  const ok = calcularSaude({ ...base, acoes: [{ status: "concluida", due_date: "2026-11-14", completed_at: "2026-11-14T15:00:00Z" }, { status: "planejada", due_date: "2026-11-20", completed_at: null }] });
  assert.equal(ok.nivel, "verde");
  assert.deepEqual(ok.motivos, []);
  assert.equal(ok.metricas.pctPlano, 50);

  const am = calcularSaude({ ...base, acoes: [{ status: "concluida", due_date: "2026-11-14", completed_at: "2026-11-14T15:00:00Z" }, { status: "planejada", due_date: "2026-11-15", completed_at: null }] });
  assert.equal(am.nivel, "amarelo");
  assert.deepEqual(am.motivos, ["1 ação atrasada"]);

  const vm = calcularSaude({ ...base, acoes: [{ status: "concluida", due_date: "2026-11-14", completed_at: "2026-11-14T15:00:00Z" }, { status: "planejada", due_date: "2026-11-01", completed_at: null }] });
  assert.equal(vm.nivel, "vermelho");
  assert.match(vm.motivos[0], /há 15 dias/);

  const canal = calcularSaude({ ...base, acoes: [], canais: [{ status: "desconectado" }], contas: [{ marketplace: "mercadolivre", status: "reauth_required" }] });
  assert.equal(canal.nivel, "vermelho");
  assert.match(canal.motivos.join(), /2 canais ou contas desconectados/);

  const semReuniao = calcularSaude({ ...base, reunioes: [], acoes: [{ status: "concluida", due_date: "2026-11-14", completed_at: "2026-11-15T15:00:00Z" }] });
  assert.equal(semReuniao.nivel, "vermelho");
  assert.deepEqual(semReuniao.motivos, ["nenhuma reunião registrada"]);

  const bloq = calcularSaude({ ...base, acoes: [{ status: "bloqueada", due_date: "2026-11-20", completed_at: null }, { status: "concluida", due_date: null, completed_at: "2026-11-15T10:00:00Z" }] });
  assert.equal(bloq.nivel, "amarelo");
  assert.deepEqual(bloq.motivos, ["1 ação parada esperando o cliente"]);

  const novo = calcularSaude({ ...base, inicio: "2026-11-14", reunioes: [], acoes: [{ status: "planejada", due_date: "2026-11-20", completed_at: null }] });
  assert.equal(novo.nivel, "verde", "cliente da semana: não cobra ritmo nem reunião");
});

test("saúde: ordena a carteira por risco", () => {
  const s = (n: "verde" | "amarelo" | "vermelho", p: number) => ({ nivel: n, pontos: p, motivos: [], metricas: {} as any });
  const r = ordenarPorRisco([{ nome: "B", saude: s("verde", 0) }, { nome: "A", saude: s("vermelho", 3) }, { nome: "C", saude: s("vermelho", 6) }, { nome: "D", saude: s("amarelo", 1) }]);
  assert.deepEqual(r.map((x) => x.nome), ["C", "A", "D", "B"]);
});

test("fila Hoje: atrasadas → hoje → 7 dias; prioridade alta primeiro; bloqueadas e do cliente à parte; filtros", () => {
  const I = (id: string, due: string | null, o: Record<string, unknown> = {}) => ({ id, client_id: "c1", title: id, status: "planejada", due_date: due, priority: 2, assignee_id: "u1", role: "marketplace", ...o });
  const itens = [
    I("hoje-baixa", "2026-11-16", { priority: 3 }), I("hoje-alta", "2026-11-16", { priority: 1 }), I("velha", "2026-11-01"), I("ontem", "2026-11-15"),
    I("semana", "2026-11-20"), I("longe", "2026-12-20"), I("feita", "2026-11-16", { status: "concluida" }), I("parada", "2026-11-10", { status: "bloqueada" }),
    I("do-cliente", "2026-11-17", { owner: "cliente" }), I("social", "2026-11-18", { role: "social", client_id: "c2", assignee_id: null }),
  ];
  const f = montarFila(itens, "2026-11-16", 2);
  assert.deepEqual(f.atrasadas.map((a) => a.id), ["velha", "ontem"]);
  assert.deepEqual(f.hoje.map((a) => a.id), ["hoje-alta", "hoje-baixa"]);
  assert.deepEqual(f.semana.map((a) => a.id), ["social", "semana"], "por prazo");
  assert.deepEqual(f.bloqueadas.map((a) => a.id), ["parada", "do-cliente"]);
  assert.deepEqual(f.contadores, { atrasadas: 2, hoje: 2, semana: 2, bloqueadas: 2, concluidasHoje: 2 });
  assert.deepEqual(filtrar(itens, { departamento: "marketing" }).map((a) => a.id), ["social"]);
  assert.deepEqual(filtrar(itens, { responsavel: "ninguem" }).map((a) => a.id), ["social"]);
  assert.deepEqual(filtrar(itens, { cliente: "c2" }).map((a) => a.id), ["social"]);
});

test("calendário: semana de segunda a domingo e mês em semanas completas", () => {
  assert.deepEqual(diasDoCalendario("2026-11-18", "semana"), ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  const mes = diasDoCalendario("2026-11-18", "mes");
  assert.equal(mes[0], "2026-10-26");
  assert.equal(mes.at(-1), "2026-12-06");
  assert.equal(mes.length % 7, 0);
});

test("telas por papel: equipe vê o Motor; só admin e membro trabalham; só admin edita playbooks; cliente nunca", async () => {
  process.env.ADMIN_EMAILS = "admin@avanteza.com.br";
  const { podeVerMotor, podeTrabalharMotor, podeEditarPlaybooks } = await import("../src/lib/motor/acesso");
  const { destinoPadrao } = await import("../src/lib/dashboards/nav");
  const S = (role: string, email = `${role}@avanteza.com.br`) => ({ email, role, apps: [], name: role, ...(role === "client" ? { clientId: "c", clientIds: ["c"] } : {}) }) as any;
  const tabela = (s: any) => [podeVerMotor(s), podeTrabalharMotor(s), podeEditarPlaybooks(s)];
  assert.deepEqual(tabela(S("admin")), [true, true, true]);
  assert.deepEqual(tabela(S("member")), [true, true, false]);
  assert.deepEqual(tabela(S("reviewer")), [true, false, false]);
  assert.deepEqual(tabela(S("client")), [false, false, false]);
  assert.deepEqual(tabela(S("admin", "intruso@x.com")), [false, false, false], "admin fora de ADMIN_EMAILS");
  assert.deepEqual(tabela(null), [false, false, false]);
  assert.equal(destinoPadrao("member"), "/operacoes", "a equipe cai em Hoje");
  assert.equal(destinoPadrao("admin"), "/dashboards", "o dono continua na Visão geral");
  const { readFileSync } = await import("node:fs");
  const ler = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  for (const p of ["src/app/(equipe)/operacoes/page.tsx", "src/app/(equipe)/operacoes/carteira/page.tsx", "src/app/(equipe)/operacoes/calendario/page.tsx", "src/app/(equipe)/operacoes/playbooks/page.tsx"]) {
    assert.match(ler(p), /if \(!podeVerMotor\(sess\)\) redirect/, `${p} exige podeVerMotor`);
  }
  const acts = ler("src/app/(equipe)/operacoes/motor-actions.ts");
  for (const fn of ["acaoRapidaForm", "editarAcaoForm"]) assert.match(acts, new RegExp(`export async function ${fn}\\(fd: FormData\\) \\{\\n  const sess = await trabalhador\\(\\);`), fn);
  for (const fn of ["salvarTarefaForm", "salvarServicoCatalogoForm", "aplicarServicoForm", "salvarPapeisForm", "salvarServicoClienteForm", "removerServicoClienteForm", "aplicarPlaybooksClienteForm", "definirGerenteForm"]) {
    assert.match(acts, new RegExp(`export async function ${fn}\\(fd: FormData\\) \\{\\n  const sess = await admin\\(\\);`), fn);
  }
  // o cliente do Mapa nunca chega nas telas da equipe; a API de capturas confere a própria chave
  const mw = ler("src/middleware.ts");
  assert.match(mw, /role === "client" && !isMapaPath/);
  assert.match(mw, /\/\^\\\/api\\\/capturas\\\/\?\$\//);
  assert.match(ler("vercel.json"), /"\/api\/cron\/entregas"/);
  assert.match(ler("src/app/api/cron/[job]/route.ts"), /entregas: \(\) => rotinaEntregas\(spDate\(\)\)/);
});
