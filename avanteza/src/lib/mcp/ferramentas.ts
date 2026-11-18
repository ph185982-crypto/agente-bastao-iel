// Ferramentas do conector do Claude (/api/mcp). Cada uma reaproveita as funções da Central (as mesmas das telas), confere o
// papel com as MESMAS regras das server actions (requireOwner → só administrador; Motor → podeTrabalharMotor; Financeiro →
// recusaDeEscrita; Entregas → podeVerEntregas) e devolve JSON compacto, com limite de linhas.
//
// Regras do dono ("ler e agir"): nada de excluir, nada de acessos/senhas, nada de e-mail para cliente. Toda escrita vai para
// a auditoria com o e-mail de quem autorizou o conector e { via: "claude" }. A saída nunca leva hash de senha, token de canal,
// chave de API nem campo cifrado: as funções já escolhem as colunas e `limpar` remove qualquer chave com nome sensível.
import { z } from "zod";
import { adminDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { spDate } from "@/lib/dates";
import { isDateStr } from "@/lib/mapa/plan";
import { scopeFromSession, type ClientScope } from "@/lib/mapa/scope";
import { getClient, getMeeting, listMeetings, listPhases } from "@/lib/mapa/repo";
import { ingestMeeting, saveMeetingManual } from "@/lib/mapa/meetings";
import * as motor from "@/lib/motor/repo";
import { filtrar, montarFila } from "@/lib/motor/fila";
import { ordenarPorRisco } from "@/lib/motor/saude";
import { podeTrabalharMotor, podeVerMotor } from "@/lib/motor/acesso";
import { ingestCaptura } from "@/lib/motor/capturas";
import { notificarCaptura } from "@/lib/motor/capturas-api";
import { buscar as buscarGlobal } from "@/lib/busca";
import { normalizar } from "@/lib/busca/texto";
import { provedorComercialDoAmbiente, TIPOS_COMERCIAL, type ProvedorComercial } from "@/lib/busca/comercial";
import { carregarCanaisDoCliente } from "@/lib/channels/cliente";
import { atualizarAgora, atualizarGoogleAgora } from "@/lib/channels/servico";
import { PERIODOS, type PeriodoId } from "@/lib/dashboards/periodo";
import { obterProvedor as provedorFinanceiro } from "@/lib/financeiro";
import { podeVerEscopo, recusaDeEscrita as recusaFinanceiro } from "@/lib/financeiro/acesso";
import { isData, isMes } from "@/lib/financeiro/periodo";
import { FinanceiroErro, mensagemDoErro as erroFinanceiro, type FinanceiroProvider } from "@/lib/financeiro/vendedoria";
import { obterProvedor as provedorEntregas } from "@/lib/entregas";
import { podeVerEntregas } from "@/lib/entregas/acesso";
import { EntregasErro, mensagemDoErro as erroEntregas, type EntregasProvider } from "@/lib/entregas/crm";
import { listarNotificacoes, podeVerNotificacoes } from "@/lib/notificacoes";
import type { AiProvider } from "@/lib/ai/provider";

// ─── Contexto ────────────────────────────────────────────────────────────────

/** Quem está agindo: o administrador que autorizou o conector (conferido no banco a cada chamada). */
export interface Ator { email: string; sessao: Session }

/** Dependências injetáveis (testes). Em produção tudo vem do ambiente. */
export interface Deps {
  hoje?: string;
  financeiro?: FinanceiroProvider;
  entregas?: EntregasProvider;
  comercial?: ProvedorComercial;
  ia?: AiProvider;
  coletar?: (clientId: string, fonte: "ads" | "instagram" | "todas") => Promise<{ ok: boolean; mensagem: string; resultado?: { linhas?: Record<string, number> } }>;
  coletarGoogle?: (clientId: string) => Promise<{ ok: boolean; mensagem: string; linhas?: Record<string, number> }>;
  /** Anúncios (marketplace): atualiza um anúncio no painel depois de criar/alterar. Padrão: collector.atualizarUmAnuncio. */
  atualizarAnuncio?: (accountId: string, externalId: string) => Promise<unknown>;
  /** Meta Ads: env (token da plataforma, teto) e coleta leve depois de criar/alterar. */
  env?: NodeJS.ProcessEnv;
  fetchMeta?: typeof fetch;
  coletarAnunciosMeta?: (clientId: string) => Promise<unknown>;
}

/** Erro "de negócio": vira a mensagem da ferramenta (isError) sem detalhe técnico. */
export class ErroFerramenta extends Error {}

export const LIMITE = 50;
export const VIA = { via: "claude" } as const;

export const corta = (s: unknown, n: number): string | null => (typeof s === "string" && s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null);
const SENSIVEL = /(password|senha|hash|token|secret|segredo|_enc$|^enc_|api_?key|chave|credencial)/i;

/** Defesa extra: remove qualquer campo com nome sensível, em qualquer nível. */
export function limpar<T>(v: T): T {
  if (Array.isArray(v)) return v.map(limpar) as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SENSIVEL.test(k) && x !== undefined) out[k] = limpar(x);
    return out as T;
  }
  return v;
}

export async function auditar(ator: Ator, event: string, clientId: string | null, details: Record<string, unknown>) {
  await adminDb().from("audit_log").insert({ event, actor: ator.email, client_id: clientId, details: { ...details, ...VIA } });
}

export const ehAdmin = (a: Ator) => a.sessao.role === "admin";
export function exigir(ok: boolean, msg = "Restrito aos administradores.") {
  if (!ok) throw new ErroFerramenta(msg);
}

/** Cliente por id (uuid) ou nome (sem acento/caixa; exato vence parcial). Ambíguo ou ausente → erro com as opções. */
export async function resolverCliente(ref: string): Promise<{ id: string; name: string }> {
  const r = ref.trim();
  if (motor.isUuid(String(r))) {
    const { data } = await adminDb().from("clients").select("id, name").eq("id", r).maybeSingle();
    if (!data) throw new ErroFerramenta("Cliente não encontrado.");
    return { id: data.id, name: data.name };
  }
  const q = normalizar(r);
  if (q.length < 2) throw new ErroFerramenta("Informe o nome ou o id do cliente.");
  const todos = await motor.clientesAtivos();
  const exatos = todos.filter((c) => normalizar(c.name) === q);
  if (exatos.length === 1) return exatos[0];
  const parciais = todos.filter((c) => normalizar(c.name).includes(q));
  if (parciais.length === 1) return parciais[0];
  if (!parciais.length) throw new ErroFerramenta(`Nenhum cliente ativo com "${r.slice(0, 60)}". Use listar_clientes ou buscar.`);
  throw new ErroFerramenta(`Mais de um cliente com "${r.slice(0, 60)}": ${parciais.slice(0, 8).map((c) => `${c.name} (${c.id})`).join("; ")}. Use o id.`);
}

/** Escopo de leitura do Mapa para a equipe ("Ver como cliente": somente leitura), para reaproveitar as consultas do Mapa. */
function escopoLeitura(ator: Ator, clientId: string): ClientScope {
  const s = scopeFromSession(ator.sessao, clientId);
  if (!s) throw new ErroFerramenta("Cliente inválido.");
  return s;
}

const hojeDe = (d: Deps) => d.hoje ?? spDate();

const acaoCurta = (a: motor.AcaoMotor, hoje: string) => ({
  id: a.id, cliente: a.client_name, cliente_id: a.client_id, titulo: a.title, status: a.status, prazo: a.due_date,
  atrasada: Boolean(a.due_date && a.due_date < hoje && a.status !== "concluida"), prioridade: a.priority, responsavel: a.assignee_name,
  de_quem: a.owner, papel: a.role, bloqueio: a.blocked_reason, origem: a.origin, ia: a.ai_generated || undefined,
});

async function pessoaPorEmail(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const p = (await motor.listarEquipe()).find((x) => x.email === e);
  if (!p) throw new ErroFerramenta(`Ninguém ativo na equipe com o e-mail ${e.slice(0, 80)}.`);
  return p.id;
}

function falhaExterna(e: unknown): never {
  if (e instanceof FinanceiroErro) throw new ErroFerramenta(erroFinanceiro(e));
  if (e instanceof EntregasErro) throw new ErroFerramenta(erroEntregas(e));
  throw e;
}

// ─── Entradas (zod) ──────────────────────────────────────────────────────────

export const cliente = z.string().trim().min(1).max(120).describe("Id (uuid) ou nome do cliente.");
const data = z.string().refine(isDateStr, "Data inválida (use AAAA-MM-DD).");
const uuid = z.string().refine(motor.isUuid, "Id inválido.");
const escopoFin = z.enum(["empresa", "pessoal"]).default("empresa").describe("empresa (Avanteza) ou pessoal (só o dono).");
const mes = z.string().refine(isMes, "Mês inválido (use AAAA-MM).");
const url = z.string().max(2000).refine((u) => /^https?:\/\/\S+$/i.test(u), "Use um link http(s).");

// ─── Definição ───────────────────────────────────────────────────────────────

export interface Ferramenta<S extends z.ZodRawShape = z.ZodRawShape> {
  nome: string;
  titulo: string;
  descricao: string;
  entrada: S;
  escrita: boolean;
  executar(ator: Ator, args: z.infer<z.ZodObject<S>>, deps: Deps): Promise<unknown>;
}
export const def = <S extends z.ZodRawShape>(f: Ferramenta<S>) => f as unknown as Ferramenta;

export const FERRAMENTAS: Ferramenta[] = [
  // ─────────────── Leitura ───────────────
  def({
    nome: "buscar", titulo: "Buscar na Central", escrita: false,
    descricao: "Busca global (a mesma do Ctrl+K): clientes, ações do Motor, aprovações e, do Comercial, oportunidades, contatos e contratos. Até 10 por grupo.",
    entrada: { q: z.string().trim().min(2).max(80).describe("Texto a buscar (mín. 2 letras)."), limite: z.number().int().min(1).max(10).optional() },
    async executar(ator, a, deps) {
      const r = await buscarGlobal(ator.sessao, a.q, { limite: a.limite, comercial: deps.comercial });
      return { q: r.q, grupos: r.grupos.map((g) => ({ grupo: g.rotulo, itens: g.itens.map((i) => ({ id: i.id, titulo: i.titulo, detalhe: i.detalhe ?? null, link: i.href })) })), avisos: r.avisos.map((x) => x.texto) };
    },
  }),
  def({
    nome: "listar_clientes", titulo: "Listar clientes e saúde", escrita: false,
    descricao: "Clientes ativos com a saúde da Carteira (verde/amarelo/vermelho e os motivos), gerente, serviços e próximos prazos. Os de maior risco vêm primeiro.",
    entrada: { nivel: z.enum(["verde", "amarelo", "vermelho"]).optional().describe("Filtra pelo nível de saúde.") },
    async executar(ator, a, deps) {
      exigir(podeVerMotor(ator.sessao));
      const cartoes = ordenarPorRisco(await motor.carteira(hojeDe(deps))).filter((c) => !a.nivel || c.saude.nivel === a.nivel);
      return {
        total: cartoes.length,
        clientes: cartoes.slice(0, 100).map((c) => ({
          id: c.id, nome: c.nome, tipo: c.kind, gerente: c.gerente, servicos: c.servicos,
          saude: { nivel: c.saude.nivel, motivos: c.saude.motivos, plano_pct: c.saude.metricas.pctPlano, atrasadas: c.saude.metricas.atrasadas, dias_sem_reuniao: c.saude.metricas.diasSemReuniao },
          proximos: c.proximos,
        })),
      };
    },
  }),
  def({
    nome: "ver_cliente", titulo: "Ver cliente", escrita: false,
    descricao: "Ficha do cliente: dados e contato, serviços contratados (valor, início, status), saúde com os motivos, gerente e próximos prazos.",
    entrada: { cliente },
    async executar(ator, a, deps) {
      exigir(podeVerMotor(ator.sessao));
      const c = await resolverCliente(a.cliente);
      const [dados, servicos, cartoes] = await Promise.all([getClient(escopoLeitura(ator, c.id)), motor.servicosDoCliente(c.id), motor.carteira(hojeDe(deps))]);
      const card = cartoes.find((x) => x.id === c.id);
      return {
        cliente: dados && { id: dados.id, nome: dados.name, slug: dados.slug, tipo: dados.kind, inicio: dados.start_date, ativo: dados.active, contato: { nome: dados.contact_name, email: dados.contact_email, telefone: dados.contact_phone } },
        gerente: card?.gerente ?? null,
        servicos: servicos.map((s) => ({ servico: s.service_name, status: s.status, inicio: s.start_date, fim: s.end_date, valor_mensal: s.monthly_value, contrato: s.contract_ref })),
        saude: card ? { nivel: card.saude.nivel, motivos: card.saude.motivos, metricas: card.saude.metricas } : null,
        proximos: card?.proximos ?? [],
      };
    },
  }),
  def({
    nome: "tarefas_hoje", titulo: "Fila de hoje", escrita: false,
    descricao: `Fila priorizada da tela Hoje: atrasadas, de hoje, próximos 7 dias e esperando o cliente (bloqueadas). Até ${LIMITE} por grupo.`,
    entrada: {
      responsavel: z.string().trim().max(120).optional().describe('E-mail do responsável, "eu" (quem autorizou o conector) ou "ninguem" (sem responsável).'),
      cliente: cliente.optional(),
    },
    async executar(ator, a, deps) {
      exigir(podeVerMotor(ator.sessao));
      const hoje = hojeDe(deps);
      const { acoes, concluidasHoje } = await motor.acoesDaFila(hoje);
      let responsavel: string | undefined;
      if (a.responsavel === "ninguem") responsavel = "ninguem";
      else if (a.responsavel) responsavel = await pessoaPorEmail(a.responsavel === "eu" ? ator.email : a.responsavel);
      const clienteId = a.cliente ? (await resolverCliente(a.cliente)).id : undefined;
      const fila = montarFila(filtrar(acoes, { cliente: clienteId, responsavel }), hoje, concluidasHoje.length);
      const g = (xs: motor.AcaoMotor[]) => xs.slice(0, LIMITE).map((x) => acaoCurta(x, hoje));
      return { hoje, contadores: fila.contadores, atrasadas: g(fila.atrasadas), vencem_hoje: g(fila.hoje), semana: g(fila.semana), esperando_cliente: g(fila.bloqueadas) };
    },
  }),
  def({
    nome: "plano_do_cliente", titulo: "Plano do cliente", escrita: false,
    descricao: "Fases do plano e as ações de cada uma (inclusive as internas do Motor). Por padrão só as abertas.",
    entrada: { cliente, incluir_concluidas: z.boolean().optional() },
    async executar(ator, a, deps) {
      exigir(podeVerMotor(ator.sessao));
      const c = await resolverCliente(a.cliente);
      const hoje = hojeDe(deps);
      const [fases, acoes] = await Promise.all([listPhases(escopoLeitura(ator, c.id)), motor.acoesDoCliente(c.id)]);
      const vis = acoes.filter((x) => a.incluir_concluidas || x.status !== "concluida");
      const por = (id: string | null) => vis.filter((x) => x.phase_id === id).slice(0, 80).map((x) => ({ ...acaoCurta(x, hoje), cliente: undefined, cliente_id: undefined }));
      return {
        cliente: c.name, cliente_id: c.id, total_acoes: acoes.length, concluidas: acoes.filter((x) => x.status === "concluida").length,
        fases: fases.map((f: any) => ({ id: f.id, ordem: f.position, nome: f.name, de: f.starts_on, ate: f.ends_on, acoes: por(f.id) })),
        sem_fase: por(null),
      };
    },
  }),
  def({
    nome: "reunioes_do_cliente", titulo: "Reuniões do cliente", escrita: false,
    descricao: "Reuniões registradas (mais recentes primeiro) com status e resumo curto. Com reuniao_id, traz o resumo completo, as decisões e as ações da reunião. Transcrição nunca sai.",
    entrada: { cliente, reuniao_id: uuid.optional() },
    async executar(ator, a) {
      exigir(podeVerMotor(ator.sessao));
      const c = await resolverCliente(a.cliente);
      const escopo = escopoLeitura(ator, c.id);
      if (a.reuniao_id) {
        const r = await getMeeting(escopo, a.reuniao_id);
        if (!r) throw new ErroFerramenta("Reunião não encontrada para este cliente.");
        const m = r.meeting;
        return {
          id: m.id, titulo: m.title, data: m.held_at, status: m.status, gravacao: m.recording_url, transcricao_link: m.transcript_url, resumo: m.summary, decisoes: m.decisions,
          acoes: r.actions.map((x: any) => ({ id: x.id, titulo: x.title, status: x.status, de_quem: x.owner, prazo: x.due_date })),
        };
      }
      const lista = await listMeetings(escopo);
      return { cliente: c.name, total: lista.length, reunioes: lista.slice(0, 20).map((m: any) => ({ id: m.id, titulo: m.title, data: m.held_at, status: m.status, resumo: corta(m.summary, 300) })) };
    },
  }),
  def({
    nome: "canais_do_cliente", titulo: "Canais do cliente", escrita: false,
    descricao: "Anúncios (gasto, resultados, custo por resultado, campanhas e melhores anúncios), público e localização, Instagram, Google (Perfil da Empresa) e o alerta de recarga (gasto do ciclo x limite).",
    entrada: { cliente, periodo: z.enum(PERIODOS).default("30").describe('Período: "7", "30" (padrão), "90" dias ou "mes" (mês atual).') },
    async executar(ator, a, deps) {
      exigir(podeVerMotor(ator.sessao));
      const c = await resolverCliente(a.cliente);
      const r = await carregarCanaisDoCliente(escopoLeitura(ator, c.id), a.periodo as PeriodoId, hojeDe(deps));
      const e = r.estado;
      const ig = r.instagram, an = r.anuncios, pub = r.publico, gg = r.google;
      return {
        cliente: c.name, periodo: { de: r.periodo.atual.de, ate: r.periodo.atual.ate },
        estado: {
          anuncios: e.anuncios ? { conectado: e.anunciosConectado, atualizado_em: e.anunciosAtualizadoEm, com_problema: e.anunciosComProblema, fonte: e.fonteAnuncios } : null,
          instagram: e.instagram ? { conectado: e.instagramConectado, atualizado_em: e.instagramAtualizadoEm, com_problema: e.instagramComProblema, fonte: e.fonteInstagram } : null,
          google: e.google ? { conectado: e.googleConectado, atualizado_em: e.googleAtualizadoEm, com_problema: e.googleComProblema } : null,
          resultado: e.resultado, simulado: e.simulado || undefined,
        },
        alerta_recarga: r.gastoCiclo,
        anuncios: an && {
          atual: an.atual, anterior: an.anterior,
          campanhas: [...an.campanhas].sort((x, y) => y.gasto - x.gasto).slice(0, 10).map((x) => ({ nome: x.nome, gasto: x.gasto, resultados: x.resultados, custo_por_resultado: x.custoPorResultado, ctr: x.ctr })),
          melhores_anuncios: an.criativos.ranking.slice(0, 5).map((x) => ({ nome: x.nome, campanha: x.campanha, publico: x.publico, gasto: x.gasto, resultados: x.resultados, custo_por_resultado: x.custoPorResultado, selo: x.selo, porque: x.porque.slice(0, 3) })),
          total_anuncios: an.criativos.totalAnuncios,
        },
        publico: pub && pub.temDados ? {
          melhor_segmento: pub.idadeGenero?.melhor ?? null, segmento_mais_caro: pub.idadeGenero?.maisCaro ?? null,
          regioes: pub.regioes?.itens.slice(0, 8) ?? [], locais_configurados: pub.locaisConfigurados.slice(0, 10).map((l) => l.texto),
          conjuntos: pub.conjuntos.slice(0, 10),
        } : null,
        instagram: ig && ig.temDados ? {
          seguidores: { atual: ig.seguidores.atual, ganho: ig.seguidores.ganho, estimado: ig.seguidores.estimado },
          kpis: ig.kpis.filter((k) => k.disponivel).map((k) => ({ indicador: k.rotulo, atual: k.atual, anterior: k.anterior, variacao: k.variacao })),
          audiencia: ig.audiencia && { idade: ig.audiencia.idade.slice(0, 6), genero: ig.audiencia.genero, cidades: ig.audiencia.cidades.slice(0, 6) },
          melhores_posts: [...ig.midias].sort((x, y) => y.interacoes - x.interacoes).slice(0, 5).map((m) => ({ tipo: m.rotulo, data: m.data, legenda: corta(m.legenda, 120), link: m.permalink, alcance: m.alcance, interacoes: m.interacoes })),
        } : null,
        google: gg && gg.temDados ? {
          local: gg.local && { nome: gg.local.titulo, categoria: gg.local.categoria, cidade: gg.local.cidade },
          visualizacoes: gg.visualizacoes, rotas: gg.rotas, ligacoes: gg.ligacoes, site: gg.site,
          nota: { media: gg.nota.media, total: gg.nota.total, no_periodo: gg.nota.noPeriodo, sem_resposta: gg.nota.semResposta },
          buscas: gg.buscas.itens.slice(0, 10),
        } : null,
      };
    },
  }),
  def({
    nome: "financeiro_resumo", titulo: "Resumo do financeiro", escrita: false,
    descricao: "Resumo do mês (receitas, despesas, saldo, comparação com o período anterior, despesas por categoria, receitas previstas) e as contas a pagar pendentes. Fonte: Vendedor IA.",
    entrada: { escopo: escopoFin, mes: mes.optional().describe("AAAA-MM; padrão: mês atual.") },
    async executar(ator, a, deps) {
      exigir(podeVerEscopo(ator.sessao, a.escopo), "Você não tem acesso a esta área do Financeiro.");
      const prov = provedorFinanceiro(process.env, deps.financeiro);
      try {
        const [r, contas] = await Promise.all([prov.resumo(a.escopo, { mes: a.mes }), prov.contas(a.escopo, "pendente").catch(() => null)]);
        const rp = r.receitasPrevistas;
        return {
          escopo: a.escopo, periodo: r.periodo.label, receitas: r.receitas, despesas: r.despesas, saldo: r.saldo,
          comparativo: { periodo_anterior: r.comparativo.periodoAnterior.label, receitas: r.comparativo.receitas, despesas: r.comparativo.despesas, saldo: r.comparativo.saldo },
          categorias: r.categorias.slice(0, 12),
          receitas_previstas: { total: rp.total, quantidade: rp.quantidade, recebido: rp.recebido, atrasadas_anteriores: rp.atrasadasAnteriores, perdidas: rp.perdidas, itens: rp.itens.slice(0, 15) },
          meta: r.meta,
          contas_a_pagar: contas && { quantidade: contas.length, total: Math.round(contas.reduce((s, c) => s + c.valor, 0) * 100) / 100, proximas: contas.sort((x, y) => (x.data_vencimento < y.data_vencimento ? -1 : 1)).slice(0, 15).map((c) => ({ id: c.id, descricao: c.descricao, valor: c.valor, vencimento: c.data_vencimento, categoria: c.categoria })) },
        };
      } catch (e) { falhaExterna(e); }
    },
  }),
  def({
    nome: "lancamentos", titulo: "Lançamentos do financeiro", escrita: false,
    descricao: `Extrato do mês (receitas e despesas), com filtros por tipo, categoria e texto. ${LIMITE} por página.`,
    entrada: {
      escopo: escopoFin, mes: mes.optional().describe("AAAA-MM; padrão: mês atual."), tipo: z.enum(["receita", "despesa"]).optional(),
      categoria: z.string().trim().max(80).optional(), texto: z.string().trim().max(80).optional(), pagina: z.number().int().min(1).max(100).optional(),
    },
    async executar(ator, a, deps) {
      exigir(podeVerEscopo(ator.sessao, a.escopo), "Você não tem acesso a esta área do Financeiro.");
      try {
        const r = await provedorFinanceiro(process.env, deps.financeiro).transacoes(a.escopo, { mes: a.mes ?? spDate().slice(0, 7), tipo: a.tipo, categoria: a.categoria, texto: a.texto, page: a.pagina ?? 1, pageSize: LIMITE });
        return {
          escopo: a.escopo, total: r.total, pagina: r.pagina, paginas: r.paginas,
          itens: r.transacoes.map((t) => ({ id: t.id, data: t.data_transacao, tipo: t.tipo, valor: t.valor, descricao: t.descricao, categoria: t.categoria, cliente: t.empresa ?? null, confirmado: t.confirmado })),
        };
      } catch (e) { falhaExterna(e); }
    },
  }),
  def({
    nome: "comercial_buscar", titulo: "Buscar no Comercial", escrita: false,
    descricao: "Busca no Comercial (Vendedor IA): oportunidades, contatos e contratos, com o link de cada um.",
    entrada: { q: z.string().trim().min(2).max(80), tipos: z.array(z.enum(TIPOS_COMERCIAL)).optional(), limite: z.number().int().min(1).max(10).optional() },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator));
      const r = await (deps.comercial ?? provedorComercialDoAmbiente()).buscar(a.q, a.limite ?? 10, a.tipos?.length ? a.tipos : TIPOS_COMERCIAL);
      if (!r.ok) return { indisponivel: true, motivo: r.motivo };
      return Object.fromEntries(Object.entries(r.grupos).map(([k, itens]) => [k, itens.map((i) => ({ id: i.id, titulo: i.titulo, detalhe: i.detalhe ?? null, link: i.href }))]));
    },
  }),
  def({
    nome: "entregas", titulo: "Funil de Entrega", escrita: false,
    descricao: "Funil de Entrega: indicadores, entregas (contratos em execução) com saúde e renovação e os cartões atrasados. Com entrega_id, o detalhe da entrega e os cartões.",
    entrada: { entrega_id: z.string().trim().min(1).max(64).optional(), status: z.string().trim().max(30).optional().describe("Ex.: EM_ANDAMENTO, PAUSADA, CONCLUIDA.") },
    async executar(ator, a, deps) {
      exigir(podeVerEntregas(ator.sessao), "Você não tem acesso ao Funil de Entrega.");
      const prov = provedorEntregas(process.env, deps.entregas);
      try {
        if (a.entrega_id) {
          const e = await prov.entrega(a.entrega_id);
          return {
            id: e.id, nome: e.nome, status: e.status, contato: e.contato.nome, inicio: e.inicioEm, renovacao: e.renovacaoEm, valor_mensal: e.valorMensal, saude: e.saude,
            cartoes: e.cartoes.slice(0, 80).map((c) => ({ id: c.id, titulo: c.titulo, pilar: c.pilar, coluna: c.coluna, data_alvo: c.dataAlvo, do_cliente: c.cliente, responsavel: c.responsavel?.nome ?? null, concluido_em: c.concluidoEm })),
          };
        }
        const q = await prov.quadro({ status: a.status });
        return {
          indicadores: q.indicadores,
          entregas: q.entregas.slice(0, LIMITE).map((e) => ({ id: e.id, nome: e.nome, status: e.status, contato: e.contato.nome, renovacao: e.renovacaoEm, valor_mensal: e.valorMensal, saude: e.saude.rotulo, progresso: e.saude.progresso, atrasados: e.saude.atrasados })),
          cartoes_atrasados: q.cartoes.filter((c) => c.diasDeAtraso > 0 && !c.concluidoEm).slice(0, 30).map((c) => ({ id: c.id, entrega_id: c.entregaId, titulo: c.titulo, coluna: c.coluna, dias_de_atraso: c.diasDeAtraso, responsavel: c.responsavel?.nome ?? null })),
        };
      } catch (e) { falhaExterna(e); }
    },
  }),
  def({
    nome: "notificacoes", titulo: "Notificações", escrita: false,
    descricao: "Notificações do sino da Central para quem autorizou o conector (contrato assinado, cliente novo, capturas, falhas), mais recentes primeiro.",
    entrada: { limite: z.number().int().min(1).max(LIMITE).optional(), so_nao_lidas: z.boolean().optional() },
    async executar(ator, a) {
      exigir(podeVerNotificacoes(ator.sessao));
      const r = await listarNotificacoes(ator.sessao, a.limite ?? 20);
      return { nao_lidas: r.naoLidas, itens: r.itens.filter((i) => !a.so_nao_lidas || !i.lida).map((i) => ({ id: i.id, tipo: i.tipo, titulo: i.titulo, corpo: corta(i.corpo, 300), link: i.link, criada_em: i.criado_em, lida: i.lida })) };
    },
  }),

  // ─────────────── Ação (sem exclusão; tudo auditado com via "claude") ───────────────
  def({
    nome: "criar_tarefa", titulo: "Criar tarefa", escrita: true,
    descricao: "Cria uma ação manual no plano do cliente (aparece em Hoje e no Mapa). Responsável da equipe opcional (e-mail).",
    entrada: {
      cliente, titulo: z.string().trim().min(1).max(200), descricao: z.string().trim().max(2000).optional(), prazo: data.optional(),
      de_quem: z.enum(["avanteza", "cliente"]).default("avanteza").describe("Quem executa: avanteza (a equipe) ou cliente."),
      responsavel_email: z.string().trim().email().max(120).optional(), prioridade: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2).describe("1 alta, 2 média, 3 baixa."),
      fase_id: uuid.optional(), visivel_ao_cliente: z.boolean().default(true),
    },
    async executar(ator, a) {
      exigir(ehAdmin(ator)); // mesma regra da tela (salvarAcao → requireOwner)
      const c = await resolverCliente(a.cliente);
      const db = adminDb();
      if (a.fase_id) {
        const { data: ph } = await db.from("plan_phases").select("id").eq("id", a.fase_id).eq("client_id", c.id).maybeSingle();
        if (!ph) throw new ErroFerramenta("Fase de outro cliente.");
      }
      const assignee = a.responsavel_email ? await pessoaPorEmail(a.responsavel_email) : null;
      const { data: row, error } = await db.from("plan_actions").insert({
        client_id: c.id, title: a.titulo, description: a.descricao || null, status: "planejada", owner: a.de_quem, due_date: a.prazo ?? null, phase_id: a.fase_id ?? null,
        origin: "manual", priority: a.prioridade, assignee_id: assignee, visible_to_client: a.visivel_ao_cliente, client_dependent: a.de_quem === "cliente", updated_at: new Date().toISOString(),
      }).select("id").single();
      if (error || !row) throw new ErroFerramenta("Não foi possível criar a tarefa.");
      await auditar(ator, "plan_action_created", c.id, { id: row.id, title: a.titulo.slice(0, 80), status: "planejada" });
      return { ok: true, id: row.id, cliente: c.name, mensagem: "Tarefa criada." };
    },
  }),
  def({
    nome: "atualizar_tarefa", titulo: "Atualizar tarefa", escrita: true,
    descricao: "Concluir (com link de evidência opcional), reagendar, mudar o responsável, iniciar, reabrir, bloquear com o motivo (esperando o cliente) ou desbloquear uma ação.",
    entrada: {
      id: uuid.describe("Id da ação (veja tarefas_hoje ou plano_do_cliente)."),
      operacao: z.enum(["concluir", "reagendar", "mudar_responsavel", "bloquear", "desbloquear", "iniciar", "reabrir"]),
      evidencia: url.optional(), nova_data: data.optional(), responsavel_email: z.string().trim().max(120).optional().describe('E-mail da equipe, ou "ninguem" para tirar o responsável.'),
      motivo: z.string().trim().max(500).optional().describe("Bloquear: o que o cliente precisa enviar ou fazer."),
    },
    async executar(ator, a) {
      exigir(podeTrabalharMotor(ator.sessao), "Acesso somente leitura.");
      let op: motor.AcaoRapida;
      switch (a.operacao) {
        case "concluir": op = { tipo: "concluir", evidencia: a.evidencia ?? null }; break;
        case "reagendar":
          if (!a.nova_data) throw new ErroFerramenta("Informe nova_data (AAAA-MM-DD).");
          op = { tipo: "adiar", para: a.nova_data }; break;
        case "mudar_responsavel":
          if (!a.responsavel_email) throw new ErroFerramenta('Informe responsavel_email (ou "ninguem").');
          op = { tipo: "reatribuir", para: a.responsavel_email === "ninguem" ? null : await pessoaPorEmail(a.responsavel_email) }; break;
        case "bloquear": op = { tipo: "bloquear", motivo: a.motivo ?? "" }; break;
        default: op = { tipo: a.operacao };
      }
      const r = await motor.acaoRapida(ator.email, a.id, op, VIA);
      if (!r.ok) throw new ErroFerramenta(r.erro ?? "Não foi possível.");
      return { ok: true, id: a.id, operacao: a.operacao };
    },
  }),
  def({
    nome: "registrar_combinado", titulo: "Registrar combinado", escrita: true,
    descricao: "Registra um combinado com o cliente (texto de conversa ou anotação) como captura de origem Claude: a IA da Central extrai as ações e elas entram no plano com o selo IA (podem ser desfeitas em Hoje).",
    entrada: { cliente, texto: z.string().trim().min(3).max(50_000), autor: z.string().trim().max(120).optional(), data: data.optional().describe("Data da conversa (base para prazos ditos).") },
    async executar(ator, a, deps) {
      exigir(podeTrabalharMotor(ator.sessao), "Acesso somente leitura.");
      const c = await resolverCliente(a.cliente);
      const r = await ingestCaptura({ origem: "claude", clientId: c.id, autor: a.autor ?? (ator.sessao.name || ator.email), texto: a.texto, data: a.data ?? null }, { provider: deps.ia, hoje: deps.hoje });
      await auditar(ator, "captura_registrada", c.id, { capturaId: r.capturaId, status: r.status, acoes: r.acoesCriadas, duplicada: r.duplicada });
      if (!r.duplicada) await notificarCaptura(c.id, "claude", r.acoesCriadas).catch(() => undefined);
      return {
        ok: r.status !== "erro", cliente: c.name, captura_id: r.capturaId, status: r.status, duplicada: r.duplicada, acoes_criadas: r.acoes,
        aviso: r.status === "sem_ia" ? "IA da Central desligada: a captura foi guardada sem gerar ações. Crie as tarefas com criar_tarefa." : r.erro ? `A análise falhou: ${r.erro}` : undefined,
      };
    },
  }),
  def({
    nome: "registrar_reuniao", titulo: "Registrar reunião", escrita: true,
    descricao: "Registra uma reunião do cliente (data, título, links e/ou transcrição). Com a IA ligada e transcrição, a Central analisa e cria as ações; sem isso a reunião fica 'aguardando análise'. Mande resumo/decisoes/acoes para preencher à mão nesse caso.",
    entrada: {
      cliente, titulo: z.string().trim().min(1).max(200), data, transcricao: z.string().max(200_000).optional(),
      link_gravacao: url.optional(), link_transcricao: url.optional(),
      resumo: z.string().trim().min(1).max(4000).optional(), decisoes: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
      acoes: z.array(z.object({ titulo: z.string().trim().min(1).max(200), de_quem: z.enum(["avanteza", "cliente"]).default("avanteza"), prazo: data.optional() })).max(30).optional(),
    },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator)); // registrarReuniao/preencherReuniao → requireOwner
      const c = await resolverCliente(a.cliente);
      let r;
      try {
        r = await ingestMeeting({ clientId: c.id, title: a.titulo, heldAt: `${a.data}T12:00:00-03:00`, recordingUrl: a.link_gravacao ?? null, transcriptUrl: a.link_transcricao ?? null, transcript: a.transcricao ?? null }, { provider: deps.ia });
      } catch (e) {
        throw new ErroFerramenta(e instanceof z.ZodError ? "Confira título, data e links." : e instanceof Error ? e.message.slice(0, 160) : "Falha ao registrar.");
      }
      // Sem análise da IA (desligada, sem transcrição ou com erro): o resumo enviado preenche à mão, como "Preencher" na tela.
      let manuais = 0, status: string = r.status;
      if (a.resumo && (r.status === "aguardando_analise" || r.status === "erro")) {
        try {
          manuais = (await saveMeetingManual(r.meetingId, { summary: a.resumo, decisions: a.decisoes ?? [], actions: (a.acoes ?? []).map((x) => ({ titulo: x.titulo, responsavel: x.de_quem, prazo: x.prazo ?? null })) })).actionsCreated;
          status = "manual";
        } catch {
          throw new ErroFerramenta("Reunião salva, mas não consegui preencher o resumo e as ações. Confira os campos.");
        }
      }
      await auditar(ator, "meeting_ingested", c.id, { meetingId: r.meetingId, status, actions: r.actionsCreated + manuais, duplicada: r.duplicate });
      return { ok: true, cliente: c.name, reuniao_id: r.meetingId, status, acoes_criadas: r.actionsCreated + manuais, duplicada: r.duplicate, erro_analise: r.error };
    },
  }),
  def({
    nome: "lancar_financeiro", titulo: "Lançar no financeiro", escrita: true,
    descricao: "Cria um lançamento (receita ou despesa) no extrato ou uma conta a pagar, com as mesmas validações da tela. Não exclui nem edita.",
    entrada: {
      natureza: z.enum(["lancamento", "conta_a_pagar"]).default("lancamento"), tipo: z.enum(["receita", "despesa"]).describe("Conta a pagar é sempre despesa."),
      valor: z.number().finite().positive().max(1_000_000_000), descricao: z.string().trim().min(1).max(300), categoria: z.string().trim().min(1).max(80),
      data: z.string().refine(isData, "Data inválida (AAAA-MM-DD).").optional().describe("Lançamento: data (padrão hoje). Conta a pagar: vencimento (obrigatório)."),
      cliente: z.string().trim().max(120).optional().describe("Empresa/cliente do lançamento (opcional)."),
      frequencia: z.enum(["mensal", "semanal", "anual"]).optional().describe("Conta a pagar recorrente."),
      escopo: escopoFin,
    },
    async executar(ator, a, deps) {
      const op = a.natureza === "conta_a_pagar" ? "conta.criar" : "lancamento.criar";
      const recusa = recusaFinanceiro(ator.sessao, a.escopo, op);
      if (recusa) throw new ErroFerramenta(recusa);
      const prov = provedorFinanceiro(process.env, deps.financeiro);
      let id: string;
      try {
        if (a.natureza === "conta_a_pagar") {
          if (a.tipo !== "despesa") throw new ErroFerramenta("Conta a pagar é sempre despesa.");
          if (!a.data) throw new ErroFerramenta("Informe a data de vencimento (data).");
          if (a.descricao.length > 200) throw new ErroFerramenta("Descrição da conta: até 200 caracteres.");
          id = (await prov.criarConta(a.escopo, { descricao: a.descricao, valor: a.valor, data_vencimento: a.data, categoria: a.categoria, ...(a.frequencia ? { recorrente: true, frequencia: a.frequencia } : {}) })).id;
        } else {
          id = (await prov.criarTransacao(a.escopo, { tipo: a.tipo, valor: Math.round(a.valor * 100) / 100, descricao: a.descricao, categoria: a.categoria, data_transacao: a.data, empresa: a.cliente || undefined })).id;
        }
      } catch (e) { if (e instanceof ErroFerramenta) throw e; falhaExterna(e); }
      // Auditoria: quem, o quê, onde — sem valores nem descrições (mesma regra da tela).
      await auditar(ator, `financeiro_${op.replace(".", "_")}`, null, { escopo: a.escopo, entidade: a.natureza === "conta_a_pagar" ? "conta" : "lancamento", id });
      return { ok: true, id, mensagem: a.natureza === "conta_a_pagar" ? "Conta a pagar criada." : "Lançamento criado." };
    },
  }),
  def({
    nome: "atualizar_coleta_canal", titulo: "Atualizar coleta do canal", escrita: true,
    descricao: 'Pede a coleta agora dos canais do cliente (o mesmo "Atualizar agora" da tela): anúncios, Instagram, os dois, ou o Google. Pode levar até ~1,5 min. Não dispara e-mail.',
    entrada: { cliente, fonte: z.enum(["ads", "instagram", "todas", "google"]).default("todas") },
    async executar(ator, a, deps) {
      exigir(ehAdmin(ator)); // atualizarAnunciosAgora/atualizarGoogleAgoraAcao → requireOwner
      const c = await resolverCliente(a.cliente);
      let ok: boolean, mensagem: string, linhas: Record<string, number> | null = null;
      if (a.fonte === "google") {
        const r = await (deps.coletarGoogle ?? ((id: string) => atualizarGoogleAgora(id, { maxMs: 40_000 })))(c.id);
        ({ ok, mensagem } = r); linhas = r.linhas ?? null;
      } else {
        const r = await (deps.coletar ?? ((id: string, fonte: "ads" | "instagram" | "todas") => atualizarAgora(id, { fonte, maxMs: 80_000 })))(c.id, a.fonte);
        ({ ok, mensagem } = r); linhas = r.resultado?.linhas ?? null;
      }
      await auditar(ator, "channel_sync_now", c.id, { fonte: a.fonte, ok, linhas });
      return { ok, cliente: c.name, fonte: a.fonte, mensagem };
    },
  }),
];

export const NOMES_FERRAMENTAS = FERRAMENTAS.map((f) => f.nome);

/** Valida a entrada com o schema da ferramenta, executa e limpa a saída. Erros de entrada/negócio viram ErroFerramenta. */
export async function executarFerramenta(nome: string, ator: Ator, args: unknown, deps: Deps = {}, lista: Ferramenta[] = FERRAMENTAS): Promise<unknown> {
  const f = lista.find((x) => x.nome === nome);
  if (!f) throw new ErroFerramenta(`Ferramenta desconhecida: ${nome}.`);
  const v = z.object(f.entrada).safeParse(args ?? {});
  if (!v.success) throw new ErroFerramenta(`Entrada inválida: ${v.error.issues.map((i) => `${i.path.join(".") || "entrada"}: ${i.message}`).join("; ").slice(0, 400)}`);
  return limpar(await f.executar(ator, v.data, deps));
}

