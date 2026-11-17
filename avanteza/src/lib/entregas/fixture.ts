// Dados simulados do Funil de Entrega SÓ para desenvolvimento e capturas de tela. Ativados por ENTREGAS_FIXTURE=1|vazio|erro e
// ignorados em produção (NODE_ENV=production ou VERCEL_ENV=production: Vercel produção e previews). Nada aqui é real.
// O provedor simulado tem estado em memória: mover, editar, criar e concluir funcionam, para testar a tela inteira.
import {
  COLUNAS, EntregasErro, PILARES, ROTULO_COLUNA, type CartaoDetalhe, type EntregaDetalhe, type EntregaResumo, type EntregasProvider, type FiltroQuadro,
  type Gatilhos, type ItemChecklist, type Modelo, type Pessoa, type Quadro, type Saude,
} from "./crm";
import type { ClienteMapa } from "./mapa";

export type ModoFixtureEntregas = "1" | "vazio" | "erro";

export function fixtureEntregasAtiva(env: NodeJS.ProcessEnv = process.env): ModoFixtureEntregas | null {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") return null;
  const v = env.ENTREGAS_FIXTURE?.trim();
  return v === "1" || v === "vazio" || v === "erro" ? v : null;
}

/** Clientes do Mapa simulados (só no modo fixture), para mostrar o vínculo por nome. */
export const CLIENTES_MAPA_FIXTURE: ClienteMapa[] = [
  { id: "mapa-nicoletti", name: "Nicoletti Professional" }, { id: "mapa-showman", name: "Showman Ltda." }, { id: "mapa-casa", name: "Casa Ambos" },
];

const DIA = 86_400_000;
const USUARIOS: Pessoa[] = [{ id: "u-pedro", nome: "Pedro" }, { id: "u-layane", nome: "Layane" }];

interface CartaoE {
  id: string; entregaId: string; titulo: string; descricao: string | null; pilar: string; coluna: string; ordem: number; dataAlvo: string | null; cliente: boolean;
  responsavelId: string | null; checklist: ItemChecklist[]; colunaDesdeEm: string; planejadoEm: string | null; concluidoEm: string | null; criadoEm: string;
}
interface EntregaE { id: string; nome: string; status: string; contato: Pessoa; oportunidadeId: string; inicioEm: string; fimPrevistoEm: string | null; renovacaoEm: string | null; valorMensal: number; diagnostico: Record<string, string>; concluidaEm: string | null; renovacaoOportunidadeId: string | null }
interface Estado { entregas: EntregaE[]; cartoes: CartaoE[]; modelos: Modelo[]; seq: number }

const pessoa = (id: string | null) => USUARIOS.find((u) => u.id === id) ?? null;

function semente(vazio: boolean): Estado {
  const e: Estado = { entregas: [], cartoes: [], modelos: [], seq: 0 };
  e.modelos = [
    { id: "m-1", nome: "Consultoria Avanteza — implantação", descricao: "Cartões por pilar para os primeiros 30 dias.", padrao: true, ativo: true, itens: [
      { id: "i1", titulo: "Reunião de kickoff com o dono", pilar: "COMERCIAL", prazoDias: 3, cliente: false, ordem: 0 }, { id: "i2", titulo: "Enviar acessos e documentos", pilar: "OPERACAO", prazoDias: 5, cliente: true, ordem: 1 },
      { id: "i3", titulo: "Mapear funil e metas comerciais", pilar: "COMERCIAL", prazoDias: 14, cliente: false, ordem: 2 }, { id: "i4", titulo: "Auditar anúncios e canais", pilar: "MARKETING", prazoDias: 14, cliente: false, ordem: 3 },
    ] },
    { id: "m-2", nome: "Recorrência — acompanhamento mensal", descricao: null, padrao: false, ativo: true, itens: [{ id: "i5", titulo: "Reunião mensal de resultados", pilar: "COMERCIAL", prazoDias: 30, cliente: false, ordem: 0 }] },
  ];
  if (vazio) return e;
  const agora = Date.now();
  const iso = (dias: number) => new Date(agora + dias * DIA).toISOString();
  const mkEntrega = (nome: string, cliente: string, mrr: number, inicioDias: number, renovaDias: number | null, status = "EM_ANDAMENTO", diag: Record<string, string> = {}) => {
    const id = `e-${++e.seq}`;
    e.entregas.push({ id, nome, status, contato: { id: `c-${e.seq}`, nome: cliente }, oportunidadeId: `o-${e.seq}`, inicioEm: iso(inicioDias), fimPrevistoEm: null, renovacaoEm: renovaDias === null ? null : iso(renovaDias), valorMensal: mrr, diagnostico: diag, concluidaEm: null, renovacaoOportunidadeId: renovaDias !== null && renovaDias < 45 ? `o-ren-${e.seq}` : null });
    return id;
  };
  const mkCartao = (entregaId: string, titulo: string, pilar: string, coluna: string, alvoDias: number | null, resp: string | null, opts: { cliente?: boolean; desdeDias?: number; check?: [number, number]; descricao?: string } = {}) => {
    const ordem = e.cartoes.filter((c) => c.entregaId === entregaId && c.coluna === coluna).length;
    const [feitos, total] = opts.check ?? [0, 0];
    e.cartoes.push({
      id: `k-${++e.seq}`, entregaId, titulo, descricao: opts.descricao ?? null, pilar, coluna, ordem, dataAlvo: alvoDias === null ? null : iso(alvoDias), cliente: opts.cliente ?? false, responsavelId: resp,
      checklist: Array.from({ length: total }, (_, i) => ({ texto: `Passo ${i + 1}`, feito: i < feitos })), colunaDesdeEm: iso(-(opts.desdeDias ?? 1)), planejadoEm: coluna === "BACKLOG" ? null : iso(-(opts.desdeDias ?? 1)),
      concluidoEm: coluna === "CONCLUIDO" ? iso(-(opts.desdeDias ?? 1)) : null, criadoEm: iso(-30),
    });
  };
  const a = mkEntrega("Consultoria Nicoletti", "Nicoletti Professional", 4800, -40, 320, "EM_ANDAMENTO", { COMERCIAL: "Funil sem etapa de qualificação; follow-up manual.", MARKETING: "Anúncios sem pixel instalado." });
  mkCartao(a, "Reunião de kickoff com o dono", "COMERCIAL", "CONCLUIDO", -35, "u-pedro", { desdeDias: 36 });
  mkCartao(a, "Enviar acessos e documentos", "OPERACAO", "CONCLUIDO", -30, "u-layane", { cliente: true, desdeDias: 28 });
  mkCartao(a, "Mapear funil e metas comerciais", "COMERCIAL", "EM_ANDAMENTO", -3, "u-pedro", { desdeDias: 6, check: [2, 4], descricao: "Desenhar as etapas reais do funil e as metas de conversão por etapa." });
  mkCartao(a, "Auditar anúncios e canais de entrada", "MARKETING", "EM_ANDAMENTO", 4, "u-layane", { desdeDias: 3, check: [1, 3] });
  mkCartao(a, "Diagnóstico de margem e fluxo de caixa", "FINANCEIRO", "ESSA_SEMANA", 5, "u-pedro");
  mkCartao(a, "Revisar oferta e precificação", "PRODUTO", "BACKLOG", 18, null);
  mkCartao(a, "Configurar CRM e rotinas de acompanhamento", "TECNOLOGIA", "BACKLOG", 25, null);
  const b = mkEntrega("Consultoria Showman", "Showman Ltda.", 3200, -120, 38, "EM_ANDAMENTO", { OPERACAO: "Processos de expedição sem responsável." });
  mkCartao(b, "Mapear processos críticos", "OPERACAO", "AGUARDANDO_CLIENTE", -2, "u-layane", { cliente: true, desdeDias: 11, check: [1, 5] });
  mkCartao(b, "Enviar extrato do trimestre", "FINANCEIRO", "AGUARDANDO_CLIENTE", 2, "u-pedro", { cliente: true, desdeDias: 9 });
  mkCartao(b, "Relatório de resultados do mês", "MARKETING", "ESSA_SEMANA", 3, "u-layane");
  mkCartao(b, "Reunião de alinhamento trimestral", "COMERCIAL", "CONCLUIDO", -10, "u-pedro", { desdeDias: 9 });
  mkCartao(b, "Treinar equipe no CRM", "TECNOLOGIA", "EM_ANDAMENTO", -6, "u-layane", { desdeDias: 12 });
  mkCartao(b, "Revisar tabela de preços", "PRODUTO", "EM_ANDAMENTO", -1, null, { desdeDias: 4 });
  const c = mkEntrega("Consultoria Vulk Jeans", "Vulk Jeans", 2100, -15, 350);
  mkCartao(c, "Reunião de kickoff com o dono", "COMERCIAL", "CONCLUIDO", -12, "u-pedro", { desdeDias: 12 });
  mkCartao(c, "Enviar acessos e documentos", "OPERACAO", "AGUARDANDO_CLIENTE", -4, "u-layane", { cliente: true, desdeDias: 10 });
  mkCartao(c, "Auditar anúncios e canais de entrada", "MARKETING", "BACKLOG", 9, null);
  const d = mkEntrega("Implantação Casa Ambos", "Casa Ambos", 1900, -200, 52, "EM_ANDAMENTO");
  mkCartao(d, "Revisão trimestral de metas", "COMERCIAL", "ESSA_SEMANA", 4, "u-pedro");
  mkCartao(d, "Auditoria de estoque", "OPERACAO", "CONCLUIDO", -20, "u-layane", { desdeDias: 19 });
  const f = mkEntrega("Consultoria Fornaro", "Fornaro Móveis", 0, -300, null, "CONCLUIDA");
  mkCartao(f, "Entrega final do diagnóstico", "PRODUTO", "CONCLUIDO", -40, "u-pedro", { desdeDias: 40 });
  e.entregas[e.entregas.length - 1].concluidaEm = iso(-40);
  return e;
}

function saudeDe(cs: CartaoE[], renovacaoEm: string | null): Saude {
  const agora = Date.now();
  const abertos = cs.filter((c) => c.coluna !== "CONCLUIDO");
  const atrasados = abertos.filter((c) => c.dataAlvo && Date.parse(c.dataAlvo) < agora).length;
  const esperando = cs.filter((c) => c.coluna === "AGUARDANDO_CLIENTE" && agora - Date.parse(c.colunaDesdeEm) > 7 * DIA).length;
  const nota = Math.max(0, 100 - 12 * atrasados - 6 * esperando);
  const concl = cs.length - abertos.length;
  const dias = renovacaoEm ? Math.ceil((Date.parse(renovacaoEm) - agora) / DIA) : null;
  return {
    nota, rotulo: nota >= 80 ? "SAUDAVEL" : nota >= 50 ? "ATENCAO" : "EM_RISCO", progresso: cs.length ? Math.round((concl / cs.length) * 100) : 0, total: cs.length, concluidos: concl, atrasados, esperandoCliente: esperando,
    diasParaRenovar: dias, renovacaoProxima: dias !== null && dias <= 60, porColuna: Object.fromEntries(COLUNAS.map((k) => [k, cs.filter((c) => c.coluna === k).length])),
  };
}

export function criarProvedorFixture(modo: ModoFixtureEntregas = "1"): EntregasProvider {
  const e = semente(modo === "vazio");
  const falha = () => { if (modo === "erro") throw new EntregasErro("O CRM está indisponível no momento.", "rede"); };
  const ent = (id: string) => { const x = e.entregas.find((y) => y.id === id); if (!x) throw new EntregasErro("Registro não encontrado (já foi alterado ou apagado no CRM).", "nao-encontrado", 404); return x; };
  const car = (eid: string, cid: string) => { const x = e.cartoes.find((y) => y.id === cid && y.entregaId === eid); if (!x) throw new EntregasErro("Registro não encontrado (já foi alterado ou apagado no CRM).", "nao-encontrado", 404); return x; };
  const resumo = (x: EntregaE): EntregaResumo => ({ id: x.id, nome: x.nome, status: x.status, contato: x.contato, inicioEm: x.inicioEm, renovacaoEm: x.renovacaoEm, valorMensal: x.valorMensal, oportunidadeId: x.oportunidadeId, saude: saudeDe(e.cartoes.filter((c) => c.entregaId === x.id), x.renovacaoEm), fimPrevistoEm: x.fimPrevistoEm, renovacaoOportunidadeId: x.renovacaoOportunidadeId });
  const reordenar = (eid: string, coluna: string) => e.cartoes.filter((c) => c.entregaId === eid && c.coluna === coluna).sort((a, b) => a.ordem - b.ordem).forEach((c, i) => { c.ordem = i; });
  const depoisDeMover = (eid: string) => {
    const x = ent(eid), cs = e.cartoes.filter((c) => c.entregaId === eid);
    if (cs.length && cs.every((c) => c.coluna === "CONCLUIDO") && x.status === "EM_ANDAMENTO") { x.status = "CONCLUIDA"; x.concluidaEm = new Date().toISOString(); }
    else if (x.status === "CONCLUIDA" && cs.some((c) => c.coluna !== "CONCLUIDO")) { x.status = "EM_ANDAMENTO"; x.concluidaEm = null; }
  };

  return {
    async quadro(f: FiltroQuadro = {}): Promise<Quadro> {
      falha();
      const agora = Date.now();
      const q = f.q?.trim().toLowerCase();
      let es = e.entregas.filter((x) => x.status === (f.status || "EM_ANDAMENTO") && (!f.entregaId || x.id === f.entregaId) && (!q || x.nome.toLowerCase().includes(q) || x.contato.nome.toLowerCase().includes(q)));
      const cartoes = e.cartoes.filter((c) => es.some((x) => x.id === c.entregaId)).filter((c) => (!f.pilar || c.pilar === f.pilar) && (!f.responsavelId || (f.responsavelId === "sem" ? !c.responsavelId : c.responsavelId === f.responsavelId))).map((c) => ({
        id: c.id, entregaId: c.entregaId, titulo: c.titulo, pilar: c.pilar, coluna: c.coluna, ordem: c.ordem, dataAlvo: c.dataAlvo, cliente: c.cliente, responsavel: pessoa(c.responsavelId),
        diasDeAtraso: c.coluna !== "CONCLUIDO" && c.dataAlvo && Date.parse(c.dataAlvo) < agora ? Math.max(1, Math.floor((agora - Date.parse(c.dataAlvo)) / DIA)) : 0,
        diasNaColuna: Math.max(0, Math.floor((agora - Date.parse(c.colunaDesdeEm)) / DIA)), concluidoEm: c.concluidoEm, checklist: { feitos: c.checklist.filter((i) => i.feito).length, total: c.checklist.length },
      })).filter((c) => !f.atrasados || c.diasDeAtraso > 0).sort((a, b) => a.ordem - b.ordem);
      if (f.pilar || f.responsavelId || f.atrasados) es = es.filter((x) => cartoes.some((c) => c.entregaId === x.id));
      const lista = es.map(resumo);
      return {
        colunas: COLUNAS.map((id) => ({ id, rotulo: ROTULO_COLUNA[id] })), pilares: PILARES.map((id) => ({ id, rotulo: id })),
        indicadores: {
          entregas: lista.length, mrr: lista.reduce((s, x) => s + x.valorMensal, 0), cartoesAbertos: cartoes.filter((c) => c.coluna !== "CONCLUIDO").length, atrasados: cartoes.filter((c) => c.diasDeAtraso > 0).length,
          aguardandoCliente: cartoes.filter((c) => c.coluna === "AGUARDANDO_CLIENTE").length, emRisco: lista.filter((x) => x.saude.rotulo === "EM_RISCO").length, renovacoesProximas: lista.filter((x) => x.saude.renovacaoProxima).length,
        },
        entregas: lista, cartoes,
      };
    },
    async entregas(status) { falha(); return e.entregas.filter((x) => !status || x.status === status).map(resumo); },
    async entrega(id): Promise<EntregaDetalhe> {
      falha();
      const x = ent(id);
      return { ...resumo(x), fimPrevistoEm: x.fimPrevistoEm, renovacaoOportunidadeId: x.renovacaoOportunidadeId, diagnostico: x.diagnostico, concluidaEm: x.concluidaEm, modelo: { nome: e.modelos[0].nome },
        cartoes: e.cartoes.filter((c) => c.entregaId === id).sort((a, b) => a.ordem - b.ordem).map((c) => ({ id: c.id, titulo: c.titulo, descricao: c.descricao, pilar: c.pilar, coluna: c.coluna, ordem: c.ordem, dataAlvo: c.dataAlvo, cliente: c.cliente, responsavel: pessoa(c.responsavelId), colunaDesdeEm: c.colunaDesdeEm, concluidoEm: c.concluidoEm })) };
    },
    async cartao(eid, cid): Promise<CartaoDetalhe> {
      falha();
      const c = car(eid, cid), x = ent(eid);
      const historico = [{ em: c.criadoEm, tipo: "CRIADO", texto: "Cartão criado" }];
      if (c.planejadoEm) historico.push({ em: c.planejadoEm, tipo: "PLANEJADO", texto: "Coluna definida pela rotina ou por uma pessoa" });
      if (c.coluna !== "BACKLOG") historico.push({ em: c.colunaDesdeEm, tipo: "COLUNA", texto: `Entrou em "${ROTULO_COLUNA[c.coluna as keyof typeof ROTULO_COLUNA]}"` });
      if (c.concluidoEm) historico.push({ em: c.concluidoEm, tipo: "CONCLUIDO", texto: "Cartão concluído" });
      if (c.coluna === "AGUARDANDO_CLIENTE") historico.push({ em: c.colunaDesdeEm, tipo: "AUTOMACAO", texto: "Automação Entrega: aguardando o cliente: CRIAR_TAREFA (executada)" });
      return { ...c, responsavel: pessoa(c.responsavelId), entrega: { id: x.id, nome: x.nome, status: x.status, renovacaoEm: x.renovacaoEm, contato: x.contato }, combinados: [], historico };
    },
    async renovacoes(dias = 60) {
      falha();
      return e.entregas.filter((x) => x.renovacaoEm && x.status !== "CANCELADA" && Date.parse(x.renovacaoEm) <= Date.now() + dias * DIA).sort((a, b) => Date.parse(a.renovacaoEm!) - Date.parse(b.renovacaoEm!))
        .map((x) => ({ entregaId: x.id, nome: x.nome, contato: x.contato, renovacaoEm: x.renovacaoEm!, diasParaRenovar: Math.ceil((Date.parse(x.renovacaoEm!) - Date.now()) / DIA), valorMensal: x.valorMensal, status: x.status, renovacaoOportunidadeId: x.renovacaoOportunidadeId }));
    },
    async gatilhos(): Promise<Gatilhos> {
      falha();
      return { gatilhos: [{ id: "ENTREGA_CARTAO_ATRASADO", rotulo: "Entrega: cartão atrasado" }, { id: "ENTREGA_AGUARDANDO_CLIENTE", rotulo: "Entrega: aguardando o cliente" }, { id: "ENTREGA_RENOVACAO_PROXIMA", rotulo: "Entrega: renovação chegando" }],
        automacoes: modo === "vazio" ? [] : [
          { id: "a1", nome: "Cobrar o cliente após 5 dias parado", ativo: true, gatilho: "ENTREGA_AGUARDANDO_CLIENTE", rotuloGatilho: "Entrega: aguardando o cliente", execucoes30d: { EXECUTADA: 7, IGNORADA: 2 } },
          { id: "a2", nome: "Avisar responsável de cartão atrasado", ativo: true, gatilho: "ENTREGA_CARTAO_ATRASADO", rotuloGatilho: "Entrega: cartão atrasado", execucoes30d: { EXECUTADA: 12 } },
          { id: "a3", nome: "Preparar renovação", ativo: false, gatilho: "ENTREGA_RENOVACAO_PROXIMA", rotuloGatilho: "Entrega: renovação chegando", execucoes30d: {} },
        ] };
    },
    async usuarios() { falha(); return USUARIOS; },
    async modelos() { falha(); return e.modelos; },
    async editarCartao(eid, cid, p) {
      falha();
      const c = car(eid, cid);
      if (p.coluna && !(COLUNAS as readonly string[]).includes(p.coluna)) throw new EntregasErro("coluna inválida", "rejeitado", 400);
      if (p.coluna) {
        const de = c.coluna;
        const destino = e.cartoes.filter((x) => x.entregaId === eid && x.coluna === p.coluna && x.id !== cid).sort((a, b) => a.ordem - b.ordem);
        destino.splice(p.posicao === undefined ? destino.length : Math.min(p.posicao, destino.length), 0, c);
        c.coluna = p.coluna;
        destino.forEach((x, i) => { x.ordem = i; });
        if (de !== p.coluna) { const agora = new Date().toISOString(); c.colunaDesdeEm = agora; c.planejadoEm = agora; c.concluidoEm = p.coluna === "CONCLUIDO" ? agora : null; reordenar(eid, de); depoisDeMover(eid); }
      }
      if (p.titulo !== undefined) c.titulo = p.titulo;
      if (p.descricao !== undefined) c.descricao = p.descricao;
      if (p.pilar) c.pilar = p.pilar;
      if (p.dataAlvo !== undefined) c.dataAlvo = p.dataAlvo;
      if (p.cliente !== undefined) c.cliente = p.cliente;
      if (p.responsavelId !== undefined) c.responsavelId = p.responsavelId;
      if (p.checklist) c.checklist = p.checklist;
    },
    async criarCartao(eid, n) {
      falha(); ent(eid);
      const coluna = n.coluna ?? "BACKLOG";
      const id = `k-${++e.seq}`;
      const agora = new Date().toISOString();
      e.cartoes.push({ id, entregaId: eid, titulo: n.titulo, descricao: n.descricao ?? null, pilar: n.pilar ?? "COMERCIAL", coluna, ordem: e.cartoes.filter((c) => c.entregaId === eid && c.coluna === coluna).length, dataAlvo: n.dataAlvo ?? null, cliente: n.cliente ?? false, responsavelId: n.responsavelId ?? null, checklist: [], colunaDesdeEm: agora, planejadoEm: null, concluidoEm: coluna === "CONCLUIDO" ? agora : null, criadoEm: agora });
      return { id };
    },
    async excluirCartao(eid, cid) { falha(); car(eid, cid); e.cartoes = e.cartoes.filter((c) => c.id !== cid); },
    async editarEntrega(id, p) {
      falha();
      const x = ent(id);
      if (p.status && p.status !== x.status) { x.status = p.status; x.concluidaEm = p.status === "CONCLUIDA" ? new Date().toISOString() : null; }
      if (p.renovacaoEm !== undefined) x.renovacaoEm = p.renovacaoEm;
      if (p.fimPrevistoEm !== undefined) x.fimPrevistoEm = p.fimPrevistoEm;
      if (p.diagnostico) for (const [k, v] of Object.entries(p.diagnostico)) if (v !== undefined) x.diagnostico[k] = v;
    },
    async concluirEntrega(id) { falha(); const x = ent(id); x.status = "CONCLUIDA"; x.concluidaEm = new Date().toISOString(); },
    async criarUpsell(id) { falha(); ent(id); return { oportunidadeId: `o-upsell-${++e.seq}` }; },
    async definirModeloPadrao(id) { falha(); if (!e.modelos.some((m) => m.id === id)) throw new EntregasErro("Modelo não encontrado", "nao-encontrado", 404); e.modelos.forEach((m) => { m.padrao = m.id === id; if (m.id === id) m.ativo = true; }); },
    async desativarModelo(id) { falha(); const m = e.modelos.find((x) => x.id === id); if (!m) throw new EntregasErro("Modelo não encontrado", "nao-encontrado", 404); m.ativo = false; m.padrao = false; },
    async rodarRotina() { falha(); return { responsaveis: 2, planejados: 1, concluidas: 0, renovacoes: 0, erros: 0 }; },
  };
}
